import { decodeLocalCalldata } from '../inspector/localDecode'
import { parseSimulationEffects } from '../transaction/effects'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import type { ActivityEntry } from '../store/state/types/activity'
import type { ActivityTransactionReference } from '../store/state/types/activityTransactionReference'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import type { WalletCallBatch } from '../store/state/types/walletCallBatch'
import {
  ActivityDetailsResultSchema,
  ActivityTransactionActionSchema,
  type ActivityDetailsResult,
  type ActivityTransactionAction
} from './detailsSchema'

export { ActivityDetailsResultSchema, ActivityTransactionActionSchema } from './detailsSchema'
export type { ActivityDetailsResult, ActivityTransactionAction } from './detailsSchema'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const HASH = /^0x[0-9a-fA-F]{64}$/u
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/u
const UINT_TYPE =
  /^uint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/u
const MAX_TRANSACTION_INPUT_BYTES = 256 * 1024
const MAX_SAFE_ARGUMENTS = 16

type ActivityDetailsDependencies = Readonly<{
  activity: () => readonly ActivityEntry[]
  references: () => Record<string, ActivityTransactionReference>
  operations: () => Record<string, OperationLifecycle>
  batches: () => Record<string, WalletCallBatch>
  rpc: (chainId: number, method: string, params?: readonly unknown[]) => Promise<unknown>
  now?: () => number
}>

