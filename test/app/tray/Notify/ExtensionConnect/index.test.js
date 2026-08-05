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

  expect(notification.render().props).toMatchObject(notifyData)
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

  await user.click(screen.getByText('Accept'))
  expect(link.rpc).toHaveBeenCalledWith('respondToExtensionRequest', 'pairing-request', true, onClose)
})
