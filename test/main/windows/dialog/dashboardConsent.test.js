import { EventEmitter } from 'events'
import { dialog } from 'electron'
import { confirmDashboardAction, dashboardDocument } from '../../../../main/windows/dialog/dashboardConsent'

jest.mock('electron', () => ({ dialog: { showMessageBox: jest.fn() } }))

const action = { message: 'Replace profile?', detail: 'Wren will restart.', confirm: 'Replace and restart' }

function fixture() {
  const frame = {}
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: jest.fn(() => false) })
  const event = { sender, senderFrame: frame }
  const window = { isDestroyed: jest.fn(() => false) }
  return { sender, event, window }
}

beforeEach(() => dialog.showMessageBox.mockReset())

it('requires explicit confirmation in a modal parented to the dashboard shell', async () => {
  const f = fixture()
  dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
  await expect(confirmDashboardAction(f.event, f.window, action)).resolves.toBe(false)
  await expect(confirmDashboardAction(f.event, f.window, action)).resolves.toBe(true)
  expect(dialog.showMessageBox).toHaveBeenCalledWith(
    f.window,
    expect.objectContaining({ defaultId: 0, cancelId: 0, buttons: ['Cancel', action.confirm] })
  )
})

it('discards approval after reload and refuses a second prompt while the first is open', async () => {
  const f = fixture()
  const owner = dashboardDocument(f.event)
  let finish
  dialog.showMessageBox.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const first = confirmDashboardAction(f.event, f.window, action)
  await expect(confirmDashboardAction(f.event, f.window, action)).resolves.toBe(false)
  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  f.sender.emit('did-start-loading')
  finish({ response: 1 })
  await expect(first).resolves.toBe(false)
  expect(dashboardDocument(f.event)).not.toBe(owner)
})

it('treats a closed parent or native dialog error as cancellation', async () => {
  const f = fixture()
  dialog.showMessageBox.mockRejectedValueOnce(new Error('dialog failed'))
  await expect(confirmDashboardAction(f.event, f.window, action)).resolves.toBe(false)
  let finish
  dialog.showMessageBox.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const response = confirmDashboardAction(f.event, f.window, action)
  f.window.isDestroyed.mockReturnValue(true)
  finish({ response: 1 })
  await expect(response).resolves.toBe(false)
})
