import type { Chain } from '../chains'
import type { TransactionData } from '../../resources/domain/transaction'
import {
  buildErc20AllowanceCalldata,
  parseErc20AllowanceResult,
  parseErc20ApprovalIntent
} from '../../resources/domain/transaction/allowance'
import { parseRpcQuantity } from '../../resources/domain/transaction/quantity'
import { parseAccountCode } from '../../resources/domain/account/code'
import { parseSimulationEffects } from './effects'
import type { SimulationEffect } from './effects'
import log from 'electron-log'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_ERROR_MESSAGE_LENGTH = 240
const MAX_RETURN_DATA_BYTES = 128 * 1024
const MAX_WALLET_CALLS = 16
const MAX_BALANCE_CHANGE_ACCOUNTS = 128
const MAX_TRACE_ACCOUNTS = 1024
const MAX_TRACE_STORAGE_ENTRIES = 8192
const MAX_PROXY_IMPLEMENTATION_CHANGES = 32
const MAX_CALL_TRACE_ENTRIES = 100
const MAX_INSPECTED_CALL_FRAMES = 512
const MAX_CALL_TRACE_CHILDREN = 256
const MAX_CALL_TRACE_DEPTH = 32
const MAX_CALL_TRACE_INPUT_BYTES = 512 * 1024
const MAX_UINT64 = (1n << 64n) - 1n
const MAX_UINT256 = (1n << 256n) - 1n
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const STORAGE_WORD = /^0x[0-9a-fA-F]{64}$/
const ZERO_STORAGE_WORD = `0x${'0'.repeat(64)}`
const ERC1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export { parseDelegationIndicator } from '../../resources/domain/account/code'

type SimulationSource = 'eth_simulateV1' | 'eth_call'
type SimulationStatus = 'pending' | 'succeeded' | 'reverted' | 'unavailable' | 'failed'

export interface TokenAllowanceSnapshot {
  source: 'eth_call'
  token: string
  owner: string
  spender: string
  currentAmount: string
  requestedAmount: string
}

export interface AccountDelegationCheck {
  status: 'delegated' | 'undelegated' | 'unavailable'
  source: 'eth_getCode'
  account: string
  delegate?: string
  reason?: string
}

export type AccountCodeEvidenceReason =
  'invalid-address' | 'invalid-chain' | 'timeout' | 'invalid-response' | 'rpc-error' | 'invalid-code'

interface AccountCodeEvidenceBase {
  source: 'eth_getCode'
  trust: 'configured-rpc'
  account: string
}

export type AccountCodeEvidence = AccountCodeEvidenceBase &
  (
    | {
        status: 'no-code' | 'contract'
        codeHash: string
      }
    | {
        status: 'delegated'
        codeHash: string
        authority: string
        delegate: string
        delegateCodeStatus: 'no-code' | 'contract' | 'delegated' | 'unavailable'
        delegateCodeHash?: string
        delegateCodeReasonCode?: AccountCodeEvidenceReason
        delegateCodeReason?: string
      }
    | {
        status: 'unavailable'
        reasonCode: AccountCodeEvidenceReason
        reason: string
      }
  )

export type SenderAccountCodeEvidence = AccountCodeEvidence & { role: 'sender' }
export type TargetAccountCodeEvidence = AccountCodeEvidence & {
  role: 'target'
  callIndexes: readonly number[]
}

export interface TransactionAccountCodeEvidence {
  source: 'configured-rpc'
  sender: SenderAccountCodeEvidence
  targets: readonly TargetAccountCodeEvidence[]
}

export type AccountCodeEvidenceFailureCode =
  'account-code-evidence-missing' | 'account-code-evidence-unavailable' | 'account-code-evidence-changed'

export interface AccountCodeEvidenceFailureData {
  role: 'sender' | 'target'
  account: string
  expected?: AccountCodeEvidence
  actual?: AccountCodeEvidence
}

export class AccountCodeEvidenceError extends Error {
  readonly code: AccountCodeEvidenceFailureCode
  readonly data: Readonly<AccountCodeEvidenceFailureData>

  constructor(code: AccountCodeEvidenceFailureCode, data: AccountCodeEvidenceFailureData) {
    const message =
      code === 'account-code-evidence-changed'
        ? `Delegation changed for ${data.account}. Request not sent.`
        : `Delegation recheck unavailable for ${data.account}. Request not sent.`
    super(message)
    this.name = 'AccountCodeEvidenceError'
    this.code = code
    this.data = Object.freeze({ ...data })
  }
}

export function isRecoverableAccountCodeEvidenceError(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return ['account-code-evidence-unavailable', 'account-code-evidence-changed'].includes(String(error.code))
}

function sameAccountCodeEvidence(expected: AccountCodeEvidence, actual: AccountCodeEvidence) {
  if (expected.status !== actual.status || expected.account !== actual.account) return false
  if (expected.status === 'unavailable' || actual.status === 'unavailable') return false
  if (expected.codeHash !== actual.codeHash) return false
  if (expected.status !== 'delegated' || actual.status !== 'delegated') return true
  return (
    expected.delegate === actual.delegate &&
    expected.authority === actual.authority &&
    expected.delegateCodeStatus === actual.delegateCodeStatus &&
    expected.delegateCodeHash === actual.delegateCodeHash
  )
}

function accountCodeEvidenceUnavailable(evidence: AccountCodeEvidence) {
  return (
    evidence.status === 'unavailable' ||
    (evidence.status === 'delegated' && evidence.delegateCodeStatus === 'unavailable')
  )
}

