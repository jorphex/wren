import BalancesScanner from '../../../../main/externalData/balances'
import * as balancesController from '../../../../main/externalData/balances/controller'
import store from '../../../../main/store'
import log from 'electron-log'
import { YEARN_SYSTEM_TOKENS } from '../../../../main/yearn/catalog'

jest.mock('../../../../main/store')
jest.mock('../../../../main/externalData/balances/controller')

const address = '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5'

const knownTokens = [
  {
    chainId: 10,
    address: '0x4200000000000000000000000000000000000042',
    symbol: 'OP'
  }
]

let balances

beforeAll(() => {
  log.transports.console.level = false
})

beforeEach(() => {
  store.set('main.tokens.known', address, knownTokens)
  store.set('main.networks.ethereum.10', {
    id: 10,
    connection: { endpoints: [{ id: 'rpc-1', connected: true }] }
  })
  store.set('main.networksMeta.ethereum.10.nativeCurrency.decimals', 6)

  balances = BalancesScanner(store)
  balances.start()
})

afterEach(() => {
  balances.stop()
})

it('scans for balances when setting an address if the controller is ready', () => {
  balancesController.isRunning.mockReturnValue(true)
  balances.setAddress(address)

  jest.advanceTimersByTime(0)

  expect(balancesController.updateKnownTokenBalances).toHaveBeenCalled()
  expect(balancesController.updateChainBalances).toHaveBeenCalledWith(address, [{ chainId: 10, decimals: 6 }])
})

it('scans for balances as soon as the controller is ready', () => {
  balancesController.isRunning.mockReturnValue(false)
  balances.setAddress(address)

  expect(balancesController.updateKnownTokenBalances).not.toHaveBeenCalled()

  balancesController.emit('ready')
  jest.advanceTimersByTime(0)

  expect(balancesController.updateKnownTokenBalances).toHaveBeenCalled()
})

it('scans for balances every 10 minutes when paused', () => {
  balancesController.isRunning.mockReturnValue(true)
  balances.setAddress(address)

  balances.pause()

  jest.advanceTimersByTime(10 * 60 * 1000)

  expect(balancesController.updateKnownTokenBalances).toHaveBeenCalledTimes(1)
})

it('tracks curated Yearn assets and shares without adding them as custom tokens', () => {
  store.set('main.networks.ethereum.1', {
    id: 1,
    connection: { endpoints: [{ id: 'rpc-1', connected: true }] }
  })
  balancesController.isRunning.mockReturnValue(true)
  balances.setAddress(address)

  jest.advanceTimersByTime(0)

  const tracked = balancesController.updateKnownTokenBalances.mock.calls.at(-1)[1]
  const ethereumSystemTokens = YEARN_SYSTEM_TOKENS.filter(({ chainId }) => chainId === 1)
  expect(tracked).toEqual(expect.arrayContaining(ethereumSystemTokens))
  expect(store('main.tokens.custom')).toBeUndefined()
})

it('prefers explicit custom token metadata over hidden Yearn metadata', () => {
  const systemToken = YEARN_SYSTEM_TOKENS.find(({ chainId }) => chainId === 1)
  const customToken = { ...systemToken, name: 'My token', symbol: 'MINE' }
  store.set('main.tokens.custom', [customToken])
  store.set('main.networks.ethereum.1', {
    id: 1,
    connection: { endpoints: [{ id: 'rpc-1', connected: true }] }
  })
  balancesController.isRunning.mockReturnValue(true)
  balances.setAddress(address)

  jest.advanceTimersByTime(0)

  const tracked = balancesController.updateKnownTokenBalances.mock.calls.at(-1)[1]
  const matching = tracked.filter(
    ({ chainId, address: tokenAddress }) =>
      chainId === systemToken.chainId && tokenAddress.toLowerCase() === systemToken.address.toLowerCase()
  )
  expect(matching).toEqual([customToken])
})

it('queues a canonical update when stored token balances differ only by address casing', () => {
  const token = { ...knownTokens[0], balance: '0x1', decimals: 18 }
  const uppercaseAddress = `0x${token.address.slice(2).toUpperCase()}`
  store.set('main.accounts', address, { address })
  store.set('main.balances', address, [token, { ...token, address: uppercaseAddress }])
  store.setBalances = jest.fn()
  store.accountTokensUpdated = jest.fn()

  balancesController.emit('tokenBalances', address, [{ ...token, address: token.address.toLowerCase() }])

  expect(store.setBalances).toHaveBeenCalledWith(address, [
    { ...token, address: token.address.toLowerCase() }
  ])
  expect(store.accountTokensUpdated).toHaveBeenCalledWith(address)
})
