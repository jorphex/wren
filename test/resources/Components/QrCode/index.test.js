import { createQrMatrix, QR_QUIET_ZONE_MODULES } from '../../../../resources/Components/QrCode'

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
