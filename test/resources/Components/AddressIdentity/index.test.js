import { render, screen } from '../../../componentSetup'
import AddressIdentity from '../../../../resources/Components/AddressIdentity'

const address = '0x0000000000000000000000000000000000000001'

test('shows a sourced label beside full checksummed address evidence', () => {
  render(<AddressIdentity address={address} label='Yearn Treasury' source='Saved contact' />)

  expect(screen.getByText('Yearn Treasury')).toBeTruthy()
  expect(screen.getByText('Saved contact')).toBeTruthy()
  expect(screen.getAllByText(address)).toHaveLength(2)
})

test('keeps the compact address presentation when no identity is known', () => {
  render(<AddressIdentity address={address} />)

  expect(screen.getByLabelText(address).textContent).toBe('0x000000000001')
  expect(screen.getByText(address)).toBeTruthy()
})

test('keeps copied feedback visible without requiring hover', () => {
  render(<AddressIdentity address={address} copied />)

  expect(screen.getByText('Address copied').closest('.clusterAddressRecipientFullCopied')).toBeTruthy()
})
