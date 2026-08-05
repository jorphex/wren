import createIpfs, { getGatewayUrl, getKuboOptions } from '../../../main/nebula/ipfs'

const mockParseCid = jest.fn((value) => ({
  toV1: () => ({ toString: () => (value.startsWith('Qm') ? 'bafy-canonical' : value) })
}))
const mockLoadKuboModule = jest.fn()

jest.mock('../../../main/nebula/modules', () => ({
  loadCidModule: jest.fn(async () => ({ CID: { parse: mockParseCid } })),
  loadKuboModule: (...args) => mockLoadKuboModule(...args)
}))

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gue3ohqgs2a6ihz7ukwxh4ze'
const LEGACY_CID = 'QmeAp9nr7rTEjExtAJJhWmCSxYQncwX1DQ2s6paJa8dBzT'

async function* chunks(...values) {
  for (const value of values) yield Buffer.from(value)
}

function response(values, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: new Headers(options.headers),
    body: options.body === null ? null : chunks(...values)
  }
}

async function collect(iterable) {
  const received = []
  for await (const chunk of iterable) received.push(Buffer.from(chunk).toString())
  return received
}

beforeEach(() => {
  jest.clearAllMocks()
  mockParseCid.mockImplementation((value) => ({
    toV1: () => ({ toString: () => (value.startsWith('Qm') ? 'bafy-canonical' : value) })
  }))
})

