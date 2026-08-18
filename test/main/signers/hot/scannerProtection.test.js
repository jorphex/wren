import hot from '../../../../main/signers/hot'

jest.mock('electron')
jest.mock('../../../../main/store/persist')
jest.mock('../../../../main/signers/hot/SeedSigner', () =>
  jest.fn(function SeedSigner(data) {
    Object.assign(this, data, { type: 'seed' })
    this.close = jest.fn()
  })
)
jest.mock('../../../../main/signers/hot/RingSigner', () =>
  jest.fn(function RingSigner(data) {
    Object.assign(this, data, { type: 'ring' })
    this.close = jest.fn()
  })
)

const record = {
  id: 'stored-id',
  addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  type: 'seed',
  encryptedSeed: { version: 2, ciphertext: 'password-encrypted' }
}

test('loads canonical records returned through the device-protection boundary', async () => {
  const added = []
  const scanner = hot.createScanner({ add: (signer) => added.push(signer), exists: () => false }, 60_000, {
    readAllSignerFiles: () => [
      { name: 'stored-id.json', bytes: Buffer.from(JSON.stringify(record)) },
      { name: 'stored-id.legacy-v1.bak', bytes: Buffer.from(JSON.stringify(record)) }
    ]
  })

  const pending = scanner.scan()
  await jest.advanceTimersByTimeAsync(100)
  await pending
  scanner.close()

  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ addresses: record.addresses, encryptedSeed: record.encryptedSeed })
  added[0].close()
})

test('loads no software signers when protection state cannot be opened consistently', async () => {
  const add = jest.fn()
  const unload = jest.fn()
  const scanner = hot.createScanner({ add, exists: () => false, unload }, 60_000, {
    readAllSignerFiles: () => {
      throw new Error('Signer protection migration is incomplete')
    }
  })

  await scanner.scan()
  scanner.close()

  expect(add).not.toHaveBeenCalled()
  expect(unload).toHaveBeenCalledWith('software signer storage unavailable')
})
