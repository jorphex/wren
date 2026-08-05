import Restore from 'react-restore'

import { Settings } from '../../../../app/dash/Settings'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen, within } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../resources/Components/KeyboardShortcutConfigurator', () => () => null)

const state = {
  platform: 'linux',
  main: {
    accountCloseLock: false,
    autohide: false,
    extensionCredentials: {
      companion: {
        browser: 'Firefox',
        extensionId: 'frame-companion@example.test',
        fingerprint: 'companion-fingerprint',
        pairedAt: 1
      }
    },
    glideSide: 'right',
    latticeSettings: {
      accountLimit: 5,
      derivation: 'standard',
      endpointCustom: '',
      endpointMode: 'default'
    },
    launch: false,
    ledger: { derivation: 'live', liveAccountLimit: 5 },
    reveal: false,
    shortcuts: {
      summon: {
        configuring: false,
        enabled: true,
        modifierKeys: ['Alt'],
        shortcutKey: 'Slash'
      }
    },
    showLocalNameWithENS: false,
    trezor: { derivation: 'standard' }
  }
}

const renderSettings = () => {
  const store = Restore.create(state, {})
  class TestSettings extends Settings {
    constructor(props) {
      super(props, { store })
      this.store = store
    }
  }
  return render(<TestSettings />)
}

const setting = (name) => screen.getByText(name).closest('.localSetting')

it.each([
  ['Auto-hide', ['tray:action', 'setAutohide', true]],
  ['Run on Startup', ['tray:action', 'toggleLaunch']],
  ['Glide', ['tray:action', 'toggleReveal']],
  ['Show Account Name with ENS', ['tray:action', 'toggleShowLocalNameWithENS']]
])('routes the %s toggle to its store action', (name, expected) => {
  renderSettings()

  fireEvent.click(setting(name).querySelector('.signerPermissionToggle'))

  expect(link.send).toHaveBeenCalledWith(...expected)
})

it('routes every settings dropdown to its matching store action', () => {
  renderSettings()
  const selections = [
    ['Glide Edge', 'Left', ['tray:action', 'setGlideSide', 'left']],
    ['Trezor Derivation', 'Legacy', ['tray:action', 'setTrezorDerivation', 'legacy']],
    ['Ledger Derivation', 'Standard', ['tray:action', 'setLedgerDerivation', 'standard']],
    ['Ledger Live Accounts', '10', ['tray:action', 'setLiveAccountLimit', 10]],
    ['Lattice Derivation', 'Live', ['tray:action', 'setLatticeDerivation', 'live']],
    ['Lattice Accounts', '20', ['tray:action', 'setLatticeAccountLimit', 20]],
    ['Lattice Relay', 'Custom', ['tray:action', 'setLatticeEndpointMode', 'custom']],
    ['Lock Hot Signers on', 'Close', ['tray:action', 'setAccountCloseLock', true]]
  ]

  selections.forEach(([name, option, expected]) => {
    fireEvent.mouseDown(within(setting(name)).getByRole('option', { name: option }))
    expect(link.send).toHaveBeenCalledWith(...expected)
  })
})

it('debounces a whitespace-free custom Lattice relay value', () => {
  renderSettings()
  fireEvent.mouseDown(within(setting('Lattice Relay')).getByRole('option', { name: 'Custom' }))
  fireEvent.change(setting('Lattice Relay').querySelector('input'), {
    target: { value: ' https://relay.example/rpc ' }
  })

  act(() => jest.advanceTimersByTime(999))
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'setLatticeEndpointCustom', expect.anything())
  act(() => jest.advanceTimersByTime(1))
  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'setLatticeEndpointCustom',
    'https://relay.example/rpc'
  )
})

it('requires confirmation before revoking a companion pairing', () => {
  renderSettings()

  fireEvent.click(screen.getByText('Revoke'))
  expect(link.rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Confirm revoke'))

  expect(link.rpc).toHaveBeenCalledWith(
    'revokeExtensionCredential',
    'companion-fingerprint',
    expect.any(Function)
  )
})
