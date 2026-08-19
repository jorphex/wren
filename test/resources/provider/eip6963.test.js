import EventEmitter from 'events'
import { createHash } from 'crypto'
import { Buffer } from 'buffer'

import {
  EIP6963_ANNOUNCE_EVENT,
  EIP6963_REQUEST_EVENT,
  WREN_PROVIDER_METADATA,
  installEip6963Provider
} from '../../../resources/provider/eip6963'
import { installFrameProvider } from '../../../resources/provider/frame'

class BrowserTarget extends globalThis.EventTarget {
  constructor(uuids = ['4d2d8f2a-85fb-4d1d-aa0e-16490915ee09']) {
    super()
    this.CustomEvent = globalThis.CustomEvent
    this.crypto = { randomUUID: jest.fn(() => uuids.shift()) }
  }
}

class RawProvider extends EventEmitter {
  constructor() {
    super()
    this.accounts = []
    this.chainId = '0x1'
    this.request = jest.fn()
  }
}

const expectCanonicalWrenIcon = (icon) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(icon)
  expect(match).not.toBeNull()
  const png = Buffer.from(match[1], 'base64')
  expect(png.toString('base64')).toBe(match[1])
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.readUInt32BE(16)).toBe(128)
  expect(png.readUInt32BE(20)).toBe(128)
  expect(createHash('sha256').update(png).digest('hex')).toBe(
    'bc8ba0f545d9a8b005cbf704a147b94f6e77a20afa54bd01b1c74983decc9676'
  )
}

it('announces immutable final EIP-6963 metadata immediately', () => {
  const target = new BrowserTarget()
  const provider = { request: jest.fn() }
  const announcements = []
  target.addEventListener(EIP6963_ANNOUNCE_EVENT, (event) => announcements.push(event.detail))

  const installation = installEip6963Provider(target, provider)

  expect(announcements).toEqual([installation.detail])
  expect(installation.detail).toEqual({
    info: {
      uuid: '4d2d8f2a-85fb-4d1d-aa0e-16490915ee09',
      ...WREN_PROVIDER_METADATA
    },
    provider
  })
  expect(Object.isFrozen(installation.detail)).toBe(true)
  expect(Object.isFrozen(installation.detail.info)).toBe(true)
  expect(Object.isFrozen(provider)).toBe(false)
  expectCanonicalWrenIcon(installation.detail.info.icon)
  expect(installation.detail.info.rdns).toBe('io.github.jorphex.wren')
  expect(target.crypto.randomUUID).toHaveBeenCalledTimes(1)
})

it('reannounces one page-lifetime identity for every provider request', () => {
  const target = new BrowserTarget()
  const announcements = []
  target.addEventListener(EIP6963_ANNOUNCE_EVENT, (event) => announcements.push(event.detail))

  const installation = installEip6963Provider(target, {})
  target.dispatchEvent(new globalThis.Event(EIP6963_REQUEST_EVENT))
  target.dispatchEvent(new globalThis.Event(EIP6963_REQUEST_EVENT))

  expect(announcements).toEqual([installation.detail, installation.detail, installation.detail])
  expect(target.crypto.randomUUID).toHaveBeenCalledTimes(1)
})

it('removes request discovery idempotently without retracting prior announcements', () => {
  const target = new BrowserTarget()
  const announce = jest.fn()
  target.addEventListener(EIP6963_ANNOUNCE_EVENT, announce)
  const installation = installEip6963Provider(target, {})

  installation.dispose()
  installation.dispose()
  target.dispatchEvent(new globalThis.Event(EIP6963_REQUEST_EVENT))

  expect(announce).toHaveBeenCalledTimes(1)
})

it('fails before announcement when the runtime cannot provide a UUIDv4 identity', () => {
  const target = new BrowserTarget(['not-a-uuid'])
  const announce = jest.fn()
  target.addEventListener(EIP6963_ANNOUNCE_EVENT, announce)

  expect(() => installEip6963Provider(target, {})).toThrow(/UUIDv4/)
  expect(announce).not.toHaveBeenCalled()
})

it('announces the exact provider installed as the legacy window.ethereum fallback', () => {
  const target = new BrowserTarget()
  const rawProvider = new RawProvider()
  const announcements = []
  target.addEventListener(EIP6963_ANNOUNCE_EVENT, (event) => announcements.push(event.detail))

  const installation = installFrameProvider(target, rawProvider)

  expect(target.ethereum).toBe(installation.provider)
  expect(announcements[0].provider).toBe(installation.provider)
  expect(installation.provider.provider).toBe(rawProvider)
})