describe('gateway mode', () => {
  test('defaults to ipfs.io without loading Kubo or contacting Nebula', async () => {
    const fetch = jest.fn(async () => response(['{}']))
    const ipfs = createIpfs(undefined, 32, 64, { env: {}, fetch })

    await expect(ipfs.getJson(CID)).resolves.toEqual({})

    const [url] = fetch.mock.calls[0]
    expect(url.toString()).toBe(`https://ipfs.io/ipfs/${CID}`)
    expect(url.toString()).not.toContain('nebula')
    expect(mockLoadKuboModule).not.toHaveBeenCalled()
  })

  test('uses an HTTPS gateway override, preserving a safe base path', async () => {
    const fetch = jest.fn(async () => response(['{"ok":true}']))
    const ipfs = createIpfs(undefined, 32, 64, {
      env: { WREN_IPFS_GATEWAY_URL: 'https://gateway.example.test/content/' },
      fetch
    })

    await expect(ipfs.getJson(`${CID}/folder name/metadata.json`)).resolves.toEqual({ ok: true })

    expect(fetch.mock.calls[0][0].toString()).toBe(
      `https://gateway.example.test/content/ipfs/${CID}/folder%20name/metadata.json`
    )
  })

  test('requests directory archives with the tar format query', async () => {
    const fetch = jest.fn(async () => response(['first', 'second']))
    const ipfs = createIpfs(undefined, 32, 64, { env: {}, fetch })

    await expect(collect(ipfs.get(`/ipfs/${CID}/directory`, { archive: true }))).resolves.toEqual([
      'first',
      'second'
    ])

    expect(fetch.mock.calls[0][0].toString()).toBe(`https://ipfs.io/ipfs/${CID}/directory?format=tar`)
  })

  test('canonicalizes CIDv0 and URL-encodes decoded subpath segments', async () => {
    const fetch = jest.fn(async () => response(['{}']))
    const ipfs = createIpfs(undefined, 32, 64, { env: {}, fetch })

    await ipfs.getJson(`${LEGACY_CID}/hello%20world.json`)

    expect(mockParseCid).toHaveBeenCalledWith(LEGACY_CID)
    expect(fetch.mock.calls[0][0].toString()).toBe('https://ipfs.io/ipfs/bafy-canonical/hello%20world.json')
  })

  test.each([
    `${CID}/../secret`,
    `${CID}/%2e%2e/secret`,
    `${CID}/%2Fetc`,
    `${CID}/file?download=1`,
    `${CID}/file#fragment`,
    `${CID}/folder\\file`,
    `/other/${CID}`,
    `${CID}//file`,
    'not-a-cid'
  ])('rejects unsafe or invalid content path %s', async (path) => {
    if (path === 'not-a-cid') {
      mockParseCid.mockImplementationOnce(() => {
        throw new Error()
      })
    }
    const fetch = jest.fn()
    const ipfs = createIpfs(undefined, 32, 64, { env: {}, fetch })

    await expect(ipfs.getJson(path)).rejects.toThrow(/Invalid IPFS/)
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each([
    'http://gateway.example.test',
    'ftp://gateway.example.test',
    'https://user:pass@gateway.example.test',
    'https://gateway.example.test?token=value',
    'https://gateway.example.test#fragment'
  ])('rejects unsafe gateway endpoint %s', (url) => {
    expect(() => getGatewayUrl({ WREN_IPFS_GATEWAY_URL: url })).toThrow()
  })

  test('permits loopback HTTP gateways for tests and self-hosting', () => {
    expect(getGatewayUrl({ WREN_IPFS_GATEWAY_URL: 'http://127.0.0.1:8080' }).toString()).toBe(
      'http://127.0.0.1:8080/'
    )
    expect(getGatewayUrl({ WREN_IPFS_GATEWAY_URL: 'http://[::1]:8080' }).toString()).toBe(
      'http://[::1]:8080/'
    )
  })

  test('rejects non-2xx responses and missing bodies', async () => {
    const failed = createIpfs(undefined, 32, 64, {
      env: {},
      fetch: jest.fn(async () => response([], { ok: false, status: 502 }))
    })
    const bodyless = createIpfs(undefined, 32, 64, {
      env: {},
      fetch: jest.fn(async () => response([], { body: null }))
    })

    await expect(failed.getJson(CID)).rejects.toThrow('HTTP 502')
    await expect(bodyless.getJson(CID)).rejects.toThrow('has no body')
  })

  test('rejects oversized declared and streamed JSON responses', async () => {
    const declared = createIpfs(undefined, 8, 64, {
      env: {},
      fetch: jest.fn(async () => response(['{}'], { headers: { 'content-length': '9' } }))
    })
    const streamed = createIpfs(undefined, 8, 64, {
      env: {},
      fetch: jest.fn(async () => response(['12345', '67890']))
    })

    await expect(declared.getJson(CID)).rejects.toThrow('JSON response exceeds 8 bytes')
    await expect(streamed.getJson(CID)).rejects.toThrow('JSON response exceeds 8 bytes')
  })

  test('rejects oversized declared and streamed archives', async () => {
    const declared = createIpfs(undefined, 32, 8, {
      env: {},
      fetch: jest.fn(async () => response(['archive'], { headers: { 'content-length': '9' } }))
    })
    const streamed = createIpfs(undefined, 32, 8, {
      env: {},
      fetch: jest.fn(async () => response(['12345', '67890']))
    })

    await expect(collect(declared.get(CID, { archive: true }))).rejects.toThrow('archive exceeds 8 bytes')
    await expect(collect(streamed.get(CID, { archive: true }))).rejects.toThrow('archive exceeds 8 bytes')
  })

  test('bounds non-archive gateway streams', async () => {
    const ipfs = createIpfs(undefined, 8, 64, {
      env: {},
      fetch: jest.fn(async () => response(['12345', '67890']))
    })

    await expect(collect(ipfs.get(CID))).rejects.toThrow('IPFS response exceeds 8 bytes')
  })

  test('keeps the timeout active until streaming completes and aborts fetch', async () => {
    let release
    const stalled = new Promise((resolve) => {
      release = resolve
    })
    const fetch = jest.fn(async (_url, { signal }) => ({
      ...response([]),
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('first')
          await stalled
        }
      },
      signal
    }))
    const ipfs = createIpfs(undefined, 32, 64, { env: {}, fetch, timeoutMs: 10 })

    const pending = collect(ipfs.get(CID))
    const rejection = expect(pending).rejects.toThrow('timed out after 10ms')
    await jest.advanceTimersByTimeAsync(10)

    await rejection
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    release()
  })

  test('preserves the empty JSON response fallback', async () => {
    const ipfs = createIpfs(undefined, 32, 64, {
      env: {},
      fetch: jest.fn(async () => response([]))
    })

    await expect(ipfs.getJson(CID)).resolves.toEqual({})
  })
})

