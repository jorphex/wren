import { loadCidModule, loadKuboModule } from './modules'

import type { KuboClient } from './modules'

const DEFAULT_IPFS_GATEWAY_URL = 'https://ipfs.io'
const DEFAULT_MAX_JSON_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

type ClientFactory = () => Promise<KuboClient>
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

type IpfsDependencies = {
  env?: NodeJS.ProcessEnv
  fetch?: Fetch
  loadCidModule?: typeof loadCidModule
  loadKuboModule?: typeof loadKuboModule
  timeoutMs?: number
}

function isLoopback(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function validateEndpoint(value: string, label: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`)
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error(`${label} must use HTTPS unless it points to a loopback host`)
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain embedded credentials`)
  }
  if (url.search || url.hash) {
    throw new Error(`${label} must not contain a query or fragment`)
  }

  return url
}

export function getGatewayUrl(env: NodeJS.ProcessEnv = process.env) {
  return validateEndpoint(env['WREN_IPFS_GATEWAY_URL'] || DEFAULT_IPFS_GATEWAY_URL, 'IPFS gateway')
}

export function getKuboOptions(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = env['WREN_IPFS_API_URL'] || env['FRAME_IPFS_API_URL']
  if (!endpoint) throw new Error('An explicit WREN_IPFS_API_URL is required for Kubo API mode')

  const url = validateEndpoint(endpoint, 'IPFS API')
  const headers: Record<string, string> = {}
  const authToken = env['WREN_IPFS_AUTH_TOKEN'] || env['NEBULA_AUTH_TOKEN']
  if (authToken) {
    headers['authorization'] = `Basic ${Buffer.from(`${authToken}:`).toString('base64')}`
  }

  return { url: url.toString(), headers }
}

type CanonicalPath = {
  kubo: string
  gateway: string
}

async function canonicalizePath(path: string, cidLoader: typeof loadCidModule): Promise<CanonicalPath> {
  if (!path || path.includes('?') || path.includes('#') || path.includes('\\')) {
    throw new Error('Invalid IPFS path')
  }

  const hasIpfsPrefix = path.startsWith('/ipfs/')
  const unprefixed = hasIpfsPrefix ? path.slice('/ipfs/'.length) : path
  if (!unprefixed || unprefixed.startsWith('/') || unprefixed.endsWith('/')) {
    throw new Error('Invalid IPFS path')
  }

  const rawSegments = unprefixed.split('/')
  const segments = rawSegments.map((segment) => {
    if (!segment) throw new Error('Invalid IPFS path')

    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new Error('Invalid IPFS path encoding')
    }

    const hasControlCharacter = Array.from(decoded).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
    })
    if (!decoded || decoded === '.' || decoded === '..' || /[\\/?#]/.test(decoded) || hasControlCharacter) {
      throw new Error('Invalid IPFS path segment')
    }
    return decoded
  })

  const cid = segments[0]
  if (!cid) throw new Error('Invalid IPFS path')

  try {
    const { CID } = await cidLoader()
    segments[0] = CID.parse(cid).toV1().toString()
  } catch {
    throw new Error('Invalid IPFS CID')
  }

  const canonical = segments.join('/')
  return {
    kubo: hasIpfsPrefix ? `/ipfs/${canonical}` : canonical,
    gateway: segments.map((segment) => encodeURIComponent(segment)).join('/')
  }
}

