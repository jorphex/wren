import { getAddress } from 'ethers'

import GasMonitor from '../transaction/gasMonitor'
import { createGasCalculator } from '../chains/gas'
import { GasFeesSource, type TransactionData } from '../../resources/domain/transaction'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { NATIVE_CURRENCY } from '../../resources/constants'
import {
  calculateNativeMax,
  sameNativeMaxEvidence,
  type NativeMaxCalculation,
  type NativeMaxEvidence,
  type NativeMaxFeeEvidence,
  type NativeMaxReserve
} from '../../resources/domain/send/max'
import { chainUsesOptimismFees } from '../../resources/utils/chains'
import { SEND_ERROR, SendValidationError } from './transaction'

const QUOTE_TTL_MS = 60_000
const MAX_QUOTES = 64
const MAX_CONVERGENCE_PASSES = 6
const SEED_GAS_LIMIT = 21_000n

type JsonRpcMethod =
  'eth_feeHistory' | 'eth_gasPrice' | 'eth_getBalance' | 'eth_getBlockByNumber' | 'eth_getTransactionCount'

export type NativeMaxQuoteRequest = Readonly<{
  account: string
  assetAddress: string
  chainId: number
  recipient: string
}>

export type NativeMaxPublicQuote = Readonly<{
  quoteId: string
  amount: string
  expiresAt: number
  reserve: NativeMaxReserve
}>

export type NativeMaxTrustedMetadata = Readonly<{
  version: 1
  quoteId: string
  account: string
  assetAddress: string
  chainId: number
  recipient: string
  amount: string
  amountQuantity: string
  evidenceAt: number
  expiresAt: number
  evidence: NativeMaxEvidence
}>

export type NativeMaxTransactionFields = Readonly<{
  type: '0x0' | '0x2'
  gasLimit: string
  nonce: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}>

export type NativeMaxQueueValidation = Readonly<{
  metadata: NativeMaxTrustedMetadata
  transaction: NativeMaxTransactionFields
}>

export interface NativeMaxDependencies {
  rpc: (chainId: number, method: JsonRpcMethod, params: unknown[]) => Promise<unknown>
  estimateGas: (transaction: {
    chainId: string
    from: string
    nonce: string
    to: string
    value: string
  }) => Promise<unknown>
  estimateL1Fee: (transaction: TransactionData) => Promise<unknown>
  now: () => number
  quoteId: () => string
}

type QuoteStatus = 'open' | 'checking-queue' | 'queued' | 'checking-sign'

type QuoteRecord = Readonly<{
  metadata: NativeMaxTrustedMetadata
  calculation: NativeMaxCalculation
}> & { status: QuoteStatus }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredQuantity(value: unknown, _label: string, allowZero = false): string {
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined || (!allowZero && parsed === 0n)) {
    throw new SendValidationError(SEND_ERROR.MaxUnavailable)
  }
  return toRpcQuantity(parsed)
}

function normalizeRequest(input: NativeMaxQuoteRequest): NativeMaxQuoteRequest {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new SendValidationError(SEND_ERROR.MaxUnavailable)
  }
  let request: NativeMaxQuoteRequest
  try {
    request = {
      account: getAddress(input.account).toLowerCase(),
      assetAddress: getAddress(input.assetAddress).toLowerCase(),
      chainId: input.chainId,
      recipient: getAddress(input.recipient).toLowerCase()
    }
  } catch {
    throw new SendValidationError(SEND_ERROR.RecipientInvalid)
  }
  if (request.assetAddress !== NATIVE_CURRENCY) {
    throw new SendValidationError(SEND_ERROR.MaxQuoteStale)
  }
  return request
}