export function assertAccountCodeEvidenceStable(
  expected: TransactionAccountCodeEvidence | undefined,
  actual: TransactionAccountCodeEvidence,
  expectedCallIndex = 0
) {
  const fail = (
    code: AccountCodeEvidenceFailureCode,
    role: 'sender' | 'target',
    account: string,
    expectedEvidence?: AccountCodeEvidence,
    actualEvidence?: AccountCodeEvidence
  ): never => {
    throw new AccountCodeEvidenceError(code, {
      role,
      account,
      ...(expectedEvidence ? { expected: expectedEvidence } : {}),
      ...(actualEvidence ? { actual: actualEvidence } : {})
    })
  }

  if (!expected) {
    fail('account-code-evidence-missing', 'sender', actual.sender.account, undefined, actual.sender)
  }
  const reviewed = expected as TransactionAccountCodeEvidence
  if (accountCodeEvidenceUnavailable(reviewed.sender) || accountCodeEvidenceUnavailable(actual.sender)) {
    fail(
      'account-code-evidence-unavailable',
      'sender',
      actual.sender.account || reviewed.sender.account,
      reviewed.sender,
      actual.sender
    )
  }
  if (!sameAccountCodeEvidence(reviewed.sender, actual.sender)) {
    fail(
      'account-code-evidence-changed',
      'sender',
      actual.sender.account || reviewed.sender.account,
      reviewed.sender,
      actual.sender
    )
  }

  const reviewedTargets = reviewed.targets.filter((target) => target.callIndexes.includes(expectedCallIndex))
  const actualTargets = actual.targets.filter((target) => target.callIndexes.includes(0))
  if (reviewedTargets.length !== actualTargets.length) {
    const reviewedTarget = reviewedTargets[0]
    const actualTarget = actualTargets[0]
    fail(
      'account-code-evidence-changed',
      'target',
      actualTarget?.account || reviewedTarget?.account || '',
      reviewedTarget,
      actualTarget
    )
  }

  for (let index = 0; index < actualTargets.length; index += 1) {
    const actualTarget = actualTargets[index]!
    const reviewedTarget = reviewedTargets[index]!
    if (accountCodeEvidenceUnavailable(reviewedTarget) || accountCodeEvidenceUnavailable(actualTarget)) {
      fail(
        'account-code-evidence-unavailable',
        'target',
        actualTarget.account || reviewedTarget.account,
        reviewedTarget,
        actualTarget
      )
    }
    if (!sameAccountCodeEvidence(reviewedTarget, actualTarget)) {
      fail(
        'account-code-evidence-changed',
        'target',
        actualTarget.account || reviewedTarget.account,
        reviewedTarget,
        actualTarget
      )
    }
  }
}

export interface NativeBalanceChange {
  account: string
  before: string
  after: string
  change: string
}

export type NativeBalanceChanges =
  | {
      status: 'succeeded'
      source: 'debug_traceCall'
      changes: NativeBalanceChange[]
      truncated?: boolean
    }
  | {
      status: 'unavailable' | 'failed'
      source: 'debug_traceCall'
      reason: string
    }

export type CallTraceType =
  'CALL' | 'STATICCALL' | 'DELEGATECALL' | 'CALLCODE' | 'CREATE' | 'CREATE2' | 'SELFDESTRUCT'

export interface CallTraceEntry {
  type: CallTraceType
  depth: number
  from: string
  to?: string
  value: string
  inputBytes: number
  selector?: string
  failure?: string
}

export interface CallTraceEvidence {
  source: 'debug_traceCall'
  calls: CallTraceEntry[]
  truncated?: boolean
}

export interface ProxyImplementationChange {
  proxy: string
  kind: 'initialized' | 'changed' | 'cleared'
  beforeValue: string
  afterValue: string
  beforeImplementation?: string
  afterImplementation?: string
}

interface ProxyImplementationCheckBase {
  source: 'debug_traceCall'
  standard: 'ERC-1967'
  slot: string
}

export type ProxyImplementationCheck = ProxyImplementationCheckBase &
  (
    | {
        status: 'succeeded'
        changes: ProxyImplementationChange[]
        truncated?: boolean
      }
    | {
        status: 'unavailable' | 'failed'
        reason: string
      }
  )

export interface TransactionSimulation {
  status: SimulationStatus
  source?: SimulationSource
  gasUsed?: string
  reason?: string
  effects?: SimulationEffect[]
  effectsTruncated?: boolean
  returnDataKind?: 'abi-bool-true' | 'abi-bool-false' | 'other'
  allowance?: TokenAllowanceSnapshot
  delegation?: AccountDelegationCheck
  accountCodeEvidence?: TransactionAccountCodeEvidence
  nativeBalanceChanges?: NativeBalanceChanges
  callTrace?: CallTraceEvidence
  proxyImplementationCheck?: ProxyImplementationCheck
  advancedChecks?: {
    status: 'pending' | 'complete' | 'partly-unavailable'
  }
}

export interface SimulationCallData {
  chainId: TransactionData['chainId']
  type?: TransactionData['type']
  nonce?: TransactionData['nonce']
  from?: TransactionData['from']
  to?: TransactionData['to']
  gasLimit?: TransactionData['gasLimit']
  gas?: TransactionData['gas']
  value?: TransactionData['value']
  data?: TransactionData['data']
  gasPrice?: TransactionData['gasPrice']
  maxPriorityFeePerGas?: TransactionData['maxPriorityFeePerGas']
  maxFeePerGas?: TransactionData['maxFeePerGas']
  accessList?: TransactionData['accessList']
}

export interface WalletCallsSimulationResult {
  status: Exclude<SimulationStatus, 'pending'>
  source: 'eth_simulateV1'
  calls: TransactionSimulation[]
  reason?: string
  delegation?: AccountDelegationCheck
  accountCodeEvidence?: TransactionAccountCodeEvidence
}

export type WalletCallsSimulation = { status: 'pending'; calls: [] } | WalletCallsSimulationResult

type ChainSend = (payload: JSONRPCRequestPayload, callback: RPCRequestCallback, targetChain: Chain) => void

interface SimulationDependencies {
  send: ChainSend
  timeoutMs?: number
  onCoreResult?: (simulation: TransactionSimulation) => void
}

const timingBucket = (durationMs: number) => {
  if (durationMs < 250) return 'under-250ms'
  if (durationMs < 1000) return 'under-1s'
  if (durationMs < 3000) return 'under-3s'
  if (durationMs < 8000) return 'under-8s'
  return '8s-or-more'
}

function logReviewTiming(phase: string, startedAt: number, outcome: string) {
  // Jest exercises deliberately unanswered RPC paths whose bounded timers can
  // settle after a suite ends. Keep operational timing production-only.
  if (process.env.NODE_ENV === 'test') return

  log.info('transaction review timing', {
    phase,
    outcome,
    duration: timingBucket(Date.now() - startedAt)
  })
}

type RpcOutcome = { response: RPCResponsePayload } | { timedOut: true }

interface RpcCandidate extends Record<string, unknown> {
  message?: unknown
  code?: unknown
  data?: unknown
  error?: unknown
  result?: unknown
  gasUsed?: unknown
  returnData?: unknown
  status?: unknown
  logs?: unknown
  calls?: unknown
}

