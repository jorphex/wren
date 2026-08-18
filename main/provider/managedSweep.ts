import {
  assertSweepEvidenceStable,
  buildSweepTokenCall,
  createSweepEvidence,
  snapshotSweepSelection,
  type SweepDraft,
  type SweepEvidence,
  type SweepSelection
} from '../../resources/domain/sweep'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { walletCallFundingEvidence } from '../../resources/domain/transaction/funding'
import type { TransactionData } from '../../resources/domain/transaction'
import type { WalletCallsSimulationResult } from '../transaction/simulation'
import type { PreparedWalletCallBatch } from './walletCallPreparation'
import type { WalletCall } from './walletCalls'

const MAX_QUOTE_PASSES = 4
const DEFAULT_QUOTE_TTL_MS = 60_000
const MAX_QUOTES = 32

export const MANAGED_SWEEP_CHANGED = 'managed-sweep-changed' as const
export const MANAGED_SWEEP_UNAVAILABLE = 'managed-sweep-unavailable' as const

export class ManagedSweepError extends Error {
  readonly code: typeof MANAGED_SWEEP_CHANGED | typeof MANAGED_SWEEP_UNAVAILABLE

  constructor(code: typeof MANAGED_SWEEP_CHANGED | typeof MANAGED_SWEEP_UNAVAILABLE, message: string) {
    super(message.slice(0, 240))
    this.code = code
  }
}

export interface ManagedSweepBuildDependencies {
  getPendingNativeBalance(account: string, chainId: string): Promise<string>
  getPendingTokenBalance(token: string, account: string, chainId: string): Promise<string>
  getPendingNonce(account: string, chainId: string): Promise<string>
  prepare(input: {
    account: string
    chainId: string
    pendingNonce: string
    calls: readonly WalletCall[]
  }): Promise<PreparedWalletCallBatch>
  l1Fees(chainId: number, transactions: readonly TransactionData[]): Promise<readonly string[]>
  simulate(transactions: readonly TransactionData[]): Promise<WalletCallsSimulationResult>
}

export interface ManagedSweepQuoteSnapshot {
  readonly quoteId: string
  readonly expiresAt: number
  readonly evidence: SweepEvidence
  readonly pendingNonce: string
  readonly preparation: PreparedWalletCallBatch
  readonly l1Fees: readonly string[]
  readonly simulation: WalletCallsSimulationResult
}

export type ManagedSweepCallEvidence = Readonly<{
  evidence: SweepEvidence
  index: number
  transaction: Readonly<TransactionData>
  pendingNonce: string
  pendingNativeBalance: string
  pendingTokenBalance?: string
  reviewedPreparation: Readonly<PreparedWalletCallBatch>
  freshPreparation: Readonly<PreparedWalletCallBatch>
  freshL1Fees: readonly string[]
}>

export interface ManagedSweepPublicQuote {
  readonly quoteId: string
  readonly expiresAt: number
  readonly account: string
  readonly chainId: number
  readonly recipient: string
  readonly assets: SweepEvidence['tokens']
  readonly native: SweepEvidence['native']
  readonly maximumFee: string
  readonly calls: SweepEvidence['calls']
  readonly execution: SweepEvidence['execution']
}

function unavailable(error: unknown) {
  if (error instanceof ManagedSweepError) return error
  const message = error instanceof Error ? error.message : 'Sweep evidence is unavailable'
  return new ManagedSweepError(
    MANAGED_SWEEP_UNAVAILABLE,
    `${(message.trim() || 'Sweep evidence is unavailable').slice(0, 190)}. Nothing was signed or sent.`
  )
}

export function assertManagedSweepSimulationSucceeded(
  simulation: WalletCallsSimulationResult,
  expectedCallCount: number,
  tokenCallCount: number
) {
  if (!simulation || simulation.status !== 'succeeded') {
    throw new ManagedSweepError(
      MANAGED_SWEEP_UNAVAILABLE,
      'Stateful sweep simulation did not succeed. Nothing was signed or sent.'
    )
  }
  if (
    !Number.isInteger(expectedCallCount) ||
    expectedCallCount < 1 ||
    !Number.isInteger(tokenCallCount) ||
    tokenCallCount < 0 ||
    tokenCallCount > expectedCallCount ||
    simulation.calls.length !== expectedCallCount
  ) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_UNAVAILABLE,
      'Stateful sweep simulation returned incomplete call evidence. Nothing was signed or sent.'
    )
  }
  const sender = simulation.accountCodeEvidence?.sender
  const targets = simulation.accountCodeEvidence?.targets || []
  if (
    !sender ||
    sender.status === 'unavailable' ||
    sender.status === 'delegated' ||
    targets.some(
      (target) =>
        target.status === 'unavailable' ||
        (target.status === 'delegated' && target.delegateCodeStatus === 'unavailable')
    )
  ) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_UNAVAILABLE,
      'Fresh sweep account-code evidence is unavailable or unsupported. Nothing was signed or sent.'
    )
  }
  if (
    simulation.calls
      .slice(0, tokenCallCount)
      .some((call) => call.returnDataKind !== undefined && call.returnDataKind !== 'abi-bool-true')
  ) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_UNAVAILABLE,
      'A selected token did not return transfer success. Nothing was signed or sent.'
    )
  }
}

