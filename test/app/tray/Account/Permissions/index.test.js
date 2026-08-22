import Restore from 'react-restore'

import { DappsPermissionsPreview } from '../../../../../app/tray/Account/Permissions/DappsPreview'
import { DappsPermissionsExpanded } from '../../../../../app/tray/Account/Permissions/DappsExpanded'
import { RevokeAccess } from '../../../../../app/tray/Account/Permissions/RevokeAccess'
import {
  DappGuardrailEditor,
  guardrailBodyFor,
  nativeDecimalToQuantity,
  nativeQuantityToDecimal
} from '../../../../../app/tray/Account/Permissions/DappGuardrailEditor'
import link from '../../../../../resources/link'
import { FRAME_SEND_ORIGIN } from '../../../../../resources/domain/origin'
import { act, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

const account = '0x0000000000000000000000000000000000000001'
const permission = (handlerId, origin) => ({
  version: 1,
  handlerId,
  origin,
  provider: true,
  parentCapability: 'eth_accounts',
  caveats: [
    {
      type: 'wren:permissionScope',
      value: {
        account,
        methods: ['eth_accounts'],
        chains: ['0x1'],
        expiresAt: Date.now() + 60_000
      }
    }
  ],
  grantedAt: Date.now()
})
const permissions = {
  managed: { origin: FRAME_SEND_ORIGIN, provider: true },
  second: permission('second', 'zeta.example'),
  first: permission('first', 'alpha.example')
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

const renderWithStore = (Component, props = {}, storedPermissions = permissions) => {
  const store = Restore.create({ main: { permissions: { [account]: storedPermissions } } }, {})
  class TestComponent extends Component {
    constructor(componentProps) {
      super(componentProps)
      this.store = store
    }
  }
  return render(<TestComponent account={account} moduleId='permissions' {...props} />)
}

it('sorts permission rows by their displayed origin', () => {
  renderWithStore(DappsPermissionsPreview)

  expect(screen.getByText('Apps with access')).toBeTruthy()
  expect(document.querySelector('.connectedAppsList')).toBeTruthy()
  expect(screen.getAllByText(/\.example$/).map((node) => node.textContent)).toEqual([
    'alpha.example',
    'zeta.example'
  ])
  expect(screen.queryByText(FRAME_SEND_ORIGIN)).toBeNull()
})

it('announces a store-confirmed revoke and moves focus to the result', async () => {
  class TestPreview extends DappsPermissionsPreview {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const { rerender, user } = render(
    <TestPreview account={account} moduleId='permissions' permissions={permissions} />
  )

  await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  rerender(
    <TestPreview
      account={account}
      moduleId='permissions'
      permissions={{ managed: permissions.managed, second: permissions.second }}
    />
  )

  const status = screen.getByRole('status')
  expect(status.textContent).toBe('Access revoked for alpha.example. The app must request access again.')
  expect(document.activeElement).toBe(status)
})

it('requires confirmation and revokes a permission once', async () => {
  const onRevokeRequested = jest.fn()
  const { user } = render(
    <RevokeAccess
      account={account}
      permissionId='first'
      origin='alpha.example'
      onRevokeRequested={onRevokeRequested}
    />
  )

  const trigger = screen.getByRole('button', { name: 'Revoke access' })
  expect(trigger.classList.contains('wrenControlSecondary')).toBe(true)
  expect(trigger.classList.contains('wrenControlDanger')).toBe(false)
  await user.click(trigger)
  const dialog = screen.getByRole('alertdialog', { name: 'Revoke access for alpha.example?' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText(/guardrails will be removed/u)).toBeTruthy()
  expect(link.send).not.toHaveBeenCalled()

  const confirm = screen.getByRole('button', { name: 'Confirm revoke' })
  expect(confirm.classList.contains('wrenControlDanger')).toBe(true)
  await user.dblClick(confirm)

  expect(link.send.mock.calls).toEqual([['tray:action', 'toggleAccess', account, 'first', false]])
  expect(onRevokeRequested).toHaveBeenCalledWith('first', 'alpha.example')
  expect(screen.getByRole('button', { name: 'Revoking…' }).disabled).toBe(true)
})

it('hosts confirmation inside the wallet panel instead of the wider workspace shell', async () => {
  const { user } = render(
    <div id='panel'>
      <RevokeAccess account={account} permissionId='first' origin='alpha.example' />
    </div>
  )

  await user.click(screen.getByRole('button', { name: 'Revoke access' }))

  expect(document.querySelector('#panel > .revokeAccessDialog')).toBeTruthy()
  expect(document.body.querySelector(':scope > .revokeAccessDialog')).toBeNull()
})

it('cancels safely, retries a dropped revoke, and clears its timer', async () => {
  const ref = { current: null }
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  const { unmount, user } = render(
    <RevokeAccess ref={ref} account={account} permissionId='first' origin='alpha.example' />
  )

  const trigger = screen.getByRole('button', { name: 'Revoke access' })
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(trigger)
  expect(link.send).not.toHaveBeenCalled()

  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  const pendingTimer = ref.current.pendingTimer
  act(() => jest.advanceTimersByTime(600))
  expect(screen.getByRole('button', { name: 'Confirm revoke' }).disabled).toBe(false)

  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'toggleAccess', account, 'first', false],
    ['tray:action', 'toggleAccess', account, 'first', false]
  ])

  unmount()
  expect(clearTimeoutSpy).toHaveBeenCalledWith(pendingTimer)
  clearTimeoutSpy.mockRestore()
})

it('applies the account filter in the expanded permission view', () => {
  renderWithStore(DappsPermissionsExpanded, { expanded: true, filter: 'zeta' })

  expect(screen.queryByText('alpha.example')).toBeNull()
  expect(screen.getByText('zeta.example')).toBeTruthy()
})

it('opens account-scoped management with the permission handler and granted chain', async () => {
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true })

  await user.click(screen.getAllByRole('button', { name: 'Add guardrail · Chain 0x1 (0x1)' })[0])

  expect(screen.getByText('Principal first')).toBeTruthy()
  expect(screen.getByText(account)).toBeTruthy()
  expect(screen.getByText('first')).toBeTruthy()
  expect(screen.getByText('Chain 0x1 · 0x1')).toBeTruthy()
  expect(document.activeElement).toBe(
    screen.getByRole('combobox', { name: 'When a request exceeds a restriction' })
  )
})

