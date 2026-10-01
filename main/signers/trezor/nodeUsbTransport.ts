import { NodeUsbTransport } from '@trezor/transport'

type NodeUsbTransportParams = ConstructorParameters<typeof NodeUsbTransport>[0]
type ResettableUsbApi = {
  resetDevice: (path: string) => Promise<void>
}

type UsbDeviceReference = {
  path: string
}

type UsbCloseResult = {
  success: boolean
  error?: { code?: string; message?: string }
}

type ManagedUsbApi = ResettableUsbApi & {
  devices: UsbDeviceReference[]
  closeDevice: (path: string) => Promise<UsbCloseResult>
}

type NodeUsbTransportInternals = {
  api?: Partial<ManagedUsbApi>
}

const activeTransports = new Set<FrameNodeUsbTransport>()

function getUsbApi(transport: NodeUsbTransportInternals) {
  const api = transport.api

  if (!api || typeof api.resetDevice !== 'function') {
    throw new Error('Trezor NodeUsb transport does not expose the expected reset hook')
  }

  return api
}

export function suppressLinuxUsbDeviceResets(
  transport: NodeUsbTransportInternals,
  platform: NodeJS.Platform = process.platform
) {
  if (platform !== 'linux') return false

  const resettableApi = getUsbApi(transport)

  // A stalled node-usb reset can hold Linux's usbfs mutex while Electron submits
  // another transfer, freezing the main process in an uninterruptible ioctl.
  resettableApi.resetDevice = async () => {}

  return true
}

export async function closeNodeUsbDevices(transport: NodeUsbTransportInternals) {
  const api = getUsbApi(transport)

  if (!Array.isArray(api.devices) || typeof api.closeDevice !== 'function') {
    throw new Error('Trezor NodeUsb transport does not expose the expected close hooks')
  }

  const paths = [...new Set(api.devices.map((device) => device.path))]

  for (const path of paths) {
    const result = await api.closeDevice(path)

    if (!result.success) {
      throw new Error(
        result.error?.message || result.error?.code || `Could not close Trezor USB device ${path}`
      )
    }
  }
}

export async function closeFrameNodeUsbTransports() {
  await Promise.all(
    [...activeTransports].map((transport) =>
      closeNodeUsbDevices(transport as unknown as NodeUsbTransportInternals)
    )
  )
}

export class FrameNodeUsbTransport extends NodeUsbTransport {
  constructor(params: NodeUsbTransportParams) {
    super(params)

    suppressLinuxUsbDeviceResets(this as unknown as NodeUsbTransportInternals)
    activeTransports.add(this)
  }

  override stop() {
    activeTransports.delete(this)
    super.stop()
  }
}
