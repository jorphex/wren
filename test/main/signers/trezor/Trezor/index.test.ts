import type { Device as TrezorDevice } from '@trezor/connect'

import { Derivation } from '../../../../../main/signers/Signer/derive'
import { USER_REJECTED_REQUEST } from '../../../../../main/signers/errors'
import Trezor, { Status } from '../../../../../main/signers/trezor/Trezor'
import TrezorBridge, { DeviceError } from '../../../../../main/signers/trezor/bridge'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const device = { path: 'trezor-test-path', features: {} } as TrezorDevice

function createSigner() {
  const signer = new Trezor(device.path)
  signer.derivation = Derivation.standard
  signer.device = device
  signer.status = Status.OK
  return signer
}

describe('Trezor lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.restoreAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls address verification back once when the device answers after the timeout', async () => {
    const address = deferred<string>()
    jest.spyOn(TrezorBridge, 'getAddress').mockReturnValue(address.promise)
    const signer = createSigner()
    const callback = jest.fn()

    const verification = signer.verifyAddress(0, '0xabc', true, callback)
    await Promise.resolve()

    jest.advanceTimersByTime(60_000)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(new Error('Address verification timed out'))

    address.resolve('0xabc')
    await verification

    expect(callback).toHaveBeenCalledTimes(1)
    signer.close()
  })

  it('cancels an outstanding verification exactly once when the signer closes', async () => {
    const address = deferred<string>()
    jest.spyOn(TrezorBridge, 'getAddress').mockReturnValue(address.promise)
    const signer = createSigner()
    const callback = jest.fn()

    const verification = signer.verifyAddress(0, '0xabc', true, callback)
    await Promise.resolve()
    signer.close()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(new Error('Trezor signer closed'))

    address.resolve('0xabc')
    await verification
    jest.advanceTimersByTime(60_000)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not apply device metadata after close invalidates an open', async () => {
    const features = deferred<{
      model: string
      major_version: number
      minor_version: number
      patch_version: number
    }>()
    jest.spyOn(TrezorBridge, 'getFeatures').mockReturnValue(features.promise)
    const signer = new Trezor(device.path)
    signer.derivation = Derivation.standard
    const updates = jest.fn()
    signer.on('update', updates)

    const opening = signer.open(device)
    await Promise.resolve()
    signer.close()
    features.resolve({ model: 'T', major_version: 2, minor_version: 8, patch_version: 10 })
    await opening

    expect(signer.model).toBe('')
    expect(updates).toHaveBeenCalledTimes(1)
  })

  it('ignores duplicate account-derivation callbacks', async () => {
    jest.spyOn(TrezorBridge, 'getPublicKey').mockResolvedValue({
      publicKey: 'public-key',
      chainCode: 'chain-code'
    })
    jest.spyOn(TrezorBridge, 'getAddress').mockResolvedValue('0xabc')
    const signer = createSigner()
    signer.deriveHDAccounts = (_publicKey, _chainCode, callback) => {
      callback(null, ['0xabc'])
      callback(null, ['0xdef'])
    }

    await signer.deriveAddresses()

    expect(signer.addresses).toEqual(['0xabc'])
    expect(signer.status).toBe(Status.OK)
    signer.close()
  })

  it('publishes a recoverable derivation-failure state', async () => {
    jest
      .spyOn(TrezorBridge, 'getPublicKey')
      .mockRejectedValue(new DeviceError('Public key unavailable', 'Device_Disconnected'))
    const signer = createSigner()

    await signer.deriveAddresses()

    expect(signer.status).toBe(Status.DERIVATION_FAILED)
    signer.close()
  })

  it('publishes the strict-safety state for a forbidden derivation path', async () => {
    jest
      .spyOn(TrezorBridge, 'getPublicKey')
      .mockRejectedValue(new DeviceError('Forbidden key path requested by host', 'Failure_DataError'))
    const signer = createSigner()

    await signer.deriveAddresses()

    expect(signer.status).toBe(Status.SAFETY_CHECKS)
    signer.close()
  })

  it('does not apply a derivation result after the signer closes', async () => {
    const publicKey = deferred<{ publicKey: string; chainCode: string }>()
    jest.spyOn(TrezorBridge, 'getPublicKey').mockReturnValue(publicKey.promise)
    const signer = createSigner()
    const updates = jest.fn()
    signer.on('update', updates)

    const derivation = signer.deriveAddresses()
    await Promise.resolve()
    expect(updates).toHaveBeenCalledTimes(1)

    signer.close()
    publicKey.resolve({ publicKey: 'public-key', chainCode: 'chain-code' })
    await derivation

    expect(signer.addresses).toEqual([])
    expect(updates).toHaveBeenCalledTimes(1)
  })

  it('accepts a device session update for the same physical path during derivation', async () => {
    const publicKey = deferred<{ publicKey: string; chainCode: string }>()
    jest.spyOn(TrezorBridge, 'getPublicKey').mockReturnValue(publicKey.promise)
    jest.spyOn(TrezorBridge, 'getAddress').mockResolvedValue('0xabc')
    const signer = createSigner()
    signer.deriveHDAccounts = (_publicKey, _chainCode, callback) => callback(null, ['0xabc'])

    const derivation = signer.deriveAddresses()
    await Promise.resolve()
    signer.device = { ...device, state: 'updated-session' } as TrezorDevice
    publicKey.resolve({ publicKey: 'public-key', chainCode: 'chain-code' })
    await derivation

    expect(signer.addresses).toEqual(['0xabc'])
    expect(signer.status).toBe(Status.OK)
    signer.close()
  })

  it('restores the status after passphrase entry on the device completes', async () => {
    const signature = deferred<string>()
    jest.spyOn(TrezorBridge, 'signMessage').mockReturnValue(signature.promise)
    const signer = createSigner()
    const callback = jest.fn()

    const signing = signer.signMessage(0, '0x12', callback)
    await Promise.resolve()
    signer.status = Status.ENTERING_PASSPHRASE

    signature.resolve('abcd')
    await signing

    expect(signer.status).toBe(Status.OK)
    expect(callback).toHaveBeenCalledTimes(1)
    signer.close()
  })

  it('maps a device rejection to the provider rejection code', async () => {
    jest
      .spyOn(TrezorBridge, 'signMessage')
      .mockRejectedValue(new DeviceError('Action cancelled by user', 'Failure_ActionCancelled'))
    const signer = createSigner()
    const callback = jest.fn()

    await signer.signMessage(0, '0x12', callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toMatchObject({
      name: 'SignerUserRejectedError',
      code: USER_REJECTED_REQUEST
    })
    signer.close()
  })
})