interface BuiltSimulationCall extends Record<string, unknown> {
  input?: unknown
  nonce?: unknown
  type?: unknown
  data?: unknown
}

function isRecord(value: unknown): value is RpcCandidate {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: object, property: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, property)
}

function boundedMessage(value: unknown, fallback: string) {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback
  return value.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function isData(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_RETURN_DATA_BYTES * 2 + 2 &&
    /^0x(?:[0-9a-fA-F]{2})*$/.test(value)
  )
}

function parseGasUsed(value: unknown) {
  const gasUsed = parseRpcQuantity(value)
  return gasUsed !== undefined && gasUsed <= MAX_UINT64 ? (value as string) : undefined
}

function errorResult(source: SimulationSource, error: EVMError): TransactionSimulation {
  const reason = boundedMessage(error.message, 'RPC execution check failed')

  if (error.code === 3 || /^execution reverted\b/i.test(reason)) {
    return { status: 'reverted', source, reason }
  }

  return { status: 'failed', source, reason }
}

function isUnsupportedMethod(error: EVMError) {
  return error.code === -32601 || error.code === -32004
}

function normalizeRpcError(value: unknown): EVMError | undefined {
  if (!isRecord(value) || typeof value.message !== 'string') return

  return {
    message: value.message,
    ...(typeof value.code === 'number' && { code: value.code }),
    ...(value.data !== undefined && { data: value.data })
  }
}

function requestRpc(
  send: ChainSend,
  payload: JSONRPCRequestPayload,
  targetChain: Chain,
  timeoutMs: number
): Promise<RpcOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: RpcOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)

    try {
      send(payload, (response) => finish({ response }), targetChain)
    } catch (error) {
      finish({
        response: {
          id: payload.id,
          jsonrpc: payload.jsonrpc,
          error: { message: error instanceof Error ? error.message : 'RPC execution check failed' }
        }
      })
    }
  })
}

function copyCallField(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined) target[key] = value
}

export function buildSimulationCall(transaction: SimulationCallData) {
  const call: BuiltSimulationCall = {}

  copyCallField(call, 'type', transaction.type)
  copyCallField(call, 'nonce', transaction.nonce)
  copyCallField(call, 'from', transaction.from)
  copyCallField(call, 'to', transaction.to)
  copyCallField(call, 'gas', transaction.gasLimit || transaction.gas)
  copyCallField(call, 'value', transaction.value)
  copyCallField(call, 'input', transaction.data)
  copyCallField(call, 'gasPrice', transaction.gasPrice)
  copyCallField(call, 'maxPriorityFeePerGas', transaction.maxPriorityFeePerGas)
  copyCallField(call, 'maxFeePerGas', transaction.maxFeePerGas)
  copyCallField(call, 'accessList', transaction.accessList)

  return call
}

export function buildEthCall(transaction: SimulationCallData) {
  const call = buildSimulationCall(transaction)
  const { input, nonce: _nonce, type: _type, ...ethCall } = call

  if (input !== undefined) ethCall.data = input
  return ethCall
}

function parseBalance(value: unknown) {
  const balance = parseRpcQuantity(value)
  return balance !== undefined && balance <= MAX_UINT256 ? balance : undefined
}

const CALL_TRACE_TYPES = new Set<CallTraceType>([
  'CALL',
  'STATICCALL',
  'DELEGATECALL',
  'CALLCODE',
  'CREATE',
  'CREATE2',
  'SELFDESTRUCT'
])

interface ParsedCallFrame {
  entry: Omit<CallTraceEntry, 'depth'>
  input: string
  children: unknown[]
}

function parseCallFrame(value: unknown): ParsedCallFrame | undefined {
  if (
    !isRecord(value) ||
    typeof value['type'] !== 'string' ||
    !CALL_TRACE_TYPES.has(value['type'] as CallTraceType)
  ) {
    return
  }

  const type = value['type'] as CallTraceType
  const fromValue = value['from']
  const toValue = value['to']
  const inputValue = value['input'] === undefined ? '0x' : value['input']
  const from = typeof fromValue === 'string' && ADDRESS.test(fromValue) ? fromValue.toLowerCase() : undefined
  const to = typeof toValue === 'string' && ADDRESS.test(toValue) ? toValue.toLowerCase() : undefined
  const input = typeof inputValue === 'string' && isData(inputValue) ? inputValue : undefined
  const parsedValue = value['value'] === undefined ? 0n : parseBalance(value['value'])
  const children = value['calls'] === undefined ? [] : value['calls']

  if (
    !from ||
    (!to && type !== 'CREATE' && type !== 'CREATE2') ||
    !input ||
    parsedValue === undefined ||
    !Array.isArray(children)
  ) {
    return
  }

  const failureValue = value['error'] ?? value['revertReason']
  if (failureValue !== undefined && typeof failureValue !== 'string') return

  const inputBytes = (input.length - 2) / 2
  const hasSelector = type !== 'CREATE' && type !== 'CREATE2' && inputBytes >= 4
  return {
    entry: {
      type,
      from,
      ...(to && { to }),
      value: parsedValue.toString(10),
      inputBytes,
      ...(hasSelector && { selector: input.slice(0, 10).toLowerCase() }),
      ...(failureValue !== undefined && {
        failure: boundedMessage(failureValue, 'Internal call failed')
      })
    },
    input: input.toLowerCase(),
    children
  }
}

function callTraceRootMatches(frame: ParsedCallFrame, transaction: SimulationCallData) {
  const expectedFrom =
    typeof transaction.from === 'string' && ADDRESS.test(transaction.from)
      ? transaction.from.toLowerCase()
      : undefined
  const expectedTo =
    typeof transaction.to === 'string' && ADDRESS.test(transaction.to)
      ? transaction.to.toLowerCase()
      : undefined
  const expectedInput = transaction.data === undefined ? '0x' : transaction.data
  const expectedValue = transaction.value === undefined ? 0n : parseBalance(transaction.value)

  if (!expectedFrom || !isData(expectedInput) || expectedValue === undefined) return false
  if (frame.entry.from !== expectedFrom || frame.input !== expectedInput.toLowerCase()) return false
  if (BigInt(frame.entry.value) !== expectedValue) return false

  return expectedTo
    ? frame.entry.type === 'CALL' && frame.entry.to === expectedTo
    : frame.entry.type === 'CREATE'
}

