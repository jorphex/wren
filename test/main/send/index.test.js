import accounts from '../../../main/accounts'
import provider from '../../../main/provider'
import store from '../../../main/store'
import { requireStoreAction } from '../../../main/store/action'
import send from '../../../main/send'
import { NATIVE_CURRENCY } from '../../../resources/constants'
import { originIdForName, FRAME_SEND_ORIGIN } from '../../../resources/domain/origin'
import { toRpcQuantity } from '../../../resources/domain/transaction/quantity'

jest.mock('../../../main/accounts', () => ({ current: jest.fn() }))
jest.mock('../../../main/provider', () => ({
  connection: { connections: { ethereum: {} }, send: jest.fn() },
  estimateGas: jest.fn(),
  sendTransaction: jest.fn()
}))
jest.mock('../../../main/store', () => jest.fn())
jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))
jest.mock('../../../main/nebula', () => {
  const resolve = jest.fn()
  return () => ({ ens: { resolve } })
})

const mockResolveEns = jest.requireMock('../../../main/nebula')().ens.resolve

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const token = '0x3333333333333333333333333333333333333333'
const actions = {
  addOriginRequest: jest.fn(),
  initOrigin: jest.fn(),
  setDash: jest.fn(),
  switchOriginChain: jest.fn()
}

const draft = {
  account,
  amount: '0.25',
  assetAddress: NATIVE_CURRENCY,
  chainId: 1,
  recipient
}

beforeEach(() => {
  jest.clearAllMocks()
  accounts.current.mockReturnValue({ id: account, lastSignerType: 'ring' })
  requireStoreAction.mockImplementation((name) => actions[name])
  provider.connection.send.mockImplementation((payload, response) => {
    if (payload.method === 'eth_getBalance') return response({ result: '0xde0b6b3a7640000' })
    if (payload.method === 'eth_getTransactionCount') return response({ result: '0x5' })
    if (payload.method === 'eth_getBlockByNumber') return response({ result: {} })
    if (payload.method === 'eth_gasPrice') return response({ result: '0x3b9aca00' })
    return response({ error: { message: 'unsupported test RPC' } })
  })
  store.mockImplementation((...path) => {
    if (path.join('.') === `main.balances.${account}`) {
      return [
        {
          address: NATIVE_CURRENCY,
          balance: '0xde0b6b3a7640000',
          chainId: 1,
          decimals: 18,
          displayBalance: '1.00',
          name: 'Ether',
          symbol: 'ETH'
        }
      ]
    }
    if (path.join('.') === 'main.networks.ethereum.1') {
      return { id: 1, name: 'Ethereum', on: true, connection: { endpoints: [{ connected: true }] } }
    }
    if (path.join('.') === 'main.networksMeta.ethereum.1.nativeCurrency.decimals') return 18
    if (path.join('.') === 'main.networksMeta.ethereum.1.gas') {
      return { price: { levels: { fast: '0x3b9aca00' } } }
    }
    if (path.join('.') === 'main.rememberRecentRecipients') return true
    if (path.join('.') === `main.origins.${originIdForName(FRAME_SEND_ORIGIN)}`) return undefined
  })
})

it.each([
  ['0', '0x0'],
  ['0.25', '0x3782dace9d90000']
])('queues native amount %s when stored native decimals need normalization', async (amount, value) => {
  store.mockImplementation((...path) => {
    if (path.join('.') === `main.balances.${account}`) {
      return [
        {
          address: NATIVE_CURRENCY,
          balance: '0xde0b6b3a7640000',
          chainId: 1,
          displayBalance: '1.00',
          name: 'Ether',
          symbol: 'ETH'
        }
      ]
    }
    if (path.join('.') === 'main.networks.ethereum.1') {
      return { id: 1, name: 'Ethereum', on: true, connection: { endpoints: [{ connected: true }] } }
    }
    if (path.join('.') === 'main.networksMeta.ethereum.1.nativeCurrency.decimals') return 18
  })
  provider.sendTransaction.mockImplementation((payload, response, chain, onQueued) => {
    expect(payload.params[0].value).toBe(value)
    onQueued('send-handler')
  })

  await expect(send.queue({ ...draft, amount })).resolves.toEqual({
    success: true,
    handlerId: 'send-handler'
  })
})

it('queues a validated native transfer with immutable recipient metadata', async () => {
  provider.sendTransaction.mockImplementation((payload, response, chain, onQueued, metadata) => {
    expect(chain).toEqual({ type: 'ethereum', id: 1 })
    expect(payload).toEqual(
      expect.objectContaining({
        method: 'eth_sendTransaction',
        chainId: '0x1',
        _origin: originIdForName(FRAME_SEND_ORIGIN),
        params: [
          {
            chainId: '0x1',
            from: account,
            to: recipient,
            value: '0x3782dace9d90000'
          }
        ]
      })
    )
    expect(metadata.recentRecipient).toEqual({ address: recipient })
    expect(Object.isFrozen(metadata.recentRecipient)).toBe(true)
    onQueued('send-handler')
  })

  await expect(send.queue(draft)).resolves.toEqual({ success: true, handlerId: 'send-handler' })
  expect(actions.initOrigin).toHaveBeenCalledWith(originIdForName(FRAME_SEND_ORIGIN), {
    chain: { type: 'ethereum', id: 1 },
    name: FRAME_SEND_ORIGIN,
    provenance: 'managed',
    sessionOnly: false
  })
  expect(actions.setDash).toHaveBeenCalledWith({ showing: true })
})

