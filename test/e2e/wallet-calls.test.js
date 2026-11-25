import { hashSignedTransaction } from '../../main/provider/walletCallExecution'
import { WalletCallBatchLedger } from '../../main/provider/walletCallBatches'
import {
  createDappClient,
  createReviewHarness,
  profileStorage,
  receipt,
  sendCalls,
  startJsonRpcFixture,
  waitForReview
} from './support/harness'

const firstHash = hashSignedTransaction('0x01')
const secondHash = hashSignedTransaction('0x02')

let upstream
let gateway

afterEach(async () => {
  await gateway?.close()
  await upstream?.close()
})

async function fixture(options = {}) {
  upstream = await startJsonRpcFixture(
    options.upstreamHandler ||
      (async (payload) => {
        if (payload.method !== 'eth_sendRawTransaction') {
          throw Object.assign(new Error('Method not found'), { code: -32601 })
        }
        return { result: hashSignedTransaction(payload.params[0]) }
      })
  )
  const storage = profileStorage(`wallet-calls-${options.name}.json`)
  const harness = createReviewHarness({ ...options, storage, rpcUrl: upstream.url })
  harness.grant()
  gateway = await startJsonRpcFixture((payload, origin) => harness.handle(payload, origin))
  return { dapp: createDappClient(gateway.url, harness.origin), harness, storage }
}

it('executes approved calls sequentially and restores scoped, ordered receipts after restart', async () => {
  const { dapp, harness, storage } = await fixture({ name: 'success' })
  const { origin, account, ledger } = harness
  const id = 'success-batch'
  const response = dapp.request('wallet_sendCalls', sendCalls({ id }))
  await waitForReview(harness)
  expect(ledger.getStatus(origin, account, id)).toMatchObject({ status: 100, atomic: false })
  await expect(harness.approve()).resolves.toEqual([firstHash, secondHash])
  await expect(response).resolves.toEqual({ id })
  expect(upstream.requests.map(({ payload }) => payload.params[0])).toEqual(['0x01', '0x02'])

  ledger.recordReceipt(origin, account, id, receipt(secondHash))
  const pending = new WalletCallBatchLedger(storage)
  expect(pending.getStatus(origin, account, id).status).toBe(100)
  expect(() => pending.getStatus('https://other.example', account, id)).toThrow(
    expect.objectContaining({ code: 5730 })
  )
  expect(() => pending.getStatus(origin, '0x3333333333333333333333333333333333333333', id)).toThrow(
    expect.objectContaining({ code: 5730 })
  )
  pending.recordReceipt(origin, account, id, receipt(firstHash))

  const restarted = new WalletCallBatchLedger(storage)
  expect(restarted.getStatus(origin, account, id)).toMatchObject({
    status: 200,
    atomic: false,
    receipts: [{ transactionHash: firstHash }, { transactionHash: secondHash }]
  })
})

it('records partial failure without broadcasting the declined call', async () => {
  const { dapp, harness, storage } = await fixture({ name: 'partial', failSignAt: 1 })
  const response = dapp.request('wallet_sendCalls', sendCalls({ id: 'partial-batch' }))
  await waitForReview(harness)

  await expect(harness.approve()).rejects.toThrow('Signer declined call 2')
  await expect(response).resolves.toEqual({ id: 'partial-batch' })
  expect(upstream.requests.map(({ payload }) => payload.params[0])).toEqual(['0x01'])

  harness.ledger.recordReceipt(harness.origin, harness.account, 'partial-batch', receipt(firstHash))
  const restarted = new WalletCallBatchLedger(storage)
  expect(restarted.getStatus(harness.origin, harness.account, 'partial-batch')).toMatchObject({
    status: 600,
    atomic: false,
    receipts: [{ transactionHash: firstHash }]
  })
})

it('recovers an ambiguous accepted broadcast from persisted restart state', async () => {
  const { dapp, harness, storage } = await fixture({
    name: 'recovery',
    upstreamHandler: async (payload) => {
      if (payload.method === 'eth_sendRawTransaction') throw new Error('Connection closed after acceptance')
      throw Object.assign(new Error('Method not found'), { code: -32601 })
    }
  })
  const response = dapp.request(
    'wallet_sendCalls',
    sendCalls({ id: 'recovery-batch', calls: [sendCalls()[0].calls[0]] })
  )
  await waitForReview(harness)

  await expect(harness.approve()).rejects.toThrow('Connection closed after acceptance')
  await expect(response).resolves.toEqual({ id: 'recovery-batch' })

  const restarted = new WalletCallBatchLedger(storage)
  expect(restarted.listReconciliationCandidates()).toEqual([
    {
      origin: harness.origin,
      account: harness.account,
      id: 'recovery-batch',
      chainId: '0x1',
      hash: firstHash
    }
  ])

  restarted.markTransactionSubmitted(harness.origin, harness.account, 'recovery-batch', firstHash)
  restarted.complete(harness.origin, harness.account, 'recovery-batch')
  restarted.recordReceipt(harness.origin, harness.account, 'recovery-batch', receipt(firstHash))
  expect(restarted.getStatus(harness.origin, harness.account, 'recovery-batch').status).toBe(200)
})
