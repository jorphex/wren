import { readJsonWithLimit } from '../../resources/utils/fetch'

export const SOURCIFY_SERVER = 'https://sourcify.dev/server'
export const SOURCIFY_TIMEOUT_MS = 10_000
export const SOURCIFY_MAX_REQUEST_BYTES = 16 * 1024 * 1024
export const SOURCIFY_MAX_RESPONSE_BYTES = 1024 * 1024

const ADDRESS = /^0x[0-9a-f]{40}$/
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const COMPILER_VERSION = /^v?\d+\.\d+\.\d+[^\s]{0,96}$/
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i
const MAX_IDENTIFIER_LENGTH = 1024
const MAX_EXTERNAL_ID_LENGTH = 512
const MAX_URL_LENGTH = 2048

class InvalidSourcifyResponseError extends Error {}

type FetchLike = typeof fetch
export type SourcifyMatch = 'match' | 'exact_match' | null
type Destination = 'etherscan' | 'blockscout' | 'routescan'

export interface SourcifySubmission {
  chainId: number
  address: string
  stdJsonInput: Record<string, unknown>
  compilerVersion: string
  contractIdentifier: string
  creationTransactionHash?: string
}

export interface SourcifyExpectedTarget {
  readonly chainId: number
  readonly address: string
}

export type SourcifySubmitError =
  | 'invalid_request'
  | 'request_too_large'
  | 'timeout'
  | 'rate_limited'
  | 'service_unavailable'
  | 'rejected'
  | 'invalid_response'

export type SourcifySubmitResult =
  | { status: 'accepted'; verificationId: string }
  | { status: 'already_verified' }
  | { status: 'error'; reason: SourcifySubmitError }

export type SourcifyExternalError = 'rate_limited' | 'rejected' | 'unavailable' | 'unknown'

export interface SourcifyExternalResult {
  verificationId?: string
  statusUrl?: string
  explorerUrl?: string
  error?: SourcifyExternalError
}

export interface SourcifyExternalVerifications {
  etherscan?: SourcifyExternalResult
  blockscout?: SourcifyExternalResult
  routescan?: SourcifyExternalResult
}

export type SourcifyFailureReason =
  'no_match' | 'compiler_error' | 'unsupported_chain' | 'invalid_source' | 'verification_failed'

export type SourcifyStatusUnavailableReason =
  'timeout' | 'rate_limited' | 'service_unavailable' | 'invalid_response'

export type SourcifyStatusResult =
  | { status: 'pending' }
  | {
      status: 'succeeded'
      creationMatch: SourcifyMatch
      runtimeMatch: SourcifyMatch
      externalVerifications: SourcifyExternalVerifications
    }
  | { status: 'failed'; reason: SourcifyFailureReason }
  | { status: 'unknown'; reason: 'not_found' }
  | { status: 'unavailable'; reason: SourcifyStatusUnavailableReason }

interface SourcifyClientDependencies {
  fetchImpl?: FetchLike
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false

  const pending: unknown[] = [value]
  const visited = new WeakSet<object>()

  while (pending.length) {
    const current = pending.pop()
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false
      continue
    }
    if (typeof current !== 'object') return false
    if (visited.has(current)) return false
    visited.add(current)

    const prototype = Object.getPrototypeOf(current)
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) return false
    if (Reflect.ownKeys(current).some((key) => typeof key === 'symbol')) return false

    const descriptors = Object.getOwnPropertyDescriptors(current)
    for (const descriptor of Object.values(descriptors)) {
      if (!('value' in descriptor)) return false
      pending.push(descriptor.value)
    }
  }

  return true
}

function hasJsonContentType(response: Response) {
  return JSON_CONTENT_TYPE.test(response.headers.get('content-type')?.trim() || '')
}

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function validSubmission(input: SourcifySubmission) {
  return (
    Number.isSafeInteger(input.chainId) &&
    input.chainId > 0 &&
    typeof input.address === 'string' &&
    ADDRESS.test(input.address) &&
    isJsonObject(input.stdJsonInput) &&
    typeof input.compilerVersion === 'string' &&
    COMPILER_VERSION.test(input.compilerVersion) &&
    input.compilerVersion.length <= 100 &&
    typeof input.contractIdentifier === 'string' &&
    input.contractIdentifier.length > 0 &&
    input.contractIdentifier.length <= MAX_IDENTIFIER_LENGTH &&
    !hasControlCharacter(input.contractIdentifier) &&
    (input.creationTransactionHash === undefined || TRANSACTION_HASH.test(input.creationTransactionHash))
  )
}

async function readJson(response: Response): Promise<unknown> {
  if (!hasJsonContentType(response)) throw new InvalidSourcifyResponseError()
  try {
    return await readJsonWithLimit<unknown>(response, SOURCIFY_MAX_RESPONSE_BYTES)
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) {
      throw new InvalidSourcifyResponseError()
    }
    throw error
  }
}

function requestFailure(error: unknown): 'timeout' | 'invalid_response' | 'service_unavailable' {
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (error instanceof InvalidSourcifyResponseError) return 'invalid_response'
  return 'service_unavailable'
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(record).every((key) => allowed.includes(key))
}

