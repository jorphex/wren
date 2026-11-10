import { EventEmitter } from 'events'
import { z } from 'zod'
import { CoreInSuiteDesktop } from '@trezor/connect-web/lib/impl/core-in-suite-desktop.js'
import type {
  CallMethodPayload,
  ConnectImplSettings,
  Device,
  DeviceIdentity,
  TrezorConnectPublicAPI
} from '@trezor/connect-common'
import { WREN_REPOSITORY_URL } from '../../../resources/constants'

export class DeviceError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
  }
}

export type SuiteDevice = {
  path: NonNullable<DeviceIdentity['path']>
  instance?: number | undefined
  state?: z.output<typeof identitySchema>['state']
  features?: Device['features']
}
type TypedData = Parameters<TrezorConnectPublicAPI<ConnectImplSettings>['ethereumSignTypedData']>[0]['data']
const featuresSchema = z
  .object({
    model: z.string().min(1),
    major_version: z.number().int().nonnegative(),
    minor_version: z.number().int().nonnegative(),
    patch_version: z.number().int().nonnegative()
  })
  .passthrough()
const addressSchema = z.object({ address: z.string().regex(/^0x[\da-f]{40}$/i) })
const publicKeySchema = z.object({
  publicKey: z.string().regex(/^(?:[\da-f]{66}|[\da-f]{130})$/i),
  chainCode: z.string().regex(/^[\da-f]{64}$/i)
})
const signatureSchema = z.object({ signature: z.string().regex(/^(?:0x)?[\da-f]{130}$/i) })
const txSignatureSchema = z.object({
  v: z.string().regex(/^(?:0x)?[\da-f]+$/i),
  r: z.string().regex(/^(?:0x)?[\da-f]{1,64}$/i),
  s: z.string().regex(/^(?:0x)?[\da-f]{1,64}$/i)
})
const identitySchema = z.object({
  path: z.string().min(1).max(1024),
  instance: z.number().int().nonnegative().optional(),
  state: z
    .object({
      sessionId: z.string().optional(),
      staticSessionId: z.string().optional(),
      deriveCardano: z.boolean().optional()
    })
    .optional()
})

class TrezorBridge extends EventEmitter {
  private closed = true
  private generation = 0
  private client?: CoreInSuiteDesktop
  private initialized = false
  private requestQueue: Promise<void> = Promise.resolve()
  private pending = new Set<(error: Error) => void>()

  open() {
    this.closed = false
  }

  close() {
    this.closed = true
    this.reset(new DeviceError('Trezor bridge closed', 'Method_Interrupted'))
    this.removeAllListeners()
  }

  async connectDevice(): Promise<SuiteDevice> {
    const response = await this.request('getFeatures', {}, featuresSchema)
    const identity = identitySchema.safeParse(response.device)
    if (!identity.success) throw new DeviceError('Trezor Suite did not return a device', 'Device_NotFound')
    return {
      ...identity.data,
      path: identity.data.path as SuiteDevice['path'],
      features: response.payload as Device['features']
    }
  }

  async getFeatures(device: SuiteDevice) {
    return (await this.request('getFeatures', {}, featuresSchema, device)).payload
  }

  async getPublicKey(device: SuiteDevice, path: string) {
    return (await this.request('ethereumGetPublicKey', { path }, publicKeySchema, device)).payload
  }

  async getAddress(device: SuiteDevice, path: string, display = false, onDispatch?: () => void) {
    const response = await this.request(
      'ethereumGetAddress',
      { path, showOnTrezor: display },
      addressSchema,
      device,
      onDispatch
    )
    return response.payload.address.toLowerCase()
  }

  async signMessage(device: SuiteDevice, path: string, message: string) {
    return (await this.request('ethereumSignMessage', { path, message, hex: true }, signatureSchema, device))
      .payload.signature
  }

  async signTypedData(device: SuiteDevice, path: string, data: unknown) {
    return (
      await this.request(
        'ethereumSignTypedData',
        { path, data: data as TypedData, metamask_v4_compat: true },
        signatureSchema,
        device
      )
    ).payload.signature
  }

  async signTypedHash(
    device: SuiteDevice,
    path: string,
    data: unknown,
    domainSeparatorHash: string,
    messageHash: string
  ) {
    return (
      await this.request(
        'ethereumSignTypedData',
        {
          path,
          data: data as TypedData,
          domain_separator_hash: domainSeparatorHash,
          message_hash: messageHash,
          metamask_v4_compat: true
        },
        signatureSchema,
        device
      )
    ).payload.signature
  }

  async signTransaction(device: SuiteDevice, path: string, transaction: unknown, onDispatch?: () => void) {
    return (
      await this.request(
        'ethereumSignTransaction',
        { path, transaction },
        txSignatureSchema,
        device,
        onDispatch
      )
    ).payload
  }