type ExpectedTransaction = Readonly<{
  hash: string
  account: string
  receipt?: Readonly<{ blockHash: string; blockNumber: string }>
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeAddress = (value: unknown) =>
  typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : undefined

const normalizeHash = (value: unknown) =>
  typeof value === 'string' && HASH.test(value) ? value.toLowerCase() : undefined

const normalizeQuantity = (value: unknown) => {
  const parsed = parseRpcQuantity(value)
  return parsed !== undefined && toRpcQuantity(parsed) === String(value).toLowerCase()
    ? { hex: toRpcQuantity(parsed), decimal: parsed.toString(10) }
    : undefined
}

const safeArguments = (data: string) => {
  const decoded = decodeLocalCalldata(data)
  if (decoded.status !== 'decoded') return { arguments: [] as ActivityTransactionAction['arguments'] }

  const arguments_ = decoded.arguments
    .filter(({ type }) => type === 'address' || type === 'bool' || UINT_TYPE.test(type))
    .slice(0, MAX_SAFE_ARGUMENTS)
    .flatMap(({ name, type, value }) => {
      const normalizedValue =
        type === 'address'
          ? normalizeAddress(value)
          : type === 'bool' && (value === 'true' || value === 'false')
            ? value
            : UINT_TYPE.test(type) && /^(?:0|[1-9][0-9]{0,77})$/u.test(value)
              ? value
              : undefined
      return normalizedValue ? [{ name: name.slice(0, 64), type, value: normalizedValue }] : []
    })

  return {
    method: decoded.method,
    signature: decoded.signature,
    arguments: arguments_,
    ...(decoded.truncated || arguments_.length !== decoded.arguments.length
      ? { argumentsTruncated: true as const }
      : {})
  }
}

export const projectActivityTransaction = (
  value: unknown,
  expected: ExpectedTransaction
): ActivityTransactionAction => {
  if (!isRecord(value)) throw new Error('Activity transaction lookup returned no transaction')

  const transactionHash = normalizeHash(value['hash'])
  const from = normalizeAddress(value['from'])
  const rawTo = value['to']
  const to = rawTo === null ? null : normalizeAddress(rawTo)
  const normalizedValue = normalizeQuantity(value['value'])
  const input = typeof value['input'] === 'string' ? value['input'] : value['data']
  const normalizedInput = typeof input === 'string' && DATA.test(input) ? input.toLowerCase() : undefined
  if (
    transactionHash !== expected.hash.toLowerCase() ||
    from !== expected.account.toLowerCase() ||
    (rawTo !== null && !to) ||
    !normalizedValue ||
    !normalizedInput ||
    normalizedInput.length > MAX_TRANSACTION_INPUT_BYTES * 2 + 2
  ) {
    throw new Error('Activity transaction evidence does not match the retained operation')
  }

  if (expected.receipt) {
    const blockHash = normalizeHash(value['blockHash'])
    const blockNumber = normalizeQuantity(value['blockNumber'])?.hex
    if (
      blockHash !== expected.receipt.blockHash.toLowerCase() ||
      blockNumber !== expected.receipt.blockNumber.toLowerCase()
    ) {
      throw new Error('Activity transaction is not in the retained canonical block')
    }
  }

  const inputBytes = (normalizedInput.length - 2) / 2
  const selector = inputBytes >= 4 ? normalizedInput.slice(0, 10) : undefined
  const decoded = selector ? safeArguments(normalizedInput) : { arguments: [] }
  const kind =
    to === null
      ? 'contract-deployment'
      : inputBytes > 0
        ? 'contract-call'
        : normalizedValue.decimal !== '0'
          ? 'native-value-transfer'
          : 'transaction'

  return ActivityTransactionActionSchema.parse({
    transactionHash,
    kind,
    from,
    to,
    value: normalizedValue.decimal,
    inputBytes,
    ...(selector ? { selector } : {}),
    ...decoded
  })
}

export const projectActivityReceiptEffects = (value: unknown, expected: ExpectedTransaction) => {
  if (!isRecord(value)) return undefined
  const transactionHash = normalizeHash(value['transactionHash'])
  const blockHash = normalizeHash(value['blockHash'])
  const blockNumber = normalizeQuantity(value['blockNumber'])?.hex
  if (
    transactionHash !== expected.hash.toLowerCase() ||
    (expected.receipt &&
      (blockHash !== expected.receipt.blockHash.toLowerCase() ||
        blockNumber !== expected.receipt.blockNumber.toLowerCase()))
  ) {
    return undefined
  }

  const account = expected.account.toLowerCase()
  const parsed = parseSimulationEffects(value['logs'])
  const assetChanges = parsed.effects.filter(
    (effect) => effect.type === 'transfer' && (effect.from === account || effect.to === account)
  )
  return {
    assetChanges,
    ...(parsed.truncated ? { assetChangesTruncated: true as const } : {})
  }
}

const operationTargets = (
  operation: OperationLifecycle,
  batches: Record<string, WalletCallBatch>
): ExpectedTransaction[] => {
  const hash = operation.transaction?.hash ?? operation.eip7702Revoke?.hash
  if (hash) {
    return [
      {
        hash,
        account: operation.account,
        ...(operation.receipt
          ? {
              receipt: {
                blockHash: operation.receipt.blockHash,
                blockNumber: operation.receipt.blockNumber
              }
            }
          : {})
      }
    ]
  }

  const batchOperationId = operation.walletCalls?.batchOperationId
  const batch = batchOperationId
    ? Object.values(batches).find(({ operationId }) => operationId === batchOperationId)
    : undefined
  if (
    !batch ||
    batch.account !== operation.account ||
    batch.origin !== operation.origin ||
    Number(BigInt(batch.chainId)) !== operation.chainId
  ) {
    return []
  }
  return batch.transactions.map((transaction) => ({
    hash: transaction.hash,
    account: operation.account,
    ...(transaction.receipt
      ? {
          receipt: {
            blockHash: transaction.receipt.blockHash,
            blockNumber: transaction.receipt.blockNumber
          }
        }
      : {})
  }))
}

const referenceMatchesEntry = (reference: ActivityTransactionReference | undefined, entry: ActivityEntry) =>
  reference?.id === entry.id &&
  reference.account === entry.account &&
  reference.origin === entry.origin &&
  reference.chainId === entry.chainId &&
  reference.kind === entry.type

const referenceTargets = (reference: ActivityTransactionReference): ExpectedTransaction[] =>
  reference.transactions.map(({ hash, canonicalBlock }) => ({
    hash,
    account: reference.account,
    ...(canonicalBlock
      ? {
          receipt: {
            blockHash: canonicalBlock.hash,
            blockNumber: canonicalBlock.number
          }
        }
      : {})
  }))

export const createActivityDetailsService = (dependencies: ActivityDetailsDependencies) => ({
  async get(activityId: string): Promise<ActivityDetailsResult> {
    const entry = dependencies.activity().find(({ id }) => id === activityId)
    if (!entry) return { success: false, error: 'not-found' }
    const reference = dependencies.references()[activityId]
    const operation = dependencies.operations()[activityId]
    const validReference =
      referenceMatchesEntry(reference, entry) &&
      (reference as ActivityTransactionReference).expiresAt >= (dependencies.now?.() ?? Date.now())
    const validOperation = Boolean(
      operation &&
      operation.id === entry.id &&
      operation.account === entry.account &&
      operation.chainId === entry.chainId &&
      operation.origin === entry.origin &&
      operation.kind === entry.type
    )
    if (!validReference && !validOperation) {
      return { success: false, error: 'evidence-unavailable' }
    }

    const targets = validReference
      ? referenceTargets(reference as ActivityTransactionReference)
      : operationTargets(operation as OperationLifecycle, dependencies.batches())
    if (!targets.length) return { success: false, error: 'evidence-unavailable' }
    const chainId = validReference
      ? (reference as ActivityTransactionReference).chainId
      : (operation as OperationLifecycle).chainId

    const outcomes = await Promise.all(
      targets.map(async (target) => {
        try {
          const [transaction, receipt] = await Promise.all([
            dependencies.rpc(chainId, 'eth_getTransactionByHash', [target.hash]),
            target.receipt
              ? dependencies.rpc(chainId, 'eth_getTransactionReceipt', [target.hash]).catch(() => undefined)
              : Promise.resolve(undefined)
          ])
          if (transaction === null || transaction === undefined) return { status: 'missing' as const }
          const action = projectActivityTransaction(transaction, target)
          const receiptEffects = projectActivityReceiptEffects(receipt, target)
          return {
            status: 'found' as const,
            action: ActivityTransactionActionSchema.parse({ ...action, ...receiptEffects })
          }
        } catch {
          return { status: 'error' as const }
        }
      })
    )
    const actions = outcomes.flatMap((outcome) => (outcome.status === 'found' ? [outcome.action] : []))
    if (!actions.length) {
      return {
        success: false,
        error: outcomes.every(({ status }) => status === 'missing') ? 'evidence-unavailable' : 'lookup-failed'
      }
    }
    return ActivityDetailsResultSchema.parse({
      success: true,
      actions,
      partial: actions.length !== targets.length
    })
  }
})
