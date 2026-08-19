import Restore from 'react-restore'

import { Settings } from '../../../../app/dash/Settings'
import { WREN_LICENSE_URL } from '../../../../resources/constants'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen, within } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({
  invoke: jest.fn().mockResolvedValue({
    success: true,
    status: {
      available: true,
      backend: 'gnome_libsecret',
      enabled: false,
      protectedFiles: 0,
      signerFiles: 0,
      state: 'disabled'
    }
  }),
  rpc: jest.fn(),
  send: jest.fn()
}))
jest.mock('../../../../resources/Components/KeyboardShortcutConfigurator', () => () => null)

const state = {
  platform: 'linux',
  version: '0.1.0',
  view: {
    interfaceScaleEffective: 1.25
  },
  main: {
    accountCloseLock: false,
    autohide: false,
    transactionNotifications: true,
    instanceId: '11111111-1111-4111-8111-111111111111',
    interfaceScale: 1.5,
    extensionCredentials: {
      companion: {
        fingerprint: 'companion-fingerprint',
        pairedAt: 1
      }
    },
    nativePeerCredentials: {
      native: {
        fingerprint: 'n'.repeat(43),
        pairedAt: 2
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
    rememberRecentRecipients: false,
    recentRecipientUses: [],
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

const renderSettings = (mutate = (value) => value) => {
  const store = Restore.create(mutate(JSON.parse(JSON.stringify(state))), {})
  class TestSettings extends Settings {
    constructor(props) {
      super(props, { store })
      this.store = store
    }
  }
  return render(<TestSettings />)
}

const setting = (name) => screen.getByText(name).closest('.localSetting')

it('groups settings into a short, semantic ledger', () => {
  renderSettings()

  expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
    'Desktop behavior',
    'Accounts and signing',
    'Privacy',
    'Browser companions',
    'Local connections',
    'Recovery',
    'Software signers',
    'About'
  ])
  expect(screen.getByRole('region', { name: 'Desktop behavior' }).contains(setting('Wallet shortcut'))).toBe(
    true
  )
  expect(
    screen.getByRole('region', { name: 'Accounts and signing' }).contains(setting('Ledger derivation'))
  ).toBe(true)
  expect(
    within(setting('Wallet activity notifications')).getByText(
      'Show private updates while Wren is hidden. They never include app, account, network, amounts, addresses, call data, transaction hashes, or delegation details.'
    )
  ).toBeTruthy()
  expect(
    within(setting('Recent recipients')).getByText(
      'Store canonical destinations from Wren Send and managed Sweep only after successful network confirmation. Stored only on this device; never from incoming activity, indexers, chain history, or dapp calls. Recent recipients are not included in backups.'
    )
  ).toBeTruthy()
})

it('enables recent recipients without backfilling history', () => {
  renderSettings()

  fireEvent.click(
    within(setting('Recent recipients')).getByRole('switch', { name: 'Save recent recipients' })
  )

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setRememberRecentRecipients', true)
  expect(screen.queryByRole('alertdialog', { name: /Turn off and clear/ })).toBeNull()
})

it('confirms disabling recent recipients and restores focus', async () => {
  const { user } = renderSettings((value) => {
    value.main.rememberRecentRecipients = true
    value.main.recentRecipientUses = [
      {
        operationId: '123e4567-e89b-42d3-a456-426614174000',
        address: '0x2222222222222222222222222222222222222222',
        confirmedAt: Date.now()
      }
    ]
    return value
  })
  const toggle = within(setting('Recent recipients')).getByRole('switch', {
    name: 'Save recent recipients'
  })

  await user.click(toggle)
  const dialog = screen.getByRole('alertdialog', { name: 'Turn off and clear recent recipients?' })
  expect(dialog.hasAttribute('aria-modal')).toBe(false)
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog', { name: 'Turn off and clear recent recipients?' })).toBeNull()
  expect(document.activeElement).toBe(toggle)

  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Turn off and clear' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'setRememberRecentRecipients', false)
  expect(screen.getByText('Recent recipients turned off and cleared')).toBeTruthy()
  expect(document.activeElement).toBe(toggle)
})

it('clears recent recipients separately with destructive confirmation', async () => {
  const { user } = renderSettings((value) => {
    value.main.rememberRecentRecipients = true
    value.main.recentRecipientUses = [
      {
        operationId: '123e4567-e89b-42d3-a456-426614174000',
        address: '0x2222222222222222222222222222222222222222',
        confirmedAt: Date.now()
      }
    ]
    return value
  })
  const clear = within(setting('Clear recent recipients')).getByRole('button', { name: 'Clear' })

  await user.click(clear)
  const dialog = screen.getByRole('alertdialog', { name: 'Clear recent recipients?' })
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
  await user.click(within(dialog).getByRole('button', { name: 'Clear recipients' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'clearRecentRecipients')
  expect(screen.getByText('Recent recipients cleared')).toBeTruthy()
  expect(document.activeElement).toBe(clear)
})

it('keeps Clear available while enabled so memory-only pending recipients can be purged', () => {
  renderSettings((value) => {
    value.main.rememberRecentRecipients = true
    value.main.recentRecipientUses = []
    return value
  })

  expect(within(setting('Clear recent recipients')).getByRole('button', { name: 'Clear' }).disabled).toBe(
    false
  )
})

it('shows native credentials as local apps using only their connection IDs', () => {
  renderSettings()
  const section = screen.getByRole('region', { name: 'Local connections' })
  expect(within(section).getByText('Local app')).toBeTruthy()
  expect(within(section).getByText('Connection ID nnnnnnnn…nnnnnn')).toBeTruthy()
  fireEvent.click(within(section).getByRole('button', { name: 'Copy full connection ID' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', 'n'.repeat(43))
})

it('shows requested and effective interface scale and routes scale changes', () => {
  renderSettings()

  const scaleSetting = setting('Interface scale')
  expect(
    within(scaleSetting).getByText('Makes Wren’s window and contents larger when your display has room.')
  ).toBeTruthy()
  expect(within(scaleSetting).getByText('150% requested · using 125% to fit this display')).toBeTruthy()
  expect(within(scaleSetting).getByRole('status').textContent).toBe(
    'Interface scale set to 125%. You requested 150%, but Wren reduced it to fit the available screen space.'
  )
  expect(within(scaleSetting).getByRole('button', { name: '150%' }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(within(scaleSetting).getByRole('button', { name: '125%' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'setInterfaceScale', 1.25)
})

it('keeps app identity, license, and reset actions in About', async () => {
  const { user } = renderSettings()
  const about = screen.getByRole('region', { name: 'About' })
  const instanceId = state.main.instanceId

  fireEvent.click(within(about).getByRole('button', { name: instanceId }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', instanceId)
  expect(within(about).getByText('Instance ID Copied')).toBeTruthy()
  expect(within(about).getByText('v0.1.0')).toBeTruthy()

  fireEvent.click(within(about).getByRole('button', { name: 'View License' }))
  expect(link.send).toHaveBeenCalledWith('tray:openExternal', WREN_LICENSE_URL)

  const reset = within(about).getByRole('button', { name: 'Reset Wren' })
  await user.click(reset)
  expect(within(about).getByRole('alertdialog').hasAttribute('aria-modal')).toBe(false)
  expect(document.activeElement).toBe(within(about).getByRole('button', { name: 'Cancel' }))
  await user.click(within(about).getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(within(about).getByRole('button', { name: 'Reset Wren' }))

  await user.click(within(about).getByRole('button', { name: 'Reset Wren' }))
  await user.click(within(about).getByRole('button', { name: 'Reset Wren' }))
  expect(link.send).toHaveBeenCalledWith('tray:resetAllSettings')
})

it('cancels a staged reset from About with Escape', async () => {
  const { user } = renderSettings()
  const about = screen.getByRole('region', { name: 'About' })

  await user.click(within(about).getByRole('button', { name: 'Reset Wren' }))
  await user.keyboard('{Escape}')

  expect(within(about).queryByRole('alertdialog', { name: 'Reset Wren?' })).toBeNull()
  expect(document.activeElement).toBe(within(about).getByRole('button', { name: 'Reset Wren' }))
})

it.each([
  ['Auto-hide', 'Auto-hide', ['tray:action', 'setAutohide', true]],
  [
    'Wallet activity notifications',
    'Wallet activity notifications',
    ['tray:action', 'setTransactionNotifications', false]
  ],
  ['Run on startup', 'Run on startup', ['tray:action', 'toggleLaunch']],
  ['Reveal from screen edge', 'Reveal from screen edge', ['tray:action', 'toggleReveal']],
  ['Show account name with ENS', 'Show account name with ENS', ['tray:action', 'toggleShowLocalNameWithENS']]
])('routes the %s toggle to its store action', (name, accessibleName, expected) => {
  renderSettings()

  fireEvent.click(within(setting(name)).getByRole('switch', { name: accessibleName }))

  expect(link.send).toHaveBeenCalledWith(...expected)
})

it('routes every settings dropdown to its matching store action', () => {
  renderSettings()
  const selections = [
    ['Wallet side', 'left', ['tray:action', 'setGlideSide', 'left']],
    ['Trezor derivation', 'legacy', ['tray:action', 'setTrezorDerivation', 'legacy']],
    ['Ledger derivation', 'standard', ['tray:action', 'setLedgerDerivation', 'standard']],
    ['Ledger Live accounts', 10, ['tray:action', 'setLiveAccountLimit', 10]],
    ['Lattice derivation', 'live', ['tray:action', 'setLatticeDerivation', 'live']],
    ['Lattice accounts', 20, ['tray:action', 'setLatticeAccountLimit', 20]],
    ['Lattice relay', 'custom', ['tray:action', 'setLatticeEndpointMode', 'custom']],
    ['Lock hot signers when', true, ['tray:action', 'setAccountCloseLock', true]]
  ]

  selections.forEach(([name, value, expected]) => {
    fireEvent.change(within(setting(name)).getByRole('combobox'), { target: { value: String(value) } })
    expect(link.send).toHaveBeenCalledWith(...expected)
  })
})

it('debounces a whitespace-free custom Lattice relay value', () => {
  renderSettings()
  fireEvent.change(within(setting('Lattice relay')).getByRole('combobox'), {
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
  const dialog = screen.getByRole('alertdialog', { name: 'Revoke companion pairing?' })
  expect(dialog.getAttribute('aria-modal')).toBeNull()
  expect(dialog.textContent).toContain(
    'This companion will be disconnected from Wren immediately. Pairing it again requires a new six-digit code comparison.'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Revoke pairing' }))

  expect(link.rpc).toHaveBeenCalledWith(
    'revokeExtensionCredential',
    'companion-fingerprint',
    expect.any(Function)
  )
})

it('cancels companion revocation and restores focus to its trigger', async () => {
  const { user } = renderSettings()
  const revoke = screen.getByRole('button', { name: 'Revoke' })

  revoke.focus()
  await user.keyboard('{Enter}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await user.keyboard('{Enter}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke' }))

  await user.keyboard('{Enter}')
  await user.keyboard('{Escape}')

  expect(link.rpc).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke' }))
})

it('guards companion revocation while pending and recovers in place after failure', () => {
  renderSettings()
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  const confirm = screen.getByRole('button', { name: 'Revoke pairing' })

  fireEvent.click(confirm)
  fireEvent.click(confirm)

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Revoking pairing\u2026' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)

  act(() => link.rpc.mock.calls[0][2](new Error('revoke failed')))

  expect(screen.getByRole('alert').textContent).toBe(
    'Couldn\u2019t revoke pairing. The pairing is unchanged. Try again.'
  )
  expect(screen.getByRole('button', { name: 'Revoke pairing' }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Revoke pairing' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
})

it('exposes shortcut editing as a native action', () => {
  renderSettings()

  const edit = screen.getByRole('button', { name: 'Edit' })
  expect(edit.classList.contains('wrenControl')).toBe(true)
  expect(edit.closest('span')).toBeNull()
  fireEvent.click(edit)

  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'setShortcut',
    'summon',
    expect.objectContaining({ configuring: true })
  )
})

it('orders the wallet shortcut label, edit action, and enable toggle', () => {
  renderSettings()

  const shortcut = setting('Wallet shortcut')
  const controls = shortcut.querySelector('.signerPermissionControls')
  const label = within(shortcut).getByText('Wallet shortcut')
  const edit = within(shortcut).getByRole('button', { name: 'Edit' })
  const toggle = within(shortcut).getByRole('switch', { name: 'Enable wallet shortcut' })

  expect(label.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(edit.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(controls.contains(label)).toBe(true)
})

it('uses shared controls for companion revocation', () => {
  renderSettings()

  const revoke = screen.getByRole('button', { name: 'Revoke' })
  expect(revoke.classList.contains('wrenControl')).toBe(true)
  expect(revoke.classList.contains('wrenControlGhost')).toBe(true)

  fireEvent.click(revoke)
  expect(screen.getByRole('button', { name: 'Revoke pairing' }).classList.contains('wrenControlDanger')).toBe(
    true
  )
})
