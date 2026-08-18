import type {
  AnyAccountRequest,
  SignRequest,
  SignTypedDataRequest,
  WalletCallsRequest
} from '../accounts/types'
import type { TransactionData } from '../../resources/domain/transaction'
import {
  MAX_DAPP_GUARDRAIL_LIST_ENTRIES,
  DappGuardrailIntentSchema,
  type DappGuardrailIntent,
  type DappGuardrailUnverifiableReason
} from '../../resources/domain/dappGuardrails'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const CALLDATA = /^0x(?:[0-9a-fA-F]{2})*$/u
const MAX_CALLDATA_BYTES = 128 * 1024
const ABI_ADDRESS_PADDING = '0'.repeat(24)
const TRANSFER = 'a9059cbb'
const TRANSFER_FROM = '23b872dd'
const APPROVE = '095ea7b3'
const SET_APPROVAL_FOR_ALL = 'a22cb465'

const address = (value: unknown) =>
  typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : undefined

const quantity = (value: unknown) => {
  if (typeof value === 'string' && /^0x/u.test(value)) return parseRpcQuantity(value)
  if (!['string', 'number', 'bigint'].includes(typeof value)) return
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return
  try {
    const parsed = BigInt(value as string | number | bigint)
    return parsed >= 0n && parsed <= MAX_UINT256 ? parsed : undefined
  } catch {
    return
  }
}

const decodeAddress = (word: string) =>
  word.length === 64 && word.startsWith(ABI_ADDRESS_PADDING)
    ? `0x${word.slice(ABI_ADDRESS_PADDING.length)}`
    : undefined

const decodeUint256 = (word: string) => {
  if (!/^[0-9a-f]{64}$/u.test(word)) return
  try {
    return BigInt(`0x${word}`)
  } catch {
    return
  }
}

const calldataWords = (data: unknown, wordCount: number) => {
  if (
    typeof data !== 'string' ||
    !CALLDATA.test(data) ||
    (data.length - 2) / 2 > MAX_CALLDATA_BYTES ||
    data.length !== 2 + 8 + wordCount * 64
  ) {
    return
  }
  const encoded = data.slice(2).toLowerCase()
  return {
    selector: encoded.slice(0, 8),
    words: Array.from({ length: wordCount }, (_, index) =>
      encoded.slice(8 + index * 64, 8 + (index + 1) * 64)
    )
  }
}

const canonicalIntent = (
  targets: Iterable<string>,
  nativeValue: bigint,
  tokenAmounts: Map<string, bigint>,
  spenders: Iterable<string>,
  unverifiable: Set<DappGuardrailUnverifiableReason>
) =>
  DappGuardrailIntentSchema.parse({
    targets: [...new Set(targets)].sort(),
    nativeValue: toRpcQuantity(nativeValue),
    tokenAmounts: [...tokenAmounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([token, amount]) => ({ token, amount: toRpcQuantity(amount) })),
    spenders: [...new Set(spenders)].sort(),
    unverifiable: (['targets', 'nativeValue', 'tokenAmounts', 'spenders'] as const).filter((reason) =>
      unverifiable.has(reason)
    )
  })

const addTokenAmount = (
  amounts: Map<string, bigint>,
  token: string,
  amount: bigint,
  unverifiable: Set<DappGuardrailUnverifiableReason>
) => {
  if (!amounts.has(token) && amounts.size >= MAX_DAPP_GUARDRAIL_LIST_ENTRIES) {
    unverifiable.add('tokenAmounts')
    return
  }
  const next = (amounts.get(token) || 0n) + amount
  if (next > MAX_UINT256) {
    unverifiable.add('tokenAmounts')
    amounts.delete(token)
  } else {
    amounts.set(token, next)
  }
}

export function transactionDappGuardrailIntent(
  transaction: Pick<TransactionData, 'data' | 'from' | 'to' | 'value'>,
  account: string
): DappGuardrailIntent {
  const targets: string[] = []
  const tokenAmounts = new Map<string, bigint>()
  const spenders: string[] = []
  const unverifiable = new Set<DappGuardrailUnverifiableReason>()
  const target = address(transaction.to)
  const sender = address(account)
  const txSender = address(transaction.from)
  if (target) targets.push(target)
  else unverifiable.add('targets')
  if (!sender || (txSender && txSender !== sender)) {
    unverifiable.add('tokenAmounts')
    unverifiable.add('spenders')
  }

  const nativeValue = quantity(transaction.value ?? '0x0')
  if (nativeValue === undefined) unverifiable.add('nativeValue')

  const data = transaction.data ?? '0x'
  if (data !== '0x') {
    const transfer = calldataWords(data, 2)
    const transferFrom = calldataWords(data, 3)
    if (target && transfer?.selector === TRANSFER) {
      const recipient = decodeAddress(transfer.words[0] || '')
      const amount = decodeUint256(transfer.words[1] || '')
      if (!recipient || amount === undefined) unverifiable.add('tokenAmounts')
      else addTokenAmount(tokenAmounts, target, amount, unverifiable)
    } else if (target && transferFrom?.selector === TRANSFER_FROM) {
      const owner = decodeAddress(transferFrom.words[0] || '')
      const recipient = decodeAddress(transferFrom.words[1] || '')
      const amount = decodeUint256(transferFrom.words[2] || '')
      if (!sender || owner !== sender || !recipient || amount === undefined) {
        unverifiable.add('tokenAmounts')
      } else {
        addTokenAmount(tokenAmounts, target, amount, unverifiable)
      }
    } else if (target && transfer?.selector === APPROVE) {
      const spender = decodeAddress(transfer.words[0] || '')
      if (spender) spenders.push(spender)
      else unverifiable.add('spenders')
      // ERC-20 approve and ERC-721 approve share this selector; without trusted
      // interface evidence its numeric argument cannot be treated as a token amount.
      unverifiable.add('tokenAmounts')
    } else if (target && transfer?.selector === SET_APPROVAL_FOR_ALL) {
      const spender = decodeAddress(transfer.words[0] || '')
      const enabled = transfer.words[1]
      if (spender && (enabled === '0'.repeat(64) || enabled === `${'0'.repeat(63)}1`)) {
        if (enabled.endsWith('1')) spenders.push(spender)
      } else {
        unverifiable.add('spenders')
      }
      unverifiable.add('tokenAmounts')
    } else {
      unverifiable.add('tokenAmounts')
      unverifiable.add('spenders')
    }
  } else {
    // Without fresh target-code evidence an empty call may still execute a
    // contract fallback, so token and spender effects are not provably empty.
    unverifiable.add('tokenAmounts')
    unverifiable.add('spenders')
  }

  return canonicalIntent(targets, nativeValue || 0n, tokenAmounts, spenders, unverifiable)
}