function metadataTransaction(metadata: NativeMaxTrustedMetadata): NativeMaxTransactionFields {
  const { evidence } = metadata
  return {
    type: evidence.fee.feeModel === 'eip1559' ? '0x2' : '0x0',
    gasLimit: evidence.gasLimit,
    nonce: evidence.nonce,
    ...(evidence.fee.feeModel === 'legacy'
      ? { gasPrice: evidence.fee.gasPrice }
      : {
          maxFeePerGas: evidence.fee.maxFeePerGas,
          maxPriorityFeePerGas: evidence.fee.maxPriorityFeePerGas
        })
  }
}

function quoteMetadata(
  quoteId: string,
  request: NativeMaxQuoteRequest,
  evidence: NativeMaxEvidence,
  calculation: NativeMaxCalculation,
  evidenceAt: number,
  expiresAt: number
): NativeMaxTrustedMetadata {
  return Object.freeze({
    version: 1 as const,
    quoteId,
    ...request,
    amount: calculation.amount,
    amountQuantity: calculation.amountQuantity,
    evidenceAt,
    expiresAt,
    evidence: Object.freeze({ ...evidence, fee: Object.freeze({ ...evidence.fee }) })
  })
}

export class NativeMaxQuoteService {
  private readonly quotes = new Map<string, QuoteRecord>()

  constructor(private readonly dependencies: NativeMaxDependencies) {}

  private stale(): never {
    throw new SendValidationError(SEND_ERROR.MaxQuoteStale)
  }

  private cleanup(now = this.dependencies.now()) {
    this.quotes.forEach((record, id) => {
      if (record.metadata.expiresAt <= now) this.quotes.delete(id)
    })
  }

  private reserveSlot() {
    this.cleanup()
    if (this.quotes.size < MAX_QUOTES) return
    const openQuote = [...this.quotes.entries()].find(([, record]) => record.status === 'open')
    if (!openQuote) throw new SendValidationError(SEND_ERROR.MaxUnavailable)
    this.quotes.delete(openQuote[0])
  }

  private async currentFee(chainId: number): Promise<NativeMaxFeeEvidence> {
    const block = await this.dependencies.rpc(chainId, 'eth_getBlockByNumber', ['latest', false])
    if (!isRecord(block)) throw new SendValidationError(SEND_ERROR.MaxUnavailable)

    if (Object.prototype.hasOwnProperty.call(block, 'baseFeePerGas')) {
      requiredQuantity(block['baseFeePerGas'], 'base fee', true)
      const monitor = new GasMonitor({
        send: ({ method, params = [] }) => this.dependencies.rpc(chainId, method as JsonRpcMethod, params)
      })
      const history = await monitor.getFeeHistory(20, [10, 60])
      const calculated = createGasCalculator(chainId).calculateGas(history)
      const maxBaseFeePerGas = requiredQuantity(calculated.maxBaseFeePerGas, 'maximum base fee per gas')
      const maxPriorityFeePerGas = requiredQuantity(
        calculated.maxPriorityFeePerGas,
        'maximum priority fee per gas',
        true
      )
      const maxFeePerGas = toRpcQuantity(BigInt(maxBaseFeePerGas) + BigInt(maxPriorityFeePerGas))
      return { feeModel: 'eip1559', maxFeePerGas, maxPriorityFeePerGas }
    }

    const gasPrice = requiredQuantity(await this.dependencies.rpc(chainId, 'eth_gasPrice', []), 'gas price')
    return { feeModel: 'legacy', gasPrice }
  }

  private transaction(
    request: NativeMaxQuoteRequest,
    value: string,
    gasLimit: string,
    fee: NativeMaxFeeEvidence,
    nonce: string
  ): TransactionData {
    return {
      chainId: toRpcQuantity(BigInt(request.chainId)),
      type: fee.feeModel === 'eip1559' ? '0x2' : '0x0',
      from: request.account,
      to: request.recipient,
      value,
      data: '0x',
      gasLimit,
      nonce,
      gasFeesSource: GasFeesSource.Dapp,
      ...(fee.feeModel === 'legacy'
        ? { gasPrice: fee.gasPrice }
        : {
            maxFeePerGas: fee.maxFeePerGas,
            maxPriorityFeePerGas: fee.maxPriorityFeePerGas
          })
    }
  }

