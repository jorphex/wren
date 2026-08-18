import { GasFeesSource, type TransactionData } from '../../../resources/domain/transaction'
import { NATIVE_CURRENCY } from '../../../resources/constants'
import { NativeMaxQuoteService, type NativeMaxQueueValidation } from '../../../main/send/max'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'

type MutableRpc = {
  balance: string
  block: Record<string, unknown>
  gasLimit: string
  gasPrice: string
  l1Fee: bigint
  nonce: string
  unavailable: boolean
}

function feeHistory() {
  return {
    oldestBlock: '0x1',
    baseFeePerGas: Array.from({ length: 21 }, () => '0x64'),
    gasUsedRatio: Array.from({ length: 20 }, () => 0.5),
    reward: Array.from({ length: 20 }, () => ['0xa', '0x14'])
  }
}

function harness(chainId = 1, l1Fee = 0n) {
  let now = 1_000
  let quoteSequence = 0
  const l1Transactions: TransactionData[] = []
  const state: MutableRpc = {
    balance: '0xf4240',
    block: {},
    gasLimit: '0x5208',
    gasPrice: '0xa',
    l1Fee,
    nonce: '0x12345',
    unavailable: false
  }
  const rpc = jest.fn(async (_chainId: number, method: string) => {
    if (state.unavailable) throw new Error('private RPC detail')
    if (method === 'eth_getBalance') return state.balance
    if (method === 'eth_getTransactionCount') return state.nonce
    if (method === 'eth_getBlockByNumber') return state.block
    if (method === 'eth_gasPrice') return state.gasPrice
    if (method === 'eth_feeHistory') return feeHistory()
    throw new Error('unexpected method')
  })
  const service = new NativeMaxQuoteService({
    rpc,
    estimateGas: jest.fn(async () => state.gasLimit),
    estimateL1Fee: jest.fn(async (transaction) => {
      l1Transactions.push(transaction)
      return state.l1Fee
    }),
    now: () => now,
    quoteId: () => (++quoteSequence).toString(16).padStart(32, '0')
  })
  const request = { account, assetAddress: NATIVE_CURRENCY, chainId, recipient }
  return { l1Transactions, request, rpc, service, state, setNow: (value: number) => (now = value) }
}

async function queueQuote(h: ReturnType<typeof harness>): Promise<NativeMaxQueueValidation> {
  const quote = await h.service.quote(h.request)
  return h.service.validateForQueue({
    ...h.request,
    quoteId: quote.quoteId,
    amount: quote.amount
  })
}

function preparedTransaction(
  validation: NativeMaxQueueValidation,
  overrides: Partial<TransactionData> = {}
): TransactionData {
  const { metadata, transaction } = validation
  return {
    chainId: `0x${metadata.chainId.toString(16)}`,
    type: transaction.type,
    from: metadata.account,
    to: metadata.recipient,
    value: metadata.amountQuantity,
    data: '0x',
    gasLimit: transaction.gasLimit,
    nonce: transaction.nonce,
    gasFeesSource: GasFeesSource.Dapp,
    ...(transaction.gasPrice !== undefined ? { gasPrice: transaction.gasPrice } : {}),
    ...(transaction.maxFeePerGas !== undefined ? { maxFeePerGas: transaction.maxFeePerGas } : {}),
    ...(transaction.maxPriorityFeePerGas !== undefined
      ? { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }
      : {}),
    ...overrides
  }
}

it('quotes legacy Max from fresh pending evidence without exposing its binding', async () => {
  const h = harness()
  const quote = await h.service.quote(h.request)

  expect(quote).toEqual({
    quoteId: '00000000000000000000000000000001',
    amount: '790000',
    expiresAt: 61_000,
    reserve: {
      feeModel: 'legacy',
      gasLimit: '0x5208',
      gasPrice: '0xa',
      executionFee: '210000',
      l1Fee: '0',
      total: '210000'
    }
  })
  const serialized = JSON.stringify(quote)
  expect(serialized).not.toContain(account)
  expect(serialized).not.toContain(recipient)
  expect(serialized).not.toContain(h.state.balance)
  expect(serialized).not.toContain(h.state.nonce)
  expect(h.rpc).toHaveBeenCalledWith(1, 'eth_getBalance', [account, 'pending'])
  expect(h.rpc).toHaveBeenCalledWith(1, 'eth_getTransactionCount', [account, 'pending'])
})

it('uses production EIP-1559 fee-history policy and maximum fee reserve', async () => {
  const h = harness()
  h.state.balance = '0x989680'
  h.state.block = { baseFeePerGas: '0x64' }

  const quote = await h.service.quote(h.request)

  expect(quote.reserve).toEqual({
    feeModel: 'eip1559',
    gasLimit: '0x5208',
    maxFeePerGas: '0x89',
    maxPriorityFeePerGas: '0xa',
    executionFee: '2877000',
    l1Fee: '0',
    total: '2877000'
  })
  expect(h.rpc).toHaveBeenCalledWith(1, 'eth_feeHistory', ['0x14', 'pending', [10, 60]])
})

