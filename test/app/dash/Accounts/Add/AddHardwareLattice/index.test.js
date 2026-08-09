import { act, render, screen } from '../../../../../componentSetup'
import link from '../../../../../../resources/link'
import { AddHardwareLattice } from '../../../../../../app/dash/Accounts/Add/AddHardwareLattice'

jest.mock('../../../../../../resources/link', () => ({
  send: jest.fn(),
  rpc: jest.fn()
}))
jest.mock(
  '../../../../../../resources/Components/RingIcon',
  () =>
    function MockRingIcon() {
      return <span />
    }
)

const renderSetup = () => render(<AddHardwareLattice index={3} />)

async function enterDeviceId(user, deviceId = 'GRID-123') {
  const name = screen.getByRole('textbox', { name: 'Device name' })
  await user.click(name)
  await user.keyboard('{Enter}')
  const id = screen.getByRole('textbox', { name: 'Enter device ID' })
  await user.type(id, deviceId)
  return id
}

beforeEach(() => jest.clearAllMocks())

it('uses normal keyboard controls while keeping inactive steps hidden', async () => {
  const { user } = renderSetup()

  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Device name' }))
  await user.keyboard('{Enter}')

  expect(screen.getByRole('textbox', { name: 'Enter device ID' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Device name' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(true)
  expect(screen.getByLabelText('Device name').closest('[inert]')).toBeTruthy()
})

it('creates one GridPlus signer with the original RPC payload', async () => {
  let finishCreation
  link.rpc.mockImplementationOnce((_action, _deviceId, _deviceName, callback) => {
    finishCreation = callback
  })
  const { user } = renderSetup()
  await enterDeviceId(user)

  await user.dblClick(screen.getByRole('button', { name: 'Create' }))

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('createLattice', 'GRID-123', 'GridPlus', expect.any(Function))
  expect(screen.getByRole('status').textContent).toBe('Creating GridPlus signer...')
  act(() => jest.advanceTimersByTime(500))
  expect(document.activeElement).toBe(document.body)
  expect(finishCreation).toBeTruthy()
})

it('preserves GridPlus success navigation', async () => {
  link.rpc.mockImplementationOnce((_action, _deviceId, _deviceName, callback) => {
    callback(null, { id: 'lattice-GRID-123' })
  })
  const { user } = renderSetup()
  const id = await enterDeviceId(user)

  await user.type(id, '{Enter}')

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'backDash', 2],
    ['tray:action', 'navDash', { view: 'expandedSigner', data: { signer: 'lattice-GRID-123' } }]
  ])
})

it('does not repeat synchronous GridPlus creation before navigation unmounts the setup', async () => {
  link.rpc.mockImplementation((_action, _deviceId, _deviceName, callback) => {
    callback(null, { id: 'lattice-GRID-123' })
  })
  const { user } = renderSetup()
  await enterDeviceId(user)

  await user.dblClick(screen.getByRole('button', { name: 'Create' }))

  expect(link.rpc).toHaveBeenCalledTimes(1)
})

it('shows creation errors and allows a clean successful retry', async () => {
  link.rpc
    .mockImplementationOnce((_action, _deviceId, _deviceName, callback) => {
      callback(new Error('GridPlus unavailable'))
    })
    .mockImplementationOnce((_action, _deviceId, _deviceName, callback) => {
      callback(null, { id: 'lattice-GRID-123' })
    })
  const { user } = renderSetup()
  await enterDeviceId(user)

  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(screen.getByRole('alert').textContent).toBe('GridPlus unavailable')
  await user.click(screen.getByRole('button', { name: 'Try again' }))

  expect(screen.getByRole('textbox', { name: 'Device name' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('textbox', { name: 'Enter device ID' }).value).toBe('GRID-123')
  await user.click(screen.getByRole('button', { name: 'Create' }))

  expect(link.rpc).toHaveBeenCalledTimes(2)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'lattice-GRID-123' }
  })
})

it('ignores a stale creation callback after unmount', async () => {
  let finishCreation
  link.rpc.mockImplementationOnce((_action, _deviceId, _deviceName, callback) => {
    finishCreation = callback
  })
  const view = renderSetup()
  await enterDeviceId(view.user)
  await view.user.click(screen.getByRole('button', { name: 'Create' }))
  view.unmount()

  act(() => finishCreation(null, { id: 'lattice-GRID-123' }))

  expect(link.send).not.toHaveBeenCalled()
})

it('cancels delayed input focus when setup unmounts', async () => {
  const focus = jest.spyOn(HTMLInputElement.prototype, 'focus')
  const view = renderSetup()

  await view.user.click(screen.getByRole('button', { name: 'Next' }))
  focus.mockClear()
  view.unmount()
  act(() => jest.advanceTimersByTime(500))

  expect(focus).not.toHaveBeenCalled()
  focus.mockRestore()
})
