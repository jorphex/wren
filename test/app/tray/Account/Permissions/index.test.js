import Restore from 'react-restore'

import { DappsPermissionsPreview } from '../../../../../app/tray/Account/Permissions/DappsPreview'
import { DappsPermissionsExpanded } from '../../../../../app/tray/Account/Permissions/DappsExpanded'
import { PermissionToggle } from '../../../../../app/tray/Account/Permissions/PermissionToggle'
import link from '../../../../../resources/link'
import { FRAME_SEND_ORIGIN } from '../../../../../resources/domain/origin'
import { act, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

const account = '0x0000000000000000000000000000000000000001'
const permissions = {
  managed: { origin: FRAME_SEND_ORIGIN, provider: true },
  second: { origin: 'zeta.example', provider: true },
  first: { origin: 'alpha.example', provider: false }
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

  expect(screen.getAllByText(/\.example$/).map((node) => node.textContent)).toEqual([
    'alpha.example',
    'zeta.example'
  ])
  expect(screen.queryByText(FRAME_SEND_ORIGIN)).toBeNull()
})

it('toggles a permission once and settles from the store value', async () => {
  const { rerender, user } = render(
    <PermissionToggle account={account} permissionId='first' origin='alpha.example' checked={false} />
  )
  const toggle = screen.getByRole('switch', { name: 'Access for alpha.example' })

  await user.dblClick(toggle)

  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'toggleAccess', account, 'first', true)
  expect(toggle.disabled).toBe(true)

  rerender(<PermissionToggle account={account} permissionId='first' origin='alpha.example' checked={true} />)
  expect(screen.getByRole('switch', { name: 'Access for alpha.example' }).disabled).toBe(false)
  expect(screen.getByRole('switch', { name: 'Access for alpha.example' }).getAttribute('aria-checked')).toBe(
    'true'
  )
})

it('retries a dropped permission update with the same desired state and clears its timer', async () => {
  const ref = { current: null }
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  const { unmount, user } = render(
    <PermissionToggle
      ref={ref}
      account={account}
      permissionId='first'
      origin='alpha.example'
      checked={false}
    />
  )

  await user.click(screen.getByRole('switch', { name: 'Access for alpha.example' }))
  const pendingTimer = ref.current.pendingTimer
  act(() => jest.advanceTimersByTime(600))
  expect(screen.getByRole('switch', { name: 'Access for alpha.example' }).disabled).toBe(false)

  await user.click(screen.getByRole('switch', { name: 'Access for alpha.example' }))
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'toggleAccess', account, 'first', true],
    ['tray:action', 'toggleAccess', account, 'first', true]
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

it('opens permission management once with the exact breadcrumb and remains single-flight', async () => {
  const { user } = renderWithStore(DappsPermissionsPreview)
  const more = screen.getByRole('button', { name: 'More' })

  await user.dblClick(more)

  expect(link.send.mock.calls).toEqual([
    ['nav:forward', 'panel', { view: 'expandedModule', data: { id: 'permissions', account } }]
  ])
  expect(more.disabled).toBe(true)
})

it('requires safe confirmation before clearing all permissions and sends once', async () => {
  const { user } = renderWithStore(DappsPermissionsExpanded, { expanded: true })

  await user.click(screen.getByRole('button', { name: 'Clear All Permissions' }))
  expect(link.send).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear All Permissions' }))

  await user.click(screen.getByRole('button', { name: 'Clear All Permissions' }))
  await user.dblClick(screen.getByRole('button', { name: 'Confirm Clear' }))

  expect(link.send.mock.calls).toEqual([['tray:action', 'clearPermissions', account]])
  expect(screen.getByRole('button', { name: 'Clearing...' }).disabled).toBe(true)

  act(() => jest.advanceTimersByTime(600))
  expect(screen.getByRole('button', { name: 'Clear All Permissions' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear All Permissions' }))
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

  await user.click(screen.getByRole('button', { name: 'Clear All Permissions' }))
  await user.click(screen.getByRole('button', { name: 'Confirm Clear' }))
  act(() => jest.advanceTimersByTime(600))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear All Permissions' }))
  await user.click(screen.getByRole('button', { name: 'Clear All Permissions' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  rerender(
    <TestExpanded account={account} moduleId='permissions' permissions={{ managed: permissions.managed }} />
  )

  const status = screen.getByRole('status')
  expect(status.textContent).toBe('All external permissions cleared.')
  expect(document.activeElement).toBe(status)
})

it('does not offer permission management or clearing for an empty list', () => {
  const { unmount } = renderWithStore(DappsPermissionsPreview, {}, {})
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  unmount()

  renderWithStore(DappsPermissionsExpanded, { expanded: true }, {})
  expect(screen.queryByRole('button', { name: 'Clear All Permissions' })).toBeNull()
})