function parseAccepted(payload: unknown): string | undefined {
  if (!isRecord(payload) || !onlyKeys(payload, ['verificationId'])) return
  return typeof payload['verificationId'] === 'string' && UUID.test(payload['verificationId'])
    ? payload['verificationId']
    : undefined
}

function isAlreadyVerified(payload: unknown) {
  return (
    isRecord(payload) &&
    onlyKeys(payload, ['customCode', 'message', 'errorId']) &&
    payload['customCode'] === 'already_verified' &&
    typeof payload['message'] === 'string' &&
    typeof payload['errorId'] === 'string' &&
    UUID.test(payload['errorId'])
  )
}

function boundedExternalId(value: unknown) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._:-]+$/.test(value) &&
    value.length <= MAX_EXTERNAL_ID_LENGTH
    ? value
    : undefined
}

const DESTINATION_HOSTS: Record<Destination, readonly string[]> = {
  etherscan: [
    'etherscan.io',
    'etherscan.com',
    'arbiscan.io',
    'basescan.org',
    'bscscan.com',
    'celoscan.io',
    'ftmscan.com',
    'lineascan.build',
    'polygonscan.com',
    'snowtrace.io',
    'scrollscan.com'
  ],
  blockscout: ['blockscout.com'],
  routescan: ['routescan.io']
}

function safeDestinationUrl(value: unknown, destination: Destination, stripQueryAndFragment = false) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    const expectedHost = DESTINATION_HOSTS[destination].some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    )
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !expectedHost) return
    if (stripQueryAndFragment) {
      parsed.search = ''
      parsed.hash = ''
    }
    const normalized = parsed.toString()
    return normalized.length <= MAX_URL_LENGTH ? normalized : undefined
  } catch {
    return
  }
}

function externalError(value: unknown): SourcifyExternalError | undefined {
  if (typeof value !== 'string' || value.length === 0) return
  const normalized = value.toLowerCase().slice(0, 512)
  if (normalized.includes('rate limit') || normalized.includes('too many')) return 'rate_limited'
  if (
    normalized.includes('unavailable') ||
    normalized.includes('timeout') ||
    normalized.includes('connection')
  ) {
    return 'unavailable'
  }
  if (normalized.includes('reject') || normalized.includes('notok') || normalized.includes('fail')) {
    return 'rejected'
  }
  return 'unknown'
}

function projectExternal(value: unknown, destination: Destination): SourcifyExternalResult | undefined {
  if (!isRecord(value)) return
  const verificationId = boundedExternalId(value['verificationId'])
  const statusUrl = safeDestinationUrl(value['statusUrl'], destination, true)
  const explorerUrl = safeDestinationUrl(value['explorerUrl'], destination)
  const error = externalError(value['error'])
  if (!verificationId && !statusUrl && !explorerUrl && !error) return
  return {
    ...(verificationId ? { verificationId } : {}),
    ...(statusUrl ? { statusUrl } : {}),
    ...(explorerUrl ? { explorerUrl } : {}),
    ...(error ? { error } : {})
  }
}

function projectExternalVerifications(value: unknown): SourcifyExternalVerifications {
  if (!isRecord(value)) return {}
  const etherscan = projectExternal(value['etherscan'], 'etherscan')
  const blockscout = projectExternal(value['blockscout'], 'blockscout')
  const routescan = projectExternal(value['routescan'], 'routescan')
  return {
    ...(etherscan ? { etherscan } : {}),
    ...(blockscout ? { blockscout } : {}),
    ...(routescan ? { routescan } : {})
  }
}

function isMatch(value: unknown): value is SourcifyMatch {
  return value === 'match' || value === 'exact_match' || value === null
}

function failureReason(value: unknown): SourcifyFailureReason | undefined {
  if (
    !isRecord(value) ||
    typeof value['customCode'] !== 'string' ||
    !value['customCode'] ||
    value['customCode'].length > 128 ||
    typeof value['message'] !== 'string' ||
    typeof value['errorId'] !== 'string' ||
    !UUID.test(value['errorId'])
  ) {
    return
  }
  switch (value['customCode']) {
    case 'no_match':
      return 'no_match'
    case 'compiler_error':
      return 'compiler_error'
    case 'unsupported_chain':
      return 'unsupported_chain'
    case 'invalid_source':
    case 'missing_source':
    case 'validation_error':
      return 'invalid_source'
    default:
      return 'verification_failed'
  }
}

function validExpectedTarget(value: SourcifyExpectedTarget) {
  return (
    isRecord(value) &&
    onlyKeys(value, ['chainId', 'address']) &&
    Number.isSafeInteger(value.chainId) &&
    value.chainId > 0 &&
    typeof value.address === 'string' &&
    ADDRESS.test(value.address)
  )
}

