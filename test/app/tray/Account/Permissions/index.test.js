import React from 'react'
import Restore from 'react-restore'

import { DappsPermissionsPreview } from '../../../../../app/tray/Account/Permissions/DappsPreview'
import { DappsPermissionsExpanded } from '../../../../../app/tray/Account/Permissions/DappsExpanded'
import {
  REVOKE_ACCESS_SESSION_ONLY,
  RevokeAccess
} from '../../../../../app/tray/Account/Permissions/RevokeAccess'
import {
  DappGuardrailEditor,
  guardrailBodyFor,
  nativeDecimalToQuantity,
  nativeQuantityToDecimal
} from '../../../../../app/tray/Account/Permissions/DappGuardrailEditor'
import link from '../../../../../resources/link'
import { MAX_TIMER_DELAY } from '../../../../../resources/domain/connectedApps'
import { FRAME_SEND_ORIGIN } from '../../../../../resources/domain/origin'
import { act, render, screen, within } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({
  send: jest.fn(),
  invoke: jest.fn().mockResolvedValue({ success: true })
}))

const account = '0x0000000000000000000000000000000000000001'
const permission = (handlerId, origin, expiresAt = Date.now() + 60_000) => ({
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
        expiresAt
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

it('keeps revoke quiet without reducing its accessible name', () => {
  renderWithStore(DappsPermissionsPreview, {}, { first: permissions.first })

  const revoke = screen.getByRole('button', { name: 'Revoke access' })
  expect(revoke.textContent).toBe('Revoke')
  expect(revoke.classList.contains('wrenControlGhost')).toBe(true)
  expect(revoke.querySelector('.revokeAccessLabel')).toBeTruthy()
  expect(document.querySelector('.connectedAppMark')).toBeTruthy()
  expect(screen.getByText('alpha.example').closest('.signerPermissionIdentity')).toBeTruthy()
})

it('keeps the preview header semantic and non-interactive', async () => {
  const { user } = renderWithStore(DappsPermissionsPreview)
  const header = screen.getByRole('heading', { name: 'Apps with access' })

  expect(header.getAttribute('tabindex')).toBeNull()
  await user.click(header)
  expect(document.activeElement).not.toBe(header)
})

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])('removes an expired permission from the %s view at its boundary', (_label, Component, props) => {
  const now = Date.now()
  renderWithStore(Component, props, {
    first: permission('first', 'alpha.example', now + MAX_TIMER_DELAY + 1_000)
  })

  expect(screen.getByText('alpha.example')).toBeTruthy()
  act(() => jest.advanceTimersByTime(MAX_TIMER_DELAY))
  expect(screen.getByText('alpha.example')).toBeTruthy()
  act(() => jest.advanceTimersByTime(999))
  expect(screen.getByText('alpha.example')).toBeTruthy()
  act(() => jest.advanceTimersByTime(1))
  expect(screen.queryByText('alpha.example')).toBeNull()
  expect(screen.getByText('No app access')).toBeTruthy()
  jest.setSystemTime(now)
})

it.each([
  ['preview', DappsPermissionsPreview, {}, 'permissionsModuleFocusFallback'],
  ['expanded', DappsPermissionsExpanded, { expanded: true }, 'permissionsLedgerView']
])(
  'moves %s dialog focus to a visible fallback when its last permission expires',
  async (_label, Component, props, fallbackClass) => {
    const now = Date.now()
    const { user } = renderWithStore(Component, props, {
      first: permission('first', 'alpha.example', now + 1_000)
    })

    await user.click(screen.getByRole('button', { name: 'Revoke access' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

    act(() => jest.advanceTimersByTime(1_000))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('No app access')).toBeTruthy()
    expect(document.activeElement.classList.contains(fallbackClass)).toBe(true)
    jest.setSystemTime(now)
  }
)

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])(
  'announces an inverse-order %s session-only failure without stealing focus',
  async (_label, Component, props) => {
    const ref = React.createRef()
    let settleRevoke
    link.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleRevoke = resolve
        })
    )
    class TestPermissions extends Component {
      store(...path) {
        if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
      }
    }
    const componentProps = { account, moduleId: 'permissions', ...props }
    const view = (storedPermissions) => (
      <>
        <button type='button'>Outside action</button>
        <TestPermissions ref={ref} {...componentProps} permissions={storedPermissions} />
      </>
    )
    const { rerender, user } = render(view(permissions))

    await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    rerender(view({ managed: permissions.managed, second: permissions.second }))
    expect(ref.current.state.revokeRequested).toBeNull()
    expect(ref.current.orphanedRevokeId).toBe('first')

    const outside = screen.getByRole('button', { name: 'Outside action' })
    outside.focus()
    await act(async () =>
      settleRevoke({
        success: false,
        uncertain: true,
        sessionOnly: true,
        error: 'persistence-failed'
      })
    )

    expect(screen.getByRole('alert').textContent).toBe(REVOKE_ACCESS_SESSION_ONLY)
    expect(document.activeElement).toBe(outside)
    expect(ref.current.orphanedRevokeId).toBeUndefined()
    act(() => jest.advanceTimersByTime(4000))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(outside)
  }
)

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])(
  'moves %s dialog focus to a surviving row when its permission expires',
  async (_label, Component, props) => {
    const now = Date.now()
    const { user } = renderWithStore(Component, props, {
      first: permission('first', 'alpha.example', now + 1_000),
      second: permission('second', 'zeta.example', now + 60_000)
    })

    const expiringAction = screen
      .getByText('alpha.example')
      .closest('.signerPermission')
      .querySelector('.revokeAccessButton')
    await user.click(expiringAction)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

    act(() => jest.advanceTimersByTime(1_000))

    expect(screen.queryByText('alpha.example')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByText('zeta.example').closest('.signerPermission').querySelector('.revokeAccessButton')
    )
    jest.setSystemTime(now)
  }
)

