import EventEmitter from 'events'
import log from 'electron-log'

import Signer from './Signer'
import { SignerAdapter } from './adapters'

import LedgerAdapter from './ledger/adapter'
import TrezorAdapter from './trezor/adapter'
import LatticeAdapter from './lattice/adapter'
import HotSignerAdapter from './hot/adapter'

import hot from './hot'
import RingSigner from './hot/RingSigner'

import store from '../store'
import { requireStoreAction } from '../store/action'
import { onCloseToTray } from '../windows/closeToTray'
import { isSignerReady } from '../../resources/domain/signer'

const { GeneratedWalletSessions } = require('./generated')

interface AdapterSpec {
  [key: string]: {
    adapter: SignerAdapter
    listeners: {
      event: string
      handler: Parameters<SignerAdapter['removeListener']>[1]
    }[]
  }
}

type Keystore = string | { version: number }

interface ManagedHotSigner extends Signer {
  lock(cb: Callback<Signer>): void
  unlock(password: string, cb: Callback<Signer>): void
}

export class Signers extends EventEmitter {
  private adapters: AdapterSpec
  private signers: { [id: string]: Signer }
  private pendingHotSigners = new Set<Signer>()
  private pendingCloseLocks = new Set<string>()
  private removeCloseToTrayListener: () => boolean
  private generatedWallets: InstanceType<typeof GeneratedWalletSessions>
  private closed = false

  constructor(adapters?: SignerAdapter[]) {
    super()

    this.signers = {}
    this.adapters = {}
    this.generatedWallets = new GeneratedWalletSessions(this, {
      onError: (error: Error) => log.warn('Could not deliver generated wallet presentation', error)
    })

    const registeredAdapters = adapters || [
      new HotSignerAdapter(
        (id) => this.exists(id),
        (reason) => this.unloadHotSigners(reason)
      ),
      new LedgerAdapter(),
      new TrezorAdapter(),
      new LatticeAdapter()
    ]

    registeredAdapters.forEach(this.addAdapter.bind(this))
    this.removeCloseToTrayListener = onCloseToTray(() => this.lockHotSignersOnClose())
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.removeCloseToTrayListener()
    this.generatedWallets.close()

    const hotSigners = new Set([
      ...Object.values(this.signers).filter((signer) => this.isHotSigner(signer)),
      ...this.pendingHotSigners
    ])
    const adapterSpecs = Object.values(this.adapters)
    const adapters = adapterSpecs.map(({ adapter }) => adapter)

    adapterSpecs.forEach(({ adapter, listeners }) => {
      listeners.forEach(({ event, handler }) => adapter.removeListener(event, handler))
    })

    try {
      await Promise.all([
        ...[...hotSigners].map((signer) => Promise.resolve().then(() => signer.close())),
        ...adapters.map((adapter) => Promise.resolve().then(() => adapter.close()))
      ])
    } finally {
      this.signers = {}
      this.pendingHotSigners.clear()
      this.adapters = {}
    }
  }

  addAdapter(adapter: SignerAdapter) {
    const addFn = this.add.bind(this)
    const removeFn = this.remove.bind(this)
    const updateFn = this.update.bind(this)

    adapter.on('add', addFn)
    adapter.on('remove', removeFn)
    adapter.on('update', updateFn)

    adapter.open()

    this.adapters[adapter.adapterType] = {
      adapter,
      listeners: [
        {
          event: 'add',
          handler: addFn
        },
        {
          event: 'remove',
          handler: removeFn
        },
        {
          event: 'update',
          handler: updateFn
        }
      ]
    }
  }

  removeAdapter(adapter: SignerAdapter) {
    const adapterSpec = this.adapters[adapter.adapterType]
    if (!adapterSpec) return

    adapterSpec.listeners.forEach((listener) => {
      adapter.removeListener(listener.event, listener.handler)
    })

    delete this.adapters[adapter.adapterType]
  }

  exists(id: string) {
    return id in this.signers
  }

  add(signer: Signer) {
    if (this.closed) {
      signer.close()
      return false
    }

    const id = signer.id

    if (!(id in this.signers)) {
      const addToStore = requireStoreAction('newSigner')
      const removeFromStore = requireStoreAction('removeSigner')
      const wasPending = this.pendingHotSigners.delete(signer)
      this.signers[id] = signer

      try {
        addToStore(signer.summary())
      } catch (error) {
        if (this.signers[id] === signer) delete this.signers[id]
        if (wasPending && !this.closed) this.pendingHotSigners.add(signer)
        try {
          removeFromStore(id)
        } catch (rollbackError) {
          log.warn('Unable to roll back failed signer store admission', rollbackError)
        }
        throw error
      }
    } else {
      this.pendingHotSigners.delete(signer)
    }

    return true
  }

  trackHotSigner(signer: Signer) {
    if (this.closed) {
      signer.close()
      return false
    }

    this.pendingHotSigners.add(signer)
    return true
  }

  untrackHotSigner(signer: Signer) {
    this.pendingHotSigners.delete(signer)
  }

  remove(id: string) {
    const signer = this.signers[id]

    if (signer) {
      delete this.signers[id]
      requireStoreAction('removeSigner')(id)
      requireStoreAction('navClearSigner')(id)

      const type = signer.type === 'ring' || signer.type === 'seed' ? 'hot' : signer.type

      const adapter = this.adapters[type]?.adapter
      if (adapter) {
        adapter.remove(signer)
      } else {
        // backwards compatibility
        signer.close()
        signer.delete()
      }
    }
  }

