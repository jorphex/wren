import { fireEvent, render, screen } from '../../../componentSetup'
import { Notify } from '../../../../app/dash/Notify'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../asset/WrenIcon.png', () => 'wren-icon.png')

test('exposes warning decisions as native actions', () => {
  const notify = new Notify({})
  notify.store = (...path) => (path.join('.') === 'main.mute.gasFeeWarning' ? false : undefined)
  render(notify.gasFeeWarning({ req: { handlerId: 'request' } }))

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')

  fireEvent.click(screen.getByRole('button', { name: 'Proceed' }))
  expect(link.rpc).toHaveBeenCalledWith('approveRequest', { handlerId: 'request' }, expect.any(Function))
})

test('exposes disclosure links and acceptance as native actions', () => {
  const notify = new Notify({})
  notify.store = jest.fn()
  render(notify.betaDisclosure())

  fireEvent.click(screen.getByRole('button', { name: 'our license' }))
  expect(link.send).toHaveBeenCalledWith('tray:openExternal', expect.any(String))

  fireEvent.click(screen.getByRole('button', { name: "Let's go!" }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'muteBetaDisclosure')
})

test.each(['mainnet', 'addToken'])('ignores the removed %s notification route', (notify) => {
  const { container } = render(<Notify data={{ notify, notifyData: {} }} />)

  expect(container.firstChild).toBeNull()
  expect(link.send).not.toHaveBeenCalled()
})
