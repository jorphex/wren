import { act, fireEvent, render, screen } from '../../../componentSetup'
import { Notify } from '../../../../app/dash/Notify'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../asset/brand/exports/app/wren-app-icon-512.png', () => 'wren-icon.png')

const createStore = () =>
  jest.fn((...path) => (path.join('.') === 'main.mute.gasFeeWarning' ? false : undefined))

const createHarness = (store) =>
  class NotifyHarness extends Notify {
    constructor(props) {
      super(props)
      this.store = store
    }
  }

test('keeps approval pending until RPC success and permits a truthful retry after failure', () => {
  const req = { handlerId: 'request' }
  const store = createStore()
  const NotifyHarness = createHarness(store)
  let approveCallback
  link.rpc.mockImplementation((_method, _req, callback) => {
    approveCallback = callback
  })
  render(<NotifyHarness data={{ notify: 'gasFeeWarning', notifyData: { req } }} />)

  const proceed = screen.getByRole('button', { name: 'Approve request' })
  fireEvent.click(proceed)
  fireEvent.click(proceed)

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'backDash')

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'backDash')

  act(() => approveCallback(new Error('approval failed')))
  expect(screen.getByRole('alert').textContent).toBe('Couldn’t approve this request. It’s still pending.')
  expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'backDash')

  act(() => approveCallback(null))
  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
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

  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }))
  expect(notify.approveRequest).toHaveBeenCalledWith(req, expect.any(Function))
})

test('replaces signer compatibility with a fee warning instead of stacking request dialogs', () => {
  const req = { data: { gasLimit: '0x5208', gasPrice: '0x3b9aca00' } }
  const notify = new Notify({})
  notify.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.networksMeta.ethereum.1') {
      return { nativeCurrency: { symbol: 'ETH', usd: { price: 10_000_000 } } }
    }
    if (key === 'main.mute.gasFeeWarning') return false
    return false
  }
  render(
    notify.signerCompatibilityWarning({
      req,
      compatibility: { signer: 'ledger', tx: 'legacy' },
      chain: { type: 'ethereum', id: '1' }
    })
  )

  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }))

  expect(link.send).toHaveBeenCalledWith(
    'nav:update',
    'dash',
    expect.objectContaining({
      view: 'notify',
      data: expect.objectContaining({ notify: 'gasFeeWarning' })
    }),
    false
  )
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'navDash', expect.anything())
})

test('renders a labelled modal with safe focus, trapped focus, Escape cancellation, and focus restore', () => {
  const previousControl = document.createElement('button')
  previousControl.textContent = 'Previous control'
  document.body.appendChild(previousControl)
  previousControl.focus()

  const store = createStore()
  const NotifyHarness = createHarness(store)
  const { unmount } = render(
    <NotifyHarness data={{ notify: 'gasFeeWarning', notifyData: { req: { handlerId: 'request' } } }} />
  )

  const dialog = screen.getByRole('dialog', { name: 'High network fee' })
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  const suppression = screen.getByRole('button', { name: "Don't show this warning again" })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(previousControl.getAttribute('aria-hidden')).toBe('true')
  expect(previousControl.hasAttribute('inert')).toBe(true)
  expect(document.activeElement).toBe(cancel)

  cancel.focus()
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(suppression)
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(document.activeElement).toBe(cancel)

  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(link.rpc).not.toHaveBeenCalled()
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')

  unmount()
  expect(previousControl.hasAttribute('aria-hidden')).toBe(false)
  expect(previousControl.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(previousControl)
  previousControl.remove()
})

test('exposes disclosure links and acceptance as native actions', () => {
  const notify = new Notify({})
  notify.store = jest.fn()
  render(notify.betaDisclosure())

  expect(screen.getByText('Important safety notice')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'our license' }))
  expect(link.send).toHaveBeenCalledWith('tray:openExternal', expect.any(String))

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'muteBetaDisclosure')
})

test.each(['mainnet', 'addToken'])('ignores the removed %s notification route', (notify) => {
  const { container } = render(<Notify data={{ notify, notifyData: {} }} />)

  expect(container.firstChild).toBeNull()
  expect(link.send).not.toHaveBeenCalled()
})

test('uses a narrow request reference and ignores a stale approval callback', () => {
  const req = {
    handlerId: '11111111-1111-4111-8111-111111111111',
    account: '0x0000000000000000000000000000000000000001',
    type: 'transaction',
    data: { not: 'forwarded' }
  }
  const store = createStore()
  const NotifyHarness = createHarness(store)
  let approveCallback
  link.rpc.mockImplementation((_method, _reference, callback) => {
    approveCallback = callback
  })
  const { rerender } = render(
    <NotifyHarness data={{ notifyId: 'notice-1', notify: 'gasFeeWarning', notifyData: { req } }} />
  )

  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }))
  expect(link.rpc).toHaveBeenCalledWith(
    'approveRequest',
    { handlerId: req.handlerId, account: req.account, type: req.type },
    expect.any(Function)
  )

  rerender(<NotifyHarness data={{ notifyId: 'notice-2', notify: 'gasFeeWarning', notifyData: { req } }} />)
  act(() => approveCallback(null))
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'backDash')
})

test('resets approval errors and initial focus for a new notification identity', () => {
  const req = {
    handlerId: '11111111-1111-4111-8111-111111111111',
    account: '0x0000000000000000000000000000000000000001',
    type: 'transaction'
  }
  const NotifyHarness = createHarness(createStore())
  let approveCallback
  link.rpc.mockImplementation((_method, _reference, callback) => {
    approveCallback = callback
  })
  const { rerender } = render(
    <NotifyHarness data={{ notifyId: 'notice-1', notify: 'gasFeeWarning', notifyData: { req } }} />
  )

  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }))
  act(() => approveCallback(new Error('failed')))
  expect(screen.getByRole('alert')).toBeTruthy()

  rerender(<NotifyHarness data={{ notifyId: 'notice-2', notify: 'gasFeeWarning', notifyData: { req } }} />)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
})