it('includes the pending nonce and exact value in fail-closed OP L1 fee evidence', async () => {
  const h = harness(10, 1_000n)
  h.state.balance = '0x989680'
  h.state.block = { baseFeePerGas: '0x64' }

  const quote = await h.service.quote(h.request)

  expect(quote.reserve.l1Fee).toBe('1000')
  expect(h.l1Transactions.length).toBeGreaterThanOrEqual(2)
  expect(h.l1Transactions.at(-1)).toEqual(
    expect.objectContaining({
      chainId: '0xa',
      nonce: '0x12345',
      from: account,
      to: recipient,
      value: `0x${BigInt(quote.amount).toString(16)}`,
      type: '0x2'
    })
  )
})

it.each([
  ['pending balance', (h: ReturnType<typeof harness>) => (h.state.balance = '0xf4241')],
  ['pending nonce', (h: ReturnType<typeof harness>) => (h.state.nonce = '0x12346')],
  ['gas price', (h: ReturnType<typeof harness>) => (h.state.gasPrice = '0xb')],
  ['gas limit', (h: ReturnType<typeof harness>) => (h.state.gasLimit = '0x5209')]
])('rejects queue when %s moved after review', async (_label, mutate) => {
  const h = harness()
  const quote = await h.service.quote(h.request)
  mutate(h)

  await expect(
    h.service.validateForQueue({ ...h.request, quoteId: quote.quoteId, amount: quote.amount })
  ).rejects.toMatchObject({ code: 'max-quote-stale' })
})

it('rejects an OP quote when its L1 fee evidence moved', async () => {
  const h = harness(10, 1_000n)
  h.state.balance = '0x989680'
  h.state.block = { baseFeePerGas: '0x64' }
  const quote = await h.service.quote(h.request)
  h.state.l1Fee = 1_001n

  await expect(
    h.service.validateForQueue({ ...h.request, quoteId: quote.quoteId, amount: quote.amount })
  ).rejects.toMatchObject({ code: 'max-quote-stale' })
})

it('rejects expired, unavailable, and context-drifted quotes with bounded errors', async () => {
  const expired = harness()
  const expiredQuote = await expired.service.quote(expired.request)
  expired.setNow(expiredQuote.expiresAt)
  await expect(
    expired.service.validateForQueue({
      ...expired.request,
      quoteId: expiredQuote.quoteId,
      amount: expiredQuote.amount
    })
  ).rejects.toMatchObject({ code: 'max-quote-stale' })

  const drifted = harness()
  const driftedQuote = await drifted.service.quote(drifted.request)
  await expect(
    drifted.service.validateForQueue({
      ...drifted.request,
      recipient: '0x3333333333333333333333333333333333333333',
      quoteId: driftedQuote.quoteId,
      amount: driftedQuote.amount
    })
  ).rejects.toMatchObject({ code: 'max-quote-stale' })

  const unavailable = harness()
  unavailable.state.unavailable = true
  await expect(unavailable.service.quote(unavailable.request)).rejects.toMatchObject({
    code: 'max-unavailable'
  })
})

it('requires an exact prepared transaction, rechecks fresh evidence, and consumes once', async () => {
  const h = harness()
  const validation = await queueQuote(h)
  const clonedMetadata = structuredClone(validation.metadata)

  await expect(
    h.service.revalidateBeforeSign(clonedMetadata, preparedTransaction(validation))
  ).resolves.toBeUndefined()
  expect(h.service.activeQuoteCount()).toBe(0)
  await expect(
    h.service.revalidateBeforeSign(clonedMetadata, preparedTransaction(validation))
  ).rejects.toMatchObject({ code: 'max-quote-stale' })
})

it('consumes and rejects a quote when the prepared amount or pre-sign evidence drifts', async () => {
  const transactionDrift = harness()
  const validation = await queueQuote(transactionDrift)
  await expect(
    transactionDrift.service.revalidateBeforeSign(
      validation.metadata,
      preparedTransaction(validation, { nonce: '0x12346' })
    )
  ).rejects.toMatchObject({ code: 'max-quote-stale' })
  expect(transactionDrift.service.activeQuoteCount()).toBe(0)

  const evidenceDrift = harness()
  const secondValidation = await queueQuote(evidenceDrift)
  evidenceDrift.state.balance = '0xf4241'
  await expect(
    evidenceDrift.service.revalidateBeforeSign(
      secondValidation.metadata,
      preparedTransaction(secondValidation)
    )
  ).rejects.toMatchObject({ code: 'max-quote-stale' })
  expect(evidenceDrift.service.activeQuoteCount()).toBe(0)
})
