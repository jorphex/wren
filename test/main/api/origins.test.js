import log from 'electron-log'

import {
  createSessionOrigin,
  isCanonicalExternalOrigin,
  requiresSessionOrigin,
  parseOrigin,
  updateOrigin,
  isTrusted,
  requestOriginAccess,
  parseFrameExtension
} from '../../../main/api/origins'
import accounts from '../../../main/accounts'
import store from '../../../main/store'
import { createAccountPermission } from '../../../main/provider/permissions'
import { originIdForInvoker } from '../../../resources/domain/origin'

const directOriginId = (origin) => originIdForInvoker(origin, { provenance: 'direct' })

it('uses the authenticated native fingerprint as identity, not its display label', () => {
  const invoker = { provenance: 'native', sourceId: 'a'.repeat(43) }
  expect(originIdForInvoker('Local app', invoker)).toBe(originIdForInvoker('Renamed app', invoker))
  expect(originIdForInvoker('Local app', invoker)).not.toBe(
    originIdForInvoker('Local app', { provenance: 'native', sourceId: 'b'.repeat(43) })
  )
})
const grant = (address, originId, origin = 'test.frame.eth', chains = [1]) =>
  createAccountPermission({ account: address, chains, handlerId: originId, origin })

jest.mock('../../../main/accounts', () => ({
  current: jest.fn(),
  addRequest: jest.fn(),
  cancelUnapprovedRequestForAccount: jest.fn()
}))
jest.mock('../../../main/store')