  private async l1Fee(
    request: NativeMaxQuoteRequest,
    value: string,
    gasLimit: string,
    fee: NativeMaxFeeEvidence,
    nonce: string
  ) {
    if (!chainUsesOptimismFees(request.chainId)) return '0x0'
    const result = await this.dependencies.estimateL1Fee(
      this.transaction(request, value, gasLimit, fee, nonce)
    )
    if (typeof result !== 'bigint' && typeof result !== 'string') {
      throw new SendValidationError(SEND_ERROR.MaxUnavailable)
    }
    const normalized = requiredQuantity(typeof result === 'bigint' ? toRpcQuantity(result) : result, 'L1 fee')
    return normalized
  }

  private async derive(request: NativeMaxQuoteRequest): Promise<{
    evidence: NativeMaxEvidence
    calculation: NativeMaxCalculation
  }> {
    const chainId = toRpcQuantity(BigInt(request.chainId))
    const balance = requiredQuantity(
      await this.dependencies.rpc(request.chainId, 'eth_getBalance', [request.account, 'pending']),
      'pending balance'
    )
    const nonce = requiredQuantity(
      await this.dependencies.rpc(request.chainId, 'eth_getTransactionCount', [request.account, 'pending']),
      'pending nonce',
      true
    )
    const fee = await this.currentFee(request.chainId)
    const seedGasLimit = toRpcQuantity(SEED_GAS_LIMIT)
    const seedL1Fee = await this.l1Fee(request, '0x0', seedGasLimit, fee, nonce)
    let candidate = calculateNativeMax({
      balance,
      gasLimit: seedGasLimit,
      l1Fee: seedL1Fee,
      nonce,
      fee
    }).amountQuantity

    for (let pass = 0; pass < MAX_CONVERGENCE_PASSES; pass += 1) {
      const gasLimit = requiredQuantity(
        await this.dependencies.estimateGas({
          chainId,
          from: request.account,
          nonce,
          to: request.recipient,
          value: candidate
        }),
        'gas estimate'
      )
      const l1Fee = await this.l1Fee(request, candidate, gasLimit, fee, nonce)
      const evidence = { balance, gasLimit, l1Fee, nonce, fee } as const
      const calculation = calculateNativeMax(evidence)
      if (calculation.amountQuantity === candidate) return { evidence, calculation }
      candidate = calculation.amountQuantity
    }

    throw new SendValidationError(SEND_ERROR.MaxUnavailable)
  }

