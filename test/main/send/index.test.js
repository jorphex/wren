import accounts from '../../../main/accounts'
import provider from '../../../main/provider'
import store from '../../../main/store'
import { requireStoreAction } from '../../../main/store/action'
import send from '../../../main/send'
import { NATIVE_CURRENCY } from '../../../resources/constants'
import { originIdForName, FRAME_SEND_ORIGIN } from '../../../resources/domain/origin'
import { toRpcQuantity } from '../../../resources/domain/transaction/quantity'

jest.mock('../../../main/accounts', () => ({ current: jest.fn() }))
jest.mock('../../../main/provider', () => ({ estimateGas: jest.fn(), sendTransaction: jest.fn() }))
jest.mock('../../../main/store', () => jest.fn())
jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))
jest.mock('../../../main/nebula', () => () => ({
  ens: { resolve: jest.fn() }
}))

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
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

it('queues a validated native transfer through the existing provider request pipeline', async () => {
  provider.sendTransaction.mockImplementation((payload, response, chain, onQueued) => {
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

it('uses a recipient-aware gas estimate when calculating the native maximum', async () => {
  provider.estimateGas.mockResolvedValue('0x7530')

  await expect(send.maxAmount(1, NATIVE_CURRENCY, recipient)).resolves.toEqual({
    success: true,
    amount: '999970000000000000'
  })
  expect(provider.estimateGas.mock.calls.map(([transaction]) => transaction)).toEqual([
    {
      chainId: '0x1',
      from: account,
      to: recipient,
      value: toRpcQuantity(999979000000000000n)
    },
    {
      chainId: '0x1',
      from: account,
      to: recipient,
      value: toRpcQuantity(999970000000000000n)
    }
  ])
})

it('does not offer a native maximum without live fee data', async () => {
  store.mockImplementation((...path) => {
    if (path.join('.') === `main.balances.${account}`) {
      return [
        {
          address: NATIVE_CURRENCY,
          balance: '0xde0b6b3a7640000',
          chainId: 1,
          decimals: 18
        }
      ]
    }
  })

  await expect(send.maxAmount(1, NATIVE_CURRENCY, recipient)).resolves.toEqual({
    success: false,
    error: 'fee-unavailable'
  })
  expect(provider.estimateGas).not.toHaveBeenCalled()
})

it('fails native Max closed when recipient-specific estimation fails', async () => {
  provider.estimateGas.mockRejectedValue(new Error('private RPC detail'))

  await expect(send.maxAmount(1, NATIVE_CURRENCY, recipient)).resolves.toEqual({
    success: false,
    error: 'fee-unavailable'
  })
})
