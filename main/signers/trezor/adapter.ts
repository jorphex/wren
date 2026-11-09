import log from 'electron-log'
import { SignerAdapter } from '../adapters'
import Trezor, { Status } from './Trezor'
import store from '../../store'
import TrezorBridge from './bridge'

export default class TrezorSignerAdapter extends SignerAdapter {
  private knownSigners = new Map<string, Trezor>()
  private generation = 0
  private closed = true
  private connecting?: Promise<string>
  private observer?: Observer

  constructor() {
    super('trezor')
  }

  override open() {
    if (!this.closed) return
    this.closed = false
    TrezorBridge.open()
    TrezorBridge.on('trezor:unavailable', () => {
      this.knownSigners.forEach((signer) => {
        signer.status = Status.NEEDS_RECONNECTION
        this.emit('update', signer)
      })
    })
    this.observer = store.observer(() => {
      this.knownSigners.forEach((signer) => {
        const derivation = store('main.trezor.derivation')
        if (signer.derivation !== derivation) {
          if (signer.hasActiveSigningOperation()) TrezorBridge.cancelCurrentRequest()
          signer.derivation = derivation
          signer.status = Status.NEEDS_RECONNECTION
          this.emit('update', signer)
        }
      })
    })
  }

  connect() {
    if (this.closed) return Promise.reject(new Error('Trezor signer is closed'))
    if (this.connecting) return this.connecting
    if ([...this.knownSigners.values()].some((signer) => signer.hasActiveSigningOperation())) {
      return Promise.reject(new Error('Finish the current Trezor request first'))
    }
    const generation = this.generation
    this.connecting = this.connectDevice(generation).finally(() => {
      if (generation === this.generation) delete this.connecting
    })
    return this.connecting
  }

  cancelConnect() {
    if (!this.connecting) return
    ++this.generation
    delete this.connecting
    TrezorBridge.cancelCurrentRequest()
  }

  private async connectDevice(generation: number) {
    const device = await TrezorBridge.connectDevice()
    const signer = new Trezor(device.path)
    signer.derivation = store('main.trezor.derivation')
    try {
      await signer.open(device)
      await signer.deriveAddresses()
      if (this.closed || generation !== this.generation) throw new Error('Trezor connection cancelled')
      if (signer.derivation !== store('main.trezor.derivation'))
        throw new Error('Address path changed. Connect again in Trezor Suite.')
      if (signer.status !== Status.OK || !signer.addresses[0]) {
        throw new Error('Could not load Trezor accounts. Connect again in Trezor Suite.')
      }
      // USB paths are owned by Suite and can change. A verified wallet address
      // keeps the live signer stable across reconnects and separates passphrases.
      signer.id = Trezor.generateId(signer.addresses[0].toLowerCase())
      const previous = this.knownSigners.get(signer.id)
      if (previous?.hasActiveSigningOperation()) throw new Error('Finish the current Trezor request first')
      if (previous) {
        previous.removeAllListeners()
        previous.close()
      }
      this.knownSigners.set(signer.id, signer)
      signer.on('update', () => {
        if (this.knownSigners.get(signer.id) === signer) this.emit('update', signer)
      })
      this.emit(previous ? 'update' : 'add', signer)
      return signer.id
    } catch (error) {
      signer.close()
      throw error
    }
  }

  override async reload(signer: Trezor) {
    if (this.knownSigners.get(signer.id) !== signer || signer.hasActiveSigningOperation()) return
    signer.status = Status.INITIAL
    this.emit('update', signer)
    try {
      const id = await this.connect()
      if (id !== signer.id) {
        signer.status = Status.NEEDS_RECONNECTION
        this.emit('update', signer)
      }
    } catch (error) {
      if (this.closed || this.knownSigners.get(signer.id) !== signer) return
      signer.status = Status.NEEDS_RECONNECTION
      this.emit('update', signer)
      log.warn('Could not reconnect Trezor through Suite', error)
    }
  }

  override remove(signer: Trezor) {
    if (this.knownSigners.get(signer.id) !== signer) return
    this.knownSigners.delete(signer.id)
    signer.close()
    this.emit('remove', signer.id)
  }

  override close() {
    if (this.closed) return
    this.closed = true
    ++this.generation
    delete this.connecting
    this.observer?.remove()
    delete this.observer
    TrezorBridge.close()
    this.knownSigners.forEach((signer) => signer.close())
    this.knownSigners.clear()
  }
}
