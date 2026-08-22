import hot from '../../../../main/signers/hot'

const mockFinishSignerRemoval = jest.fn()
let mockPendingSignerRemovals = {}

jest.mock('electron')
jest.mock('../../../../main/store/persist')
jest.mock('../../../../main/store', () => ({
  __esModule: true,
  default: (path) => (path === 'main.pendingSignerRemovals' ? mockPendingSignerRemovals : undefined)
}))
jest.mock('../../../../main/store/action', () => ({
  requireStoreAction: () => mockFinishSignerRemoval
}))
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

beforeEach(() => {
  mockFinishSignerRemoval.mockReset()
  mockPendingSignerRemovals = {}
})

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

test('does not reload a software signer with a durable removal journal', async () => {
  const add = jest.fn()
  const eraseFiles = jest.fn()
  mockPendingSignerRemovals = { [record.id]: { addresses: record.addresses, kind: 'hot' } }
  const scanner = hot.createScanner(
    { add, exists: () => false },
    60_000,
    {
      readAllSignerFiles: () => [{ name: 'stored-id.json', bytes: Buffer.from(JSON.stringify(record)) }]
    },
    eraseFiles
  )

  await scanner.scan()
  scanner.close()

  expect(add).not.toHaveBeenCalled()
  expect(eraseFiles).toHaveBeenCalledWith(record.id)
  expect(mockFinishSignerRemoval).toHaveBeenCalledWith(record.id)
})

test('retains a removal journal after storage failure and retries it on the next scan', async () => {
  const add = jest.fn()
  const storageError = Object.assign(new Error('signer storage unavailable'), { code: 'EACCES' })
  const eraseFiles = jest.fn().mockImplementationOnce(() => {
    throw storageError
  })
  mockPendingSignerRemovals = { [record.id]: { addresses: record.addresses, kind: 'hot' } }
  const scanner = hot.createScanner(
    { add, exists: () => false },
    60_000,
    {
      readAllSignerFiles: () => [{ name: 'stored-id.json', bytes: Buffer.from(JSON.stringify(record)) }]
    },
    eraseFiles
  )

  await scanner.scan()
  expect(mockFinishSignerRemoval).not.toHaveBeenCalled()
  expect(add).not.toHaveBeenCalled()

  await scanner.scan()
  scanner.close()

  expect(eraseFiles).toHaveBeenCalledTimes(2)
  expect(mockFinishSignerRemoval).toHaveBeenCalledWith(record.id)
  expect(add).not.toHaveBeenCalled()
})