it('announces a store-confirmed revoke, advances focus, and dismisses the inline status', async () => {
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
  expect(status.getAttribute('aria-live')).toBe('polite')
  expect(status.classList.contains('revokeAccessStatus')).toBe(true)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke access' }))

  act(() => jest.advanceTimersByTime(3999))
  expect(screen.getByRole('status')).toBeTruthy()
  act(() => jest.advanceTimersByTime(1))
  expect(screen.queryByRole('status')).toBeNull()
})

it('uses the same transient revoke status lifecycle in expanded account access', async () => {
  class TestExpanded extends DappsPermissionsExpanded {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
      if (path.join('.') === 'main.networks.ethereum.1.name') return 'Ethereum'
      if (path.join('.') === 'main.networksMeta.ethereum.1.nativeCurrency.decimals') return 18
    }
  }
  const { rerender, user } = render(<TestExpanded account={account} expanded permissions={permissions} />)

  await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  rerender(
    <TestExpanded
      account={account}
      expanded
      permissions={{ managed: permissions.managed, second: permissions.second }}
    />
  )

  expect(screen.getByRole('status').textContent).toContain('Access revoked for alpha.example')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke access' }))
  act(() => jest.advanceTimersByTime(4000))
  expect(screen.queryByRole('status')).toBeNull()
})

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])(
  'silently drops a %s revoke whose permission disappears before the invoke settles',
  async (_label, Component, props) => {
    const ref = React.createRef()
    let settleRevoke
    link.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleRevoke = resolve
        })
    )
    class TestPermissions extends Component {
      store(...path) {
        if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
      }
    }
    const componentProps = { account, moduleId: 'permissions', ...props }
    const view = (storedPermissions) => (
      <>
        <button type='button'>Outside action</button>
        <TestPermissions ref={ref} {...componentProps} permissions={storedPermissions} />
      </>
    )
    const { rerender, user } = render(view(permissions))
    const outside = screen.getByRole('button', { name: 'Outside action' })

    await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    rerender(view({ managed: permissions.managed, second: permissions.second }))

    expect(ref.current.state.revokeRequested).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Revoke access' }))

    outside.focus()
    await act(async () => settleRevoke({ success: true }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.activeElement).toBe(outside)
  }
)

