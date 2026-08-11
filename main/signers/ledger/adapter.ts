import log from 'electron-log'

import { getDevices as getLedgerDevices } from '@ledgerhq/hw-transport-node-hid-noevents'
import { Device } from 'node-hid'

import { Derivation } from '../Signer/derive'
import { SignerAdapter } from '../adapters'
import Ledger from './Ledger'
import store from '../../store'
import { requireStoreAction } from '../../store/action'

function updateDerivation(ledger: Ledger, derivation = store('main.ledger.derivation'), accountLimit = 0) {
  const liveAccountLimit =
    accountLimit || (derivation === Derivation.live ? store('main.ledger.liveAccountLimit') : 0)

  ledger.derivation = derivation
  ledger.accountLimit = liveAccountLimit
}

interface Disconnection {
  device: Ledger
  timeout: NodeJS.Timeout
}

type ConnectedDevice = Device & { path: string; product: string }
const DEVICE_SCAN_INTERVAL = 1000

export default class LedgerSignerAdapter extends SignerAdapter {
  private knownSigners: { [devicePath: string]: Ledger }
  private disconnections: Disconnection[]

  private observer: Observer | undefined
  private scanTimer: NodeJS.Timeout | null = null
  private scanFailureReported = false
  private running = false
  private closePromise: Promise<void> | undefined

  constructor() {
    super('ledger')

    this.knownSigners = {}
    this.disconnections = []
  }

  override open() {
    if (this.running) return

    this.running = true
    this.closePromise = undefined
    this.observer = store.observer(() => {
      const ledgerDerivation = store('main.ledger.derivation')
      const liveAccountLimit = store('main.ledger.liveAccountLimit')

      Object.values(this.knownSigners).forEach((ledger) => {
        if (
          ledger.derivation !== ledgerDerivation ||
          (ledger.derivation === 'live' && ledger.accountLimit !== liveAccountLimit)
        ) {
          updateDerivation(ledger, ledgerDerivation, liveAccountLimit)
          ledger.deriveAddresses()
        }
      })
    })

    this.scanForDeviceChanges()
    this.scanTimer = setInterval(() => this.scanForDeviceChanges(), DEVICE_SCAN_INTERVAL)
    this.scanTimer.unref()

    super.open()
  }

  override async close() {
    if (this.closePromise) return this.closePromise

    this.running = false

    if (this.observer) {
      this.observer.remove()
      this.observer = undefined
    }

    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }

    const ledgers = new Set([
      ...Object.values(this.knownSigners),
      ...this.disconnections.map(({ device }) => device)
    ])

    this.disconnections.forEach(({ timeout }) => clearTimeout(timeout))
    this.disconnections = []
    this.knownSigners = {}

    super.close()

    this.closePromise = Promise.all(Array.from(ledgers, (ledger) => this.closeLedger(ledger))).then(
      () => undefined
    )

