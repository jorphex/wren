jest.mock('../../../../main/store', () => {
  const store = jest.fn(() => 'standard')
  store.observer = jest.fn(() => ({ remove: jest.fn() }))
  return { __esModule: true, default: store }
})

jest.mock('../../../../main/store/action', () => ({
  requireStoreAction: jest.fn(() => jest.fn())
}))

jest.mock('../../../../main/signers/trezor/bridge', () => {
  const { EventEmitter } = require('events')
  const bridge = new EventEmitter()
  bridge.open = jest.fn(async () => undefined)
  bridge.close = jest.fn(async () => bridge.removeAllListeners())
  bridge.getFeatures = jest.fn(async () => ({
    model: 'T',
    major_version: 2,
    minor_version: 8,
    patch_version: 10
  }))
  bridge.getAddress = jest.fn(async () => '0xabc')
  bridge.getPublicKey = jest.fn(async () => ({ publicKey: 'public-key', chainCode: 'chain-code' }))

  return { __esModule: true, default: bridge }
})

const TrezorSignerAdapter = require('../../../../main/signers/trezor/adapter').default
const { Status } = require('../../../../main/signers/trezor/Trezor')
const TrezorBridge = require('../../../../main/signers/trezor/bridge').default

const device = { path: 'adapter-test-path', features: {} }

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Trezor adapter lifecycle', () => {
  let adapter

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    TrezorBridge.getFeatures.mockResolvedValue({
      model: 'T',
      major_version: 2,
      minor_version: 8,
      patch_version: 10
    })
    adapter = new TrezorSignerAdapter()
    adapter.open()
  })

  afterEach(async () => {
    await adapter.close()
    jest.useRealTimers()
  })

  it('restores the status after switching passphrase entry to the device', () => {
    let signer
    adapter.once('add', (addedSigner) => {
      signer = addedSigner
    })
    TrezorBridge.emit('trezor:detected', device.path)
    signer.status = Status.OK

    TrezorBridge.emit('trezor:needPhrase', device)
    expect(signer.status).toBe(Status.NEEDS_PASSPHRASE)

    TrezorBridge.emit('trezor:enteringPhrase', signer.id)
    expect(signer.status).toBe(Status.ENTERING_PASSPHRASE)

    TrezorBridge.emit('trezor:entered:passphrase', signer.id)
    expect(signer.status).toBe(Status.OK)
  })

  it('does not restore a stale status after PIN attempts are depleted', () => {
    let signer
    adapter.once('add', (addedSigner) => {
      signer = addedSigner
    })
    TrezorBridge.emit('trezor:detected', device.path)
    signer.status = Status.OK

    TrezorBridge.emit('trezor:needPin', device)
    TrezorBridge.emit('trezor:pinAttemptsDepleted', device)
    TrezorBridge.emit('trezor:entered:pin', signer.id)

    expect(signer.status).toBe(Status.NEEDS_RECONNECTION)
  })

  it('cancels delayed connection work when a signer is removed', async () => {
    let signer
    adapter.once('add', (addedSigner) => {
      signer = addedSigner
    })
    TrezorBridge.emit('trezor:detected', device.path)
    signer.deriveAddresses = jest.fn(async () => undefined)

    TrezorBridge.emit('trezor:connect', device)
    await flushPromises()
    TrezorBridge.emit('trezor:disconnect', device)
    jest.advanceTimersByTime(10_000)
    await flushPromises()

    expect(signer.deriveAddresses).not.toHaveBeenCalled()
  })

  it('only derives from the latest overlapping connection attempt', async () => {
    let signer
    adapter.once('add', (addedSigner) => {
      signer = addedSigner
    })
    TrezorBridge.emit('trezor:detected', device.path)
    let resolveFirstOpen
    signer.open = jest
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstOpen = resolve
        })
      )
      .mockResolvedValueOnce(undefined)
    signer.deriveAddresses = jest.fn(async () => undefined)

    TrezorBridge.emit('trezor:connect', device)
    TrezorBridge.emit('trezor:connect', device)
    await flushPromises()
    jest.advanceTimersByTime(200)
    await flushPromises()
    expect(signer.deriveAddresses).toHaveBeenCalledTimes(1)

    resolveFirstOpen()
    await flushPromises()
    jest.advanceTimersByTime(200)

    expect(signer.deriveAddresses).toHaveBeenCalledTimes(1)
  })

  it('does not emit an update from the disconnected timer after removal', () => {
    const updates = jest.fn()
    const removals = jest.fn()
    adapter.on('update', updates)
    adapter.on('remove', removals)

    TrezorBridge.emit('trezor:detected', device.path)
    TrezorBridge.emit('trezor:disconnect', device)
    jest.advanceTimersByTime(10_000)

    expect(removals).toHaveBeenCalledTimes(1)
    expect(updates).not.toHaveBeenCalled()
  })

  it('ignores a session probe that settles after removal', async () => {
    let resolveProbe
    TrezorBridge.getFeatures.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = resolve
      })
    )
    const updates = jest.fn()
    adapter.on('update', updates)

    TrezorBridge.emit('trezor:detected', device.path)
    TrezorBridge.emit('trezor:disconnect', device)
    resolveProbe({ model: 'T' })
    await flushPromises()
    jest.advanceTimersByTime(10_000)

    expect(updates).not.toHaveBeenCalled()
  })

  it('leaves connecting state after a slow session probe settles', async () => {
    let resolveProbe
    TrezorBridge.getFeatures.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = resolve
      })
    )
    let signer
    adapter.once('add', (addedSigner) => {
      signer = addedSigner
    })

    TrezorBridge.emit('trezor:detected', device.path)
    jest.advanceTimersByTime(10_000)
    expect(signer.status).toBe(Status.INITIAL)

    resolveProbe({ model: 'T' })
    await flushPromises()
    jest.advanceTimersByTime(1_000)

    expect(signer.status).toBe(Status.DISCONNECTED)
  })

  it('does not let an old probe clear the probe for a replacement signer', async () => {
    let resolveOldProbe
    let resolveNewProbe
    TrezorBridge.getFeatures
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldProbe = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNewProbe = resolve
        })
      )
    const addedSigners = []
    adapter.on('add', (signer) => addedSigners.push(signer))

    TrezorBridge.emit('trezor:detected', device.path)
    TrezorBridge.emit('trezor:disconnect', device)
    TrezorBridge.emit('trezor:detected', device.path)
    resolveOldProbe({ model: 'T' })
    await flushPromises()

    jest.advanceTimersByTime(10_000)
    expect(addedSigners[1].status).toBe(Status.INITIAL)

    resolveNewProbe({ model: 'T' })
    await flushPromises()
    jest.advanceTimersByTime(1_000)

    expect(addedSigners[1].status).toBe(Status.DISCONNECTED)
  })

  it('does not let adapter shutdown timers resurrect a signer', async () => {
    const updates = jest.fn()
    adapter.on('update', updates)
    TrezorBridge.emit('trezor:detected', device.path)

    await adapter.close()
    jest.advanceTimersByTime(10_000)
    TrezorBridge.emit('trezor:detected', 'late-device')

    expect(updates).not.toHaveBeenCalled()
    expect(adapter.knownSigners).toEqual({})
  })
})
