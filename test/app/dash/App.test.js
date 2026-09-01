import { Dash } from '../../../app/dash/App'
import Dapps from '../../../app/dash/Dapps'
import Inspector from '../../../app/dash/Inspector'
import Contracts from '../../../app/dash/Contracts'
import link from '../../../resources/link'
import { RECENT_ORIGIN_TTL } from '../../../resources/domain/connectedApps'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../app/dash/Notify', () => () => null)
jest.mock('../../../app/dash/Settings', () => () => null)

beforeEach(() => link.send.mockReset())

it('renders the connected-app destination instead of falling through to the control center', () => {
  const dash = new Dash({})
  const data = { dappDetails: 'garden.example' }

  const view = dash.renderPanel('dapps', data)

  expect(view.type).toBe(Dapps)
  expect(view.props.data).toBe(data)
})

it('counts only apps visible in Connected apps', () => {
  const now = 1_800_000
  const expiredAt = now - RECENT_ORIGIN_TTL - 1
  const origins = Object.fromEntries(
    Array.from({ length: 73 }, (_, index) => [
      `expired-${index}`,
      {
        name: `expired-${index}.example`,
        chain: { id: 1, type: 'ethereum' },
        session: {
          requests: 1,
          startedAt: expiredAt - 1,
          lastUpdatedAt: expiredAt,
          endedAt: expiredAt
        }
      }
    ])
  )
  const values = {
    'main.accounts': {},
    'main.networks': {
      ethereum: {
        1: {
          id: 1,
          name: 'Ethereum',
          on: true,
          connection: { endpoints: [{ id: 'rpc-1', connected: true }] }
        }
      }
    },
    'main.networks.ethereum': {
      1: {
        id: 1,
        name: 'Ethereum',
        on: true,
        connection: { endpoints: [{ id: 'rpc-1', connected: true }] }
      }
    },
    'main.origins': origins,
    'main.permissions': {}
  }
  const dash = new Dash({})
  dash.store = jest.fn((path) => values[path])

  expect(Object.keys(origins)).toHaveLength(73)
  expect(dash.controlCounts(now).dapps).toBe(0)
})

it('refreshes the Connected apps count at the visibility expiry boundary', () => {
  jest.useFakeTimers()
  const now = 1_800_000
  jest.setSystemTime(now)
  const lastUpdatedAt = now - RECENT_ORIGIN_TTL + 1_000
  const values = {
    'main.networks.ethereum': {
      1: {
        id: 1,
        name: 'Ethereum',
        on: true,
        connection: { endpoints: [{ id: 'rpc-1', connected: false }] }
      }
    },
    'main.origins': {
      recent: {
        name: 'recent.example',
        chain: { id: 1, type: 'ethereum' },
        session: {
          requests: 1,
          startedAt: lastUpdatedAt - 1,
          lastUpdatedAt,
          endedAt: lastUpdatedAt
        }
      }
    },
    'main.permissions': {}
  }
  const dash = new Dash({})
  dash.store = jest.fn((path) => values[path])
  dash.setState = jest.fn()

  dash.scheduleControlCountExpiry()
  expect(dash.controlCountExpiryDeadline).toBe(now + 1_000)

  jest.advanceTimersByTime(1_000)
  expect(dash.setState).toHaveBeenCalledTimes(1)
  expect(dash.setState.mock.calls[0][0]({})).toEqual({ controlCountTick: 1 })

  clearTimeout(dash.controlCountExpiryTimer)
  jest.useRealTimers()
})

it('renders the read-only inspector as an explicit dashboard destination', () => {
  const dash = new Dash({})

  expect(dash.renderPanel('inspector', {}).type).toBe(Inspector)
})

it('renders Contracts with the exact account and network state needed by deployment', () => {
  const dash = new Dash({})
  const values = {
    'main.accounts': { account: {} },
    'main.signers': { signer: {} },
    'selected.current': 'account',
    'main.networks.ethereum': { 1: {} },
    'main.networksMeta.ethereum': { 1: { nativeCurrency: { decimals: 18 } } }
  }
  dash.store = jest.fn((path) => values[path])

  const view = dash.renderPanel('contracts', {})

  expect(view.type).toBe(Contracts)
  expect(view.props).toEqual({
    initialMode: 'deploy',
    data: {},
    accounts: values['main.accounts'],
    signers: values['main.signers'],
    currentAccount: 'account',
    networks: values['main.networks.ethereum'],
    networksMeta: values['main.networksMeta.ethereum']
  })
})

it('maps the verification compatibility route into Contracts Verify mode', () => {
  const dash = new Dash({})
  const data = {
    operationId: '11111111-1111-4111-8111-111111111111',
    chainId: 1,
    address: `0x${'1'.repeat(40)}`
  }
  const networks = { 1: { id: 1, name: 'Ethereum', on: true } }
  dash.store = jest.fn((path) => (path === 'main.networks.ethereum' ? networks : undefined))

  const view = dash.renderPanel('contractVerification', data)

  expect(view.type).toBe(Contracts)
  expect(view.props).toEqual({
    initialMode: 'verify',
    data,
    accounts: {},
    signers: {},
    currentAccount: '',
    networks,
    networksMeta: {}
  })
})

it('gives an active hardware prompt exclusive ownership of signer authentication', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => ({
    id: 'trezor-1',
    name: 'Trezor Signer',
    type: 'trezor',
    status: 'need pin'
  }))

  const view = dash.renderPanel(
    'expandedSigner',
    { signer: 'trezor-1' },
    { signerId: 'trezor-1', dismissible: true }
  )

  expect(view.props.authenticationOwnedByPrompt).toBe(true)
})

it('does not suppress authentication for a different expanded signer', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => ({ id: 'trezor-2', type: 'trezor', status: 'need pin' }))

  const view = dash.renderPanel(
    'expandedSigner',
    { signer: 'trezor-2' },
    { signerId: 'trezor-1', dismissible: true }
  )

  expect(view.props.authenticationOwnedByPrompt).toBe(false)
})

it('returns one dashboard level on Escape when navigation is active', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => [{ view: 'send', data: { step: 'assetPicker' } }])
  const event = { defaultPrevented: false, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalled()
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
})

it('closes the dashboard from its root on Escape', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => [])
  const event = { defaultPrevented: false, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(link.send).toHaveBeenCalledWith('tray:action', 'closeDash')
})

it('leaves an Escape event handled by a child untouched', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => [{ view: 'send', data: {} }])
  const event = { defaultPrevented: true, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(link.send).not.toHaveBeenCalled()
})

it('keeps a non-dismissible hardware prompt open on Escape', () => {
  const dash = new Dash({})
  dash.store = jest.fn((path) => {
    if (path === 'windows.dash.hardwarePrompt') return { signerId: 'trezor-1', dismissible: false }
    if (path === 'windows.dash.nav') return [{ view: 'accounts', data: {} }]
  })
  const event = { defaultPrevented: false, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalled()
  expect(link.send).not.toHaveBeenCalled()
})

it('dismisses a passive hardware prompt on Escape without closing Dash', () => {
  const dash = new Dash({})
  dash.store = jest.fn((path) => {
    if (path === 'windows.dash.hardwarePrompt') return { signerId: 'trezor-1', dismissible: true }
    if (path === 'windows.dash.nav') return [{ view: 'accounts', data: {} }]
  })
  const event = { defaultPrevented: false, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalled()
  expect(link.send).toHaveBeenCalledWith('dash:dismissHardwarePrompt', 'trezor-1')
})