    await this.closePromise
  }

  private scanForDeviceChanges() {
    if (!this.running) return

    try {
      this.handleDeviceChanges()
      this.scanFailureReported = false
    } catch (error) {
      if (!this.scanFailureReported) {
        log.warn('Ledger HID transport unavailable; skipping Ledger device scan', error)
        this.scanFailureReported = true
      }
    }
  }

  override async remove(ledger: Ledger) {
    const path = this.getOwnedPath(ledger)

    if (path) {
      log.info(`removing Ledger ${ledger.model} attached at ${ledger.devicePath}`)

      delete this.knownSigners[path]
      if (this.running) this.emit('remove', ledger.id)

      await this.closeLedger(ledger)
    }
  }

  override async reload(ledger: Ledger) {
    log.info(`reloading  Ledger ${ledger.model} attached at ${ledger.devicePath}`)

    const signer = this.getOwnedPath(ledger) ? ledger : undefined

    if (signer) {
      try {
        await signer.disconnect()
        if (!this.owns(signer)) return

        await signer.open()
        if (!this.owns(signer)) {
          await this.closeLedger(signer)
          return
        }

        await signer.connect()
      } catch (error) {
        await this.handleConnectionFailure(signer, error)
      }
    }
  }

  private handleDeviceChanges() {
    if (!this.running) return

    const { attachedDevices, detachedLedgers, reconnections, pendingDisconnections } =
      this.detectDeviceChanges()

    this.disconnections = pendingDisconnections

    detachedLedgers.forEach((ledger) => this.handleDisconnectedDevice(ledger))
    reconnections.forEach((disconnection) => this.handleReconnectedDevice(disconnection))
    attachedDevices.forEach((device) => this.handleAttachedDevice(device))
  }

  private async handleAttachedDevice(device: ConnectedDevice) {
    if (!this.running) return

    log.info(`Ledger ${device.product} attached at ${device.path}`)

    const ledger = new Ledger(device.path, device.product)

    const emitUpdate = () => {
      if (this.owns(ledger)) this.emit('update', ledger)
    }

    ledger.on('update', emitUpdate)
    ledger.on('error', emitUpdate)
    ledger.on('lock', emitUpdate)

    ledger.on('close', () => {
      const path = this.getOwnedPath(ledger)
      if (!this.running || !path) return

      delete this.knownSigners[path]
      this.emit('remove', ledger.id)
    })

    ledger.on('unlock', () => {
      if (!this.owns(ledger)) return
      void ledger.connect().catch((error) => this.handleConnectionFailure(ledger, error))
    })

    this.knownSigners[ledger.devicePath] = ledger

    this.emit('add', ledger)

    // Show signer in dash window
    requireStoreAction('navReplace')('dash', [
      {
        view: 'expandedSigner',
        data: { signer: ledger.id }
      },
      {
        view: 'accounts',
        data: {}
      }
    ])

    try {
      await this.handleConnectedDevice(ledger)
    } catch (error) {
      await this.handleConnectionFailure(ledger, error)
    }
  }

  private async handleConnectedDevice(ledger: Ledger) {
    if (!this.owns(ledger)) return

    updateDerivation(ledger)

    await ledger.open()
    if (!this.owns(ledger)) {
      await this.closeLedger(ledger)
      return
    }

    await ledger.connect()

    if (!this.owns(ledger)) await this.closeLedger(ledger)
  }

  private async handleReconnectedDevice(disconnection: Disconnection) {
    log.info(`Ledger ${disconnection.device.model} re-connected at ${disconnection.device.devicePath}`)

    clearTimeout(disconnection.timeout)

    try {
      await this.handleConnectedDevice(disconnection.device)
    } catch (error) {
      await this.handleConnectionFailure(disconnection.device, error)
    }
  }

  handleDisconnectedDevice(ledger: Ledger) {
    if (this.disconnections.some(({ device }) => device === ledger)) return

    log.info(`Ledger ${ledger.model} disconnected from ${ledger.devicePath}`)

    void ledger
      .disconnect()
      .catch((error) => log.warn(`failed to disconnect Ledger at ${ledger.devicePath}`, error))

    // when a user exits the eth app, it takes a few seconds for the
    // main ledger to reconnect via USB, so attempt to wait for this event
    // instead of immediately removing the signer
    this.disconnections.push({
      device: ledger,
      timeout: setTimeout(() => {
        const index = this.disconnections.findIndex((d) => d.device.devicePath === ledger.devicePath)
        this.disconnections.splice(index, 1)

        log.info(`Ledger ${ledger.model} detached from ${ledger.devicePath}`)

        void this.remove(ledger)
      }, 5000)
    })
  }

  private owns(ledger: Ledger) {
    return this.running && !!this.getOwnedPath(ledger)
  }

  private getOwnedPath(ledger: Ledger) {
    return Object.entries(this.knownSigners).find(([, signer]) => signer === ledger)?.[0]
  }

  private async closeLedger(ledger: Ledger) {
    try {
      await ledger.close()
    } catch (error) {
      log.warn(`failed to close Ledger at ${ledger.devicePath}`, error)
    }
  }

  private async handleConnectionFailure(ledger: Ledger, error: unknown) {
    log.warn(`failed to connect Ledger at ${ledger.devicePath}`, error)

    try {
      await ledger.disconnect()
    } catch (disconnectError) {
      log.warn(`failed to recover Ledger at ${ledger.devicePath}`, disconnectError)
    }

    if (this.owns(ledger)) this.emit('update', ledger)
  }

  private detectDeviceChanges() {
    // all Ledger devices that are currently connected
    const ledgerDevices = getLedgerDevices()
      .filter((device) => !!device.path)
      .map((d) => ({ ...d, path: d.path as string, product: d.product || '' }))

    const { pendingDisconnections, reconnections } = this.getReconnectedLedgers(ledgerDevices)
    const detachedLedgers = this.getDetachedLedgers(ledgerDevices)
    const attachedDevices = this.getAttachedDevices(ledgerDevices).filter(
      (device) => !reconnections.some((r) => r.device.devicePath === device.path)
    )

    return {
      attachedDevices,
      detachedLedgers,
      pendingDisconnections,
      reconnections
    }
  }

  private getAttachedDevices(connectedDevices: ConnectedDevice[]) {
    // attached devices are ones where a connected device
    // is not yet one of the currently known signers
    return connectedDevices.filter((device) => !(device.path in this.knownSigners))
  }

  private getDetachedLedgers(connectedDevices: ConnectedDevice[]) {
    // detached Ledgers are previously known signers that are
    // no longer one of the connected Ledger devices
    return Object.values(this.knownSigners).filter(
      (signer) => !connectedDevices.some((device) => device.path === signer.devicePath)
    )
  }

  private getReconnectedLedgers(connectedDevices: ConnectedDevice[]) {
    // group all the disconnections into ones that are either accounted for
    // by the currently connected devices (reconnections) or ones that are still
    // pending (pendingDisconnections)
    const { pendingDisconnections, reconnections } = this.disconnections.reduce(
      (resolved, disconnection) => {
        if (connectedDevices.some((device) => device.path === disconnection.device.devicePath)) {
          resolved.reconnections.push(disconnection)
        } else {
          resolved.pendingDisconnections.push(disconnection)
        }

        return resolved
      },
      { pendingDisconnections: [] as Array<Disconnection>, reconnections: [] as Array<Disconnection> }
    )

    // if we are still waiting on reconnections, check if any more devices have been added. if so, assume
    // that these are the reconnection events and allow any newly connected device to take the place
    // of a disconnected one. this mostly happens on Windows because the devices reconnect at a different
    // device path from the one from which they were disconnected
    while (pendingDisconnections.length > 0) {
      const reconnectedDevice = connectedDevices.find(
        (device) =>
          !reconnections.some((r) => r.device.devicePath === device.path) && !this.knownSigners[device.path]
      )

      if (reconnectedDevice) {
        const disconnection = pendingDisconnections.pop() as Disconnection
        this.knownSigners[reconnectedDevice.path] = disconnection.device
        delete this.knownSigners[disconnection.device.devicePath]

        disconnection.device.devicePath = reconnectedDevice.path

        reconnections.push(disconnection)
      } else break
    }

    return { pendingDisconnections, reconnections }
  }
}
