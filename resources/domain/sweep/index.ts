import { getAddress } from 'ethers'

import { erc20Interface } from '../../contracts'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from '../transaction/quantity'

export const MAX_SWEEP_CALLS = 16
export const SWEEP_VERSION = '1' as const

const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER)

export interface SweepDraft {
  account: string
  chainId: number
  recipient: string
  tokens: readonly string[]
  includeNative: boolean
}

export interface SweepSelection {
  readonly version: typeof SWEEP_VERSION
  readonly account: string
  readonly chainId: string
  readonly recipient: string
  readonly tokens: readonly string[]
  readonly includeNative: boolean
}

export interface SweepCall {
  readonly to: string
  readonly data: string
  readonly value: string
}

export interface SweepEvidence {
  readonly version: typeof SWEEP_VERSION
  readonly account: string
  readonly chainId: string
  readonly recipient: string
  readonly tokens: readonly Readonly<{ address: string; balance: string }>[]
  readonly native: Readonly<{
    selected: boolean
    balance: string
    value: string
  }>
  readonly maximumFee: string
  readonly l1Fees: readonly string[]
  readonly calls: readonly SweepCall[]
  readonly execution: 'sequential-non-atomic'
}

function canonicalAddress(value: unknown, field: string) {
  if (typeof value !== 'string') throw new Error(`Sweep ${field} is invalid`)
  try {
    return getAddress(value).toLowerCase()
  } catch {
    throw new Error(`Sweep ${field} is invalid`)
  }
}

function quantity(value: unknown, field: string) {
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined || parsed > MAX_UINT256) throw new Error(`Sweep ${field} is invalid`)
  return parsed
}

export function snapshotSweepSelection(input: SweepDraft): SweepSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Sweep selection is invalid')
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error('Sweep chain is invalid')
  }
  const chainId = BigInt(input.chainId)
  if (chainId > MAX_SAFE_CHAIN_ID) throw new Error('Sweep chain is invalid')
  if (!Array.isArray(input.tokens) || typeof input.includeNative !== 'boolean') {
    throw new Error('Sweep assets are invalid')
  }

  const account = canonicalAddress(input.account, 'account')
  const recipient = canonicalAddress(input.recipient, 'recipient')
  if (account === recipient) throw new Error('Sweep recipient must differ from the sending account')

  const tokens = input.tokens.map((token) => canonicalAddress(token, 'token'))
  if (new Set(tokens).size !== tokens.length) throw new Error('Sweep token selection contains duplicates')
  if (tokens.includes(account)) throw new Error('Sweep token selection is invalid')

  const callCount = tokens.length + (input.includeNative ? 1 : 0)
  if (callCount < 1 || callCount > MAX_SWEEP_CALLS) {
    throw new Error(`Sweep requires between 1 and ${MAX_SWEEP_CALLS} explicitly selected assets`)
  }

  return Object.freeze({
    version: SWEEP_VERSION,
    account,
    chainId: toRpcQuantity(chainId),
    recipient,
    tokens: Object.freeze(tokens),
    includeNative: input.includeNative
  })
}

export function buildSweepBalanceCall(token: string, account: string): SweepCall {
  return Object.freeze({
    to: canonicalAddress(token, 'token'),
    data: erc20Interface.encodeFunctionData('balanceOf', [canonicalAddress(account, 'account')]),
    value: '0x0'
  })
}

export function parseSweepBalanceResult(value: unknown) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new Error('Sweep token balance response is invalid')
  }
  try {
    const [balance] = erc20Interface.decodeFunctionResult('balanceOf', value)
    if (typeof balance !== 'bigint' || balance < 0n || balance > MAX_UINT256) {
      throw new Error('invalid decoded balance')
    }
    return balance
  } catch {
    throw new Error('Sweep token balance response is invalid')
  }
}

export function buildSweepTokenCall(token: string, recipient: string, balanceInput: unknown): SweepCall {
  const balance = quantity(balanceInput, 'token balance')
  if (balance === 0n) throw new Error('Selected sweep token has no pending balance')
  return Object.freeze({
    to: canonicalAddress(token, 'token'),
    data: erc20Interface.encodeFunctionData('transfer', [canonicalAddress(recipient, 'recipient'), balance]),
    value: '0x0'
  })
}

