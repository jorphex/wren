import {
  closeNodeUsbDevices,
  suppressLinuxUsbDeviceResets
} from '../../../../main/signers/trezor/nodeUsbTransport'

describe('Linux Trezor NodeUsb transport', () => {
  it('suppresses device-level resets on Linux', async () => {
    const resetDevice = jest.fn().mockResolvedValue(undefined)
    const transport = { api: { resetDevice } }

    expect(suppressLinuxUsbDeviceResets(transport, 'linux')).toBe(true)

    await transport.api.resetDevice('trezor-path')

    expect(resetDevice).not.toHaveBeenCalled()
  })

  it('preserves upstream reset behavior on other platforms', async () => {
    const resetDevice = jest.fn().mockResolvedValue(undefined)
    const transport = { api: { resetDevice } }

    expect(suppressLinuxUsbDeviceResets(transport, 'darwin')).toBe(false)

    await transport.api.resetDevice('trezor-path')

    expect(resetDevice).toHaveBeenCalledWith('trezor-path')
  })

  it('fails closed when the upstream Linux reset hook changes', () => {
    expect(() => suppressLinuxUsbDeviceResets({}, 'linux')).toThrow(
      'Trezor NodeUsb transport does not expose the expected reset hook'
    )
  })

  it('closes every enumerated USB device before process teardown', async () => {
    const closeDevice = jest.fn().mockResolvedValue({ success: true })
    const transport = {
      api: {
        resetDevice: jest.fn().mockResolvedValue(undefined),
        closeDevice,
        devices: [{ path: 'first' }, { path: 'second' }, { path: 'first' }]
      }
    }

    await closeNodeUsbDevices(transport)

    expect(closeDevice.mock.calls).toEqual([['first'], ['second']])
  })

  it('fails shutdown when a USB device cannot be closed', async () => {
    const transport = {
      api: {
        resetDevice: jest.fn().mockResolvedValue(undefined),
        closeDevice: jest.fn().mockResolvedValue({ success: false, error: { code: 'close failed' } }),
        devices: [{ path: 'trezor-path' }]
      }
    }

    await expect(closeNodeUsbDevices(transport)).rejects.toThrow('close failed')
  })
})