function projectStatus(
  payload: unknown,
  verificationId: string,
  expected: SourcifyExpectedTarget
): SourcifyStatusResult | undefined {
  if (
    !isRecord(payload) ||
    typeof payload['isJobCompleted'] !== 'boolean' ||
    payload['verificationId'] !== verificationId
  ) {
    return
  }

  const contract = payload['contract']
  if (
    !isRecord(contract) ||
    contract['chainId'] !== String(expected.chainId) ||
    typeof contract['address'] !== 'string' ||
    contract['address'].toLowerCase() !== expected.address
  ) {
    return
  }

  if (!payload['isJobCompleted']) return { status: 'pending' }

  if (
    (contract['match'] === 'match' || contract['match'] === 'exact_match') &&
    isMatch(contract['creationMatch']) &&
    isMatch(contract['runtimeMatch']) &&
    /^\d{1,20}$/.test(contract['chainId'] as string)
  ) {
    return {
      status: 'succeeded',
      creationMatch: contract['creationMatch'],
      runtimeMatch: contract['runtimeMatch'],
      externalVerifications: projectExternalVerifications(payload['externalVerifications'])
    }
  }

  const reason = failureReason(payload['error'])
  return reason ? { status: 'failed', reason } : undefined
}

async function withRequestDeadline<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchLike,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal })
    return await consume(response)
  } finally {
    clearTimeout(timer)
  }
}

export function createSourcifyClient({
  fetchImpl = fetch,
  timeoutMs = SOURCIFY_TIMEOUT_MS
}: SourcifyClientDependencies = {}) {
  const boundedTimeout = Number.isFinite(timeoutMs)
    ? Math.min(Math.max(1, Math.trunc(timeoutMs)), SOURCIFY_TIMEOUT_MS)
    : SOURCIFY_TIMEOUT_MS

  return {
    submit: async (input: SourcifySubmission): Promise<SourcifySubmitResult> => {
      if (!validSubmission(input)) return { status: 'error', reason: 'invalid_request' }

      let body: string
      try {
        body = JSON.stringify({
          stdJsonInput: input.stdJsonInput,
          compilerVersion: input.compilerVersion,
          contractIdentifier: input.contractIdentifier,
          ...(input.creationTransactionHash ? { creationTransactionHash: input.creationTransactionHash } : {})
        })
      } catch {
        return { status: 'error', reason: 'invalid_request' }
      }

      if (Buffer.byteLength(body, 'utf8') > SOURCIFY_MAX_REQUEST_BYTES) {
        return { status: 'error', reason: 'request_too_large' }
      }

      try {
        return await withRequestDeadline(
          `${SOURCIFY_SERVER}/v2/verify/${input.chainId}/${input.address}`,
          {
            method: 'POST',
            redirect: 'error',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body
          },
          boundedTimeout,
          fetchImpl,
          async (response): Promise<SourcifySubmitResult> => {
            if (response.status === 202) {
              const verificationId = parseAccepted(await readJson(response))
              return verificationId
                ? { status: 'accepted', verificationId }
                : { status: 'error', reason: 'invalid_response' }
            }
            if (response.status === 409) {
              return isAlreadyVerified(await readJson(response))
                ? { status: 'already_verified' }
                : { status: 'error', reason: 'rejected' }
            }

            await response.body?.cancel()
            if (response.status === 429) return { status: 'error', reason: 'rate_limited' }
            if (response.status >= 500) return { status: 'error', reason: 'service_unavailable' }
            if (response.status >= 300 && response.status < 400) {
              return { status: 'error', reason: 'invalid_response' }
            }
            return { status: 'error', reason: 'rejected' }
          }
        )
      } catch (error) {
        return { status: 'error', reason: requestFailure(error) }
      }
    },

    status: async (
      verificationId: string,
      expected: SourcifyExpectedTarget
    ): Promise<SourcifyStatusResult> => {
      if (!UUID.test(verificationId) || !validExpectedTarget(expected)) {
        return { status: 'unavailable', reason: 'invalid_response' }
      }
      const expectedTarget = Object.freeze({ chainId: expected.chainId, address: expected.address })
      try {
        return await withRequestDeadline(
          `${SOURCIFY_SERVER}/v2/verify/${verificationId}`,
          { method: 'GET', redirect: 'error', headers: { accept: 'application/json' } },
          boundedTimeout,
          fetchImpl,
          async (response): Promise<SourcifyStatusResult> => {
            if (response.status === 200) {
              const result = projectStatus(await readJson(response), verificationId, expectedTarget)
              return result || { status: 'unavailable', reason: 'invalid_response' }
            }
            await response.body?.cancel()
            if (response.status === 404) return { status: 'unknown', reason: 'not_found' }
            if (response.status === 429) return { status: 'unavailable', reason: 'rate_limited' }
            if (response.status >= 500) {
              return { status: 'unavailable', reason: 'service_unavailable' }
            }
            return { status: 'unavailable', reason: 'invalid_response' }
          }
        )
      } catch (error) {
        const reason = requestFailure(error)
        return {
          status: 'unavailable',
          reason: reason === 'service_unavailable' ? 'service_unavailable' : reason
        }
      }
    }
  }
}

export type SourcifyClient = ReturnType<typeof createSourcifyClient>
