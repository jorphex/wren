import link from '../../../../../resources/link'
import NativeConnectNotification from '../../../../../app/tray/Notify/NativeConnect'
import { Notify } from '../../../../../app/tray/Notify'
import { render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))
jest.mock('../../../../../asset/WrenIcon.png', () => 'wren-icon.png')

const fingerprint = 'a'.repeat(43)

it('presents a local-app identity without displaying its self-asserted label', async () => {
  const onClose = jest.fn()
  const { user } = render(
    <NativeConnectNotification
      fingerprint={fingerprint}
      pairingCode='123456'
      requestId='11111111-1111-4111-8111-111111111111'
      onClose={onClose}
    />
  )
  expect(screen.getByRole('heading', { name: 'Allow local app to connect?' })).toBeTruthy()
  expect(
    screen.getByText(
      'A local app wants to use Wren on this device. Compare this code with the app before allowing it.'
    )
  ).toBeTruthy()
  expect(screen.getByText('123456')).toBeTruthy()
  expect(screen.getByText('Connection ID aaaaaaaa…aaaaaa')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Copy full connection ID' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', fingerprint)
  await user.dblClick(screen.getByRole('button', { name: 'Allow' }))
  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith(
    'respondToNativePeerRequest',
    '11111111-1111-4111-8111-111111111111',
    true,
    expect.any(Function)
  )
})

it('routes native notification data through the modal shell', () => {
  const notifyData = {
    fingerprint,
    pairingCode: '654321',
    requestId: '11111111-1111-4111-8111-111111111111',
    label: 'Do not trust this label'
  }
  const notification = new Notify({})
  notification.store = Object.assign(
    jest.fn((path) => (path === 'view.notify' ? 'nativeConnect' : notifyData)),
    { notify: jest.fn() }
  )
  const view = notification.render()
  expect(view.props.children.props).toMatchObject({
    fingerprint,
    pairingCode: '654321',
    requestId: notifyData.requestId
  })
  expect(view.props.children.props).not.toHaveProperty('label')
})
