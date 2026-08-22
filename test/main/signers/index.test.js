import EventEmitter from 'events'

import { Signers } from '../../../main/signers'
import { installCloseToTray } from '../../../main/windows/closeToTray'

let mockCloseLock = false
let mockPendingSignerRemovals = {}
let mockSignerSummaries = {}
const mockNewSignerAction = jest.fn()
const mockRemoveSignerAction = jest.fn()
const mockUpdateSignerAction = jest.fn()
const mockCommitMainState = jest.fn()
const mockStoreActions = {
  newSigner: mockNewSignerAction,
  removeSigner: mockRemoveSignerAction,
  updateSigner: mockUpdateSignerAction
}

jest.mock('../../../main/store', () => ({
  __esModule: true,
  default: jest.fn((path) => {
    if (path === 'main.accountCloseLock') return mockCloseLock
    if (path === 'main.pendingSignerRemovals') return mockPendingSignerRemovals
    const signerAddressMatch = path?.match(/^main\.signers\.([^.]+)\.addresses$/u)
    if (signerAddressMatch) return mockSignerSummaries[signerAddressMatch[1]]?.addresses
    const signerSummaryMatch = path?.match(/^main\.signers\.([^.]+)$/u)
    if (signerSummaryMatch) return mockSignerSummaries[signerSummaryMatch[1]]
    if (path === 'main') return { pendingSignerRemovals: mockPendingSignerRemovals }
  })
}))
jest.mock('../../../main/store/action', () => ({
  requireStoreAction: (name) => mockStoreActions[name] || jest.fn()
}))
jest.mock('../../../main/store/persist', () => ({ commitMainState: mockCommitMainState }))

jest.mock('../../../main/signers/hot/adapter', () => {
  const { EventEmitter: MockEventEmitter } = require('events')
  return {
    __esModule: true,
    default: class MockHotAdapter extends MockEventEmitter {
      adapterType = 'hot'
      open() {}
      close() {}
    }
  }
})
jest.mock('../../../main/signers/ledger/adapter', () => {
  const { EventEmitter: MockEventEmitter } = require('events')
  return {
    __esModule: true,
    default: class MockLedgerAdapter extends MockEventEmitter {
      adapterType = 'ledger'
      open() {}
      close() {}
    }
  }
})
jest.mock('../../../main/signers/trezor/adapter', () => {
  const { EventEmitter: MockEventEmitter } = require('events')
  return {
    __esModule: true,
    default: class MockTrezorAdapter extends MockEventEmitter {
      adapterType = 'trezor'
      open() {}
      close() {}
    }
  }
})
jest.mock('../../../main/signers/lattice/adapter', () => {
  const { EventEmitter: MockEventEmitter } = require('events')
  return {
    __esModule: true,
    default: class MockLatticeAdapter extends MockEventEmitter {
      adapterType = 'lattice'
      open() {}
      close() {}
    }
  }
})

class TestAdapter extends EventEmitter {
  constructor(type) {
    super()
    this.adapterType = type
    this.open = jest.fn()
    this.close = jest.fn()
    this.remove = jest.fn()
    this.reload = jest.fn()
  }
}

const hotSigner = (id = 'hot-1') => ({
  id,
  type: 'ring',
  status: 'ok',
  summary: () => ({ id }),
  lock: jest.fn(function (callback) {
    this.status = 'locked'
    callback(null)
  }),
  unlock: jest.fn(),
  close: jest.fn(),
  delete: jest.fn()
})

