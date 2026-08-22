import { createHash } from 'node:crypto'

export function releaseSbomSerial({ name, version, sourceCommit, packageLock }) {
  const serialBytes = createHash('sha256')
    .update(`${name}\0${version}\0${sourceCommit}\0`)
    .update(JSON.stringify(packageLock))
    .digest()
    .subarray(0, 16)
  serialBytes[6] = (serialBytes[6] & 0x0f) | 0x50
  serialBytes[8] = (serialBytes[8] & 0x3f) | 0x80
  const serialHex = serialBytes.toString('hex')
  return `urn:uuid:${serialHex.slice(0, 8)}-${serialHex.slice(8, 12)}-${serialHex.slice(12, 16)}-${serialHex.slice(16, 20)}-${serialHex.slice(20)}`
}
