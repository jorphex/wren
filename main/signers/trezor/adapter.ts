import log from 'electron-log'

import type { DeviceUniquePath, Device as TrezorDevice } from '@trezor/connect'

import { SignerAdapter } from '../adapters'
import Trezor, { Status, TrezorPairing } from './Trezor'
import store from '../../store'
import { requireStoreAction } from '../../store/action'
import TrezorBridge from './bridge'

interface KnownSigners {
  [id: string]: {
    signer: Trezor
    eventHandlers: {
      [event: string]: (...args: unknown[]) => void
    }
  }
}

interface TrezorPairingRequest extends TrezorPairing {
  device: TrezorDevice
}

export default class TrezorSignerAdapter extends SignerAdapter {
  private knownSigners: KnownSigners = {}
  private pendingSessionProbes = new Map<string, symbol>()
  private timers = new Map<string, Set<ReturnType<typeof setTimeout>>>()
  private promptStatuses = new Map<string, string>()
  private activePrompts = new Set<string>()
  private promptDismissibility = new Map<string, boolean>()
  private suspendedPrompts = new Set<string>()
  private connectionGenerations = new Map<string, number>()
  private observer: Observer | undefined
  private lifecycleGeneration = 0
  private closed = true

  constructor() {
    super('trezor')
  }