describe('signer manager lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    mockCloseLock = false
    mockPendingSignerRemovals = {}
    mockSignerSummaries = {}
  })

  it('lists addresses owned by signers other than the one being removed', async () => {
    const manager = new Signers([])
    const removed = { ...hotSigner('removed'), addresses: ['0x1', '0x2'] }
    const retained = { ...hotSigner('retained'), addresses: ['0x2', '0x3'] }
    manager.add(removed)
    manager.add(retained)

    expect(manager.addressesExcept('removed')).toEqual(['0x2', '0x3'])

    await manager.close()
  })

  it('durably records replacement ownership without narrowing a removal journal', async () => {
    const manager = new Signers([])
    const sharedAddress = '0x0000000000000000000000000000000000000001'
    const signer = { ...hotSigner('replacement'), addresses: [] }
    signer.summary = () => ({ id: signer.id, addresses: [...signer.addresses] })
    manager.add(signer)
    mockSignerSummaries = { replacement: { id: signer.id, addresses: [] } }
    mockPendingSignerRemovals = {
      removed: { addresses: [sharedAddress], kind: 'hardware' }
    }

    signer.addresses = [sharedAddress]
    manager.update(signer)

    expect(mockCommitMainState).toHaveBeenCalledTimes(1)
    expect(mockUpdateSignerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'replacement', addresses: [sharedAddress] })
    )

    await manager.close()
  })

  it('keeps a late-derived address fenced when preserving it cannot be committed', async () => {
    const manager = new Signers([])
    const pendingAddress = '0x0000000000000000000000000000000000000001'
    const signer = { ...hotSigner('replacement'), addresses: [] }
    signer.summary = () => ({ id: signer.id, addresses: [...signer.addresses] })
    manager.add(signer)
    mockSignerSummaries = { replacement: { id: signer.id, addresses: [] } }
    mockPendingSignerRemovals = {
      removed: { addresses: [pendingAddress], kind: 'hardware' }
    }
    mockCommitMainState.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })

    signer.addresses = [pendingAddress]
    manager.update(signer)

    expect(signer.addresses).toEqual([])
    expect(mockUpdateSignerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'replacement', addresses: [] })
    )

    await manager.close()
  })

  it('keeps a late-derived address fenced when the store update itself fails', async () => {
    const manager = new Signers([])
    const pendingAddress = '0x0000000000000000000000000000000000000001'
    const signer = { ...hotSigner('replacement'), addresses: [] }
    signer.summary = () => ({ id: signer.id, addresses: [...signer.addresses] })
    manager.add(signer)
    mockSignerSummaries = { replacement: { id: signer.id, addresses: [] } }
    mockPendingSignerRemovals = {
      removed: { addresses: [pendingAddress], kind: 'hardware' }
    }
    mockUpdateSignerAction.mockImplementationOnce(() => {
      throw new Error('store update failed')
    })

    signer.addresses = [pendingAddress]
    manager.update(signer)

    expect(mockCommitMainState).not.toHaveBeenCalled()
    expect(signer.addresses).toEqual([])
    expect(mockUpdateSignerAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'replacement', addresses: [] })
    )

    await manager.close()
  })

  it('freezes every address update from a signer already pending removal', async () => {
    const manager = new Signers([])
    const originalAddress = '0x0000000000000000000000000000000000000001'
    const lateAddress = '0x0000000000000000000000000000000000000002'
    const signer = { ...hotSigner('pending'), addresses: [originalAddress] }
    signer.summary = () => ({ id: signer.id, addresses: [...signer.addresses] })
    manager.add(signer)
    mockSignerSummaries = { pending: { addresses: [originalAddress] } }
    mockPendingSignerRemovals = {
      pending: { addresses: [originalAddress], kind: 'hardware' }
    }

    signer.addresses = [originalAddress, lateAddress]
    manager.update(signer)

    expect(signer.addresses).toEqual([originalAddress])
    expect(mockUpdateSignerAction).not.toHaveBeenCalled()

    await manager.close()
  })

  it('closes hot signers and every adapter registered with the manager', async () => {
    const initialAdapter = new TestAdapter('initial')
    const addedAdapter = new TestAdapter('added')
    const manager = new Signers([initialAdapter])
    const signer = hotSigner()

    manager.addAdapter(addedAdapter)
    manager.add(signer)
    await manager.close()
    await manager.close()

    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(signer.delete).not.toHaveBeenCalled()
    expect(initialAdapter.close).toHaveBeenCalledTimes(1)
    expect(addedAdapter.close).toHaveBeenCalledTimes(1)
    expect(initialAdapter.listenerCount('add')).toBe(0)
    expect(addedAdapter.listenerCount('add')).toBe(0)
  })

  it('closes in-progress and late hot signers during shutdown', async () => {
    const manager = new Signers([])
    const pending = hotSigner('pending')
    const late = hotSigner('late')

    expect(manager.trackHotSigner(pending)).toBe(true)
    await manager.close()
    expect(pending.close).toHaveBeenCalledTimes(1)
    expect(pending.delete).not.toHaveBeenCalled()

    expect(manager.trackHotSigner(late)).toBe(false)
    expect(late.close).toHaveBeenCalledTimes(1)
    expect(manager.add(late)).toBe(false)
    expect(late.close).toHaveBeenCalledTimes(2)
    expect(late.delete).not.toHaveBeenCalled()
  })

  it('rolls back map, store, and pending admission when the store update throws', async () => {
    const manager = new Signers([])
    const signer = hotSigner('store-failure')
    manager.trackHotSigner(signer)
    mockNewSignerAction.mockImplementationOnce(() => {
      throw new Error('store update failed')
    })

    expect(() => manager.add(signer)).toThrow('store update failed')
    expect(manager.get(signer.id)).toBeUndefined()
    expect(mockRemoveSignerAction).toHaveBeenCalledWith(signer.id)

    await manager.close()
    expect(signer.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a signer admitted when its adapter cannot remove it', async () => {
    const adapter = new TestAdapter('hot')
    const manager = new Signers([adapter])
    const signer = hotSigner('remove-failure')
    adapter.remove.mockImplementationOnce(() => {
      throw new Error('signer storage unavailable')
    })
    manager.add(signer)

    expect(() => manager.remove(signer.id)).toThrow('signer storage unavailable')
    expect(manager.get(signer.id)).toBe(signer)
    expect(mockRemoveSignerAction).not.toHaveBeenCalledWith(signer.id)

    await manager.close()
  })

  it('removes signer storage before clearing its live and store summaries', async () => {
    const order = []
    const adapter = new TestAdapter('hot')
    const manager = new Signers([adapter])
    const signer = hotSigner('removed')
    adapter.remove.mockImplementationOnce(() => order.push('adapter'))
    mockRemoveSignerAction.mockImplementationOnce(() => order.push('store'))
    manager.add(signer)

    manager.remove(signer.id)

    expect(order).toEqual(['adapter', 'store'])
    expect(manager.get(signer.id)).toBeUndefined()

    await manager.close()
  })

  it('force-detaches a rejected admission without invoking storage erasure', async () => {
    const adapter = new TestAdapter('hot')
    const manager = new Signers([adapter])
    const signer = hotSigner('rejected')
    manager.add(signer)

    manager.rollbackAdmission(signer)

    expect(manager.get(signer.id)).toBeUndefined()
    expect(adapter.remove).not.toHaveBeenCalled()
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(mockRemoveSignerAction).toHaveBeenCalledWith(signer.id)

    await manager.close()
  })

  it('locks an unlocked hot signer when a normal close is configured to lock', async () => {
    mockCloseLock = true
    const manager = new Signers([])
    const signer = hotSigner()
    const app = new EventEmitter()
    const window = new EventEmitter()
    const hide = jest.fn()
    const event = { preventDefault: jest.fn() }

    manager.add(signer)
    installCloseToTray(app, window, hide)
    window.emit('close', event)

    expect(signer.lock).toHaveBeenCalledTimes(1)
    expect(signer.delete).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(hide).toHaveBeenCalledTimes(1)

    window.emit('closed')
    await manager.close()
  })

  it('keeps a hot signer unlocked on window close when locking is deferred to quit', async () => {
    mockCloseLock = false
    const manager = new Signers([])
    const signer = hotSigner()
    const app = new EventEmitter()
    const window = new EventEmitter()

    manager.add(signer)
    installCloseToTray(app, window, jest.fn())
    window.emit('close', { preventDefault: jest.fn() })

    expect(signer.lock).not.toHaveBeenCalled()

    window.emit('closed')
    await manager.close()
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(signer.delete).not.toHaveBeenCalled()
  })

  it('locks every ready hot signer after a security event independently of close preferences', async () => {
    mockCloseLock = false
    const manager = new Signers([])
    const first = hotSigner('first')
    const second = hotSigner('second')
    const hardware = { ...hotSigner('hardware'), type: 'ledger' }
    const alreadyLocked = { ...hotSigner('locked'), status: 'locked' }

    manager.add(first)
    manager.add(second)
    manager.add(hardware)
    manager.add(alreadyLocked)
    manager.lockHotSigners('screen lock')

    expect(first.lock).toHaveBeenCalledTimes(1)
    expect(second.lock).toHaveBeenCalledTimes(1)
    expect(hardware.lock).not.toHaveBeenCalled()
    expect(alreadyLocked.lock).not.toHaveBeenCalled()
    await manager.close()
  })

  it('handles a security event when no software signer is present', async () => {
    const manager = new Signers([])

    expect(() => manager.lockHotSigners('system suspend')).not.toThrow()

    await manager.close()
  })

  it('unloads active and in-progress hot signers without deleting their protected files', async () => {
    const manager = new Signers([])
    const active = hotSigner('active')
    const pending = hotSigner('pending')

    manager.add(active)
    manager.trackHotSigner(pending)
    manager.unloadHotSigners('keychain unavailable')

    expect(manager.get(active.id)).toBeUndefined()
    expect(active.close).toHaveBeenCalledTimes(1)
    expect(pending.close).toHaveBeenCalledTimes(1)
    expect(active.delete).not.toHaveBeenCalled()
    expect(pending.delete).not.toHaveBeenCalled()

    await manager.close()
    expect(active.close).toHaveBeenCalledTimes(1)
    expect(pending.close).toHaveBeenCalledTimes(1)
  })

  it('contains a synchronous signer lock failure and permits a later retry', async () => {
    const manager = new Signers([])
    const signer = hotSigner()
    signer.lock.mockImplementationOnce(() => {
      throw new Error('synthetic lock failure')
    })
    manager.add(signer)

    expect(() => manager.lockHotSigners('screen lock')).not.toThrow()
    manager.lockHotSigners('system suspend')

    expect(signer.lock).toHaveBeenCalledTimes(2)
    await manager.close()
  })
})
