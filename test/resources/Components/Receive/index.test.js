import { render, screen, within, waitFor } from '../../../componentSetup'
import Receive from '../../../../resources/Components/Receive'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ invoke: jest.fn() }))
jest.mock(
  '../../../../resources/Components/QrCode',
  () =>
    function MockQr({ value, label }) {
      return <span role='img' aria-label={label} data-value={value} />
    }
)
const address = '0x1111111111111111111111111111111111111111'

it('opens an anchored nonmodal popover, copies the full address, and dismisses on Escape', async () => {
  link.invoke.mockResolvedValue({ success: true })
  const { user } = render(<Receive address={address} />)
  const trigger = screen.getByRole('button', { name: 'Receive' })
  await user.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Receive assets' })
  expect(dialog.hasAttribute('aria-modal')).toBe(false)
  expect(document.activeElement).toBe(trigger)
  expect(within(dialog).getByRole('img').dataset.value).toBe(address)
  await user.tab()
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy address' }))
  await user.click(document.activeElement)
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: address })
  expect(within(dialog).getByText(address)).toBeTruthy()
  await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Address copied'))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('opens only on click and consumes outside dismissal without activating the wallet', async () => {
  const send = jest.fn()
  const { user } = render(
    <>
      <Receive address={address} />
      <button onClick={send}>Send</button>
    </>
  )
  const trigger = screen.getByRole('button', { name: 'Receive' })
  await user.hover(trigger)
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.tab()
  expect(document.activeElement).toBe(trigger)
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  await user.unhover(trigger)
  expect(screen.getByRole('dialog')).toBeTruthy()
  await user.click(document.querySelector('.receiveBackdrop'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(send).not.toHaveBeenCalled()
})
