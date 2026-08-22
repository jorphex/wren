import EventEmitter from 'events'
import log from 'electron-log'

import Signer, { type SignerSummary } from './Signer'
import { SignerAdapter } from './adapters'

import LedgerAdapter from './ledger/adapter'
import TrezorAdapter from './trezor/adapter'
import LatticeAdapter from './lattice/adapter'
import HotSignerAdapter from './hot/adapter'

import hot from './hot'
import type { NewPasswordOptions } from '../../resources/domain/password'
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
    const pendingSignerRemovals = store('main.pendingSignerRemovals') || {}
    if (Object.prototype.hasOwnProperty.call(pendingSignerRemovals, id)) {
      throw new Error('Signer removal is still being completed')
    }
    const pendingAddresses = new Set(
      Object.values(pendingSignerRemovals).flatMap((removal) =>
        Array.isArray(removal?.addresses)
          ? removal.addresses.map((address: string) => address.toLowerCase())
          : []
      )
    )
    if ((signer.addresses || []).some((address) => pendingAddresses.has(address.toLowerCase()))) {
      throw new Error('An account for this signer is still being removed')
    }

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
      const type = signer.type === 'ring' || signer.type === 'seed' ? 'hot' : signer.type

      const adapter = this.adapters[type]?.adapter
      if (adapter) {
        adapter.remove(signer)
      } else {
        // backwards compatibility
        signer.delete()
        signer.close()
      }

      delete this.signers[id]

      try {
        requireStoreAction('removeSigner')(id)
      } catch (error) {
        log.error('Signer was removed, but its store summary could not be cleared', error)
      }

      try {
        requireStoreAction('navClearSigner')(id)
      } catch (error) {
        log.error('Signer was removed, but its open navigation state could not be cleared', error)
      }
    }
  }

  rollbackAdmission(signer: Signer) {
    const id = signer.id
    if (this.signers[id] === signer) delete this.signers[id]
    this.pendingHotSigners.delete(signer)

    try {
      signer.close()
    } catch (error) {
      log.warn('Could not close a rejected signer admission', error)
    }
    try {
      requireStoreAction('removeSigner')(id)
    } catch (error) {
      log.warn('Could not clear a rejected signer summary', error)
    }
    try {
      requireStoreAction('navClearSigner')(id)
    } catch (error) {
      log.warn('Could not clear rejected signer navigation', error)
    }
  }

  update(signer: Signer) {
    const id = signer.id

    if (id in this.signers) {
      const pendingSignerRemovals = store('main.pendingSignerRemovals') || {}
      if (Object.prototype.hasOwnProperty.call(pendingSignerRemovals, id)) {
        const storedAddresses = store(`main.signers.${id}.addresses`)
        signer.addresses = Array.isArray(storedAddresses)
          ? [...storedAddresses]
          : [...(pendingSignerRemovals[id]?.addresses || [])]
        return
      }
      const pendingAddresses = new Set(
        Object.values(pendingSignerRemovals).flatMap((removal) =>
          Array.isArray(removal?.addresses)
            ? removal.addresses.map((address: string) => address.toLowerCase())
            : []
        )
      )
      const intersectingAddresses = (signer.addresses || []).filter((address) =>
        pendingAddresses.has(address.toLowerCase())
      )

      if (intersectingAddresses.length) {
        const storedSummary = store(`main.signers.${id}`) as SignerSummary | undefined
        const previousSummary = storedSummary
          ? {
              ...storedSummary,
              addresses: Array.isArray(storedSummary.addresses) ? [...storedSummary.addresses] : []
            }
          : undefined
        // Persist the replacement ownership without narrowing the removal
        // journal. A later retry can then decide from current signer state.
        try {
          requireStoreAction('updateSigner')(signer.summary())
          const { commitMainState } = require('../store/persist')
          commitMainState(store('main'))
          this.signers[id] = signer
          return
        } catch (error) {
          // The durable journal still owns these addresses. Restore the last
          // persisted summary so neither live nor queued state exposes them.
          signer.addresses = previousSummary
            ? [...previousSummary.addresses]
            : signer.addresses.filter((address) => !pendingAddresses.has(address.toLowerCase()))
          try {
            requireStoreAction('updateSigner')(previousSummary || signer.summary())
          } catch (restoreError) {
            log.warn('Could not restore the previous signer summary', restoreError)
          }
          log.warn('Could not durably preserve a newly shared signer address', error)
        }
      }

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

  addressesExcept(id: string) {
    return Object.entries(this.signers)
      .filter(([signerId]) => signerId !== id)
      .flatMap(([, signer]) => signer.addresses || [])
  }

  createFromPhrase(
    mnemonic: string,
    password: string,
    passwordOptions: NewPasswordOptions,
    cb: Callback<Signer>
  ) {
    hot.createFromPhrase(this, mnemonic, password, passwordOptions, cb)
  }

  createFromPrivateKey(
    privateKey: string,
    password: string,
    passwordOptions: NewPasswordOptions,
    cb: Callback<Signer>
  ) {
    hot.createFromPrivateKey(this, privateKey, password, passwordOptions, cb)
  }

  reserveGeneratedWallet(cb: Callback<{ sessionId: string }>) {
    this.generatedWallets.reserve(cb)
  }

  beginGeneratedWallet(
    id: string,
    kind: 'phrase' | 'private-key',
    password: string,
    passwordOptions: NewPasswordOptions,
    cb: Callback<unknown>
  ) {
    this.generatedWallets.begin(id, kind, password, passwordOptions, cb)
  }

  completeGeneratedWallet(id: string, proof: unknown, cb: Callback<{ id: string }>) {
    this.generatedWallets.complete(id, proof, cb)
  }

  discardGeneratedWallet(id: string, cb: Callback<void>) {
    this.generatedWallets.discard(id, cb)
  }

  createFromKeystore(
    keystore: Keystore,
    keystorePassword: string,
    password: string,
    passwordOptions: NewPasswordOptions,
    cb: Callback<Signer>
  ) {
    hot.createFromKeystore(this, keystore, keystorePassword, password, passwordOptions, cb)
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
