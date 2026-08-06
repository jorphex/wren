import { render, screen } from '../../../componentSetup'
import link from '../../../../resources/link'
import ReloadSignerButton from '../../../../app/dash/Signer/ReloadSignerButton'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

it('sends one reload request until signer status changes', async () => {
  const view = render(<ReloadSignerButton id='device-1' status='disconnected' />)

  await view.user.dblClick(screen.getByRole('button', { name: 'Reload Signer' }))
  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('dash:reloadSigner', 'device-1')
  expect(screen.getByRole('button', { name: 'Reloading Signer...' }).disabled).toBe(true)

  view.rerender(<ReloadSignerButton id='device-1' status='connecting' />)
  expect(screen.getByRole('button', { name: 'Reloading Signer...' }).disabled).toBe(true)
  expect(link.send).toHaveBeenCalledTimes(1)

  view.rerender(<ReloadSignerButton id='device-1' status='disconnected' />)
  await view.user.click(screen.getByRole('button', { name: 'Reload Signer' }))
  expect(link.send).toHaveBeenCalledTimes(2)
})

it('re-enables reload when GridPlus pairing settles in an error state', async () => {
  const view = render(<ReloadSignerButton id='device-1' status='disconnected' />)
  await view.user.click(screen.getByRole('button', { name: 'Reload Signer' }))

  view.rerender(<ReloadSignerButton id='device-1' status='Pairing' />)
  expect(screen.getByRole('button', { name: 'Reloading Signer...' }).disabled).toBe(true)
  view.rerender(<ReloadSignerButton id='device-1' status='Pairing Failed' />)

  expect(screen.getByRole('button', { name: 'Reload Signer' }).disabled).toBe(false)
})