it.each([
  ['preview', DappsPermissionsPreview, {}, REVOKE_ACCESS_SESSION_ONLY],
  ['expanded', DappsPermissionsExpanded, { expanded: true }, REVOKE_ACCESS_SESSION_ONLY]
])(
  'reports a %s session-only revoke without claiming durable success',
  async (_label, Component, props, expectedCopy) => {
    let settleRevoke
    link.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleRevoke = resolve
        })
    )
    class TestPermissions extends Component {
      store(...path) {
        if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
      }
    }
    const componentProps = { account, moduleId: 'permissions', ...props }
    const { rerender, user } = render(<TestPermissions {...componentProps} permissions={permissions} />)

    await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    await act(async () =>
      settleRevoke({
        success: false,
        uncertain: true,
        sessionOnly: true,
        error: 'persistence-failed'
      })
    )
    rerender(
      <TestPermissions
        {...componentProps}
        permissions={{ managed: permissions.managed, second: permissions.second }}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(expectedCopy)
    expect(alert.textContent).not.toContain('Access revoked for')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke access' }))
  }
)

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])(
  'ignores a %s revoke rejection after an orphaned request was cleared',
  async (_label, Component, props) => {
    let rejectRevoke
    link.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          rejectRevoke = reject
        })
    )
    class TestPermissions extends Component {
      store(...path) {
        if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
      }
    }
    const componentProps = { account, moduleId: 'permissions', ...props }
    const { rerender, user } = render(<TestPermissions {...componentProps} permissions={permissions} />)

    await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    rerender(
      <TestPermissions
        {...componentProps}
        permissions={{ managed: permissions.managed, second: permissions.second }}
      />
    )
    await act(async () => rejectRevoke(new Error('transport unavailable')))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  }
)

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])('reconciles %s store removal that arrives after a rejected invoke', async (_label, Component, props) => {
  link.invoke.mockRejectedValueOnce(new Error('transport unavailable'))
  class TestPermissions extends Component {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const componentProps = { account, moduleId: 'permissions', ...props }
  const { rerender, user } = render(<TestPermissions {...componentProps} permissions={permissions} />)

  await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect((await screen.findByRole('alert')).textContent).toContain('confirmation is unavailable')

  rerender(
    <TestPermissions
      {...componentProps}
      permissions={{ managed: permissions.managed, second: permissions.second }}
    />
  )
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('could not confirm the saved change')
  expect(alert.textContent).not.toContain('Access revoked for')
  act(() => jest.advanceTimersByTime(4_000))
  expect(screen.queryByRole('alert')).toBeNull()
})

it.each([
  ['preview', DappsPermissionsPreview, {}],
  ['expanded', DappsPermissionsExpanded, { expanded: true }]
])('stops %s uncertainty UI reconciliation after cancellation', async (_label, Component, props) => {
  link.invoke.mockRejectedValueOnce(new Error('transport unavailable'))
  class TestPermissions extends Component {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const componentProps = { account, moduleId: 'permissions', ...props }
  const view = (storedPermissions) => (
    <>
      <button type='button'>Outside action</button>
      <TestPermissions {...componentProps} permissions={storedPermissions} />
    </>
  )
  const { rerender, user } = render(view(permissions))

  await user.click(screen.getAllByRole('button', { name: 'Revoke access' })[0])
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect((await screen.findByRole('alert')).textContent).toContain('confirmation is unavailable')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  const outside = screen.getByRole('button', { name: 'Outside action' })
  outside.focus()

  rerender(view({ managed: permissions.managed, second: permissions.second }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(document.activeElement).toBe(outside)
})

it.each([
  ['preview', DappsPermissionsPreview, {}, 'permissionsModuleFocusFallback'],
  ['expanded', DappsPermissionsExpanded, { expanded: true }, 'permissionsLedgerView']
])(
  'keeps %s revoke focus on the next row, then the previous row, then a visible fallback',
  async (_label, Component, componentProps, fallbackClass) => {
    class TestPermissions extends Component {
      store(...path) {
        const key = path.join('.')
        if (key === `main.permissions.${account}`) return this.props.permissions
        if (key === 'main.networks.ethereum.1.name') return 'Ethereum'
        if (key === 'main.networksMeta.ethereum.1.nativeCurrency.decimals') return 18
      }
    }
    const initial = {
      first: permission('first', 'alpha.example'),
      middle: permission('middle', 'beta.example'),
      last: permission('last', 'zeta.example')
    }
    const props = { account, moduleId: 'permissions', ...componentProps }
    const { rerender, user } = render(<TestPermissions {...props} permissions={initial} />)
    const revoke = async (origin) => {
      const action = screen
        .getByText(origin)
        .closest('.signerPermission')
        .querySelector('.revokeAccessButton')
      await user.click(action)
      await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    }

    await revoke('beta.example')
    const afterMiddle = { first: initial.first, last: initial.last }
    rerender(<TestPermissions {...props} permissions={afterMiddle} />)
    expect(document.activeElement).toBe(
      screen.getByText('zeta.example').closest('.signerPermission').querySelector('.revokeAccessButton')
    )

    await revoke('zeta.example')
    const afterLast = { first: initial.first }
    rerender(<TestPermissions {...props} permissions={afterLast} />)
    expect(document.activeElement).toBe(
      screen.getByText('alpha.example').closest('.signerPermission').querySelector('.revokeAccessButton')
    )

    await revoke('alpha.example')
    rerender(<TestPermissions {...props} permissions={{}} />)
    const status = screen.getByRole('status')
    expect(document.activeElement).toBe(status)
    expect(status.tabIndex).toBe(-1)

    act(() => jest.advanceTimersByTime(4000))
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.activeElement.classList.contains(fallbackClass)).toBe(true)
  }
)

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
  expect(trigger.classList.contains('wrenControlGhost')).toBe(true)
  expect(trigger.classList.contains('wrenControlDanger')).toBe(false)
  await user.click(trigger)
  const dialog = screen.getByRole('alertdialog', { name: 'Revoke access for alpha.example?' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  const descriptionId = dialog.getAttribute('aria-describedby')
  expect(descriptionId).toBeTruthy()
  expect(document.getElementById(descriptionId).textContent).toContain('This app will lose access')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText(/guardrails will be removed/u)).toBeTruthy()
  expect(link.send).not.toHaveBeenCalled()

  const confirm = screen.getByRole('button', { name: 'Confirm revoke' })
  expect(confirm.classList.contains('wrenControlDanger')).toBe(true)
  await user.dblClick(confirm)

  expect(link.invoke).toHaveBeenCalledWith('tray:revokeAccess', account, 'first')
  expect(onRevokeRequested).toHaveBeenCalledWith('first', 'alpha.example', [])
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

it('cancels safely, reports a refused revoke, and allows a retry', async () => {
  const ref = { current: null }
  const onRevokeFailed = jest.fn()
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  const { unmount, user } = render(
    <RevokeAccess
      ref={ref}
      account={account}
      permissionId='first'
      origin='alpha.example'
      onRevokeFailed={onRevokeFailed}
    />
  )

  const trigger = screen.getByRole('button', { name: 'Revoke access' })
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(trigger)
  expect(link.invoke).not.toHaveBeenCalled()

  link.invoke.mockResolvedValueOnce({ success: false, error: 'permission unavailable' })
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Access was not revoked. Try again.')
  expect(onRevokeFailed).toHaveBeenCalledWith('first')
  const retry = screen.getByRole('button', { name: 'Confirm revoke' })
  expect(retry.disabled).toBe(false)
  expect(document.activeElement).toBe(retry)

  act(() => jest.advanceTimersByTime(4000))
  expect(screen.queryByRole('alert')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect(link.invoke.mock.calls).toEqual([
    ['tray:revokeAccess', account, 'first'],
    ['tray:revokeAccess', account, 'first']
  ])

  unmount()
  clearTimeoutSpy.mockRestore()
})

it('keeps a delayed successful revoke pending without inventing a timeout failure', async () => {
  let resolveRevoke
  link.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRevoke = resolve
      })
  )
  const { user } = render(<RevokeAccess account={account} permissionId='first' origin='alpha.example' />)

  await user.click(screen.getByRole('button', { name: 'Revoke access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  act(() => jest.advanceTimersByTime(1_200))

  expect(screen.getByRole('button', { name: 'Revoking…' }).disabled).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()

  await act(async () => resolveRevoke({ success: true }))
  expect(screen.getByRole('button', { name: 'Revoking…' }).disabled).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('applies the account filter in the expanded permission view', () => {
  renderWithStore(DappsPermissionsExpanded, { expanded: true, filter: 'zeta' })

  expect(screen.queryByText('alpha.example')).toBeNull()
  expect(screen.getByText('zeta.example')).toBeTruthy()
})

it('opens account-scoped management with the app connection ID and granted chain', async () => {
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true })

  await user.click(screen.getAllByRole('button', { name: 'Add guardrail · Chain 0x1 (0x1)' })[0])

  const editor = screen.getByRole('region', { name: 'Guardrail for alpha.example' })
  expect(editor.closest('.signerPermission')).toBeNull()
  expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull()
  expect(within(editor).getByText('App connection ID')).toBeTruthy()
  expect(within(editor).getByText(account)).toBeTruthy()
  expect(within(editor).getByText('first')).toBeTruthy()
  expect(screen.getByText('Chain 0x1 · 0x1')).toBeTruthy()
  expect(document.activeElement).toBe(
    screen.getByRole('combobox', { name: 'When a request exceeds a restriction' })
  )
  await user.click(within(editor).getByRole('button', { name: 'Close editor' }))
  expect(screen.queryByRole('region', { name: 'Guardrail for alpha.example' })).toBeNull()
  expect(document.activeElement).toBe(
    screen.getAllByRole('button', { name: 'Add guardrail · Chain 0x1 (0x1)' })[0]
  )
})

it('revokes the stored permission key while retaining its app connection ID', async () => {
  const storedPermissions = {
    stored: permission('principal', 'alpha.example')
  }
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true }, storedPermissions)

  const app = screen.getByRole('group', { name: 'alpha.example app access' })
  await user.click(within(app).getByText('Connection details'))
  expect(within(app).getByText('App connection ID')).toBeTruthy()
  expect(within(app).getByText('principal')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Revoke access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))

  expect(link.invoke).toHaveBeenCalledWith('tray:revokeAccess', account, 'stored')
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

it('requires safe confirmation and keeps a delayed clear pending without a false timeout', async () => {
  link.invoke.mockImplementationOnce(() => new Promise(() => {}))
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true })

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  expect(link.invoke).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog', { name: 'Revoke all app access?' }).getAttribute('aria-modal')).toBe(
    'true'
  )
  const clearDialog = screen.getByRole('alertdialog', { name: 'Revoke all app access?' })
  const descriptionId = clearDialog.getAttribute('aria-describedby')
  expect(document.getElementById(descriptionId).textContent).toContain('guardrails will be removed')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  const trigger = screen.getByRole('button', { name: 'Revoke all app access' })
  expect(document.activeElement).toBe(trigger)
  expect(trigger.classList.contains('wrenControlGhost')).toBe(true)
  expect(trigger.classList.contains('wrenControlDanger')).toBe(false)

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.dblClick(screen.getByRole('button', { name: 'Confirm revoke' }))

  expect(link.invoke.mock.calls).toEqual([['tray:revokeAccess', account]])
  expect(screen.getByRole('button', { name: 'Revoking…' }).disabled).toBe(true)

  act(() => jest.advanceTimersByTime(1_200))
  expect(screen.getByRole('button', { name: 'Revoking…' }).disabled).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('announces only acknowledged permission clearing and moves focus to the status', async () => {
  let settleClear
  link.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settleClear = resolve
      })
  )
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

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  rerender(
    <TestExpanded account={account} moduleId='permissions' permissions={{ managed: permissions.managed }} />
  )

  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('button', { name: 'Revoking…' })).toBeTruthy()
  await act(async () => settleClear({ success: true }))

  const status = screen.getByRole('status')
  expect(status.textContent).toBe('All app access revoked.')
  expect(document.activeElement).toBe(status)
  act(() => jest.advanceTimersByTime(3_999))
  expect(screen.getByRole('status')).toBeTruthy()
  act(() => jest.advanceTimersByTime(1))
  expect(screen.queryByRole('status')).toBeNull()
  expect(document.activeElement.classList.contains('permissionsLedgerView')).toBe(true)
})