it('revokes the stored permission key while retaining its handler as the app principal', async () => {
  const storedPermissions = {
    stored: permission('principal', 'alpha.example')
  }
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true }, storedPermissions)

  expect(screen.getByText('Principal principal')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Revoke access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'toggleAccess', account, 'stored', false)
})

it('ends cleanly when every connected app is visible', () => {
  renderWithStore(DappsPermissionsPreview)

  expect(screen.queryByRole('button', { name: 'View all app access' })).toBeNull()
})

it('opens truncated permission management once from a continuation row', async () => {
  const crowdedPermissions = {
    managed: permissions.managed,
    first: permission('first', 'alpha.example'),
    second: permission('second', 'beta.example'),
    third: permission('third', 'delta.example'),
    fourth: permission('fourth', 'gamma.example'),
    fifth: permission('fifth', 'zeta.example')
  }
  const { user } = renderWithStore(DappsPermissionsPreview, {}, crowdedPermissions)
  const more = screen.getByRole('button', { name: 'View all app access' })

  expect(more.classList.contains('accountContinuationRow')).toBe(true)

  await user.dblClick(more)

  expect(link.send.mock.calls).toEqual([
    ['nav:forward', 'panel', { view: 'expandedModule', data: { id: 'permissions', account } }]
  ])
  expect(more.disabled).toBe(true)
})