export function createSweepEvidence(
  selectionInput: SweepSelection,
  tokenBalancesInput: readonly unknown[],
  nativeBalanceInput: unknown,
  maximumFeeInput: unknown,
  l1FeesInput: readonly unknown[] = []
): SweepEvidence {
  const selection = snapshotSweepSelection({
    account: selectionInput.account,
    chainId: Number(BigInt(selectionInput.chainId)),
    recipient: selectionInput.recipient,
    tokens: selectionInput.tokens,
    includeNative: selectionInput.includeNative
  })
  if (!Array.isArray(tokenBalancesInput) || tokenBalancesInput.length !== selection.tokens.length) {
    throw new Error('Sweep token balance evidence does not match the selection')
  }

  const tokens = selection.tokens.map((address, index) => {
    const balance = quantity(tokenBalancesInput[index], 'token balance')
    if (balance === 0n) throw new Error(`Selected sweep token ${address} has no pending balance`)
    return Object.freeze({ address, balance: toRpcQuantity(balance) })
  })
  const nativeBalance = quantity(nativeBalanceInput, 'native balance')
  const maximumFee = quantity(maximumFeeInput, 'maximum fee')
  if (maximumFee > nativeBalance) {
    throw new Error('Sweep account cannot cover the batch maximum fees')
  }
  const nativeValue = selection.includeNative ? nativeBalance - maximumFee : 0n
  if (selection.includeNative && nativeValue === 0n) {
    throw new Error('Selected native sweep has no value after reserving maximum fees')
  }

  const calls: SweepCall[] = tokens.map(({ address, balance }) =>
    buildSweepTokenCall(address, selection.recipient, balance)
  )
  if (selection.includeNative) {
    calls.push(Object.freeze({ to: selection.recipient, data: '0x', value: toRpcQuantity(nativeValue) }))
  }
  if (l1FeesInput.length !== 0 && l1FeesInput.length !== calls.length) {
    throw new Error('Sweep L1 fee evidence does not match the selected calls')
  }
  const l1Fees = (l1FeesInput.length ? l1FeesInput : calls.map(() => '0x0')).map((fee) =>
    toRpcQuantity(quantity(fee, 'L1 fee'))
  )

  return Object.freeze({
    version: SWEEP_VERSION,
    account: selection.account,
    chainId: selection.chainId,
    recipient: selection.recipient,
    tokens: Object.freeze(tokens),
    native: Object.freeze({
      selected: selection.includeNative,
      balance: toRpcQuantity(nativeBalance),
      value: toRpcQuantity(nativeValue)
    }),
    maximumFee: toRpcQuantity(maximumFee),
    l1Fees: Object.freeze(l1Fees),
    calls: Object.freeze(calls),
    execution: 'sequential-non-atomic'
  })
}

export function assertSweepEvidenceStable(expected: SweepEvidence, actual: SweepEvidence) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Sweep balances, fees, or calls changed; review a fresh sweep quote before submitting')
  }
  return actual
}

export function snapshotSweepEvidence(input: SweepEvidence): SweepEvidence {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== SWEEP_VERSION) {
    throw new Error('Sweep evidence is invalid')
  }
  const selection = snapshotSweepSelection({
    account: input.account,
    chainId: Number(BigInt(input.chainId)),
    recipient: input.recipient,
    tokens: input.tokens?.map((token) => token?.address),
    includeNative: input.native?.selected
  })
  const snapshot = createSweepEvidence(
    selection,
    input.tokens.map((token) => token.balance),
    input.native.balance,
    input.maximumFee,
    input.l1Fees
  )
  if (
    input.execution !== 'sequential-non-atomic' ||
    input.native.value !== snapshot.native.value ||
    JSON.stringify(input.calls) !== JSON.stringify(snapshot.calls)
  ) {
    throw new Error('Sweep evidence does not match its selected assets')
  }
  return snapshot
}