export function assertManagedSweepCallEvidence(input: ManagedSweepCallEvidence) {
  const { evidence, index, transaction } = input
  if (!Number.isInteger(index) || index < 0 || index >= evidence.calls.length) {
    throw new ManagedSweepError(MANAGED_SWEEP_CHANGED, 'Managed sweep call index changed before signing')
  }
  const expectedCall = evidence.calls[index]
  const reviewedRemaining = input.reviewedPreparation.calls.slice(index)
  const remainingCalls = evidence.calls.slice(index)
  if (
    !expectedCall ||
    transaction.to !== expectedCall.to ||
    transaction.data !== expectedCall.data ||
    transaction.value !== expectedCall.value ||
    reviewedRemaining.length !== remainingCalls.length ||
    reviewedRemaining.length === 0 ||
    JSON.stringify(transaction) !== JSON.stringify(reviewedRemaining[0]?.transaction)
  ) {
    throw new ManagedSweepError(MANAGED_SWEEP_CHANGED, 'Managed sweep call changed before signing')
  }
  if (input.pendingNonce !== transaction.nonce) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_CHANGED,
      'Sweep nonce changed before signing; the remaining sweep was not sent'
    )
  }
  if (JSON.stringify(input.freshPreparation.calls) !== JSON.stringify(reviewedRemaining)) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_CHANGED,
      'Sweep gas or fee evidence changed before signing; the remaining sweep was not sent'
    )
  }
  if (JSON.stringify(input.freshL1Fees) !== JSON.stringify(evidence.l1Fees.slice(index))) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_CHANGED,
      'Sweep network data fees changed before signing; the remaining sweep was not sent'
    )
  }
  const remainingTransactions = input.freshPreparation.calls.map(({ transaction }) => transaction)
  if (
    walletCallFundingEvidence(remainingTransactions, input.pendingNativeBalance, input.freshL1Fees)
      .missing !== '0x0'
  ) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_CHANGED,
      'The remaining sweep is no longer safely affordable; the remaining calls were not sent'
    )
  }
  const token = evidence.tokens[index]
  if (token && input.pendingTokenBalance !== token.balance) {
    throw new ManagedSweepError(
      MANAGED_SWEEP_CHANGED,
      'Selected token balance changed before signing; the remaining sweep was not sent'
    )
  }
  if (!token && (!evidence.native.selected || index !== evidence.calls.length - 1)) {
    throw new ManagedSweepError(MANAGED_SWEEP_CHANGED, 'Managed sweep native call ordering changed')
  }
}

function provisionalCalls(
  selection: SweepSelection,
  tokenBalances: readonly string[]
): readonly WalletCall[] {
  const calls: WalletCall[] = selection.tokens.map((token, index) =>
    buildSweepTokenCall(token, selection.recipient, tokenBalances[index])
  )
  if (selection.includeNative) calls.push({ to: selection.recipient, data: '0x', value: '0x0' })
  return Object.freeze(calls)
}

function sameQuoteEvidence(
  previous: SweepEvidence | undefined,
  evidence: SweepEvidence,
  preparation: PreparedWalletCallBatch
) {
  return (
    previous !== undefined &&
    JSON.stringify(previous) === JSON.stringify(evidence) &&
    preparation.calls.every(
      ({ transaction }, index) =>
        transaction.to === evidence.calls[index]?.to &&
        transaction.data === evidence.calls[index]?.data &&
        transaction.value === evidence.calls[index]?.value
    )
  )
}

