import { act, fireEvent, render, screen } from '../../../componentSetup'
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

test('keeps approval pending until RPC success and permits a truthful retry after failure', () => {
  const req = { handlerId: 'request' }
  const store = jest.fn((...path) => {
    const key = path.join('.')
    if (key === 'view.notify') return 'gasFeeWarning'
    if (key === 'view.notifyData') return { req }
    if (key === 'main.mute.gasFeeWarning') return false
    return undefined
  })
  store.notify = jest.fn()
  class NotifyHarness extends Notify {
    constructor(props) {
      super(props)
      this.store = store
    }
  }
  let approveCallback
  link.rpc.mockImplementation((_method, _req, callback) => {
    approveCallback = callback
  })
  render(<NotifyHarness />)

  const proceed = screen.getByRole('button', { name: 'Proceed' })
  fireEvent.click(proceed)
  fireEvent.click(proceed)

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
  expect(store.notify).not.toHaveBeenCalled()

  act(() => approveCallback(new Error('approval failed')))
  expect(screen.getByRole('alert').textContent).toBe('Couldn’t approve this request. It’s still pending.')
  expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
  expect(store.notify).not.toHaveBeenCalled()

  act(() => approveCallback(null))
  expect(store.notify).toHaveBeenCalledTimes(1)
})

test('routes direct signer compatibility approval through the guarded request path', () => {
  const req = { data: { gasLimit: '0x5208', gasPrice: '0x3b9aca00' } }
  const notify = new Notify({})
  notify.approveRequest = jest.fn()
  notify.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.networksMeta.ethereum.1') {
      return { nativeCurrency: { symbol: 'ETH', usd: { price: 1 } } }
    }
    if (key === 'main.mute.gasFeeWarning') return true
    return false
  }
  render(
    notify.signerCompatibilityWarning({
      req,
      compatibility: { signer: 'ledger', tx: 'legacy' },
      chain: { type: 'ethereum', id: '1' }
    })
  )

  fireEvent.click(screen.getByRole('button', { name: 'Proceed' }))
  expect(notify.approveRequest).toHaveBeenCalledWith(req, expect.any(Function))
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
