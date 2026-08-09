import { fireEvent, render, screen } from '../../../componentSetup'
import { Notify } from '../../../../app/tray/Notify'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../asset/WrenIcon.png', () => 'wren-icon.png')

test('exposes warning suppression as a pressed-state button', () => {
  const notify = new Notify({})
  notify.store = (...path) => (path.join('.') === 'main.mute.gasFeeWarning' ? false : undefined)
  render(notify.gasFeeWarning({}))

  const control = screen.getByRole('button', { name: "Don't show this warning again" })
  expect(control.getAttribute('aria-pressed')).toBe('false')

  fireEvent.click(control)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'toggleGasFeeWarning')
})

test('exposes warning decisions as native actions', () => {
  const notify = new Notify({})
  const store = jest.fn((...path) => (path.join('.') === 'main.mute.gasFeeWarning' ? false : undefined))
  store.notify = jest.fn()
  notify.store = store
  render(notify.gasFeeWarning({ req: { handlerId: 'request' } }))

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(store.notify).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Proceed' }))
  expect(link.rpc).toHaveBeenCalledWith('approveRequest', { handlerId: 'request' }, expect.any(Function))
})

test('exposes dismissible warnings as labelled modal dialogs', () => {
  const notify = new Notify({})
  const store = (...path) => (path.join('.') === 'main.mute.gasFeeWarning' ? false : undefined)
  store.notify = jest.fn()
  notify.store = store
  render(notify.renderDialog(notify.gasFeeWarning({ req: {} })))

  const dialog = screen.getByRole('dialog', { name: 'Gas fee warning' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(store.notify).toHaveBeenCalledTimes(1)
})