export function parseCallTrace(
  result: unknown,
  transaction: SimulationCallData
): { calls: CallTraceEntry[]; truncated: boolean } | undefined {
  const root = parseCallFrame(result)
  if (!root || !callTraceRootMatches(root, transaction)) return

  const calls: CallTraceEntry[] = []
  let inspected = 0
  let inputBytes = 0
  let truncated = false
  const stack: Array<{ value: unknown; depth: number; include: boolean }> = [
    { value: result, depth: 0, include: root.entry.type === 'CREATE' }
  ]

  while (stack.length) {
    const candidate = stack.pop()
    if (!candidate) break
    if (inspected === MAX_INSPECTED_CALL_FRAMES) {
      truncated = true
      break
    }

    const frame = parseCallFrame(candidate.value)
    if (!frame) return
    inspected += 1
    inputBytes += frame.entry.inputBytes
    if (inputBytes > MAX_CALL_TRACE_INPUT_BYTES) return

    if (candidate.include) {
      if (calls.length < MAX_CALL_TRACE_ENTRIES) {
        calls.push({ ...frame.entry, depth: candidate.depth })
      } else {
        truncated = true
      }
    }

    if (frame.children.length > MAX_CALL_TRACE_CHILDREN) truncated = true
    if (candidate.depth === MAX_CALL_TRACE_DEPTH) {
      truncated ||= frame.children.length > 0
      continue
    }

    const children = frame.children.slice(0, MAX_CALL_TRACE_CHILDREN)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: candidate.depth + 1, include: true })
    }
  }

  return { calls, truncated }
}

function parseTraceAccounts(value: unknown) {
  if (!isRecord(value)) return

  const entries = Object.entries(value)
  if (entries.length > MAX_TRACE_ACCOUNTS) return

  const accounts = new Map<string, RpcCandidate>()
  for (const [address, state] of entries) {
    if (!ADDRESS.test(address) || !isRecord(state)) return

    const normalizedAddress = address.toLowerCase()
    if (accounts.has(normalizedAddress)) return
    accounts.set(normalizedAddress, state)
  }
  return accounts
}

export function parseNativeBalanceChanges(result: unknown):
  | {
      changes: NativeBalanceChange[]
      truncated: boolean
    }
  | undefined {
  if (!isRecord(result)) return
  const preAccounts = parseTraceAccounts(result['pre'])
  const postAccounts = parseTraceAccounts(result['post'])
  if (!preAccounts || !postAccounts) return

  const addresses = [...new Set([...preAccounts.keys(), ...postAccounts.keys()])].sort()

  const truncated = addresses.length > MAX_BALANCE_CHANGE_ACCOUNTS
  const changes: NativeBalanceChange[] = []
  for (const address of addresses.slice(0, MAX_BALANCE_CHANGE_ACCOUNTS)) {
    const pre = preAccounts.get(address)
    const post = postAccounts.get(address)

    const preHasBalance = pre !== undefined && hasOwn(pre, 'balance')
    const postHasBalance = post !== undefined && hasOwn(post, 'balance')
    if (!postHasBalance && post !== undefined) continue
    if (!preHasBalance && pre !== undefined && postHasBalance) return

    const before = pre === undefined ? 0n : parseBalance(pre['balance'])
    const after = post === undefined ? 0n : parseBalance(post['balance'])
    if (before === undefined || after === undefined) return
    if (before === after) continue

    changes.push({
      account: address.toLowerCase(),
      before: before.toString(10),
      after: after.toString(10),
      change: (after - before).toString(10)
    })
  }

  return { changes, truncated }
}

function findTraceStorageWord(
  account: RpcCandidate | undefined,
  slot: string,
  budget: { inspected: number }
) {
  if (!account || !hasOwn(account, 'storage')) return { present: false as const }
  if (!isRecord(account['storage'])) return

  const storage = account['storage']
  let word: string | undefined
  for (const key in storage) {
    if (!hasOwn(storage, key)) continue
    budget.inspected += 1
    if (budget.inspected > MAX_TRACE_STORAGE_ENTRIES) return
    if (key.toLowerCase() !== slot) continue
    const value = storage[key]
    if (word !== undefined || typeof value !== 'string' || !STORAGE_WORD.test(value)) return
    word = value.toLowerCase()
  }

  return word === undefined ? { present: false as const } : { present: true as const, word }
}

function parseStorageAddress(word: string | undefined) {
  if (word === undefined) return
  if (!STORAGE_WORD.test(word) || !/^0x0{24}/.test(word)) return
  return `0x${word.slice(-40).toLowerCase()}`
}

export function parseProxyImplementationChanges(
  result: unknown
): { changes: ProxyImplementationChange[]; truncated: boolean } | undefined {
  if (!isRecord(result)) return
  const preAccounts = parseTraceAccounts(result['pre'])
  const postAccounts = parseTraceAccounts(result['post'])
  if (!preAccounts || !postAccounts) return

  const addresses = [...new Set([...preAccounts.keys(), ...postAccounts.keys()])].sort()
  const changes: ProxyImplementationChange[] = []
  const storageBudget = { inspected: 0 }
  let changeCount = 0

  for (const proxy of addresses) {
    const beforeWord = findTraceStorageWord(
      preAccounts.get(proxy),
      ERC1967_IMPLEMENTATION_SLOT,
      storageBudget
    )
    const afterWord = findTraceStorageWord(
      postAccounts.get(proxy),
      ERC1967_IMPLEMENTATION_SLOT,
      storageBudget
    )
    if (!beforeWord || !afterWord) return
    if (!beforeWord.present && !afterWord.present) continue

    const beforeValue = beforeWord.present ? beforeWord.word : ZERO_STORAGE_WORD
    const afterValue = afterWord.present ? afterWord.word : ZERO_STORAGE_WORD
    if (beforeValue === afterValue) continue

    const beforeImplementation = parseStorageAddress(beforeValue)
    const afterImplementation = parseStorageAddress(afterValue)
    const kind =
      beforeValue === ZERO_STORAGE_WORD
        ? 'initialized'
        : afterValue === ZERO_STORAGE_WORD
          ? 'cleared'
          : 'changed'

    changeCount += 1
    if (changes.length < MAX_PROXY_IMPLEMENTATION_CHANGES) {
      changes.push({
        proxy,
        kind,
        beforeValue,
        afterValue,
        ...(beforeImplementation ? { beforeImplementation } : {}),
        ...(afterImplementation ? { afterImplementation } : {})
      })
    }
  }

  return { changes, truncated: changeCount > changes.length }
}

