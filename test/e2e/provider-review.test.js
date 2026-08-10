import {
  createDappClient,
  createReviewHarness,
  sendCalls,
  startJsonRpcFixture,
  waitForReview
} from './support/harness'

let upstream
let gateway
let harness
let dapp

beforeEach(async () => {
  upstream = await startJsonRpcFixture(async () => {
    throw Object.assign(new Error('Unexpected upstream method'), { code: -32601 })
  })
  harness = createReviewHarness({ rpcUrl: upstream.url })
  gateway = await startJsonRpcFixture((payload, origin) => harness.handle(payload, origin))
  dapp = createDappClient(gateway.url, harness.origin)
})

afterEach(async () => {
  await gateway.close()
  await upstream.close()
})

it('returns no accounts and rejects transaction review before permission', async () => {
  await expect(dapp.request('eth_accounts')).resolves.toEqual([])
  await expect(dapp.request('wallet_sendCalls', sendCalls())).rejects.toMatchObject({
    code: 4100,
    message: 'Request origin is no longer authorized'
  })
  expect(harness.requests.size).toBe(0)
  expect(upstream.requests).toHaveLength(0)
})

it('admits an authorized review and returns a stable user rejection', async () => {
  harness.grant()
  await expect(dapp.request('eth_accounts')).resolves.toEqual([harness.account])

  const pendingResponse = dapp.request('wallet_sendCalls', sendCalls({ id: 'rejected-batch' }))
  await waitForReview(harness)
  harness.reject()

  await expect(pendingResponse).rejects.toMatchObject({ code: 4001, message: 'User rejected request' })
  expect(harness.ledger.getStatus(harness.origin, harness.account, 'rejected-batch').status).toBe(400)
  expect(upstream.requests).toHaveLength(0)
})

it('fails closed if permission is revoked before a later review', async () => {
  harness.grant()
  harness.revoke()

  await expect(dapp.request('wallet_sendCalls', sendCalls())).rejects.toMatchObject({ code: 4100 })
  expect(harness.requests.size).toBe(0)
})
