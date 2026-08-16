import { render, screen } from '@testing-library/react'

import QrCode, {
  createQrMatrix,
  QR_QUIET_ZONE_MODULES
} from '../../../../resources/Components/QrCode'

const address = '0x0000000000000000000000000000000000000001'

test('encodes the exact address with the minimum reliable quiet zone', () => {
  const qr = createQrMatrix(address)

  expect(QR_QUIET_ZONE_MODULES).toBe(4)
  expect(qr.version).toBe(3)
  expect(qr.size).toBe(37)

  for (let offset = 0; offset < QR_QUIET_ZONE_MODULES; offset += 1) {
    expect(qr.data[offset].every((module) => module === false)).toBe(true)
    expect(qr.data[qr.size - 1 - offset].every((module) => module === false)).toBe(true)
    expect(qr.data.every((row) => row[offset] === false)).toBe(true)
    expect(qr.data.every((row) => row[qr.size - 1 - offset] === false)).toBe(true)
  }

  expect(qr.data.slice(QR_QUIET_ZONE_MODULES, -QR_QUIET_ZONE_MODULES).flat()).toContain(true)
})

test('renders a crisp local SVG with no padding beyond its quiet zone', () => {
  render(<QrCode label='QR code for account address' value={address} />)

  const qr = screen.getByRole('img', { name: 'QR code for account address' })
  expect(qr.getAttribute('data-qr-payload')).toBe(address)
  expect(qr.getAttribute('data-qr-quiet-zone')).toBe('4')
  expect(qr.getAttribute('shape-rendering')).toBe('crispEdges')
  expect(qr.getAttribute('viewBox')).toBe('0 0 37 37')
  expect(qr.getAttribute('width')).toBe('185')
  expect(qr.getAttribute('height')).toBe('185')
})
