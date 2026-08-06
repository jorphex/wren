import { render, screen } from '../../../componentSetup'
import { Signer } from '../../../../app/dash/Signer'

test('renders the Trezor PIN matrix as named native controls', () => {
  const signer = new Signer({ id: 'trezor', type: 'trezor' })
  render(signer.renderTrezorPin(true))

  expect(screen.getAllByRole('button', { name: /PIN position/ })).toHaveLength(9)
  expect(screen.getByRole('button', { name: 'Submit PIN' }).disabled).toBe(true)
  expect(screen.getByRole('status', { name: '0 PIN positions entered' })).toBeTruthy()
})