it('requires safe confirmation before clearing all permissions and sends once', async () => {
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true })

  await user.click(screen.getByRole('button', { name: 'Clear all permissions' }))
  expect(link.send).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog', { name: 'Clear all permissions?' }).getAttribute('aria-modal')).toBe(
    'true'
  )
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear all permissions' }))

  await user.click(screen.getByRole('button', { name: 'Clear all permissions' }))
  await user.dblClick(screen.getByRole('button', { name: 'Confirm clear' }))

  expect(link.send.mock.calls).toEqual([['tray:action', 'clearPermissions', account]])
  expect(screen.getByRole('button', { name: 'Clearing…' }).disabled).toBe(true)

  act(() => jest.advanceTimersByTime(600))
  expect(screen.getByRole('button', { name: 'Clear all permissions' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear all permissions' }))
})

it('announces late store-confirmed permission clearing and moves focus to the status', async () => {
  class TestExpanded extends DappsPermissionsExpanded {
    constructor(props) {
      super(props)
      this.store = () => props.permissions
    }

    render() {
      this.store = () => this.props.permissions
      return super.render()
    }
  }
  const { rerender, user } = render(
    <TestExpanded account={account} moduleId='permissions' permissions={permissions} />
  )

  await user.click(screen.getByRole('button', { name: 'Clear all permissions' }))
  await user.click(screen.getByRole('button', { name: 'Confirm clear' }))
  act(() => jest.advanceTimersByTime(600))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear all permissions' }))
  await user.click(screen.getByRole('button', { name: 'Clear all permissions' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  rerender(
    <TestExpanded account={account} moduleId='permissions' permissions={{ managed: permissions.managed }} />
  )

  const status = screen.getByRole('status')
  expect(status.textContent).toBe('All app permissions cleared.')
  expect(document.activeElement).toBe(status)
})

it('does not offer permission management or clearing for an empty list', () => {
  const { unmount } = renderWithStore(DappsPermissionsPreview, {}, {})
  expect(screen.getByText('No app access')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'View all app access' })).toBeNull()
  unmount()

  renderWithStore(DappsPermissionsExpanded, { expanded: true }, {})
  expect(document.querySelector('.wrenEmptyStateExpanded')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Clear all permissions' })).toBeNull()
})

const guardrailProps = {
  account,
  originId: '33333333-3333-4333-8333-333333333333',
  origin: {
    name: 'alpha.example',
    provenance: 'native',
    sourceId: 'native-source-fingerprint-with-distinguishing-evidence'
  },
  chainId: '0x1',
  chainName: 'Ethereum',
  nativeDecimals: 18,
  onClose: jest.fn()
}

it('converts native decimal amounts exactly without guessing token decimals', () => {
  expect(nativeDecimalToQuantity('1.25')).toBe('0x1158e460913d0000')
  expect(nativeQuantityToDecimal('0x1158e460913d0000')).toBe('1.25')
  expect(nativeDecimalToQuantity('1.25', 6)).toBe('0x1312d0')
  expect(nativeQuantityToDecimal('0x1312d0', 6)).toBe('1.25')
  expect(() => nativeDecimalToQuantity('1.0000001', 6)).toThrow('6 decimal places')
  expect(() => nativeDecimalToQuantity('0.0000000000000000001')).toThrow('18 decimal places')
  expect(() => nativeDecimalToQuantity('1' + '0'.repeat(78))).toThrow('uint256')
  expect(
    guardrailBodyFor({
      mode: 'warn',
      targetsEnabled: false,
      spendersEnabled: false,
      nativeEnabled: false,
      tokensEnabled: true,
      tokenCeilings: '0x4444444444444444444444444444444444444444 1000',
      expiresEnabled: false
    })
  ).toEqual({
    mode: 'warn',
    tokenCeilings: [{ token: '0x4444444444444444444444444444444444444444', amount: '0x3e8' }]
  })
})

it('shows full source-bound evidence and saves an exact account, principal, and chain policy', async () => {
  const { rerender, user } = render(<DappGuardrailEditor {...guardrailProps} />)

  expect(document.activeElement).toBe(screen.getByRole('combobox'))
  expect(screen.getByText(account)).toBeTruthy()
  expect(screen.getByText(guardrailProps.originId)).toBeTruthy()
  expect(screen.getByText(guardrailProps.origin.sourceId)).toBeTruthy()
  expect(screen.getByText(/Native app · bound to the source below/u)).toBeTruthy()
  expect(
    screen.getByText(/never sign automatically and never replace normal transaction review/u)
  ).toBeTruthy()

  await user.selectOptions(screen.getByRole('combobox'), 'warn')
  await user.click(screen.getByRole('switch', { name: 'Restrict request targets' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Allowed target addresses' }),
    '0x2222222222222222222222222222222222222222'
  )
  await user.click(screen.getByRole('switch', { name: 'Restrict approval spenders' }))
  await user.click(screen.getByRole('switch', { name: 'Set native-value ceiling' }))
  await user.type(screen.getByRole('textbox', { name: 'Native-value ceiling' }), '1.25')
  await user.click(screen.getByRole('switch', { name: 'Set token ceilings' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Token ceilings' }),
    '0x4444444444444444444444444444444444444444 1000'
  )

  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(link.send).not.toHaveBeenCalled()
  expect(
    screen.getByRole('alertdialog', { name: 'Save guardrail changes?' }).getAttribute('aria-modal')
  ).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Confirm save' }))

  const body = {
    mode: 'warn',
    targets: ['0x2222222222222222222222222222222222222222'],
    spenders: [],
    nativeValueCeiling: '0x1158e460913d0000',
    tokenCeilings: [{ token: '0x4444444444444444444444444444444444444444', amount: '0x3e8' }]
  }
  expect(link.send).toHaveBeenCalledWith('tray:action', 'saveDappGuardrail', {
    account,
    originId: guardrailProps.originId,
    chainId: '0x1',
    body
  })
  expect(screen.getByRole('button', { name: 'Saving…' }).disabled).toBe(true)

  rerender(
    <DappGuardrailEditor
      {...guardrailProps}
      guardrail={{ ...body, version: 1, revision: 1, createdAt: 1, updatedAt: 1 }}
    />
  )
  expect(screen.getByRole('status').textContent).toBe('Guardrail saved.')
  expect(document.activeElement).toBe(screen.getByRole('status'))
})

it('distinguishes omitted and deny-all allowlists and focuses actionable validation errors', async () => {
  const { user } = render(<DappGuardrailEditor {...guardrailProps} />)

  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('alert').textContent).toContain('Enable at least one restriction')

  await user.click(screen.getByRole('switch', { name: 'Restrict request targets' }))
  expect(screen.getByText(/Enabled with no addresses denies every target/u)).toBeTruthy()
  expect(
    guardrailBodyFor({
      mode: 'block',
      targetsEnabled: true,
      targets: '',
      spendersEnabled: false,
      nativeEnabled: false,
      tokensEnabled: false,
      expiresEnabled: false
    })
  ).toEqual({ mode: 'block', targets: [] })
  expect(
    guardrailBodyFor({
      mode: 'block',
      targetsEnabled: false,
      spendersEnabled: false,
      nativeEnabled: false,
      tokensEnabled: true,
      tokenCeilings: '',
      expiresEnabled: false
    })
  ).toEqual({ mode: 'block', tokenCeilings: [] })

  await user.type(screen.getByRole('textbox', { name: 'Allowed target addresses' }), 'not-an-address')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('alert').textContent).toContain('invalid address')
  expect(document.activeElement).toBe(screen.getByRole('alert'))
  expect(link.send).not.toHaveBeenCalled()
})

it('requires removal confirmation, supports Escape, and reports refused actions', async () => {
  const existing = {
    version: 1,
    mode: 'block',
    targets: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1
  }
  const { user } = render(<DappGuardrailEditor {...guardrailProps} guardrail={existing} />)
  const remove = screen.getByRole('button', { name: 'Remove guardrail' })

  await user.click(remove)
  expect(screen.getByRole('alertdialog', { name: 'Remove this guardrail?' }).getAttribute('aria-modal')).toBe(
    'true'
  )
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await user.keyboard('{Escape}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove guardrail' }))
  expect(link.send).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Remove guardrail' }))
  await user.dblClick(screen.getByRole('button', { name: 'Confirm remove' }))
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'removeDappGuardrail', { account, originId: guardrailProps.originId, chainId: '0x1' }]
  ])
  expect(screen.getByRole('button', { name: 'Removing…' }).disabled).toBe(true)

  act(() => jest.advanceTimersByTime(1200))
  expect(screen.getByRole('alert').textContent).toContain('Nothing changed. Try again.')
  expect(document.activeElement).toBe(screen.getByRole('alert'))
  expect(screen.getByRole('button', { name: 'Remove guardrail' }).disabled).toBe(false)
})

it('settles removal only after the scoped store record disappears', async () => {
  const existing = { version: 1, mode: 'warn', targets: [], revision: 1, createdAt: 1, updatedAt: 1 }
  const { rerender, user } = render(<DappGuardrailEditor {...guardrailProps} guardrail={existing} />)

  await user.click(screen.getByRole('button', { name: 'Remove guardrail' }))
  await user.click(screen.getByRole('button', { name: 'Confirm remove' }))
  expect(screen.getByRole('button', { name: 'Removing…' })).toBeTruthy()

  rerender(<DappGuardrailEditor {...guardrailProps} />)
  expect(screen.getByRole('status').textContent).toBe('Guardrail removed.')
  expect(document.activeElement).toBe(screen.getByRole('status'))
  expect(screen.queryByRole('button', { name: 'Remove guardrail' })).toBeNull()
})