interface PrestateTraceEvidence {
  nativeBalanceChanges: NativeBalanceChanges
  proxyImplementationCheck: ProxyImplementationCheck
}

function proxyImplementationCheck(
  status: 'unavailable' | 'failed',
  reason: string
): ProxyImplementationCheck {
  return {
    status,
    source: 'debug_traceCall',
    standard: 'ERC-1967',
    slot: ERC1967_IMPLEMENTATION_SLOT,
    reason
  }
}

async function readPrestateTrace(
  transaction: SimulationCallData,
  send: ChainSend,
  targetChain: Chain,
  timeoutMs: number
): Promise<PrestateTraceEvidence> {
  if (timeoutMs <= 0) {
    return {
      nativeBalanceChanges: {
        status: 'unavailable',
        source: 'debug_traceCall',
        reason: 'Native balance-change trace exceeded the simulation time budget'
      },
      proxyImplementationCheck: proxyImplementationCheck(
        'unavailable',
        'ERC-1967 net implementation-slot trace exceeded the simulation time budget'
      )
    }
  }

  const outcome = await requestRpc(
    send,
    {
      id: 4,
      jsonrpc: '2.0',
      method: 'debug_traceCall',
      params: [
        buildEthCall(transaction),
        'latest',
        {
          tracer: 'prestateTracer',
          timeout: `${Math.ceil(timeoutMs)}ms`,
          tracerConfig: { diffMode: true, disableCode: true, disableStorage: false }
        }
      ]
    },
    targetChain,
    timeoutMs
  )

  if ('timedOut' in outcome) {
    return {
      nativeBalanceChanges: {
        status: 'unavailable',
        source: 'debug_traceCall',
        reason: 'Native balance-change trace timed out'
      },
      proxyImplementationCheck: proxyImplementationCheck(
        'unavailable',
        'ERC-1967 net implementation-slot trace timed out'
      )
    }
  }
  if (!isRecord(outcome.response) || outcome.response.id !== 4 || outcome.response.jsonrpc !== '2.0') {
    return {
      nativeBalanceChanges: {
        status: 'failed',
        source: 'debug_traceCall',
        reason: 'RPC returned an invalid native balance-change response'
      },
      proxyImplementationCheck: proxyImplementationCheck(
        'failed',
        'RPC returned an invalid ERC-1967 implementation-slot response'
      )
    }
  }
  if (outcome.response.error !== undefined) {
    const error = normalizeRpcError(outcome.response.error)
    if (!error) {
      return {
        nativeBalanceChanges: {
          status: 'failed',
          source: 'debug_traceCall',
          reason: 'RPC returned an invalid native balance-change error'
        },
        proxyImplementationCheck: proxyImplementationCheck(
          'failed',
          'RPC returned an invalid ERC-1967 implementation-slot error'
        )
      }
    }

    const unsupported = isUnsupportedMethod(error)
    return {
      nativeBalanceChanges: {
        status: unsupported ? 'unavailable' : 'failed',
        source: 'debug_traceCall',
        reason: unsupported
          ? 'Configured RPC does not support native balance-change tracing'
          : boundedMessage(error.message, 'Native balance-change trace failed')
      },
      proxyImplementationCheck: proxyImplementationCheck(
        unsupported ? 'unavailable' : 'failed',
        unsupported
          ? 'Configured RPC does not support ERC-1967 net implementation-slot tracing'
          : boundedMessage(error.message, 'ERC-1967 net implementation-slot trace failed')
      )
    }
  }

  const proxyChanges = parseProxyImplementationChanges(outcome.response.result)
  const implementationCheck: ProxyImplementationCheck = proxyChanges
    ? {
        status: 'succeeded',
        source: 'debug_traceCall' as const,
        standard: 'ERC-1967' as const,
        slot: ERC1967_IMPLEMENTATION_SLOT,
        changes: proxyChanges.changes,
        ...(proxyChanges.truncated ? { truncated: true } : {})
      }
    : proxyImplementationCheck(
        'failed',
        'RPC returned an invalid or oversized ERC-1967 implementation-slot result'
      )
  const parsed = parseNativeBalanceChanges(outcome.response.result)
  if (!parsed) {
    return {
      nativeBalanceChanges: {
        status: 'failed',
        source: 'debug_traceCall',
        reason: 'RPC returned an invalid native balance-change result'
      },
      proxyImplementationCheck: implementationCheck
    }
  }

  return {
    nativeBalanceChanges: {
      status: 'succeeded',
      source: 'debug_traceCall',
      changes: parsed.changes,
      ...(parsed.truncated ? { truncated: true } : {})
    },
    proxyImplementationCheck: implementationCheck
  }
}

async function readCallTrace(
  transaction: SimulationCallData,
  send: ChainSend,
  targetChain: Chain,
  timeoutMs: number
): Promise<CallTraceEvidence | undefined> {
  if (timeoutMs <= 0) return

  const outcome = await requestRpc(
    send,
    {
      id: 5,
      jsonrpc: '2.0',
      method: 'debug_traceCall',
      params: [
        buildEthCall(transaction),
        'latest',
        {
          tracer: 'callTracer',
          timeout: `${Math.ceil(timeoutMs)}ms`,
          tracerConfig: { onlyTopCall: false, withLog: false }
        }
      ]
    },
    targetChain,
    timeoutMs
  )

  if (
    'timedOut' in outcome ||
    !isRecord(outcome.response) ||
    outcome.response.id !== 5 ||
    outcome.response.jsonrpc !== '2.0' ||
    outcome.response.error !== undefined
  ) {
    return
  }

  const parsed = parseCallTrace(outcome.response.result, transaction)
  if (!parsed || (!parsed.calls.length && !parsed.truncated)) return

  return {
    source: 'debug_traceCall',
    calls: parsed.calls,
    ...(parsed.truncated ? { truncated: true } : {})
  }
}

async function readTokenAllowance(
  transaction: SimulationCallData,
  send: ChainSend,
  targetChain: Chain,
  timeoutMs: number,
  requestId = 2
): Promise<TokenAllowanceSnapshot | undefined> {
  const intent = parseErc20ApprovalIntent(transaction.data)
  const owner = typeof transaction.from === 'string' ? transaction.from.toLowerCase() : undefined
  const allowanceData = intent && buildErc20AllowanceCalldata(owner, intent.spender)
  if (!intent || !owner || !allowanceData || typeof transaction.to !== 'string') return

  const token = transaction.to.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(token)) return

  const outcome = await requestRpc(
    send,
    {
      id: requestId,
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: token, data: allowanceData }, 'latest']
    },
    targetChain,
    timeoutMs
  )
  if ('timedOut' in outcome || !isRecord(outcome.response) || outcome.response.error !== undefined) return

  const currentAmount = parseErc20AllowanceResult(outcome.response.result)
  if (currentAmount === undefined) return

  return {
    source: 'eth_call',
    token,
    owner,
    spender: intent.spender,
    currentAmount,
    requestedAmount: intent.amount
  }
}