it('reports a refused clear in its dialog and restores the confirm action', async () => {
  link.invoke.mockResolvedValueOnce({ success: false, error: 'Permission could not be revoked' })
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true })

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))

  expect((await screen.findByRole('alert')).textContent).toContain('App access was not revoked')
  const confirm = screen.getByRole('button', { name: 'Confirm revoke' })
  expect(confirm.disabled).toBe(false)
  expect(document.activeElement).toBe(confirm)
})

it('reports session-only clearing without claiming durable success', async () => {
  const ref = React.createRef()
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  let settleClear
  link.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settleClear = resolve
      })
  )
  class TestExpanded extends DappsPermissionsExpanded {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const { rerender, unmount, user } = render(
    <TestExpanded ref={ref} account={account} moduleId='permissions' permissions={permissions} />
  )

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  await act(async () =>
    settleClear({
      success: false,
      uncertain: true,
      sessionOnly: true,
      error: 'persistence-failed'
    })
  )
  expect(screen.getByRole('alert').textContent).toBe(REVOKE_ACCESS_SESSION_ONLY)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm revoke' }))

  rerender(
    <TestExpanded
      account={account}
      ref={ref}
      moduleId='permissions'
      permissions={{ managed: permissions.managed }}
    />
  )

  const alert = screen.getByRole('alert')
  expect(alert.textContent).toBe(REVOKE_ACCESS_SESSION_ONLY)
  expect(screen.queryByText('All app access revoked.')).toBeNull()
  expect(document.activeElement).toBe(alert)
  const statusTimer = ref.current.clearStatusTimer
  unmount()
  expect(clearTimeoutSpy).toHaveBeenCalledWith(statusTimer)
  clearTimeoutSpy.mockRestore()
})

