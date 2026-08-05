import EventEmitter from 'events'

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
  expect(installation.detail.info.icon).toMatch(/^data:image\/svg\+xml;base64,/)
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