function createDeadline(timeoutMs: number, onTimeout?: () => void) {
  let rejectTimeout!: (reason: Error) => void
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject
  })
  const timer = setTimeout(() => {
    onTimeout?.()
    rejectTimeout(new Error(`IPFS request timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  return {
    race<T>(promise: Promise<T>) {
      return Promise.race([promise, timeout])
    },
    close() {
      clearTimeout(timer)
    }
  }
}

async function* streamWithDeadline(
  open: (signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>,
  timeoutMs: number,
  maxBytes?: number,
  sizeLabel?: string
) {
  const controller = new AbortController()
  const deadline = createDeadline(timeoutMs, () => controller.abort())
  let iterator: AsyncIterator<Uint8Array> | undefined
  let size = 0

  try {
    const source = await deadline.race(open(controller.signal))
    iterator = source[Symbol.asyncIterator]()

    while (true) {
      const result = await deadline.race(iterator.next())
      if (result.done) break

      size += result.value.byteLength
      if (maxBytes !== undefined && size > maxBytes) {
        throw new Error(`${sizeLabel || 'IPFS response'} exceeds ${maxBytes} bytes`)
      }
      yield result.value
    }
  } finally {
    deadline.close()
    void iterator?.return?.().catch(() => undefined)
  }
}

function parseContentLength(response: Response, maxBytes: number, label: string) {
  const value = response.headers.get('content-length')
  if (!value) return

  const length = Number(value)
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error('IPFS response has an invalid Content-Length')
  }
  if (length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`)
}

export default function createIpfs(
  clientFactory?: ClientFactory,
  maxJsonBytes = DEFAULT_MAX_JSON_BYTES,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  dependencies: IpfsDependencies = {}
) {
  const env = dependencies.env || process.env
  const cidLoader = dependencies.loadCidModule || loadCidModule
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('IPFS timeout must be positive')

  const apiConfigured = Boolean(clientFactory || env['WREN_IPFS_API_URL'] || env['FRAME_IPFS_API_URL'])
  let client: Promise<KuboClient> | undefined
  const getClient = () => {
    if (!client) {
      client = clientFactory
        ? clientFactory()
        : (dependencies.loadKuboModule || loadKuboModule)().then(({ create }) =>
            Promise.resolve(create(getKuboOptions(env)))
          )
    }
    return client
  }

  const openGateway = async (
    path: CanonicalPath,
    archive: boolean,
    signal: AbortSignal,
    maxBytes?: number,
    sizeLabel?: string
  ) => {
    const gateway = getGatewayUrl(env)
    gateway.pathname = `${gateway.pathname.replace(/\/$/, '')}/ipfs/${path.gateway}`
    if (archive) gateway.searchParams.set('format', 'tar')

    const fetcher = dependencies.fetch || globalThis.fetch
    if (!fetcher) throw new Error('IPFS gateway mode requires Fetch API support')
    const response = await fetcher(gateway, { signal })
    if (!response.ok) throw new Error(`IPFS gateway request failed with HTTP ${response.status}`)
    if (!response.body) throw new Error('IPFS gateway response has no body')
    if (maxBytes !== undefined) parseContentLength(response, maxBytes, sizeLabel || 'IPFS response')
    return response.body as unknown as AsyncIterable<Uint8Array>
  }

  const openJson = async (path: CanonicalPath, signal: AbortSignal) => {
    if (apiConfigured) return (await getClient()).cat(path.kubo, { signal })
    return openGateway(path, false, signal, maxJsonBytes, 'IPFS JSON response')
  }

  const getFile = async (path: string) => {
    const canonicalPath = await canonicalizePath(path, cidLoader)
    const chunks: Buffer[] = []
    for await (const chunk of streamWithDeadline(
      (signal) => openJson(canonicalPath, signal),
      timeoutMs,
      maxJsonBytes,
      'IPFS JSON response'
    )) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  return {
    async *get(path: string, options?: { archive?: boolean }) {
      const canonicalPath = await canonicalizePath(path, cidLoader)
      const archive = options?.archive === true
      const maxBytes = archive ? maxArchiveBytes : maxJsonBytes
      const sizeLabel = archive ? 'IPFS archive' : 'IPFS response'

      const open = async (signal: AbortSignal) => {
        if (apiConfigured) return (await getClient()).get(canonicalPath.kubo, { ...options, signal })
        return openGateway(canonicalPath, archive, signal, maxBytes, sizeLabel)
      }

      yield* streamWithDeadline(open, timeoutMs, maxBytes, sizeLabel)
    },
    async getJson<T = unknown>(path: string): Promise<T> {
      const file = await getFile(path)
      return (file.length ? JSON.parse(file.toString()) : {}) as T
    }
  }
}

export type { IpfsDependencies }
