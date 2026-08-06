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
  ['Auto-hide', 'Auto-hide', ['tray:action', 'setAutohide', true]],
  ['Run on Startup', 'Run on startup', ['tray:action', 'toggleLaunch']],
  ['Glide', 'Glide', ['tray:action', 'toggleReveal']],
  ['Show Account Name with ENS', 'Show account name with ENS', ['tray:action', 'toggleShowLocalNameWithENS']]
])('routes the %s toggle to its store action', (name, accessibleName, expected) => {
  renderSettings()

  fireEvent.click(within(setting(name)).getByRole('switch', { name: accessibleName }))

  expect(link.send).toHaveBeenCalledWith(...expected)
})

it('routes every settings dropdown to its matching store action', () => {
  renderSettings()
  const selections = [
    ['Glide Edge', 'left', ['tray:action', 'setGlideSide', 'left']],
    ['Trezor Derivation', 'legacy', ['tray:action', 'setTrezorDerivation', 'legacy']],
    ['Ledger Derivation', 'standard', ['tray:action', 'setLedgerDerivation', 'standard']],
    ['Ledger Live Accounts', 10, ['tray:action', 'setLiveAccountLimit', 10]],
    ['Lattice Derivation', 'live', ['tray:action', 'setLatticeDerivation', 'live']],
    ['Lattice Accounts', 20, ['tray:action', 'setLatticeAccountLimit', 20]],
    ['Lattice Relay', 'custom', ['tray:action', 'setLatticeEndpointMode', 'custom']],
    ['Lock Hot Signers on', true, ['tray:action', 'setAccountCloseLock', true]]
  ]

  selections.forEach(([name, value, expected]) => {
    fireEvent.change(within(setting(name)).getByRole('combobox'), { target: { value: String(value) } })
    expect(link.send).toHaveBeenCalledWith(...expected)
  })
})

it('debounces a whitespace-free custom Lattice relay value', () => {
  renderSettings()
  fireEvent.change(within(setting('Lattice Relay')).getByRole('combobox'), {
    target: { value: 'custom' }
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Custom Lattice relay' }), {
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

  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  expect(link.rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))

  expect(link.rpc).toHaveBeenCalledWith(
    'revokeExtensionCredential',
    'companion-fingerprint',
    expect.any(Function)
  )
})

it('exposes shortcut editing as a native action', () => {
  renderSettings()

  fireEvent.click(screen.getByRole('button', { name: 'edit' }))

  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'setShortcut',
    'summon',
    expect.objectContaining({ configuring: true })
  )
})