  update(signer: Signer) {
    const id = signer.id

    if (id in this.signers) {
      this.signers[id] = signer

      requireStoreAction('updateSigner')(signer.summary())
    } else {
      this.add(signer)
    }
  }

  reload(id: string) {
    const signer = this.signers[id]

    if (signer) {
      const type = signer.type === 'ring' || signer.type === 'seed' ? 'hot' : signer.type
      if (type === 'hot') delete this.signers[id]
      this.adapters[type]?.adapter.reload(signer)
    }
  }

  async rescanHotSigners() {
    const adapter = this.adapters['hot']?.adapter
    if (adapter instanceof HotSignerAdapter) await adapter.scan()
  }

  unloadHotSigners(reason = 'software signer storage unavailable') {
    const unloaded = new Set<Signer>()
    Object.entries(this.signers).forEach(([id, signer]) => {
      if (!this.isHotSigner(signer)) return
      delete this.signers[id]
      requireStoreAction('navClearSigner')(id)
      unloaded.add(signer)
      try {
        signer.close()
      } catch (error) {
        log.warn(`Unable to unload hot signer after ${reason}`, error)
      }
    })
    for (const signer of this.pendingHotSigners) {
      if (unloaded.has(signer)) continue
      try {
        signer.close()
      } catch (error) {
        log.warn(`Unable to unload pending hot signer after ${reason}`, error)
      }
    }
    this.pendingHotSigners.clear()
  }

  dismissHardwarePrompt(id: string) {
    const signer = this.signers[id]
    if (!signer || signer.type !== 'trezor') return false

    return this.adapters['trezor']?.adapter.dismissAuthentication(signer) || false
  }

  get(id: string) {
    return this.signers[id]
  }

  createFromPhrase(mnemonic: string, password: string, cb: Callback<Signer>) {
    hot.createFromPhrase(this, mnemonic, password, cb)
  }

  createFromPrivateKey(privateKey: string, password: string, cb: Callback<Signer>) {
    hot.createFromPrivateKey(this, privateKey, password, cb)
  }

  reserveGeneratedWallet(cb: Callback<{ sessionId: string }>) {
    this.generatedWallets.reserve(cb)
  }

  beginGeneratedWallet(id: string, kind: 'phrase' | 'private-key', password: string, cb: Callback<unknown>) {
    this.generatedWallets.begin(id, kind, password, cb)
  }

  completeGeneratedWallet(id: string, proof: unknown, cb: Callback<{ id: string }>) {
    this.generatedWallets.complete(id, proof, cb)
  }

  discardGeneratedWallet(id: string, cb: Callback<void>) {
    this.generatedWallets.discard(id, cb)
  }

  createFromKeystore(keystore: Keystore, keystorePassword: string, password: string, cb: Callback<Signer>) {
    hot.createFromKeystore(this, keystore, keystorePassword, password, cb)
  }

  addPrivateKey(id: string, privateKey: string, password: string, cb: Callback<Signer>) {
    // Get signer
    const signer = this.get(id)
    // Make sure signer is of type 'ring'
    if (!signer || signer.type !== 'ring') {
      return cb(new Error('Private keys can only be added to ring signers'), undefined)
    }

    // Add private key
    ;(signer as RingSigner).addPrivateKey(privateKey, password, cb)
  }

  removePrivateKey(id: string, index: number, password: string, cb: Callback<Signer>) {
    // Get signer
    const signer = this.get(id)

    if (!signer || signer.type !== 'ring') {
      return cb(new Error('Private keys can only be removed from ring signers'), undefined)
    }

    // Add keystore
    ;(signer as RingSigner).removePrivateKey(index, password, cb)
  }

  addKeystore(
    id: string,
    keystore: Keystore,
    keystorePassword: string,
    password: string,
    cb: Callback<Signer>
  ) {
    // Get signer
    const signer = this.get(id)

    if (!signer || signer.type !== 'ring') {
      return cb(new Error('Keystores can only be used with ring signers'), undefined)
    }

    ;(signer as RingSigner).addKeystore(keystore, keystorePassword, password, cb)
  }

  lock(id: string, cb: Callback<Signer>) {
    const signer = this.get(id)

    if (signer && this.isHotSigner(signer)) signer.lock(cb)
  }

  unlock(id: string, password: string, cb: Callback<Signer>) {
    const signer = this.signers[id]

    if (signer && this.isHotSigner(signer)) {
      signer.unlock(password, cb)
    } else {
      log.error('Signer not unlockable via password, no unlock method')
    }
  }

  private isHotSigner(signer: Signer): signer is ManagedHotSigner {
    const candidate = signer as Partial<ManagedHotSigner>
    return (
      (signer.type === 'ring' || signer.type === 'seed') &&
      typeof candidate.lock === 'function' &&
      typeof candidate.unlock === 'function'
    )
  }

  lockHotSigners(reason = 'security event') {
    Object.values(this.signers).forEach((signer) => {
      if (!this.isHotSigner(signer) || !isSignerReady(signer) || this.pendingCloseLocks.has(signer.id)) {
        return
      }

      this.pendingCloseLocks.add(signer.id)
      try {
        signer.lock((error: Error | null) => {
          this.pendingCloseLocks.delete(signer.id)
          if (error) log.warn(`Unable to lock hot signer after ${reason}`, error)
        })
      } catch (error) {
        this.pendingCloseLocks.delete(signer.id)
        log.warn(`Unable to lock hot signer after ${reason}`, error)
      }
    })
  }

  private lockHotSignersOnClose() {
    if (!store('main.accountCloseLock')) return
    this.lockHotSigners('closing Wren')
  }

  unsetSigner() {
    log.info('unsetSigner')
  }
}

export default new Signers()