async function readAccountCodeEvidence(
  account: unknown,
  send: ChainSend,
  targetChain: Chain,
  timeoutMs: number,
  requestId: number
): Promise<AccountCodeEvidence> {
  const normalizedAccount = typeof account === 'string' && ADDRESS.test(account) ? account.toLowerCase() : ''
  const unavailable = (reasonCode: AccountCodeEvidenceReason, reason: string): AccountCodeEvidence => ({
    status: 'unavailable',
    source: 'eth_getCode',
    trust: 'configured-rpc',
    account: normalizedAccount,
    reasonCode,
    reason
  })

  if (!normalizedAccount) return unavailable('invalid-address', 'Account has an invalid address')

  const outcome = await requestRpc(
    send,
    {
      id: requestId,
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [normalizedAccount, 'latest']
    },
    targetChain,
    timeoutMs
  )
  if ('timedOut' in outcome) return unavailable('timeout', 'Account code check timed out')
  if (!isRecord(outcome.response)) {
    return unavailable('invalid-response', 'RPC returned an invalid account code response')
  }

  if (outcome.response.error !== undefined) {
    const error = normalizeRpcError(outcome.response.error)
    return unavailable('rpc-error', boundedMessage(error?.message, 'Account code check failed'))
  }
  const parsed = parseAccountCode(outcome.response.result)
  if (!parsed) return unavailable('invalid-code', 'RPC returned invalid account code')

  if (parsed.status === 'delegated') {
    return {
      ...parsed,
      source: 'eth_getCode',
      trust: 'configured-rpc',
      account: normalizedAccount,
      authority: normalizedAccount,
      delegateCodeStatus: 'unavailable',
      delegateCodeReasonCode: 'timeout'
    }
  }
  return {
    ...parsed,
    source: 'eth_getCode',
    trust: 'configured-rpc',
    account: normalizedAccount
  }
}

function unavailableAccountCode(
  account: unknown,
  reasonCode: AccountCodeEvidenceReason,
  reason: string
): AccountCodeEvidence {
  return {
    status: 'unavailable',
    source: 'eth_getCode',
    trust: 'configured-rpc',
    account: typeof account === 'string' && ADDRESS.test(account) ? account.toLowerCase() : '',
    reasonCode,
    reason
  }
}

async function inspectAccountCodeEvidence(
  transactions: SimulationCallData[],
  send: ChainSend,
  targetChain: Chain,
  timeoutMs: number
): Promise<TransactionAccountCodeEvidence> {
  const senderAddress = transactions[0]?.from
  const targets = new Map<string, { address: unknown; callIndexes: number[] }>()
  transactions.forEach((transaction, callIndex) => {
    if (transaction.to === undefined || transaction.to === null || transaction.to === '') return
    const normalized =
      typeof transaction.to === 'string' && ADDRESS.test(transaction.to)
        ? transaction.to.toLowerCase()
        : `invalid:${callIndex}`
    const target = targets.get(normalized)
    if (target) target.callIndexes.push(callIndex)
    else targets.set(normalized, { address: transaction.to, callIndexes: [callIndex] })
  })

  const startedAt = Date.now()
  const initial = await Promise.all([
    readAccountCodeEvidence(senderAddress, send, targetChain, timeoutMs, 30),
    ...Array.from(targets.values(), ({ address }, index) =>
      readAccountCodeEvidence(address, send, targetChain, timeoutMs, 31 + index)
    )
  ])
  const remainingTimeout = Math.max(0, timeoutMs - (Date.now() - startedAt))
  const delegates = Array.from(
    new Set(initial.flatMap((evidence) => (evidence.status === 'delegated' ? [evidence.delegate] : [])))
  )
  const delegateEvidence = new Map<string, AccountCodeEvidence>()
  if (delegates.length && remainingTimeout > 0) {
    const results = await Promise.all(
      delegates.map((delegate, index) =>
        readAccountCodeEvidence(delegate, send, targetChain, remainingTimeout, 64 + index)
      )
    )
    results.forEach((result, index) => {
      const delegate = delegates[index]
      if (delegate) delegateEvidence.set(delegate, result)
    })
  }

  const withDelegateCode = (evidence: AccountCodeEvidence): AccountCodeEvidence => {
    if (evidence.status !== 'delegated') return Object.freeze(evidence)
    const delegate = delegateEvidence.get(evidence.delegate)
    if (!delegate) {
      return Object.freeze({
        ...evidence,
        delegateCodeStatus: 'unavailable',
        delegateCodeReasonCode: 'timeout',
        delegateCodeReason: 'Account code check timed out'
      })
    }
    if (delegate.status === 'unavailable') {
      return Object.freeze({
        ...evidence,
        delegateCodeStatus: 'unavailable',
        delegateCodeReasonCode: delegate.reasonCode,
        delegateCodeReason: delegate.reason
      })
    }
    return Object.freeze({
      ...evidence,
      delegateCodeStatus: delegate.status,
      delegateCodeHash: delegate.codeHash
    })
  }

  const sender = Object.freeze({ ...withDelegateCode(initial[0]!), role: 'sender' as const })
  const targetEvidence = Array.from(targets.values(), (target, index) =>
    Object.freeze({
      ...withDelegateCode(initial[index + 1]!),
      role: 'target' as const,
      callIndexes: Object.freeze([...target.callIndexes])
    })
  )
  return Object.freeze({
    source: 'configured-rpc' as const,
    sender,
    targets: Object.freeze(targetEvidence)
  })
}

