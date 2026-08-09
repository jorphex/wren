import accounts from '../../../main/accounts'
import store from '../../../main/store'
import { addRequestedChain } from '../../../main/chains/addRequestedChain'
import { verifyRpcChainId } from '../../../main/provider/chainRequests'

jest.mock('../../../main/store')
jest.mock('../../../main/accounts', () => ({ accounts: {} }))
jest.mock('../../../main/provider/chainRequests', () => ({
  ...jest.requireActual('../../../main/provider/chainRequests'),
  verifyRpcChainId: jest.fn()
}))

const address = '0x22dd63c3619818fdbc262c78baee43cb61e9cccf'
const handlerId = 'e194a121-a42a-4c2f-a8e4-d90b102b2440'
const reference = { account: address, handlerId }
const request = {
  handlerId,
  type: 'addChain',
  payload: { id: 1, jsonrpc: '2.0', params: [{ chainId: '0x89' }] }
}
const chain = {
  type: 'ethereum',
  id: 137,
  name: 'Polygon',
  symbol: 'POL',
  nativeCurrencyName: 'POL',
  nativeCurrencyDecimals: 18,
  explorer: 'https://polygonscan.com',
  icon: '',
  nativeCurrencyIcon: '',
  rpcUrls: ['https://polygon.example'],
  isTestnet: false,
  primaryColor: 'accent2'
}

let account

beforeEach(() => {
  store.set('main.networks', { ethereum: {} })
  account = {
    getRequest: jest.fn(() => request),
    resolveRequest: jest.fn()
  }
  accounts.accounts = { [address]: account }
  store.addNetwork = jest.fn((network) => store.set('main.networks', network.type, network.id, network))
  verifyRpcChainId.mockResolvedValue(chain.rpcUrls[0])
})

it('verifies, persists, and only then resolves a pending request', async () => {
  await addRequestedChain(chain, reference)

  expect(verifyRpcChainId).toHaveBeenCalledWith(chain.rpcUrls, 137)
  expect(store.addNetwork).toHaveBeenCalledWith(chain)
  expect(account.resolveRequest).toHaveBeenCalledWith(request, null)
  expect(store.addNetwork.mock.invocationCallOrder[0]).toBeLessThan(
    account.resolveRequest.mock.invocationCallOrder[0]
  )
})

it('rejects a missing pending request before endpoint verification', async () => {
  account.getRequest.mockReturnValue(undefined)

  await expect(addRequestedChain(chain, reference)).rejects.toThrow(/no longer pending/)
  expect(verifyRpcChainId).not.toHaveBeenCalled()
  expect(store.addNetwork).not.toHaveBeenCalled()
})

it('rejects a missing request account before endpoint verification', async () => {
  accounts.accounts = {}

  await expect(addRequestedChain(chain, reference)).rejects.toThrow(/no longer pending/)
  expect(verifyRpcChainId).not.toHaveBeenCalled()
  expect(store.addNetwork).not.toHaveBeenCalled()
})

it('does not allow the requested chain ID to change in the editor', async () => {
  await expect(addRequestedChain({ ...chain, id: 1 }, reference)).rejects.toThrow(/cannot be changed/)
  expect(verifyRpcChainId).not.toHaveBeenCalled()
  expect(store.addNetwork).not.toHaveBeenCalled()
})

it('does not persist or resolve when endpoint verification fails', async () => {
  verifyRpcChainId.mockRejectedValue(new Error('RPC endpoint reports a different chain ID'))

  await expect(addRequestedChain(chain, reference)).rejects.toThrow(/different chain ID/)
  expect(store.addNetwork).not.toHaveBeenCalled()
  expect(account.resolveRequest).not.toHaveBeenCalled()
})

it('does not resolve when persistence fails', async () => {
  store.addNetwork.mockImplementation(() => {})

  await expect(addRequestedChain(chain, reference)).rejects.toThrow(/Could not add chain/)
  expect(account.resolveRequest).not.toHaveBeenCalled()
})