export function walletCallsDappGuardrailIntent(request: WalletCallsRequest): DappGuardrailIntent {
  const targets = new Set<string>()
  const tokenAmounts = new Map<string, bigint>()
  const spenders = new Set<string>()
  const unverifiable = new Set<DappGuardrailUnverifiableReason>()
  let nativeValue = 0n

  for (const call of request.calls) {
    const intent = transactionDappGuardrailIntent({ ...call, from: request.account }, request.account)
    intent.targets.forEach((target) => targets.add(target))
    intent.spenders.forEach((spender) => spenders.add(spender))
    intent.unverifiable.forEach((reason) => unverifiable.add(reason))
    const nextNativeValue = nativeValue + BigInt(intent.nativeValue)
    if (nextNativeValue > MAX_UINT256) unverifiable.add('nativeValue')
    else nativeValue = nextNativeValue
    intent.tokenAmounts.forEach(({ token, amount }) =>
      addTokenAmount(tokenAmounts, token, BigInt(amount), unverifiable)
    )
  }

  return canonicalIntent(targets, nativeValue, tokenAmounts, spenders, unverifiable)
}

export function signatureDappGuardrailIntent(
  request: SignRequest | SignTypedDataRequest
): DappGuardrailIntent {
  const targets = new Set<string>()
  const tokenAmounts = new Map<string, bigint>()
  const spenders = new Set<string>()
  const unverifiable = new Set<DappGuardrailUnverifiableReason>()

  if (request.type === 'sign') {
    unverifiable.add('targets')
    unverifiable.add('tokenAmounts')
    unverifiable.add('spenders')
    return canonicalIntent(targets, 0n, tokenAmounts, spenders, unverifiable)
  }

  if (request.type === 'signErc20Permit') {
    const token = address(request.permit.verifyingContract.address)
    const spender = address(request.permit.spender.address)
    const amount = quantity(request.permit.value)
    if (token) targets.add(token)
    else unverifiable.add('targets')
    if (spender) spenders.add(spender)
    else unverifiable.add('spenders')
    if (token && amount !== undefined) addTokenAmount(tokenAmounts, token, amount, unverifiable)
    else unverifiable.add('tokenAmounts')
    return canonicalIntent(targets, 0n, tokenAmounts, spenders, unverifiable)
  }

  const { permit2, eip3009 } = request.context
  if (permit2) {
    const verifyingContract = address(permit2.verifyingContract)
    const spender = address(permit2.spender)
    if (verifyingContract) targets.add(verifyingContract)
    else unverifiable.add('targets')
    if (spender) spenders.add(spender)
    else unverifiable.add('spenders')
    permit2.permissions.forEach((permission) => {
      const token = address(permission.token)
      const amount = quantity(permission.amount)
      if (token && amount !== undefined) addTokenAmount(tokenAmounts, token, amount, unverifiable)
      else unverifiable.add('tokenAmounts')
    })
  } else if (eip3009) {
    const token = address(eip3009.verifyingContract)
    const amount = eip3009.value === undefined ? undefined : quantity(eip3009.value)
    if (token) targets.add(token)
    else unverifiable.add('targets')
    if (eip3009.grantsAuthority) {
      if (token && amount !== undefined) addTokenAmount(tokenAmounts, token, amount, unverifiable)
      else unverifiable.add('tokenAmounts')
    }
  } else {
    const data = Array.isArray(request.typedMessage.data) ? undefined : request.typedMessage.data
    const verifyingContract = data ? address(data.domain.verifyingContract) : undefined
    if (verifyingContract) targets.add(verifyingContract)
    else unverifiable.add('targets')
    unverifiable.add('tokenAmounts')
    unverifiable.add('spenders')
  }

  return canonicalIntent(targets, 0n, tokenAmounts, spenders, unverifiable)
}

export function requestDappGuardrailIntent(request: AnyAccountRequest): DappGuardrailIntent | undefined {
  if (request.type === 'transaction') return transactionDappGuardrailIntent(request.data, request.account)
  if (request.type === 'walletCalls') return walletCallsDappGuardrailIntent(request)
  if (request.type === 'sign' || request.type === 'signTypedData' || request.type === 'signErc20Permit') {
    return signatureDappGuardrailIntent(request)
  }
  return undefined
}