it('does not attach recipient metadata when recent-recipient memory is disabled', async () => {
  const originalStore = store.getMockImplementation()
  store.mockImplementation((...path) => {
    if (path.join('.') === 'main.rememberRecentRecipients') return false
    return originalStore(...path)
  })
  provider.sendTransaction.mockImplementation((_payload, _response, _chain, onQueued, metadata) => {
    expect(metadata).not.toHaveProperty('recentRecipient')
    onQueued('send-handler')
  })

  await expect(send.queue(draft)).resolves.toEqual({ success: true, handlerId: 'send-handler' })
})

it.each([
  ['wrong name', { name: 'https://collision.example', provenance: 'managed' }],
  ['wrong provenance', { name: FRAME_SEND_ORIGIN, provenance: 'direct' }],
  [
    'unexpected source identity',
    { name: FRAME_SEND_ORIGIN, provenance: 'managed', sourceId: 'untrusted-source' }
  ]
])('rejects an existing Wren Send origin with %s', async (_label, invalidOrigin) => {
  const originalStore = store.getMockImplementation()
  store.mockImplementation((...path) => {
    if (path.join('.') === `main.origins.${originIdForName(FRAME_SEND_ORIGIN)}`) {
      return { ...invalidOrigin, chain: { type: 'ethereum', id: 1 } }
    }
    return originalStore(...path)
  })

  await expect(send.queue(draft)).resolves.toEqual({ success: false, error: 'origin-unavailable' })
  expect(provider.sendTransaction).not.toHaveBeenCalled()
  expect(actions.addOriginRequest).not.toHaveBeenCalled()
})

it('rejects watch-only accounts before calling the provider', async () => {
  accounts.current.mockReturnValue({ id: account, lastSignerType: 'address' })

  await expect(send.queue(draft)).resolves.toEqual({ success: false, error: 'watch-only' })
  expect(provider.sendTransaction).not.toHaveBeenCalled()
})

it('returns a bounded generic failure instead of exposing provider error text', async () => {
  provider.sendTransaction.mockImplementation((payload, response) => {
    response({ error: { message: 'private upstream detail' } })
  })

  await expect(send.queue(draft)).resolves.toEqual({ success: false, error: 'send-unavailable' })
})

it.each([
  [{ code: 4100, message: 'Managed Wren Send origin is not authorized' }, 'origin-unavailable'],
  [{ code: -32602, message: 'private validation payload' }, 'validation-failed'],
  [{ code: 4200, message: 'private unsupported detail' }, 'validation-failed'],
  [{ code: -32603, message: 'Chain 0x1 not connected' }, 'network-unavailable'],
  [{ code: -32603, message: 'Gas fee schedule unavailable at https://private-rpc' }, 'fee-unavailable']
])('maps provider admission failure %j to bounded code %s', async (providerError, expected) => {
  provider.sendTransaction.mockImplementation((_payload, response) => {
    response({ error: providerError })
  })

  await expect(send.queue(draft)).resolves.toEqual({ success: false, error: expected })
})

it('does not mislabel an unrelated authorization rejection as a local Send origin failure', async () => {
  provider.sendTransaction.mockImplementation((_payload, response) => {
    response({ error: { code: 4100, message: 'Account access changed' } })
  })

  await expect(send.queue(draft)).resolves.toEqual({ success: false, error: 'send-unavailable' })
})

it('preserves a pending managed Send route instead of switching it to another chain', async () => {
  const pending = {
    type: 'transaction',
    origin: originIdForName(FRAME_SEND_ORIGIN),
    mode: 'normal',
    data: { chainId: '0x1' }
  }
  const originalStore = store.getMockImplementation()
  store.mockImplementation((...path) => {
    if (path.join('.') === 'main.accounts') return { [account]: { requests: { pending } } }
    return originalStore(...path)
  })

  await expect(send.queue({ ...draft, chainId: 10 })).resolves.toEqual({
    success: false,
    error: 'pending-chain'
  })
  expect(provider.sendTransaction).not.toHaveBeenCalled()
  expect(actions.switchOriginChain).not.toHaveBeenCalled()
})