  async quote(input: NativeMaxQuoteRequest): Promise<NativeMaxPublicQuote> {
    const request = normalizeRequest(input)
    this.reserveSlot()
    try {
      const { evidence, calculation } = await this.derive(request)
      const quoteId = this.dependencies.quoteId()
      if (!/^[0-9a-f]{32}$/u.test(quoteId) || this.quotes.has(quoteId)) {
        throw new SendValidationError(SEND_ERROR.MaxUnavailable)
      }
      const now = this.dependencies.now()
      const expiresAt = now + QUOTE_TTL_MS
      if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt)) {
        throw new SendValidationError(SEND_ERROR.MaxUnavailable)
      }
      const metadata = quoteMetadata(quoteId, request, evidence, calculation, now, expiresAt)
      this.quotes.set(quoteId, { metadata, calculation, status: 'open' })
      return Object.freeze({
        quoteId,
        amount: calculation.amount,
        expiresAt,
        reserve: Object.freeze({ ...calculation.reserve })
      })
    } catch (error) {
      if (error instanceof SendValidationError) throw error
      throw new SendValidationError(SEND_ERROR.MaxUnavailable)
    }
  }

  private recordFor(metadata: NativeMaxTrustedMetadata | { quoteId: string }, status: QuoteStatus) {
    const record = this.quotes.get(metadata.quoteId)
    if (!record || record.status !== status || record.metadata.expiresAt <= this.dependencies.now()) {
      this.quotes.delete(metadata.quoteId)
      return this.stale()
    }
    return record
  }

  private exactBinding(
    record: QuoteRecord,
    input: Readonly<{
      account: string
      assetAddress: string
      chainId: number
      recipient: string
      amount: string
    }>
  ) {
    let request: NativeMaxQuoteRequest
    try {
      request = normalizeRequest(input)
    } catch {
      return false
    }
    return (
      record.metadata.account === request.account &&
      record.metadata.assetAddress === request.assetAddress &&
      record.metadata.chainId === request.chainId &&
      record.metadata.recipient === request.recipient &&
      record.metadata.amount === input.amount
    )
  }

  private async freshMatch(record: QuoteRecord) {
    const current = await this.derive(record.metadata)
    return (
      current.calculation.amount === record.metadata.amount &&
      sameNativeMaxEvidence(current.evidence, record.metadata.evidence)
    )
  }

  private exactMetadata(left: NativeMaxTrustedMetadata, right: NativeMaxTrustedMetadata) {
    return (
      left.version === right.version &&
      left.quoteId === right.quoteId &&
      left.account === right.account &&
      left.assetAddress === right.assetAddress &&
      left.chainId === right.chainId &&
      left.recipient === right.recipient &&
      left.amount === right.amount &&
      left.amountQuantity === right.amountQuantity &&
      left.evidenceAt === right.evidenceAt &&
      left.expiresAt === right.expiresAt &&
      sameNativeMaxEvidence(left.evidence, right.evidence)
    )
  }

  async validateForQueue(
    input: Readonly<{
      quoteId: string
      account: string
      assetAddress: string
      chainId: number
      recipient: string
      amount: string
    }>
  ): Promise<NativeMaxQueueValidation> {
    const record = this.recordFor(input, 'open')
    if (!this.exactBinding(record, input)) {
      this.quotes.delete(input.quoteId)
      return this.stale()
    }
    record.status = 'checking-queue'
    try {
      if (!(await this.freshMatch(record))) return this.stale()
      record.status = 'queued'
      return Object.freeze({
        metadata: record.metadata,
        transaction: Object.freeze(metadataTransaction(record.metadata))
      })
    } catch {
      this.quotes.delete(input.quoteId)
      return this.stale()
    }
  }

  queueFailed(quoteId: string) {
    this.quotes.delete(quoteId)
  }

  private exactTransaction(metadata: NativeMaxTrustedMetadata, transaction: TransactionData) {
    const expected = metadataTransaction(metadata)
    return (
      transaction.from?.toLowerCase() === metadata.account &&
      transaction.chainId === toRpcQuantity(BigInt(metadata.chainId)) &&
      transaction.to?.toLowerCase() === metadata.recipient &&
      transaction.value === metadata.amountQuantity &&
      (transaction.data === undefined || transaction.data === '0x') &&
      transaction.type === expected.type &&
      transaction.gasLimit === expected.gasLimit &&
      transaction.nonce === expected.nonce &&
      transaction.gasPrice === expected.gasPrice &&
      transaction.maxFeePerGas === expected.maxFeePerGas &&
      transaction.maxPriorityFeePerGas === expected.maxPriorityFeePerGas
    )
  }

  async revalidateBeforeSign(
    metadata: NativeMaxTrustedMetadata,
    transaction: TransactionData
  ): Promise<void> {
    const record = this.recordFor(metadata, 'queued')
    if (!this.exactMetadata(record.metadata, metadata) || !this.exactTransaction(metadata, transaction)) {
      this.quotes.delete(metadata.quoteId)
      return this.stale()
    }
    record.status = 'checking-sign'
    try {
      if (!(await this.freshMatch(record))) return this.stale()
    } catch {
      return this.stale()
    } finally {
      this.quotes.delete(metadata.quoteId)
    }
  }

  activeQuoteCount() {
    this.cleanup()
    return this.quotes.size
  }
}
