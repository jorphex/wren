import { screen, render } from '../../../componentSetup'
import Confirm from '../../../../resources/Components/Confirm'

it('handles a declined confirmation', async () => {
  const onDecline = jest.fn()
  const { user } = render(<Confirm onDecline={onDecline} />)

  await user.click(screen.getByRole('button', { name: 'Decline' }))

  expect(onDecline).toHaveBeenCalled()
})

it('handles an accepted confirmation', async () => {
  const onAccept = jest.fn()
  const { user } = render(<Confirm onAccept={onAccept} />)

  await user.click(screen.getByRole('button', { name: 'OK' }))

  expect(onAccept).toHaveBeenCalled()
})