  override open() {
    const generation = ++this.lifecycleGeneration
    this.closed = false

    this.observer = store.observer(() => {
      if (!this.isCurrent(generation)) return

      const trezorDerivation = store('main.trezor.derivation')

      Object.values(this.knownSigners).forEach((signerInfo) => {
        const trezor = signerInfo.signer
        if (trezor.derivation !== trezorDerivation) {
          trezor.derivation = trezorDerivation

          if (trezor.status === Status.OK) {
            trezor.deriveAddresses()
          }
        }
      })
    })

    TrezorBridge.on('trezor:detected', (path: string) => {
      if (!this.isCurrent(generation)) return

      // create a new signer whenever a Trezor is detected, but it won't be opened
      // until a connect event with an active device is received
      const id = Trezor.generateId(path)
      const signer = this.knownSigners[id]?.signer || this.initTrezor(path)

      if (!signer.device) {
        this.probeSession(path)
      }
    })

    TrezorBridge.on('trezor:connect', async (device: TrezorDevice) => {
      if (!this.isCurrent(generation)) return

      const id = Trezor.generateId(device.path)
      const trezor = this.knownSigners[id]?.signer || this.initTrezor(device.path)
      this.suspendedPrompts.delete(id)
      const connectionGeneration = (this.connectionGenerations.get(id) || 0) + 1
      this.connectionGenerations.set(id, connectionGeneration)

      trezor.derivation = store('main.trezor.derivation')

      try {
        await trezor.open(device)

        if (!this.isConnectionCurrent(trezor, generation, connectionGeneration)) return

        const version = [trezor.appVersion.major, trezor.appVersion.minor, trezor.appVersion.patch].join('.')
        log.info(`Trezor ${trezor.id} connected: ${trezor.model}, firmware v${version}`)

        // arbitrary delay to attempt to minimize message conflicts on first connection
        this.setSignerTimer(
          trezor.id,
          () => {
            if (this.isConnectionCurrent(trezor, generation, connectionGeneration)) {
              void trezor.deriveAddresses()
            }
          },
          200
        )
      } catch (e) {
        if (this.isRegistered(trezor, generation)) log.error('could not open Trezor', e)
      }
    })

    TrezorBridge.on('trezor:disconnect', (device: TrezorDevice) => {
      this.withSigner(device, (signer) => {
        log.info(`Trezor ${signer.id} disconnected`)

        this.remove(signer)
      })
    })

    TrezorBridge.on('trezor:update', (device: TrezorDevice) => {
      this.withSigner(device, (signer) => {
        log.debug(`Trezor ${signer.id} updated`)

        signer.device = device
      })
    })

    TrezorBridge.on('trezor:entered:pin', (deviceId: string) => {
      log.verbose(`Trezor ${deviceId} pin entered`)

      this.handleEvent(deviceId, 'trezor:entered:pin')
    })

    TrezorBridge.on('trezor:entered:passphrase', (deviceId: string) => {
      log.verbose(`Trezor ${deviceId} passphrase entered`)

      this.handleEvent(deviceId, 'trezor:entered:passphrase')
    })

    TrezorBridge.on('trezor:entered:pairing', (deviceId: string) => {
      log.verbose(`Trezor ${deviceId} pairing response entered`)

      this.handleEvent(deviceId, 'trezor:entered:pairing')
    })

    TrezorBridge.on('trezor:enteringPhrase', (deviceId: string) => {
      log.verbose(`Trezor ${deviceId} waiting for passphrase entry on device`)
      const signer = this.knownSigners[deviceId]?.signer
      if (!signer) return

      this.showPrompt(signer)
      this.rememberPromptStatus(signer)
      this.addEventHandler(signer, 'trezor:entered:passphrase', () => {
        this.restorePromptStatus(signer)
      })

      signer.status = Status.ENTERING_PASSPHRASE
      this.emit('update', signer)
    })

    TrezorBridge.on('trezor:needPin', (device: TrezorDevice) => {
      this.withSigner(device, (signer) => {
        log.verbose(`Trezor ${signer.id} needs pin`)

        this.showPrompt(signer)
        this.rememberPromptStatus(signer)

        this.addEventHandler(signer, 'trezor:entered:pin', () => {
          signer.pinError = undefined
          this.restorePromptStatus(signer)
        })

        signer.status = Status.NEEDS_PIN
        this.emit('update', signer)
      })
    })

    TrezorBridge.on('trezor:invalidPin', (device: TrezorDevice) => {
      this.withSigner(device, (signer) => {
        log.warn(`Trezor ${signer.id} rejected the entered PIN`)

        signer.pinError = 'Incorrect PIN. Try again.'
        signer.status = Status.NEEDS_PIN
        this.emit('update', signer)
      })
    })

    TrezorBridge.on('trezor:pinAttemptsDepleted', (device: TrezorDevice) => {
      this.withSigner(device, (signer) => {
        log.warn(`Trezor ${signer.id} ended the current PIN attempt sequence`)

        this.promptStatuses.delete(signer.id)
        delete this.knownSigners[signer.id]?.eventHandlers['trezor:entered:pin']
        signer.pinError = undefined
        signer.status = Status.NEEDS_RECONNECTION
        this.clearPrompt(signer.id)
        this.emit('update', signer)
      })
    })

    TrezorBridge.on('trezor:needPhrase', (device: TrezorDevice) => {
      this.withSigner(device, (signer) => {
        log.verbose(`Trezor ${signer.id} needs passphrase`, { status: signer.status })

        this.showPrompt(signer)
        this.rememberPromptStatus(signer)

        this.addEventHandler(signer, 'trezor:entered:passphrase', () => {
          this.restorePromptStatus(signer)
        })

        signer.status = Status.NEEDS_PASSPHRASE
        this.emit('update', signer)
      })
    })

    TrezorBridge.on('trezor:needPairing', (payload: TrezorPairingRequest) => {
      this.withSigner(payload.device, (signer) => {
        log.verbose(`Trezor ${signer.id} needs pairing`, {
          methods: payload.availableMethods,
          selectedMethod: payload.selectedMethod
        })

        this.showPrompt(signer)
        this.rememberPromptStatus(signer)

        this.addEventHandler(signer, 'trezor:entered:pairing', () => {
          signer.pairing = undefined
          this.restorePromptStatus(signer)
        })

        signer.pairing = {
          availableMethods: payload.availableMethods,
          selectedMethod: payload.selectedMethod,
          ...(payload.nfcData !== undefined ? { nfcData: payload.nfcData } : {})
        }
        signer.status = Status.NEEDS_PAIRING
        this.emit('update', signer)
      })
    })

    TrezorBridge.open()
    super.open()
  }

  private initTrezor(path: string) {
    const trezor = new Trezor(path)

    log.info(`Trezor ${trezor.id} detected`)

    trezor.on('close', () => {
      this.emit('remove', trezor.id)
    })

    trezor.on('update', () => {
      if (!this.isRegistered(trezor, this.lifecycleGeneration)) return

      if (!this.isPromptStatus(trezor.status)) {
        this.promptStatuses.delete(trezor.id)
        delete this.knownSigners[trezor.id]?.eventHandlers['trezor:entered:passphrase']
      }

      if (this.shouldClearPrompt(trezor.status)) this.clearPrompt(trezor.id)

      this.emit('update', trezor)
    })

    this.knownSigners[trezor.id] = { signer: trezor, eventHandlers: {} }

    this.emit('add', trezor)

    const generation = this.lifecycleGeneration
    this.setSignerTimer(trezor.id, () => this.markDisconnectedAfterProbe(trezor, generation), 10_000)

    return trezor
  }