export async function buildManagedSweepQuote(
  draft: SweepDraft,
  dependencies: ManagedSweepBuildDependencies
): Promise<Omit<ManagedSweepQuoteSnapshot, 'quoteId' | 'expiresAt'>> {
  try {
    const selection = snapshotSweepSelection(draft)
    const [nativeBalance, pendingNonce, ...tokenBalances] = await Promise.all([
      dependencies.getPendingNativeBalance(selection.account, selection.chainId),
      dependencies.getPendingNonce(selection.account, selection.chainId),
      ...selection.tokens.map((token) =>
        dependencies.getPendingTokenBalance(token, selection.account, selection.chainId)
      )
    ])
    const parsedNonce = parseRpcQuantity(pendingNonce)
    if (parsedNonce === undefined) throw new Error('Sweep pending nonce response is invalid')

    let calls = provisionalCalls(selection, tokenBalances)
    let previousEvidence: SweepEvidence | undefined
    for (let pass = 0; pass < MAX_QUOTE_PASSES; pass += 1) {
      const preparation = await dependencies.prepare({
        account: selection.account,
        chainId: selection.chainId,
        pendingNonce: toRpcQuantity(parsedNonce),
        calls
      })
      const transactions = preparation.calls.map(({ transaction }) => transaction)
      if (transactions.length !== calls.length) throw new Error('Sweep preparation omitted a selected call')
      const l1Fees = await dependencies.l1Fees(Number(BigInt(selection.chainId)), transactions)
      const funding = walletCallFundingEvidence(transactions, nativeBalance, l1Fees)
      const evidence = createSweepEvidence(
        selection,
        tokenBalances,
        nativeBalance,
        funding.maximumFee,
        l1Fees
      )

      if (sameQuoteEvidence(previousEvidence, evidence, preparation)) {
        if (funding.missing !== '0x0') throw new Error('Sweep account cannot cover the batch')
        const simulation = await dependencies.simulate(transactions)
        assertManagedSweepSimulationSucceeded(simulation, evidence.calls.length, evidence.tokens.length)
        return Object.freeze({
          evidence,
          pendingNonce: toRpcQuantity(parsedNonce),
          preparation,
          l1Fees: Object.freeze([...l1Fees]),
          simulation
        })
      }

      previousEvidence = evidence
      calls = evidence.calls
    }
    throw new Error('Sweep maximum-safe native value did not stabilize')
  } catch (error) {
    throw unavailable(error)
  }
}

export function assertManagedSweepQuoteStable(
  expected: ManagedSweepQuoteSnapshot,
  actual: Omit<ManagedSweepQuoteSnapshot, 'quoteId' | 'expiresAt'>
) {
  try {
    assertSweepEvidenceStable(expected.evidence, actual.evidence)
    if (
      expected.pendingNonce !== actual.pendingNonce ||
      JSON.stringify(expected.preparation) !== JSON.stringify(actual.preparation) ||
      JSON.stringify(expected.l1Fees) !== JSON.stringify(actual.l1Fees) ||
      JSON.stringify(expected.simulation) !== JSON.stringify(actual.simulation)
    ) {
      throw new Error('Sweep quote changed')
    }
    return actual
  } catch {
    throw new ManagedSweepError(
      MANAGED_SWEEP_CHANGED,
      'Sweep balances, fees, nonce, or simulation changed. Review a fresh quote; nothing was signed or sent.'
    )
  }
}

export function publicManagedSweepQuote(quote: ManagedSweepQuoteSnapshot): ManagedSweepPublicQuote {
  return Object.freeze({
    quoteId: quote.quoteId,
    expiresAt: quote.expiresAt,
    account: quote.evidence.account,
    chainId: Number(BigInt(quote.evidence.chainId)),
    recipient: quote.evidence.recipient,
    assets: quote.evidence.tokens,
    native: quote.evidence.native,
    maximumFee: quote.evidence.maximumFee,
    calls: quote.evidence.calls,
    execution: quote.evidence.execution
  })
}

export class ManagedSweepQuoteStore {
  private readonly quotes = new Map<string, ManagedSweepQuoteSnapshot>()

  constructor(
    private readonly createId: () => string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_QUOTE_TTL_MS
  ) {}

  put(quote: Omit<ManagedSweepQuoteSnapshot, 'quoteId' | 'expiresAt'>) {
    this.prune()
    while (this.quotes.size >= MAX_QUOTES) this.quotes.delete(this.quotes.keys().next().value as string)
    const quoteId = this.createId()
    if (typeof quoteId !== 'string' || !quoteId || quoteId.length > 128 || this.quotes.has(quoteId)) {
      throw new ManagedSweepError(MANAGED_SWEEP_UNAVAILABLE, 'Could not create a sweep quote')
    }
    const stored = Object.freeze({ ...quote, quoteId, expiresAt: this.now() + this.ttlMs })
    this.quotes.set(quoteId, stored)
    return stored
  }

  take(quoteId: unknown, identity: Pick<SweepEvidence, 'account' | 'chainId' | 'recipient'>) {
    this.prune()
    if (typeof quoteId !== 'string' || !quoteId || quoteId.length > 128) {
      throw new ManagedSweepError(MANAGED_SWEEP_CHANGED, 'Sweep quote is invalid or expired')
    }
    const quote = this.quotes.get(quoteId)
    this.quotes.delete(quoteId)
    if (
      !quote ||
      quote.evidence.account !== identity.account.toLowerCase() ||
      quote.evidence.chainId !== identity.chainId ||
      quote.evidence.recipient !== identity.recipient.toLowerCase()
    ) {
      throw new ManagedSweepError(MANAGED_SWEEP_CHANGED, 'Sweep quote is invalid or expired')
    }
    return quote
  }

  private prune() {
    const now = this.now()
    for (const [id, quote] of this.quotes) if (quote.expiresAt <= now) this.quotes.delete(id)
  }
}
