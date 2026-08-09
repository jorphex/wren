import link from '../../../../../resources/link'
import ExtensionConnectNotification from '../../../../../app/tray/Notify/ExtensionConnect'
import { Notify } from '../../../../../app/tray/Notify'
import { render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../../asset/WrenIcon.png', () => 'wren-icon.png')

it('routes the complete authentication candidate into the consent component', () => {
  const notifyData = {
    browser: 'firefox',
    extensionId: '4be0643f-1d98-573b-97cd-ca98a65347dd',
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
    browser: 'firefox',
    extensionId: '4be0643f-1d98-573b-97cd-ca98a65347dd',
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
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Decline extension connection' })
  )
})

it('shows the pairing identity and submits the opaque pairing request', async () => {
  const onClose = jest.fn()
  const { user } = render(
    <ExtensionConnectNotification
      browser='chrome'
      extensionId='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      pairingCode='123456'
      requestId='pairing-request'
      onClose={onClose}
    />
  )

  expect(screen.getByText('123456')).toBeTruthy()
  expect(screen.getByText('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeTruthy()

  const accept = screen.getByRole('button', { name: 'Accept extension connection' })
  accept.focus()
  await user.keyboard('{Enter}')
  expect(link.rpc).toHaveBeenCalledWith('respondToExtensionRequest', 'pairing-request', true, onClose)
  expect(screen.getByRole('button', { name: 'Decline extension connection' }).disabled).toBe(true)
})

it('settles one response for duplicate extension authorization input', async () => {
  const { user } = render(
    <ExtensionConnectNotification
      browser='firefox'
      extensionId='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      pairingCode='654321'
      requestId='duplicate-request'
      onClose={jest.fn()}
    />
  )

  await user.dblClick(screen.getByRole('button', { name: 'Accept extension connection' }))

  expect(link.rpc).toHaveBeenCalledTimes(1)
})