it('reconciles clear-all store removal that arrives before a rejected invoke', async () => {
  let rejectClear
  link.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        rejectClear = reject
      })
  )
  class TestExpanded extends DappsPermissionsExpanded {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const { rerender, user } = render(
    <TestExpanded account={account} moduleId='permissions' permissions={permissions} />
  )

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  rerender(
    <TestExpanded account={account} moduleId='permissions' permissions={{ managed: permissions.managed }} />
  )
  await act(async () => rejectClear(new Error('transport unavailable')))

  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('could not confirm the saved change')
  expect(screen.queryByText('All app access revoked.')).toBeNull()
})

it('reconciles clear-all store removal that arrives after a rejected invoke', async () => {
  link.invoke.mockRejectedValueOnce(new Error('transport unavailable'))
  class TestExpanded extends DappsPermissionsExpanded {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const { rerender, user } = render(
    <TestExpanded account={account} moduleId='permissions' permissions={permissions} />
  )

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect((await screen.findByRole('alert')).textContent).toContain('confirmation is unavailable')

  rerender(
    <TestExpanded account={account} moduleId='permissions' permissions={{ managed: permissions.managed }} />
  )
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('could not confirm the saved change')
  expect(screen.queryByText('All app access revoked.')).toBeNull()
})

it('stops clear-all uncertainty UI reconciliation after cancellation', async () => {
  link.invoke.mockRejectedValueOnce(new Error('transport unavailable'))
  class TestExpanded extends DappsPermissionsExpanded {
    store(...path) {
      if (path.join('.') === `main.permissions.${account}`) return this.props.permissions
    }
  }
  const view = (storedPermissions) => (
    <>
      <button type='button'>Outside action</button>
      <TestExpanded account={account} moduleId='permissions' permissions={storedPermissions} />
    </>
  )
  const { rerender, user } = render(view(permissions))

  await user.click(screen.getByRole('button', { name: 'Revoke all app access' }))
  await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect((await screen.findByRole('alert')).textContent).toContain('confirmation is unavailable')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  const outside = screen.getByRole('button', { name: 'Outside action' })
  outside.focus()

  rerender(view({ managed: permissions.managed }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(document.activeElement).toBe(outside)
})

it('does not offer permission management or clearing for an empty list', () => {
  const { unmount } = renderWithStore(DappsPermissionsPreview, {}, {})
  expect(screen.getByText('No app access')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'View all app access' })).toBeNull()
  unmount()

  renderWithStore(DappsPermissionsExpanded, { expanded: true }, {})
  expect(document.querySelector('.wrenEmptyStateExpanded')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Revoke all app access' })).toBeNull()
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

  expect(document.activeElement).toBe(
    screen.getByRole('combobox', { name: 'When a request exceeds a restriction' })
  )
  expect(screen.getByText(account)).toBeTruthy()
  expect(screen.getByText(guardrailProps.originId)).toBeTruthy()
  expect(screen.getByText(guardrailProps.origin.sourceId)).toBeTruthy()
  expect(screen.getByText(/Native app · bound to the source below/u)).toBeTruthy()
  expect(screen.getByText(/Requests still require your review/u)).toBeTruthy()

  await user.selectOptions(
    screen.getByRole('combobox', { name: 'When a request exceeds a restriction' }),
    'warn'
  )
  await user.selectOptions(screen.getByRole('combobox', { name: 'Request targets' }), 'selected')
  await user.type(
    screen.getByRole('textbox', { name: 'Allowed target addresses' }),
    '0x2222222222222222222222222222222222222222'
  )
  await user.selectOptions(screen.getByRole('combobox', { name: 'Approval spenders' }), 'none')
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

  await user.selectOptions(screen.getByRole('combobox', { name: 'Request targets' }), 'selected')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Request targets' }), 'none')
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

  await user.selectOptions(screen.getByRole('combobox', { name: 'Request targets' }), 'selected')
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

it('keeps the precision-unavailable reason visible for a disabled native restriction', () => {
  render(<DappGuardrailEditor {...guardrailProps} nativeDecimals={undefined} />)
  expect(
    screen.getByText('Native asset precision is unavailable, so this restriction cannot be edited.')
  ).toBeTruthy()
})