export async function inspectTransactionAccountCode(
  transaction: SimulationCallData,
  dependencies: SimulationDependencies
): Promise<TransactionAccountCodeEvidence> {
  const chainId = parseRpcQuantity(transaction.chainId)
  if (chainId === undefined || chainId === 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    const sender = Object.freeze({
      ...unavailableAccountCode(transaction.from, 'invalid-chain', 'Transaction has an invalid chain ID'),
      role: 'sender' as const
    })
    const targets =
      transaction.to === undefined || transaction.to === null || transaction.to === ''
        ? []
        : [
            Object.freeze({
              ...unavailableAccountCode(
                transaction.to,
                'invalid-chain',
                'Transaction has an invalid chain ID'
              ),
              role: 'target' as const,
              callIndexes: Object.freeze([0])
            })
          ]
    return Object.freeze({
      source: 'configured-rpc',
      sender,
      targets: Object.freeze(targets)
    })
  }

  const configuredTimeout = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  return inspectAccountCodeEvidence(
    [transaction],
    dependencies.send,
    { type: 'ethereum', id: Number(chainId) },
    timeoutMs
  )
}

function legacyDelegationCheck(evidence: SenderAccountCodeEvidence): AccountDelegationCheck {
  if (evidence.status === 'delegated') {
    return {
      status: 'delegated',
      source: 'eth_getCode',
      account: evidence.account,
      delegate: evidence.delegate
    }
  }
  if (evidence.status === 'unavailable') {
    return {
      status: 'unavailable',
      source: 'eth_getCode',
      account: evidence.account,
      reason: evidence.reason
    }
  }
  return { status: 'undelegated', source: 'eth_getCode', account: evidence.account }
}

function parseSimulatedCall(call: unknown): TransactionSimulation | undefined {
  if (!isRecord(call)) return
  const gasUsed = parseGasUsed(call.gasUsed)
  const rawReturnData = call.returnData
  if (!gasUsed || typeof rawReturnData !== 'string' || !isData(rawReturnData)) return

  if (call.status === '0x1') {
    if (!Array.isArray(call.logs)) return
    const { effects, truncated } = parseSimulationEffects(call.logs)
    const returnData = rawReturnData.toLowerCase()
    const returnDataKind =
      returnData === '0x'
        ? undefined
        : returnData === `0x${'0'.repeat(63)}1`
          ? ('abi-bool-true' as const)
          : returnData === `0x${'0'.repeat(64)}`
            ? ('abi-bool-false' as const)
            : ('other' as const)
    return {
      status: 'succeeded',
      source: 'eth_simulateV1',
      gasUsed,
      ...(returnDataKind ? { returnDataKind } : {}),
      ...(effects.length ? { effects } : {}),
      ...(truncated ? { effectsTruncated: true } : {})
    }
  }

  if (call.status === '0x0' && isRecord(call.error)) {
    const code = call.error.code
    if (code !== 3 && code !== -32015) return

    return {
      status: 'reverted',
      source: 'eth_simulateV1',
      gasUsed,
      reason: boundedMessage(call.error.message, 'Execution reverted')
    }
  }

  return undefined
}

export function parseSimulateCallsResult(
  result: unknown,
  expectedCalls: number
): TransactionSimulation[] | undefined {
  if (!Number.isInteger(expectedCalls) || expectedCalls < 1 || expectedCalls > MAX_WALLET_CALLS) return
  if (!Array.isArray(result) || result.length !== 1 || !isRecord(result[0])) return

  const calls = result[0].calls
  if (!Array.isArray(calls) || calls.length !== expectedCalls) return

  const parsed = calls.map(parseSimulatedCall)
  return parsed.every((call): call is TransactionSimulation => call !== undefined) ? parsed : undefined
}

export function parseSimulateResult(result: unknown): TransactionSimulation | undefined {
  return parseSimulateCallsResult(result, 1)?.[0]
}

async function simulateExecution(
  transaction: TransactionData,
  send: ChainSend,
  targetChain: Chain,
  timeoutMs: number
): Promise<TransactionSimulation> {
  const startedAt = Date.now()
  const simulatePayload: JSONRPCRequestPayload = {
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_simulateV1',
    params: [
      {
        blockStateCalls: [{ calls: [buildSimulationCall(transaction)] }],
        validation: false
      },
      'latest'
    ]
  }

  const simulateOutcome = await requestRpc(send, simulatePayload, targetChain, timeoutMs)
  if ('timedOut' in simulateOutcome) {
    return { status: 'failed', source: 'eth_simulateV1', reason: 'RPC execution check timed out' }
  }

  const simulateResponse = simulateOutcome.response
  if (!isRecord(simulateResponse)) {
    return { status: 'failed', source: 'eth_simulateV1', reason: 'RPC returned an invalid response' }
  }

  if (simulateResponse.error === undefined) {
    return (
      parseSimulateResult(simulateResponse.result) || {
        status: 'failed',
        source: 'eth_simulateV1',
        reason: 'RPC returned an invalid simulation result'
      }
    )
  }

  const simulateError = normalizeRpcError(simulateResponse.error)
  if (!simulateError) {
    return { status: 'failed', source: 'eth_simulateV1', reason: 'RPC returned an invalid error' }
  }

  if (!isUnsupportedMethod(simulateError)) {
    return errorResult('eth_simulateV1', simulateError)
  }

  const callPayload: JSONRPCRequestPayload = {
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [buildEthCall(transaction), 'latest']
  }
  const remainingTimeout = Math.max(1, timeoutMs - (Date.now() - startedAt))
  const callOutcome = await requestRpc(send, callPayload, targetChain, remainingTimeout)

  if ('timedOut' in callOutcome) {
    return { status: 'failed', source: 'eth_call', reason: 'RPC execution check timed out' }
  }

  const callResponse = callOutcome.response
  if (!isRecord(callResponse)) {
    return { status: 'failed', source: 'eth_call', reason: 'RPC returned an invalid response' }
  }

  if (callResponse.error !== undefined) {
    const callError = normalizeRpcError(callResponse.error)
    if (!callError) {
      return { status: 'failed', source: 'eth_call', reason: 'RPC returned an invalid error' }
    }

    return isUnsupportedMethod(callError)
      ? { status: 'unavailable', source: 'eth_call', reason: 'RPC execution check is unsupported' }
      : errorResult('eth_call', callError)
  }

  return isData(callResponse.result)
    ? { status: 'succeeded', source: 'eth_call' }
    : { status: 'failed', source: 'eth_call', reason: 'RPC returned an invalid call result' }
}