  private probeSession(path: string) {
    const id = Trezor.generateId(path)

    if (this.pendingSessionProbes.has(id)) return

    const signer = this.knownSigners[id]?.signer

    if (!signer || signer.device) return

    const generation = this.lifecycleGeneration
    const probe = Symbol(id)
    this.pendingSessionProbes.set(id, probe)

    log.info(`probing Trezor ${id} session`)

    TrezorBridge.getFeatures({ path: signer.path as DeviceUniquePath })
      .catch((err) => {
        if (this.isCurrent(generation)) {
          log.debug(`initial Trezor session probe finished with error for ${id}`, err)
        }
      })
      .finally(() => {
        if (this.pendingSessionProbes.get(id) === probe) {
          this.pendingSessionProbes.delete(id)
        }
      })
  }

  override async close() {
    if (this.closed) return

    this.closed = true
    ++this.lifecycleGeneration
    this.clearAllTimers()
    this.pendingSessionProbes.clear()
    this.promptStatuses.clear()
    this.promptDismissibility.clear()
    this.suspendedPrompts.clear()
    Array.from(this.activePrompts).forEach((id) => this.clearPrompt(id))
    this.activePrompts.clear()
    this.connectionGenerations.clear()

    if (this.observer) {
      this.observer.remove()
      this.observer = undefined
    }

    const signers = Object.values(this.knownSigners).map(({ signer }) => signer)
    this.knownSigners = {}
    signers.forEach((signer) => signer.close())

    try {
      await TrezorBridge.close()
    } finally {
      super.close()
    }
  }

  override remove(trezor: Trezor) {
    if (trezor.id in this.knownSigners) {
      log.info(`removing Trezor ${trezor.id}`)

      delete this.knownSigners[trezor.id]
      this.clearSignerTimers(trezor.id)
      this.pendingSessionProbes.delete(trezor.id)
      this.promptStatuses.delete(trezor.id)
      this.promptDismissibility.delete(trezor.id)
      this.suspendedPrompts.delete(trezor.id)
      this.clearPrompt(trezor.id)
      this.connectionGenerations.delete(trezor.id)

      trezor.close()
    }
  }

  override async reload(trezor: Trezor) {
    const generation = this.lifecycleGeneration
    if (!this.isRegistered(trezor, generation)) return
    this.suspendedPrompts.delete(trezor.id)
    const connectionGeneration = (this.connectionGenerations.get(trezor.id) || 0) + 1
    this.connectionGenerations.set(trezor.id, connectionGeneration)

    log.info(`reloading Trezor ${trezor.id}`)

    trezor.status = Status.INITIAL
    this.emit('update', trezor)

    try {
      if (trezor.device) {
        await trezor.open(trezor.device)
        if (!this.isConnectionCurrent(trezor, generation, connectionGeneration)) return
        await trezor.deriveAddresses()
      } else {
        await TrezorBridge.getFeatures({ path: trezor.path as DeviceUniquePath })
      }
    } catch (error) {
      if (!this.isConnectionCurrent(trezor, generation, connectionGeneration)) return
      log.warn(`could not reload Trezor ${trezor.id}`, error)
      trezor.status = Status.NEEDS_RECONNECTION
      this.emit('update', trezor)
    }
  }

  private addEventHandler(signer: Trezor, event: string, handler: (...args: unknown[]) => void) {
    const signerInfo = this.knownSigners[signer.id]
    if (!signerInfo) throw new Error(`Trezor ${signer.id} is not registered`)
    signerInfo.eventHandlers[event] = handler
  }

  private handleEvent(signerId: string, event: string, ...args: unknown[]) {
    const signerInfo = this.knownSigners[signerId]
    if (!signerInfo) return
    const action = signerInfo.eventHandlers[event] || (() => {})

    delete signerInfo.eventHandlers[event]

    action(...args)
  }

  private withSigner(device: TrezorDevice, fn: (signer: Trezor) => void) {
    const signer = this.knownSigners[Trezor.generateId(device.path)]?.signer

    if (signer) fn(signer)
  }

  private isCurrent(generation: number) {
    return !this.closed && generation === this.lifecycleGeneration
  }

  private isRegistered(signer: Trezor, generation: number) {
    return this.isCurrent(generation) && this.knownSigners[signer.id]?.signer === signer
  }

  private isConnectionCurrent(signer: Trezor, generation: number, connectionGeneration: number) {
    return (
      this.isRegistered(signer, generation) &&
      this.connectionGenerations.get(signer.id) === connectionGeneration
    )
  }

  private isPromptStatus(status: string) {
    return [
      Status.NEEDS_PIN,
      Status.NEEDS_PASSPHRASE,
      Status.ENTERING_PASSPHRASE,
      Status.NEEDS_PAIRING
    ].includes(status)
  }