it('does not switch the profile-wide Send origin beneath another account’s pending request', async () => {
  const otherAccount = '0x4444444444444444444444444444444444444444'
  const pending = {
    type: 'transaction',
    origin: originIdForName(FRAME_SEND_ORIGIN),
    mode: 'normal',
    data: { chainId: '0x1' }
  }
  const originalStore = store.getMockImplementation()
  store.mockImplementation((...path) => {
    const key = path.join('.')
    if (key === 'main.accounts') return { [otherAccount]: { requests: { pending } } }
    if (key === `main.origins.${originIdForName(FRAME_SEND_ORIGIN)}`) {
      return {
        chain: { type: 'ethereum', id: 10 },
        name: FRAME_SEND_ORIGIN,
        provenance: 'managed'
      }
    }
    return originalStore(...path)
  })

  await expect(send.queue({ ...draft, chainId: 10 })).resolves.toEqual({
    success: false,
    error: 'pending-chain'
  })
  expect(provider.sendTransaction).not.toHaveBeenCalled()
  expect(actions.addOriginRequest).not.toHaveBeenCalled()
  expect(actions.switchOriginChain).not.toHaveBeenCalled()
})

it('distinguishes invalid address input from unavailable ENS lookup', async () => {
  await expect(send.resolveRecipient('0x1234')).resolves.toEqual({
    success: false,
    error: 'recipient-invalid'
  })
  expect(mockResolveEns).not.toHaveBeenCalled()

  mockResolveEns.mockRejectedValueOnce(new Error('private resolver detail'))
  await expect(send.resolveRecipient('friend.eth')).resolves.toEqual({
    success: false,
    error: 'recipient-lookup-unavailable'
  })
})

it('uses a recipient-aware gas estimate when calculating the native maximum', async () => {
  provider.estimateGas.mockResolvedValue('0x7530')

  await expect(
    send.maxAmount({ account, chainId: 1, assetAddress: NATIVE_CURRENCY, recipient })
  ).resolves.toEqual(
    expect.objectContaining({
      success: true,
      amount: '999970000000000000',
      reserve: expect.objectContaining({ total: '30000000000000' })
    })
  )
  expect(provider.estimateGas.mock.calls.map(([transaction]) => transaction)).toEqual([
    {
      chainId: '0x1',
      from: account,
      nonce: '0x5',
      to: recipient,
      value: toRpcQuantity(999979000000000000n)
    },
    {
      chainId: '0x1',
      from: account,
      nonce: '0x5',
      to: recipient,
      value: toRpcQuantity(999970000000000000n)
    }
  ])
})

it('keeps token Max available before a recipient is entered', async () => {
  store.mockImplementation((...path) => {
    if (path.join('.') === `main.balances.${account}`) {
      return [
        {
          address: token,
          balance: '1234567',
          chainId: 1,
          decimals: 6,
          displayBalance: '1.234567',
          name: 'Token',
          symbol: 'TOK'
        }
      ]
    }
  })

  await expect(send.maxAmount({ account, chainId: 1, assetAddress: token })).resolves.toEqual({
    success: true,
    amount: '1234567'
  })
  expect(provider.connection.send).not.toHaveBeenCalled()
  expect(provider.estimateGas).not.toHaveBeenCalled()
})

it('binds a reviewed Max quote to the queued transaction and trusted metadata', async () => {
  provider.estimateGas.mockResolvedValue('0x7530')
  const quote = await send.maxAmount({
    account,
    chainId: 1,
    assetAddress: NATIVE_CURRENCY,
    recipient
  })
  expect(quote).toEqual(expect.objectContaining({ success: true, amount: '999970000000000000' }))

  provider.sendTransaction.mockImplementation((payload, response, chain, onQueued, metadata) => {
    expect(payload.params[0]).toEqual(
      expect.objectContaining({
        type: '0x0',
        nonce: '0x5',
        gasLimit: '0x7530',
        gasPrice: '0x3b9aca00',
        value: toRpcQuantity(999970000000000000n)
      })
    )
    expect(metadata.nativeMax).toEqual(
      expect.objectContaining({
        quoteId: quote.quoteId,
        account,
        assetAddress: NATIVE_CURRENCY,
        chainId: 1,
        recipient,
        amount: quote.amount,
        evidence: expect.objectContaining({ nonce: '0x5' })
      })
    )
    expect(metadata.recentRecipient).toEqual({ address: recipient })
    onQueued('max-handler')
  })

  await expect(send.queue({ ...draft, amount: '0.99997', maxQuoteId: quote.quoteId })).resolves.toEqual({
    success: true,
    handlerId: 'max-handler'
  })
})

it('does not offer a native maximum without live RPC evidence', async () => {
  provider.connection.send.mockImplementation((payload, response) =>
    response({ error: { message: 'private RPC detail' } })
  )

  await expect(
    send.maxAmount({ account, chainId: 1, assetAddress: NATIVE_CURRENCY, recipient })
  ).resolves.toEqual({
    success: false,
    error: 'max-unavailable'
  })
  expect(provider.estimateGas).not.toHaveBeenCalled()
})

it('fails native Max closed when recipient-specific estimation fails', async () => {
  provider.estimateGas.mockRejectedValue(new Error('private RPC detail'))

  await expect(
    send.maxAmount({ account, chainId: 1, assetAddress: NATIVE_CURRENCY, recipient })
  ).resolves.toEqual({
    success: false,
    error: 'max-unavailable'
  })
})
