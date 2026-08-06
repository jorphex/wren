import { render, screen } from '../../../../../componentSetup'
import { AddHardware } from '../../../../../../app/dash/Accounts/Add/AddHardware'

jest.mock(
  '../../../../../../resources/Components/RingIcon',
  () =>
    function MockRingIcon() {
      return <span />
    }
)

class AddHardwareHarness extends AddHardware {
  store(...path) {
    if (path.join('.') === 'main.signers') return {}
  }
}

test('shows accessible discovery guidance while no device is detected', () => {
  const { rerender } = render(<AddHardwareHarness type='trezor' />)

  expect(screen.getByRole('status').textContent).toBe('Looking for a Trezor')
  expect(screen.getByText('Connect and unlock your device.')).toBeTruthy()
  expect(screen.getByAltText('').getAttribute('aria-hidden')).toBe('true')

  rerender(<AddHardwareHarness type='ledger' />)
  expect(screen.getByRole('status').textContent).toBe('Looking for a Ledger')
})