  cancelCurrentRequest() {
    // Suite cancels calls belonging to a closed socket. A fresh client also
    // prevents a late signature from satisfying a later Wren request.
    this.reset(new DeviceError('Request cancelled in Wren', 'Method_Interrupted'))
  }

  private reset(error: Error) {
    ++this.generation
    const client = this.client
    delete this.client
    this.initialized = false
    void client?.dispose()
    this.pending.forEach((reject) => reject(error))
    this.pending.clear()
    this.requestQueue = Promise.resolve()
  }

  private request<S extends z.ZodType>(
    method: string,
    params: Record<string, unknown>,
    schema: S,
    device?: SuiteDevice,
    onDispatch?: () => void
  ): Promise<{ payload: z.output<S>; device?: DeviceIdentity }> {
    const generation = this.generation
    const ensureCurrent = () => {
      if (this.closed || generation !== this.generation)
        throw new DeviceError('Trezor operation cancelled', 'Method_Interrupted')
    }
    const job = this.requestQueue
      .catch(() => {})
      .then(async () => {
        ensureCurrent()
        // Explicitly use the published desktop implementation: the automatic
        // client falls back to a browser popup, which does not support Electron.
        const client = (this.client ||= new CoreInSuiteDesktop())
        try {
          if (!this.initialized) {
            await this.withDeadline(
              client.init({
                manifest: {
                  appName: 'Wren',
                  email: 'jorphex@users.noreply.github.com',
                  appUrl: WREN_REPOSITORY_URL
                },
                version: '10.0.1'
              }),
              4_000,
              new DeviceError('Open Trezor Suite, then connect again.', 'Desktop_ConnectionMissing')
            )
            ensureCurrent()
            this.initialized = true
          }
          onDispatch?.()
          const response = await this.withDeadline(
            client.call({
              ...params,
              method,
              keepSession: true,
              ...(device && {
                device: {
                  path: device.path,
                  ...(device.instance !== undefined && { instance: device.instance }),
                  ...(device.state && { state: device.state })
                }
              })
            } as CallMethodPayload),
            300_000,
            new DeviceError('Trezor Suite request timed out. Connect again to retry.', 'Method_Timeout')
          )
          ensureCurrent()
          if (!response || response.success !== true) {
            const error = response?.error
            throw new DeviceError(
              error?.message || 'Trezor Suite could not complete the request',
              error?.code
            )
          }
          const payload = schema.safeParse(response.payload)
          if (!payload.success)
            throw new DeviceError('Trezor Suite returned an invalid response', 'Method_InvalidResponse')
          if (device) {
            const identity = identitySchema.safeParse(response.device)
            if (
              !identity.success ||
              identity.data.path !== device.path ||
              (identity.data.instance ?? 0) !== (device.instance ?? 0) ||
              (device.state?.staticSessionId &&
                identity.data.state?.staticSessionId !== device.state.staticSessionId)
            )
              throw new DeviceError(
                'Device or wallet changed in Trezor Suite. Connect again.',
                'Device_InvalidState'
              )
            if (identity.data.state) device.state = identity.data.state
            if (identity.data.instance !== undefined) device.instance = identity.data.instance
          }
          return { payload: payload.data, ...(response.device && { device: response.device }) }
        } catch (error) {
          if (generation === this.generation) {
            const failure =
              error instanceof DeviceError && error.code !== 'Desktop_ConnectionMissing'
                ? error
                : new DeviceError('Open Trezor Suite, then connect again.', 'Desktop_ConnectionMissing')
            if (
              ['Desktop_ConnectionMissing', 'Method_Timeout', 'Device_InvalidState'].includes(
                failure.code || ''
              )
            ) {
              this.reset(failure)
              this.emit('trezor:unavailable')
            }
            throw failure
          }
          throw error
        }
      })
    this.requestQueue = job.then(
      () => {},
      () => {}
    )
    return new Promise((resolve, reject) => {
      this.pending.add(reject)
      job.then(
        (result) => {
          this.pending.delete(reject)
          resolve(result)
        },
        (error) => {
          this.pending.delete(reject)
          reject(error)
        }
      )
    })
  }
  private withDeadline<T>(operation: Promise<T>, timeout: number, error: DeviceError) {
    let timer: ReturnType<typeof setTimeout>
    let cancel: (error: Error) => void
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = reject
      this.pending.add(cancel)
      timer = setTimeout(() => reject(error), timeout)
    })
    return Promise.race([operation, deadline]).finally(() => {
      clearTimeout(timer!)
      this.pending.delete(cancel!)
    })
  }
}

export default new TrezorBridge()