  private shouldClearPrompt(status: string) {
    return [
      Status.OK,
      Status.DISCONNECTED,
      Status.NEEDS_RECONNECTION,
      Status.DERIVATION_FAILED,
      Status.SAFETY_CHECKS
    ].includes(status)
  }

  private showPrompt(signer: Trezor) {
    if (this.suspendedPrompts.has(signer.id)) return
    if (this.activePrompts.has(signer.id)) return
    this.activePrompts.add(signer.id)
    // Only the initial connect/session-establishment request is passive. Later
    // PIN or passphrase prompts can belong to signing, verification, or derivation.
    const dismissible = signer.status === Status.INITIAL
    this.promptDismissibility.set(signer.id, dismissible)
    if (this.activePrompts.size === 1) {
      requireStoreAction('showHardwarePrompt')(signer.id, dismissible)
    }
  }

  override dismissAuthentication(signer: Trezor) {
    if (
      !this.isRegistered(signer, this.lifecycleGeneration) ||
      !this.activePrompts.has(signer.id) ||
      !this.promptDismissibility.get(signer.id) ||
      signer.hasActiveSigningOperation()
    ) {
      return false
    }

    log.info(`dismissing passive Trezor authentication for ${signer.id}`)
    this.suspendedPrompts.add(signer.id)
    this.promptStatuses.delete(signer.id)
    this.promptDismissibility.delete(signer.id)
    delete this.knownSigners[signer.id]?.eventHandlers['trezor:entered:pin']
    delete this.knownSigners[signer.id]?.eventHandlers['trezor:entered:passphrase']
    delete this.knownSigners[signer.id]?.eventHandlers['trezor:entered:pairing']
    signer.pinError = undefined
    signer.pairing = undefined
    signer.status = Status.NEEDS_RECONNECTION
    TrezorBridge.cancelAuthentication()
    const visiblePrompt = this.activePrompts.values().next().value === signer.id
    this.activePrompts.delete(signer.id)
    if (visiblePrompt) {
      requireStoreAction('dismissHardwarePrompt')(signer.id)
      const nextSignerId = this.activePrompts.values().next().value
      if (nextSignerId) {
        requireStoreAction('showHardwarePrompt')(
          nextSignerId,
          this.promptDismissibility.get(nextSignerId) || false
        )
      }
    }
    this.emit('update', signer)
    return true
  }

  private clearPrompt(signerId: string) {
    const visiblePrompt = this.activePrompts.values().next().value === signerId
    if (!this.activePrompts.delete(signerId)) return
    this.promptDismissibility.delete(signerId)
    if (!visiblePrompt) return
    requireStoreAction('clearHardwarePrompt')(signerId)
    const nextSignerId = this.activePrompts.values().next().value
    if (nextSignerId) {
      requireStoreAction('showHardwarePrompt')(
        nextSignerId,
        this.promptDismissibility.get(nextSignerId) || false
      )
    }
  }

  private rememberPromptStatus(signer: Trezor) {
    if (!this.promptStatuses.has(signer.id) && !this.isPromptStatus(signer.status)) {
      this.promptStatuses.set(signer.id, signer.status)
    }
  }

  private restorePromptStatus(signer: Trezor) {
    if (this.knownSigners[signer.id]?.signer !== signer) return

    const status = this.promptStatuses.get(signer.id)
    this.promptStatuses.delete(signer.id)

    if (status) signer.status = status
    if (this.shouldClearPrompt(signer.status)) this.clearPrompt(signer.id)
    this.emit('update', signer)
  }

  private setSignerTimer(id: string, fn: () => void, delay: number) {
    const signerTimers = this.timers.get(id) || new Set<ReturnType<typeof setTimeout>>()
    const timer = setTimeout(() => {
      signerTimers.delete(timer)
      if (signerTimers.size === 0) this.timers.delete(id)
      fn()
    }, delay)

    signerTimers.add(timer)
    this.timers.set(id, signerTimers)
  }

  private clearSignerTimers(id: string) {
    this.timers.get(id)?.forEach((timer) => clearTimeout(timer))
    this.timers.delete(id)
  }

  private clearAllTimers() {
    this.timers.forEach((timers) => timers.forEach((timer) => clearTimeout(timer)))
    this.timers.clear()
  }

  private markDisconnectedAfterProbe(trezor: Trezor, generation: number) {
    if (!this.isRegistered(trezor, generation) || trezor.status !== Status.INITIAL || trezor.device) {
      return
    }

    if (this.pendingSessionProbes.has(trezor.id)) {
      this.setSignerTimer(trezor.id, () => this.markDisconnectedAfterProbe(trezor, generation), 1_000)
      return
    }

    trezor.status = Status.DISCONNECTED
    this.emit('update', trezor)
  }
}