describe('explicit Kubo API mode', () => {
  test('uses Wren API configuration and lazily creates one client', async () => {
    const get = jest.fn(() => chunks('archive'))
    const cat = jest.fn(() => chunks('{"ok":true}'))
    const create = jest.fn(() => ({ get, cat }))
    mockLoadKuboModule.mockResolvedValue({ create })
    const fetch = jest.fn()
    const env = { WREN_IPFS_API_URL: 'https://kubo.example.test/api/v0' }
    const ipfs = createIpfs(undefined, 32, 64, { env, fetch })

    await expect(ipfs.getJson(CID)).resolves.toEqual({ ok: true })
    await expect(collect(ipfs.get(CID, { archive: true }))).resolves.toEqual(['archive'])

    expect(create).toHaveBeenCalledWith({ url: 'https://kubo.example.test/api/v0', headers: {} })
    expect(mockLoadKuboModule).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('preserves an injected Kubo client factory', async () => {
    const client = { get: jest.fn(() => chunks('archive')), cat: jest.fn(() => chunks('{}')) }
    const factory = jest.fn(async () => client)
    const ipfs = createIpfs(factory, 32, 64, { env: {} })

    await ipfs.getJson(`/ipfs/${CID}/metadata.json`)
    await collect(ipfs.get(CID, { archive: true }))

    expect(client.cat).toHaveBeenCalledWith(`/ipfs/${CID}/metadata.json`, {
      signal: expect.any(AbortSignal)
    })
    expect(client.get).toHaveBeenCalledWith(CID, {
      archive: true,
      signal: expect.any(AbortSignal)
    })
    expect(factory).toHaveBeenCalledTimes(1)
  })

  test('prefers Wren API and auth settings over deprecated fallbacks', () => {
    expect(
      getKuboOptions({
        WREN_IPFS_API_URL: 'https://wren.example.test/api/v0',
        FRAME_IPFS_API_URL: 'https://frame.example.test/api/v0',
        WREN_IPFS_AUTH_TOKEN: 'wren-token',
        NEBULA_AUTH_TOKEN: 'legacy-token'
      })
    ).toEqual({
      url: 'https://wren.example.test/api/v0',
      headers: { authorization: `Basic ${Buffer.from('wren-token:').toString('base64')}` }
    })
  })

  test('supports deprecated API and auth settings only in explicit API mode', () => {
    expect(
      getKuboOptions({
        FRAME_IPFS_API_URL: 'http://localhost:5001',
        NEBULA_AUTH_TOKEN: 'legacy-token'
      })
    ).toEqual({
      url: 'http://localhost:5001/',
      headers: { authorization: `Basic ${Buffer.from('legacy-token:').toString('base64')}` }
    })

    expect(() => getKuboOptions({ NEBULA_AUTH_TOKEN: 'unused' })).toThrow(
      'explicit WREN_IPFS_API_URL is required'
    )
  })

  test.each([
    'http://kubo.example.test',
    'file:///tmp/ipfs',
    'https://user:pass@kubo.example.test',
    'https://kubo.example.test/api/v0?token=value',
    'https://kubo.example.test/api/v0#fragment'
  ])('rejects unsafe API endpoint %s', (url) => {
    expect(() => getKuboOptions({ WREN_IPFS_API_URL: url })).toThrow()
  })

  test('applies streaming bounds and deadlines in Kubo mode', async () => {
    let stalledSignal
    const oversized = createIpfs(
      async () => ({ get: jest.fn(() => chunks('12345', '67890')), cat: jest.fn() }),
      32,
      8,
      { env: {} }
    )
    const stalled = createIpfs(
      async () => ({
        get: jest.fn(),
        cat: jest.fn((_path, { signal }) => ({
          [Symbol.asyncIterator]() {
            stalledSignal = signal
            return this
          },
          next() {
            return new Promise(() => {})
          }
        }))
      }),
      32,
      64,
      { env: {}, timeoutMs: 10 }
    )

    await expect(collect(oversized.get(CID, { archive: true }))).rejects.toThrow('archive exceeds 8 bytes')
    const pending = stalled.getJson(CID)
    const rejection = expect(pending).rejects.toThrow('timed out after 10ms')
    await jest.advanceTimersByTimeAsync(10)
    await rejection
    expect(stalledSignal).toBeInstanceOf(AbortSignal)
    expect(stalledSignal.aborted).toBe(true)
  })
})
