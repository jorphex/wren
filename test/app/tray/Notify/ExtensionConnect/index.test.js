import link from '../../../../../resources/link'
import ExtensionConnectNotification from '../../../../../app/tray/Notify/ExtensionConnect'
import { Notify } from '../../../../../app/tray/Notify'
import { act, render, screen, waitFor } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../../asset/brand/exports/app/wren-app-icon-512.png', () => 'wren-icon.png')

it('routes the complete authentication candidate into the consent component', () => {
  const notifyData = {
    fingerprint: 'pairing-fingerprint',
    pairingCode: '654321',
    requestId: 'pairing-request'
  }
  const notification = new Notify({})
  notification.store = Object.assign(
    jest.fn((path) => (path === 'view.notify' ? 'extensionConnect' : notifyData)),
    { notify: jest.fn() }
  )

  expect(notification.render().props.children.props).toMatchObject(notifyData)
})

it('presents extension consent as a modal with the safe action focused first', () => {
  const notifyData = {
    fingerprint: 'pairing-fingerprint',
    pairingCode: '654321',
    requestId: 'pairing-request'
  }
  class NotifyHarness extends Notify {
    constructor(props) {
      super(props)
      this.store = Object.assign(
        jest.fn((path) => (path === 'view.notify' ? 'extensionConnect' : notifyData)),
        { notify: jest.fn() }
      )
    }
  }

  render(<NotifyHarness />)

  expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Decline extension connection' }))
})

it('shows the pairing identity and submits the opaque pairing request', async () => {
  const onClose = jest.fn()
  const { user } = render(
    <ExtensionConnectNotification
      fingerprint='pairing-fingerprint'
      pairingCode='123456'
      requestId='pairing-request'
      onClose={onClose}
    />
  )

  expect(screen.getByText('123456')).toBeTruthy()
  expect(screen.getByText('pairing-fingerprint')).toBeTruthy()

  const accept = screen.getByRole('button', { name: 'Codes match, connect' })
  accept.focus()
  await user.keyboard('{Enter}')
  expect(link.rpc).toHaveBeenCalledWith(
    'respondToExtensionRequest',
    'pairing-request',
    true,
    expect.any(Function)
  )
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Decline extension connection' }).disabled).toBe(true)

  link.rpc.mock.calls[0][3](null)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('settles one response for duplicate extension authorization input', async () => {
  const { user } = render(
    <ExtensionConnectNotification
      fingerprint='pairing-fingerprint'
      pairingCode='654321'
      requestId='duplicate-request'
      onClose={jest.fn()}
    />
  )

  await user.dblClick(screen.getByRole('button', { name: 'Codes match, connect' }))

  expect(link.rpc).toHaveBeenCalledTimes(1)
})

it('keeps pairing open after an RPC error and permits one guarded retry', async () => {
  const onClose = jest.fn()
  const { user } = render(
    <ExtensionConnectNotification
      fingerprint='pairing-fingerprint'
      pairingCode='111222'
      requestId='retry-request'
      onClose={onClose}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Codes match, connect' }))
  act(() => link.rpc.mock.calls[0][3](new Error('pairing failed')))

  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Could not connect to the extension' })).toBeTruthy()
  expect(screen.getByText('Wren could not complete pairing with the extension.')).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))

  await user.dblClick(screen.getByRole('button', { name: 'Retry' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
  expect(link.rpc.mock.calls[1].slice(0, 3)).toEqual(['respondToExtensionRequest', 'retry-request', true])

  link.rpc.mock.calls[1][3](null)
  expect(onClose).toHaveBeenCalledTimes(1)
})
