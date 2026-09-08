import { SiweMessage } from 'siwe'
import { isUtf8 } from 'node:buffer'

import type {
  MessageSigningContext,
  MessageSigningMethod,
  MessageSigningRisk,
  SiweMessageData
} from '../accounts/types'

interface MessageRequestOptions {
  account: string
  origin: string
  requestChainId: number
  now?: number
}

interface ParsedMessageRequest {
  params: unknown[]
  rawMessage: string
  decodedMessage: string
  context: MessageSigningContext
}

const SIWE_MARKER = 'wants you to sign in with your Ethereum account'
const HEX_BYTES = /^0x(?:[0-9a-f]{2})*$/i

const invalidParams = (message: string) =>
  Object.assign(new Error(`Invalid params: ${message}`), { code: -32602 })

function normalizeParams(method: MessageSigningMethod, params: unknown, account: string) {
  if (!Array.isArray(params)) throw invalidParams('message signing params must be an array')

  if (method === 'eth_sign') {
    if (params.length !== 2) throw invalidParams('eth_sign requires [address, message]')
    return [...params]
  }

  if (params.length < 2 || params.length > 3) {
    throw invalidParams('personal_sign requires [message, address]')
  }

  const [first, second, ...rest] = params
  const selected = account.toLowerCase()
  const firstIsAccount = typeof first === 'string' && first.toLowerCase() === selected
  const secondIsAccount = typeof second === 'string' && second.toLowerCase() === selected

  if (secondIsAccount) return [second, first, ...rest]
  if (firstIsAccount) return [first, second, ...rest]
  throw invalidParams('personal_sign signing address must be the selected account')
}

function normalizeMessage(value: unknown) {
  if (typeof value !== 'string') throw invalidParams('message must be a string')
  if (/^0x/i.test(value) && !HEX_BYTES.test(value)) {
    throw invalidParams('0x-prefixed message must contain complete hexadecimal bytes')
  }

  const rawMessage = HEX_BYTES.test(value)
    ? value.toLowerCase()
    : `0x${Buffer.from(value, 'utf8').toString('hex')}`
  const bytes = Buffer.from(rawMessage.slice(2), 'hex')
  const decodedMessage = bytes.length === 32 || !isUtf8(bytes) ? rawMessage : bytes.toString('utf8')
  const encoding = decodedMessage === rawMessage ? 'hex' : 'utf8'

  return {
    rawMessage,
    decodedMessage,
    encoding: encoding as 'hex' | 'utf8',
    byteLength: (rawMessage.length - 2) / 2
  }
}

function originMatchesDomain(origin: string, siwe: SiweMessageData) {
  if (
    !origin ||
    origin.startsWith('Unknown/') ||
    ['Unknown', 'frame-extension', 'frame-internal'].includes(origin)
  )
    return

  try {
    const originUrl = new URL(origin.includes('://') ? origin : `https://${origin}`)
    const domainUrl = new URL(`${siwe.scheme || 'https'}://${siwe.domain}`)
    return (
      originUrl.hostname.toLowerCase() === domainUrl.hostname.toLowerCase() &&
      (originUrl.port || undefined) === (domainUrl.port || undefined)
    )
  } catch {
    return
  }
}

function parseSiwe(
  message: string,
  options: MessageRequestOptions,
  risks: MessageSigningRisk[]
): SiweMessageData | undefined {
  if (!message.includes(SIWE_MARKER)) return

  try {
    const parsed = new SiweMessage(message)
    const chainId = message.match(/\nChain ID: ([0-9]+)\n/)?.[1]
    if (!chainId) throw new Error('SIWE parser did not return an exact chain ID')

    const siwe: SiweMessageData = {
      ...(parsed.scheme !== undefined && { scheme: parsed.scheme }),
      domain: parsed.domain,
      address: parsed.address,
      ...(parsed.statement !== undefined && { statement: parsed.statement }),
      uri: parsed.uri,
      version: parsed.version,
      chainId,
      nonce: parsed.nonce,
      ...(parsed.issuedAt !== undefined && { issuedAt: parsed.issuedAt }),
      ...(parsed.expirationTime !== undefined && { expirationTime: parsed.expirationTime }),
      ...(parsed.notBefore !== undefined && { notBefore: parsed.notBefore }),
      ...(parsed.requestId !== undefined && { requestId: parsed.requestId }),
      ...(parsed.resources !== undefined && { resources: parsed.resources })
    }

    risks.push('siwe-origin-unverified')
    if (originMatchesDomain(options.origin, siwe) === false) risks.push('siwe-origin-mismatch')
    if (siwe.address.toLowerCase() !== options.account.toLowerCase()) risks.push('siwe-address-mismatch')
    if (siwe.chainId !== String(options.requestChainId)) risks.push('siwe-chain-mismatch')

    const now = options.now ?? Date.now()
    if (siwe.expirationTime && Date.parse(siwe.expirationTime) <= now) risks.push('siwe-expired')
    if (siwe.notBefore && Date.parse(siwe.notBefore) > now) risks.push('siwe-not-yet-valid')
    if (siwe.issuedAt && Date.parse(siwe.issuedAt) > now) risks.push('siwe-issued-in-future')

    return siwe
  } catch {
    if (message.includes(SIWE_MARKER)) risks.push('siwe-malformed')
    return
  }
}

export function parseMessageRequest(
  method: MessageSigningMethod,
  params: unknown,
  options: MessageRequestOptions
): ParsedMessageRequest {
  const normalizedParams = normalizeParams(method, params, options.account)
  const [address, message] = normalizedParams

  if (typeof address !== 'string' || address.toLowerCase() !== options.account.toLowerCase()) {
    throw invalidParams('signing address must be the selected account')
  }

  const normalizedMessage = normalizeMessage(message)
  const risks: MessageSigningRisk[] = []
  if (method === 'eth_sign') risks.push('legacy-eth-sign')
  if (normalizedMessage.encoding === 'hex') risks.push('opaque-message')

  const siwe =
    normalizedMessage.encoding === 'utf8'
      ? parseSiwe(normalizedMessage.decodedMessage, options, risks)
      : undefined

  return {
    params: normalizedParams,
    rawMessage: normalizedMessage.rawMessage,
    decodedMessage: normalizedMessage.decodedMessage,
    context: {
      method,
      requestChainId: options.requestChainId,
      origin: options.origin,
      encoding: normalizedMessage.encoding,
      byteLength: normalizedMessage.byteLength,
      risks,
      ...(siwe !== undefined && { siwe })
    }
  }
}