beforeAll(() => {
  log.transports.console.level = false
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

beforeEach(() => {
  accounts.current.mockReset()
  accounts.addRequest.mockReset()
  accounts.cancelUnapprovedRequestForAccount.mockReset()
  store.initOrigin = jest.fn()
  store.addOriginRequest = jest.fn()

  store.set('main.origins', {})
  store.set('main.permissions', {})
})

describe('#updateOrigin', () => {
  describe('handling origins', () => {
    it('adds a new origin to the store', () => {
      updateOrigin({}, 'frame.test')

      expect(store.initOrigin).toHaveBeenCalledWith(directOriginId('frame.test'), {
        name: 'frame.test',
        provenance: 'direct',
        chain: {
          type: 'ethereum',
          id: 1
        }
      })
    })

    it('marks generated local-client origins as session-only', () => {
      const origin = 'Unknown/46d1d57b-7b20-41a8-a9ad-d299da51851d'

      updateOrigin({}, origin)

      expect(store.initOrigin).toHaveBeenCalledWith(directOriginId(origin), {
        name: origin,
        provenance: 'direct',
        sessionOnly: true,
        chain: { type: 'ethereum', id: 1 }
      })
    })

    it('does not overwrite an existing origin', () => {
      store.set('main.origins', directOriginId('frame.test'), { chain: { id: 1 } })

      updateOrigin({}, 'frame.test')

      expect(store.initOrigin).not.toHaveBeenCalled()
    })

    it('does not initialize a new origin on a connection message', () => {
      updateOrigin({}, 'frame.test', true)

      expect(store.initOrigin).not.toHaveBeenCalled()
    })

    it('separates direct clients and authenticated Companion installations claiming the same origin', () => {
      const origin = 'https://example.test'
      const direct = updateOrigin({}, origin)
      const firstCompanion = updateOrigin({}, origin, false, {
        provenance: 'companion',
        sourceId: 'installation-one'
      })
      const secondCompanion = updateOrigin({}, origin, false, {
        provenance: 'companion',
        sourceId: 'installation-two'
      })

      expect(
        new Set([direct.payload._origin, firstCompanion.payload._origin, secondCompanion.payload._origin])
      ).toHaveProperty('size', 3)
    })
    it('sets the payload chain id to mainnet for connection messages with no known origin', () => {
      const originalPayload = {}
      const { payload, chainId } = updateOrigin(originalPayload, 'frame.test', true)

      expect(chainId).toBe('0x1')
      expect(payload.chainId).toBe('0x1')
    })

    it('sets the payload chain id to the origin default for connection messages with a known origin', () => {
      const originalPayload = {}
      const { payload, chainId } = updateOrigin(originalPayload, 'frame.test', true)

      expect(chainId).toBe('0x1')
      expect(payload.chainId).toBe('0x1')
    })

    it('sets the chain id to mainnet for a new origin', () => {
      const { chainId } = updateOrigin({}, 'frame.test')

      expect(chainId).toBe('0x1')
    })

    it('sets the chain id to mainnet for an unknown origin', () => {
      const { chainId } = updateOrigin({}, 'Unknown')

      expect(chainId).toBe('0x1')
    })

    it('sets the chain id for an existing origin', () => {
      store.set('main.origins', directOriginId('frame.test'), { chain: { id: 137 } })

      const { chainId } = updateOrigin({}, 'frame.test')

      expect(chainId).toBe('0x89')
    })

    it('does not override the chain id in the payload with one from a configured origin', () => {
      store.set('main.origins', directOriginId('frame.test'), { chain: { id: 137 } })

      const { chainId } = updateOrigin({ chainId: '0x1' }, 'frame.test')

      expect(chainId).toBe('0x1')
    })
  })

  describe('parsing', () => {
    it('preserves an origin using ws:// protocol', () => {
      const origin = parseOrigin('ws://frame.eth')

      expect(origin).toBe('ws://frame.eth')
    })

    it('preserves an origin using wss:// protocol', () => {
      const origin = parseOrigin('wss://pylon.frame.eth')

      expect(origin).toBe('wss://pylon.frame.eth')
    })

    it('preserves an origin using http:// protocol', () => {
      const origin = parseOrigin('http://test-case.frame.io')

      expect(origin).toBe('http://test-case.frame.io')
    })

    it('preserves an origin using https:// protocol', () => {
      const origin = parseOrigin('https://www.google.com')

      expect(origin).toBe('https://www.google.com')
    })

    it('canonicalizes host case and default ports using web origin semantics', () => {
      expect(parseOrigin('HTTPS://Example.COM:443')).toBe('https://example.com')
      expect(parseOrigin('ws://Example.COM:80')).toBe('ws://example.com')
    })

    it('keeps schemes as distinct permission identities', () => {
      const http = parseOrigin('http://frame.test')
      const https = parseOrigin('https://frame.test')

      expect(http).toBe('http://frame.test')
      expect(https).toBe('https://frame.test')
      expect(directOriginId(http)).not.toBe(directOriginId(https))
    })

    it('does not change an origin using an extension protocol', () => {
      const origin = parseOrigin('chrome-extension://tagxpelsfagzmzljsfgmuipalsfaohgpal')

      expect(origin).toBe('chrome-extension://tagxpelsfagzmzljsfgmuipalsfaohgpal')
    })

    it('preserves a narrow internal origin label', () => {
      const origin = parseOrigin('frame-extension')

      expect(origin).toBe('frame-extension')
    })

    it.each([
      ['https://example.test', true],
      ['chrome-extension://tagxpelsfagzmzljsfgmuipalsfaohgpal', true],
      ['frame-extension', false],
      ['frame-internal', false],
      ['legacy.example', false],
      [undefined, false]
    ])('classifies canonical external transport origin %s as %s', (origin, expected) => {
      expect(isCanonicalExternalOrigin(origin)).toBe(expected)
    })

    it.each([
      'send.frame.eth',
      'example.test',
      'https://example.test/path',
      'https://example.test/..',
      'https://user@example.test',
      'https://example.test?query=1',
      'https://example.test#fragment',
      `https://${'a'.repeat(2048)}.test`
    ])('uses the server session identity for non-origin claim %s', (claimedOrigin) => {
      expect(parseOrigin(claimedOrigin, 'Unknown/server-generated')).toBe('Unknown/server-generated')
      expect(requiresSessionOrigin(claimedOrigin)).toBe(true)
    })

    it('treats a lack of origin as unknown', () => {
      const origin = parseOrigin(undefined)

      expect(origin).toBe('Unknown')
    })

    it.each([undefined, 'null', 'Unknown', 'Unknown/caller-selected', 'https://Unknown/caller-selected'])(
      'uses the server session identity for opaque origin %s',
      (claimedOrigin) => {
        expect(parseOrigin(claimedOrigin, 'Unknown/server-generated')).toBe('Unknown/server-generated')
        expect(requiresSessionOrigin(claimedOrigin)).toBe(true)
      }
    )

    it('generates distinct unguessable local-client origins', () => {
      const first = createSessionOrigin()
      const second = createSessionOrigin()

      expect(first).toMatch(/^Unknown\/[0-9a-f-]{36}$/)
      expect(second).toMatch(/^Unknown\/[0-9a-f-]{36}$/)
      expect(second).not.toBe(first)
    })
  })
})

describe('#parseFrameExtension', () => {
  it('correctly identifies the Chrome extension', () => {
    const origin = 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
    const req = { headers: { origin }, url: '/?identity=frame-extension&role=control' }

    expect(parseFrameExtension(req)).toStrictEqual({
      browser: 'chrome',
      id: 'ldcoohedfbjoobcadoglnnmmfbdlmmhf',
      role: 'control'
    })
  })

  it('does not recognize the Chrome extension without the identity query parameter', () => {
    const origin = 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
    const req = { headers: { origin }, url: '/' }

    expect(parseFrameExtension(req)).toBeUndefined()
  })

  it('does not recognize a Chrome extension with the wrong id', () => {
    const origin = 'chrome-extension://somebogusid'
    const req = { headers: { origin } }

    expect(parseFrameExtension(req)).toBeUndefined()
  })

  it('correctly identifies the Firefox extension', () => {
    const origin = 'moz-extension://4be0643f-1d98-573b-97cd-ca98a65347dd'
    const req = { headers: { origin }, url: '/?identity=frame-extension&role=page' }

    expect(parseFrameExtension(req)).toStrictEqual({
      browser: 'firefox',
      id: '4be0643f-1d98-573b-97cd-ca98a65347dd',
      role: 'page'
    })
  })

  it('does not recognize the Firefox extension without the identity query parameter', () => {
    const origin = 'moz-extension://4be0643f-1d98-573b-97cd-ca98a65347dd'
    const req = { headers: { origin }, url: '/' }

    expect(parseFrameExtension(req)).toBeUndefined()
  })

  it('correctly identifies the Safari extension', async () => {
    return withEnvironment({ NODE_ENV: 'development' }, async () => {
      const origin = 'safari-web-extension://4be0643f-1d98-573b-97cd-ca98a65347dd'
      const req = { headers: { origin }, url: '/?identity=frame-extension&role=control' }

      const { parseFrameExtension } = await import('../../../main/api/origins')

      expect(parseFrameExtension(req)).toStrictEqual({
        browser: 'safari',
        id: expect.any(String),
        role: 'control'
      })
    })
  })

  it('does not recognize a Safari extension in production', () => {
    return withEnvironment({ NODE_ENV: 'production' }, async () => {
      const origin = 'safari-web-extension://4be0643f-1d98-573b-97cd-ca98a65347dd'
      const req = { headers: { origin }, url: '/?identity=frame-extension&role=control' }

      const { parseFrameExtension } = await import('../../../main/api/origins')

      expect(parseFrameExtension(req)).toBeUndefined()
    })
  })

  it('does not recognize the Safari extension without the identity query parameter', () => {
    return withEnvironment({ NODE_ENV: 'development' }, async () => {
      const origin = 'safari-web-extension://4be0643f-1d98-573b-97cd-ca98a65347dd'
      const req = { headers: { origin }, url: '/' }

      const { parseFrameExtension } = await import('../../../main/api/origins')

      expect(parseFrameExtension(req)).toBeUndefined()
    })
  })

  it('does not recognize an extension from an unsupported browser', () => {
    const origin = 'brave-extension://4be0643f-1d98-573b-97cd-ca98a65347dd'
    const req = { headers: { origin } }

    expect(parseFrameExtension(req)).toBeUndefined()
  })

  it('requires a bounded companion connection role', () => {
    const origin = 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
    expect(parseFrameExtension({ headers: { origin }, url: '/?identity=frame-extension' })).toBeUndefined()
    expect(
      parseFrameExtension({
        headers: { origin },
        url: '/?identity=frame-extension&role=attacker'
      })
    ).toBeUndefined()
  })
})

describe('#isTrusted', () => {
  const frameTestOriginId = 'bf93061b-3575-40c5-b526-4932b02e1f3f'

  beforeEach(() => {
    store.set('main.origins', frameTestOriginId, {
      name: 'test.frame.eth',
      chain: { type: 'ethereum', id: 1 },
      provenance: 'direct'
    })
    store.set('main.permissions', {})
  })

  describe('extension requests', () => {
    // these origins are "trusted" internally and thus have access to specific methods without approval
    const trustedOrigins = ['frame-extension', 'frame-internal']
    const trustedExtensionMethods = ['wallet_getEthereumChains']

    trustedOrigins.forEach((origin) => {
      it(`does not trust requests from the ${origin} origin by default`, async () => {
        const payload = { method: 'eth_accounts', _origin: 'ac93061b-3575-40c5-b526-4932b02e1f3f' }
        store.set('main.origins', payload._origin, { name: origin, chain: { type: 'ethereum', id: 1 } })

        return expect(isTrusted(payload)).resolves.toBe(false)
      })

      trustedExtensionMethods.forEach((method) => {
        it(`trusts ${method} only with internal provenance from the ${origin} origin`, async () => {
          const payload = { method, _origin: 'ac93061b-3575-40c5-b526-4932b02e1f3f' }
          store.set('main.origins', payload._origin, {
            name: origin,
            chain: { type: 'ethereum', id: 1 },
            provenance: 'internal'
          })

          return expect(isTrusted(payload)).resolves.toBe(true)
        })

        it(`does not trust direct provenance claiming ${origin} for ${method}`, async () => {
          const payload = { method, _origin: 'ac93061b-3575-40c5-b526-4932b02e1f3f' }
          store.set('main.origins', payload._origin, {
            name: origin,
            chain: { type: 'ethereum', id: 1 },
            provenance: 'direct'
          })

          return expect(isTrusted(payload)).resolves.toBe(false)
        })
      })
    })
  })

  it('does not trust any request with an invalid origin', async () => {
    const payload = { _origin: 'ac93061b-3575-40c5-b526-4932b02e1f3f' }
    store.set('main.origins', payload._origin, {
      name: '!nvalid origin',
      chain: { type: 'ethereum', id: 1 }
    })

    return expect(isTrusted(payload)).resolves.toBe(false)
  })

  it('does not trust a request if no account is selected', async () => {
    const payload = { _origin: frameTestOriginId }

    accounts.current.mockReturnValueOnce(undefined)

    return expect(isTrusted(payload)).resolves.toBe(false)
  })

  it('trusts an origin that has been previously granted permission', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = { method: 'eth_accounts', _origin: frameTestOriginId }

    accounts.current.mockReturnValue({ address })

    store.set('main.permissions', address, {
      [frameTestOriginId]: grant(address, frameTestOriginId)
    })

    return expect(isTrusted(payload)).resolves.toBe(true)
  })

  it('rejects a transaction whose internal chain exceeds the granted scope before review', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = {
      method: 'eth_sendTransaction',
      _origin: frameTestOriginId,
      params: [{ from: address, to: address, chainId: '0xa' }]
    }
    accounts.current.mockReturnValue({ address })
    store.set('main.permissions', address, {
      [frameTestOriginId]: grant(address, frameTestOriginId, 'test.frame.eth', [1])
    })

    await expect(isTrusted(payload)).resolves.toBe(false)
    expect(accounts.addRequest).not.toHaveBeenCalled()
  })

  it('does not prompt when an origin has no standing permission', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = { method: 'eth_accounts', _origin: frameTestOriginId }

    accounts.current.mockReturnValue({ address })
    store.set('main.permissions', address, {})
    await expect(isTrusted(payload)).resolves.toBe(false)
    expect(accounts.addRequest).not.toHaveBeenCalled()
  })

  it('opens an explicit request to grant permission to the user', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = { method: 'eth_accounts', _origin: frameTestOriginId }

    accounts.current.mockReturnValue({ address })

    accounts.addRequest.mockImplementationOnce((request, cb) => {
      expect(request).toStrictEqual({
        type: 'access',
        handlerId: frameTestOriginId,
        origin: frameTestOriginId,
        account: address,
        permission: expect.objectContaining({ handlerId: frameTestOriginId }),
        payload: {
          method: 'eth_accounts'
        }
      })

      setTimeout(cb, 1000)
    })

    const runTest = requestOriginAccess(payload)

    jest.runAllTimers()

    return expect(runTest).resolves
  })

  it('prompts for a replacement grant when enabled networks exceed the existing scope', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = { method: 'wallet_requestPermissions', _origin: frameTestOriginId }
    accounts.current.mockReturnValue({ address })
    store.set('main.permissions', address, {
      [frameTestOriginId]: grant(address, frameTestOriginId, 'test.frame.eth', [1])
    })
    store.set('main.networks.ethereum', {
      1: { id: 1, on: true },
      10: { id: 10, on: true }
    })
    accounts.addRequest.mockImplementationOnce((request, callback) => {
      expect(request.permission.caveats[0].value.chains).toEqual(['0x1', '0xa'])
      store.set('main.permissions', address, { [frameTestOriginId]: request.permission })
      callback()
    })

    await expect(requestOriginAccess(payload)).resolves.toBe(true)
    expect(accounts.addRequest).toHaveBeenCalledTimes(1)
  })

  it('does not let an ordinary capability check join an explicit access prompt', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const implicitPayload = { method: 'eth_accounts', _origin: frameTestOriginId }
    const explicitPayload = { method: 'wallet_requestPermissions', _origin: frameTestOriginId }

    accounts.current.mockReturnValue({ address })

    accounts.addRequest.mockImplementationOnce((request, cb) => {
      setTimeout(() => {
        // simulate user accepting the request after both RPC requests are received
        store.set('main.permissions', address, {
          [frameTestOriginId]: request.permission
        })

        cb()
      }, 1000)
    })

    const runTest = Promise.all([isTrusted(implicitPayload), requestOriginAccess(explicitPayload)]).then(
      ([isImplicitTrusted, isExplicitGranted]) => {
        expect(accounts.addRequest).toHaveBeenCalledTimes(1)
        expect(isImplicitTrusted).toBe(false)
        expect(isExplicitGranted).toBe(true)
      }
    )

    jest.runAllTimers()

    return runTest
  })

  it('keeps a shared access prompt when only one requesting transport disconnects', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = { method: 'eth_accounts', _origin: frameTestOriginId }
    const first = new AbortController()
    const second = new AbortController()
    let resolvePrompt
    let proposedPermission

    accounts.current.mockReturnValue({ address })
    accounts.addRequest.mockImplementationOnce((request, callback) => {
      proposedPermission = request.permission
      resolvePrompt = callback
    })

    const firstResult = isTrusted(payload, first.signal)
    const secondResult = requestOriginAccess(payload, undefined, second.signal)
    first.abort()
    await expect(firstResult).resolves.toBe(false)

    expect(accounts.addRequest).toHaveBeenCalledTimes(1)
    expect(accounts.cancelUnapprovedRequestForAccount).not.toHaveBeenCalled()

    store.set('main.permissions', address, {
      [frameTestOriginId]: proposedPermission
    })
    resolvePrompt()

    await expect(secondResult).resolves.toBe(true)
    expect(accounts.cancelUnapprovedRequestForAccount).not.toHaveBeenCalled()
  })

  it('dismisses an untouched access prompt when its final transport disconnects', async () => {
    const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
    const payload = { method: 'eth_accounts', _origin: frameTestOriginId }
    const controller = new AbortController()

    accounts.current.mockReturnValue({ address })
    accounts.addRequest.mockImplementationOnce(() => {})

    const result = requestOriginAccess(payload, undefined, controller.signal)
    controller.abort()

    await expect(result).resolves.toBe(false)
    expect(accounts.cancelUnapprovedRequestForAccount).toHaveBeenCalledWith(
      address,
      frameTestOriginId,
      expect.objectContaining({ code: 4900, message: 'Requesting client disconnected' })
    )
  })

  const userActions = [
    { actionTaken: 'accepted', outcome: 'grants' },
    { actionTaken: 'declined', outcome: 'refuses' }
  ]

  userActions.forEach(({ actionTaken, outcome }) => {
    it(`${outcome} permission after a request is ${actionTaken} by the user`, async () => {
      const permissionGranted = actionTaken === 'grants'
      const address = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
      const payload = { method: 'eth_accounts', _origin: 'bf93061b-3575-40c5-b526-4932b02e1f3f' }

      accounts.current.mockReturnValue({ address })

      // simulate user acting on request
      accounts.addRequest.mockImplementationOnce((request, cb) => {
        setTimeout(() => {
          store.set(
            'main.permissions',
            address,
            permissionGranted ? { [frameTestOriginId]: request.permission } : {}
          )

          cb()
        }, 1000)
      })

      const runTest = requestOriginAccess(payload)

      jest.runAllTimers()

      return expect(runTest).resolves.toBe(permissionGranted)
    })
  })
})

// helper functions
async function withEnvironment(env, test) {
  const oldEnv = { ...process.env }

  jest.resetModules()
  process.env = env

  await test()

  process.env = oldEnv
  jest.resetModules()
}