export async function simulateTransaction(
  transaction: TransactionData,
  dependencies: SimulationDependencies
): Promise<TransactionSimulation> {
  const { send } = dependencies
  const configuredTimeout = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  const chainId = parseRpcQuantity(transaction.chainId)

  if (chainId === undefined || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { status: 'failed', reason: 'Transaction has an invalid chain ID' }
  }

  const targetChain: Chain = { type: 'ethereum', id: Number(chainId) }
  const startedAt = Date.now()
  const simulationPromise = simulateExecution(transaction, send, targetChain, timeoutMs)
  const prestateTracePromise = simulationPromise.then((simulation) => {
    if (simulation.status !== 'succeeded') return undefined

    return readPrestateTrace(
      transaction,
      send,
      targetChain,
      Math.max(0, timeoutMs - (Date.now() - startedAt))
    )
  })
  const callTracePromise = simulationPromise.then((simulation) => {
    if (simulation.status !== 'succeeded') return undefined

    return readCallTrace(transaction, send, targetChain, Math.max(0, timeoutMs - (Date.now() - startedAt)))
  })
  const coreStartedAt = Date.now()
  const [simulation, allowance, accountCodeEvidence] = await Promise.all([
    simulationPromise,
    readTokenAllowance(transaction, send, targetChain, timeoutMs),
    inspectAccountCodeEvidence([transaction], send, targetChain, timeoutMs)
  ])
  const delegation = legacyDelegationCheck(accountCodeEvidence.sender)
  const coreResult: TransactionSimulation = {
    ...simulation,
    ...(allowance ? { allowance } : {}),
    ...(delegation.status === 'undelegated' ? {} : { delegation }),
    accountCodeEvidence,
    ...(simulation.status === 'succeeded' ? { advancedChecks: { status: 'pending' as const } } : {})
  }
  logReviewTiming('core', coreStartedAt, simulation.status)
  try {
    dependencies.onCoreResult?.(coreResult)
  } catch {
    log.warn('transaction review core-result callback failed')
  }

  if (simulation.status !== 'succeeded') return coreResult

  const advancedStartedAt = Date.now()
  const [prestateTrace, callTrace] = await Promise.all([prestateTracePromise, callTracePromise])
  const advancedChecksComplete =
    prestateTrace?.nativeBalanceChanges.status === 'succeeded' &&
    prestateTrace.proxyImplementationCheck.status === 'succeeded' &&
    callTrace !== undefined
  const advancedStatus = advancedChecksComplete ? 'complete' : 'partly-unavailable'
  logReviewTiming('advanced', advancedStartedAt, advancedStatus)

  return {
    ...coreResult,
    ...(prestateTrace ? { nativeBalanceChanges: prestateTrace.nativeBalanceChanges } : {}),
    ...(prestateTrace?.proxyImplementationCheck
      ? { proxyImplementationCheck: prestateTrace.proxyImplementationCheck }
      : {}),
    ...(callTrace ? { callTrace } : {}),
    advancedChecks: { status: advancedStatus }
  }
}

export async function simulateWalletCalls(
  transactions: SimulationCallData[],
  dependencies: SimulationDependencies
): Promise<WalletCallsSimulationResult> {
  if (transactions.length < 1 || transactions.length > MAX_WALLET_CALLS) {
    return {
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Wallet call simulation requires between 1 and 16 calls'
    }
  }

  const senders = transactions.map((transaction) =>
    typeof transaction.from === 'string' && ADDRESS.test(transaction.from)
      ? transaction.from.toLowerCase()
      : undefined
  )
  const sender = senders[0]
  if (!sender || senders.some((candidate) => candidate !== sender)) {
    return {
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Wallet call batch has invalid or mismatched sender addresses'
    }
  }

  const chainIds = transactions.map((transaction) => parseRpcQuantity(transaction.chainId))
  const chainId = chainIds[0]
  if (
    chainId === undefined ||
    chainId === 0n ||
    chainId > BigInt(Number.MAX_SAFE_INTEGER) ||
    chainIds.some((candidate) => candidate !== chainId)
  ) {
    return {
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Wallet call batch has invalid or mismatched chain IDs'
    }
  }

  const configuredTimeout = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  const targetChain: Chain = { type: 'ethereum', id: Number(chainId) }
  const firstTransaction = transactions[0]
  if (!firstTransaction) {
    return {
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Wallet call simulation requires between 1 and 16 calls'
    }
  }
  const payload: JSONRPCRequestPayload = {
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_simulateV1',
    params: [
      {
        blockStateCalls: [{ calls: transactions.map(buildSimulationCall) }],
        validation: false
      },
      'latest'
    ]
  }

  const [outcome, firstAllowance, accountCodeEvidence] = await Promise.all([
    requestRpc(dependencies.send, payload, targetChain, timeoutMs),
    readTokenAllowance(firstTransaction, dependencies.send, targetChain, timeoutMs),
    inspectAccountCodeEvidence(transactions, dependencies.send, targetChain, timeoutMs)
  ])
  const delegation = legacyDelegationCheck(accountCodeEvidence.sender)
  const withDelegation = (result: Omit<WalletCallsSimulationResult, 'delegation'>) => ({
    ...result,
    ...(delegation.status === 'undelegated' ? {} : { delegation }),
    accountCodeEvidence
  })

  if ('timedOut' in outcome) {
    return withDelegation({
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Stateful wallet call simulation timed out'
    })
  }
  if (!isRecord(outcome.response)) {
    return withDelegation({
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'RPC returned an invalid batch simulation response'
    })
  }
  if (outcome.response.error !== undefined) {
    const error = normalizeRpcError(outcome.response.error)
    if (!error) {
      return withDelegation({
        status: 'failed',
        source: 'eth_simulateV1',
        calls: [],
        reason: 'RPC returned an invalid batch simulation error'
      })
    }

    return withDelegation({
      status: isUnsupportedMethod(error) ? 'unavailable' : 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: isUnsupportedMethod(error)
        ? 'Configured RPC does not support stateful wallet call simulation'
        : boundedMessage(error.message, 'Stateful wallet call simulation failed')
    })
  }

  const calls = parseSimulateCallsResult(outcome.response.result, transactions.length)
  if (!calls) {
    return withDelegation({
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'RPC returned an invalid batch simulation result'
    })
  }

  const callsWithAllowances = calls.map((call, index) =>
    index === 0 && firstAllowance ? { ...call, allowance: firstAllowance } : call
  )
  return withDelegation({
    status: callsWithAllowances.some((call) => call.status === 'reverted') ? 'reverted' : 'succeeded',
    source: 'eth_simulateV1',
    calls: callsWithAllowances
  })
}
