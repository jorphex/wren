import { render, screen } from '../../../../../componentSetup'
import { AddHardware } from '../../../../../../app/dash/Accounts/Add/AddHardware'

jest.mock(
  '../../../../../../resources/Components/RingIcon',
  () =>
    function MockRingIcon() {
      return <span />
    }
)
jest.mock(
  '../../../../../../app/dash/Signer',
  () =>
    function MockSigner({ id, inSetup }) {
      return <div data-testid={`signer-${id}`} data-in-setup={String(inSetup)} />
    }
)

class AddHardwareHarness extends AddHardware {
  store(...path) {
    if (path.join('.') === 'main.signers') return this.props.signers || {}
    if (path[0] === 'main.signers') {
      const signer = (this.props.signers || {})[path[1]]
      return path.length === 2 ? signer : signer?.[path[2]]
    }
  }
}

test('shows accessible discovery guidance while no device is detected', () => {
  const { rerender } = render(<AddHardwareHarness type='trezor' />)

  expect(screen.getByRole('status').textContent).toBe('Looking for your Trezor')
  expect(screen.getByText('Connect and unlock your device.')).toBeTruthy()
  expect(screen.getByAltText('').getAttribute('aria-hidden')).toBe('true')

  rerender(<AddHardwareHarness type='ledger' />)
  expect(screen.getByRole('status').textContent).toBe('Looking for your Ledger')
})

test('renders only detected signers matching the discovery card type', () => {
  const signers = {
    ledger: { id: 'ledger', type: 'ledger', status: 'ok' },
    trezor: { id: 'trezor', type: 'trezor', status: 'ok' }
  }
  render(<AddHardwareHarness type='trezor' signers={signers} />)

  expect(screen.getByTestId('signer-trezor').getAttribute('data-in-setup')).toBe('true')
  expect(screen.queryByTestId('signer-ledger')).toBeNull()
})
