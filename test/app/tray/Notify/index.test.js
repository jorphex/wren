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
