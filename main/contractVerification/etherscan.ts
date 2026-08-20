const ETHERSCAN_V2_URL = 'https://api.etherscan.io/v2/api'
const FETCH_TIMEOUT_MS = 10_000
const MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_RESPONSE_RESULT_LENGTH = 4096
const MAX_SOURCE_COUNT = 1024
const MAX_SOURCE_PATH_LENGTH = 1024
const MAX_SOURCE_CONTENT_LENGTH = 8 * 1024 * 1024
const MAX_TOTAL_SOURCE_CONTENT_LENGTH = 12 * 1024 * 1024
const MAX_CONSTRUCTOR_ARGUMENTS_LENGTH = 2 * 1024 * 1024

const SUPPORTED_CHAIN_IDS = new Set([1, 10, 100, 137, 8453, 42161, 84532, 747474, 11155111, 11155420])

export type EtherscanVerificationLanguage = 'Solidity' | 'Vyper'

export type EtherscanVerificationInput = Readonly<{
  chainId: number
  compilerVersion: string
  constructorArguments?: string
  contractAddress: string
  contractIdentifier: string
  evmVersion?: string
  language: EtherscanVerificationLanguage
  licenseType?: number
  optimization: Readonly<{
    runs: number
    used: boolean
  }>
  standardJsonInput: unknown
}>

export type EtherscanSubmitResult =
  | Readonly<{ status: 'accepted'; guid: string }>
  | Readonly<{ status: 'already_verified' }>
  | Readonly<{ status: 'invalid_api_key' }>
  | Readonly<{ status: 'rejected' }>
  | Readonly<{ status: 'unavailable' }>

export type EtherscanVerificationStatus =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'verified' }>
  | Readonly<{ status: 'invalid_api_key' }>
  | Readonly<{ status: 'rejected' }>
  | Readonly<{ status: 'unavailable' }>

export class EtherscanClientError extends Error {
  readonly code:
    | 'invalid_api_key'
    | 'invalid_chain'
    | 'invalid_guid'
    | 'invalid_input'
    | 'request_too_large'
    | 'unsupported_language'

  constructor(code: EtherscanClientError['code']) {
    super(`Etherscan client ${code.replaceAll('_', ' ')}`)
    this.name = 'EtherscanClientError'
    this.code = code
  }
}

type FetchLike = typeof fetch

type EtherscanResponse = Readonly<{
  message: string
  result: string
  status: '0' | '1'
}>

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasOnlyKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>) =>
  Object.keys(value).every((key) => allowed.has(key))

const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })

const validateApiKey = (apiKey: string) => {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(apiKey)) {
    throw new EtherscanClientError('invalid_api_key')
  }
}

const validateChainId = (chainId: number) => {
  if (!Number.isSafeInteger(chainId) || !SUPPORTED_CHAIN_IDS.has(chainId)) {
    throw new EtherscanClientError('invalid_chain')
  }
}

const validateGuid = (guid: string) => {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(guid)) throw new EtherscanClientError('invalid_guid')
}

const validateContractAddress = (address: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) throw new EtherscanClientError('invalid_input')
}

const validateContractIdentifier = (identifier: string) => {
  if (identifier.length > 1024 || !/^[A-Za-z0-9_@./$+~ -]+:[A-Za-z_$][A-Za-z0-9_$]*$/u.test(identifier)) {
    throw new EtherscanClientError('invalid_input')
  }
}

const validateCompilerVersion = (language: EtherscanVerificationLanguage, version: string) => {
  const valid =
    language === 'Solidity'
      ? /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\+commit\.[0-9a-fA-F]{8}(?:\.[0-9A-Za-z.-]+)?$/u.test(version)
      : /^vyper:\d+\.\d+\.\d+(?:[+.-][0-9A-Za-z.-]+)?$/u.test(version)
  if (!valid || version.length > 128) throw new EtherscanClientError('invalid_input')
}

const validateSource = (source: unknown) => {
  if (!isPlainObject(source)) throw new EtherscanClientError('invalid_input')
  if (!hasOnlyKeys(source, new Set(['content', 'keccak256', 'urls']))) {
    throw new EtherscanClientError('invalid_input')
  }
  if (typeof source['content'] !== 'string') {
    throw new EtherscanClientError('invalid_input')
  }
  const contentBytes = new TextEncoder().encode(source['content']).byteLength
  if (contentBytes > MAX_SOURCE_CONTENT_LENGTH) throw new EtherscanClientError('request_too_large')
  if (
    source['keccak256'] !== undefined &&
    (typeof source['keccak256'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(source['keccak256']))
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  if (
    source['urls'] !== undefined &&
    (!Array.isArray(source['urls']) ||
      source['urls'].length > 16 ||
      source['urls'].some((url) => typeof url !== 'string' || url.length < 1 || url.length > 2048))
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  return contentBytes
}

const validateStandardJsonInput = (language: EtherscanVerificationLanguage, input: unknown) => {
  let parsed: unknown = input
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input)
    } catch {
      throw new EtherscanClientError('invalid_input')
    }
  }
  if (!isPlainObject(parsed)) throw new EtherscanClientError('invalid_input')
  const allowedKeys =
    language === 'Vyper'
      ? new Set(['language', 'settings', 'sources', 'storage_layout_overrides'])
      : new Set(['language', 'settings', 'sources'])
  if (!hasOnlyKeys(parsed, allowedKeys) || parsed['language'] !== language) {
    throw new EtherscanClientError('invalid_input')
  }
  if (!isPlainObject(parsed['sources']) || !isPlainObject(parsed['settings'])) {
    throw new EtherscanClientError('invalid_input')
  }
  const sourceEntries = Object.entries(parsed['sources'])
  if (sourceEntries.length < 1 || sourceEntries.length > MAX_SOURCE_COUNT) {
    throw new EtherscanClientError('invalid_input')
  }
  let totalSourceLength = 0
  for (const [sourcePath, source] of sourceEntries) {
    if (
      sourcePath.length < 1 ||
      sourcePath.length > MAX_SOURCE_PATH_LENGTH ||
      hasControlCharacter(sourcePath)
    ) {
      throw new EtherscanClientError('invalid_input')
    }
    totalSourceLength += validateSource(source)
    if (totalSourceLength > MAX_TOTAL_SOURCE_CONTENT_LENGTH) {
      throw new EtherscanClientError('request_too_large')
    }
  }
  try {
    return JSON.stringify(parsed)
  } catch {
    throw new EtherscanClientError('invalid_input')
  }
}

const validateInput = (input: EtherscanVerificationInput) => {
  if (!isPlainObject(input)) throw new EtherscanClientError('invalid_input')
  if (
    !hasOnlyKeys(
      input,
      new Set([
        'chainId',
        'compilerVersion',
        'constructorArguments',
        'contractAddress',
        'contractIdentifier',
        'evmVersion',
        'language',
        'licenseType',
        'optimization',
        'standardJsonInput'
      ])
    )
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  if (input.language !== 'Solidity' && input.language !== 'Vyper') {
    throw new EtherscanClientError('unsupported_language')
  }
  validateChainId(input.chainId)
  validateContractAddress(input.contractAddress)
  validateContractIdentifier(input.contractIdentifier)
  validateCompilerVersion(input.language, input.compilerVersion)
  if (
    !isPlainObject(input.optimization) ||
    !hasOnlyKeys(input.optimization, new Set(['runs', 'used'])) ||
    typeof input.optimization.used !== 'boolean' ||
    !Number.isSafeInteger(input.optimization.runs) ||
    input.optimization.runs < 0 ||
    input.optimization.runs > 0xffffffff
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  if (
    input.constructorArguments !== undefined &&
    (input.constructorArguments.length > MAX_CONSTRUCTOR_ARGUMENTS_LENGTH ||
      !/^(?:[0-9a-fA-F]{2})*$/u.test(input.constructorArguments))
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  if (
    input.evmVersion !== undefined &&
    (input.evmVersion.length < 1 ||
      input.evmVersion.length > 64 ||
      !/^(?:default|[a-z][a-z0-9_-]*)$/u.test(input.evmVersion))
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  if (
    input.licenseType !== undefined &&
    (!Number.isSafeInteger(input.licenseType) || input.licenseType < 1 || input.licenseType > 14)
  ) {
    throw new EtherscanClientError('invalid_input')
  }
  return validateStandardJsonInput(input.language, input.standardJsonInput)
}

const createBody = (entries: ReadonlyArray<readonly [string, string]>) => {
  const params = new URLSearchParams()
  for (const [name, value] of entries) params.append(name, value)
  const body = params.toString()
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    throw new EtherscanClientError('request_too_large')
  }
  return body
}

const readBoundedResponse = async (response: Response, signal: AbortSignal, expectedUrl: string) => {
  if (response.redirected || (response.url !== '' && response.url !== expectedUrl)) {
    await response.body?.cancel()
    return undefined
  }
  if (!response.ok) {
    await response.body?.cancel()
    return undefined
  }
  const contentType = response.headers.get('content-type') || ''
  if (!/^application\/json(?:\s*;.*)?$/iu.test(contentType)) {
    await response.body?.cancel()
    return undefined
  }
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel()
      return undefined
    }
  }
  if (!response.body) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      if (signal.aborted) return undefined
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return undefined
      }
      chunks.push(chunk.value)
    }
  } catch {
    return undefined
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return undefined
  }
  if (!isPlainObject(parsed) || !hasOnlyKeys(parsed, new Set(['message', 'result', 'status']))) {
    return undefined
  }
  if (
    (parsed['status'] !== '0' && parsed['status'] !== '1') ||
    typeof parsed['message'] !== 'string' ||
    parsed['message'].length < 1 ||
    parsed['message'].length > 256 ||
    typeof parsed['result'] !== 'string' ||
    parsed['result'].length < 1 ||
    parsed['result'].length > MAX_RESPONSE_RESULT_LENGTH
  ) {
    return undefined
  }
  return parsed as EtherscanResponse
}

const request = async (
  url: string,
  options: RequestInit,
  fetchImpl: FetchLike
): Promise<EtherscanResponse | undefined> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: controller.signal
    })
    return await readBoundedResponse(response, controller.signal, url)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

const isAlreadyVerified = (result: string) => /already\s+verified/iu.test(result)
const isInvalidApiKey = (response: EtherscanResponse) =>
  /invalid api key/iu.test(response.result) || /invalid api key/iu.test(response.message)
const isUnavailableResult = (result: string) =>
  /(?:rate\s*limit|temporar(?:y|ily)|timeout|try\s+again|unavailable|busy)/iu.test(result)

export const createEtherscanV2Client = (fetchImpl: FetchLike = fetch) => {
  const submit = async (
    input: EtherscanVerificationInput,
    apiKey: string
  ): Promise<EtherscanSubmitResult> => {
    validateApiKey(apiKey)
    const sourceCode = validateInput(input)
    const fields: Array<readonly [string, string]> = [
      ['contractaddress', input.contractAddress],
      ['sourceCode', sourceCode],
      ['codeformat', input.language === 'Solidity' ? 'solidity-standard-json-input' : 'vyper-json'],
      ['contractname', input.contractIdentifier],
      ['compilerversion', input.compilerVersion],
      ['optimizationUsed', input.optimization.used ? '1' : '0'],
      ['constructorArguments', input.constructorArguments || '']
    ]
    if (input.language === 'Solidity') {
      fields.push(
        ['runs', String(input.optimization.runs)],
        ['evmVersion', input.evmVersion || 'default'],
        ['licenseType', String(input.licenseType || 1)]
      )
    }
    const body = createBody(fields)
    const query = new URLSearchParams({
      apikey: apiKey,
      chainid: String(input.chainId),
      module: 'contract',
      action: 'verifysourcecode'
    })
    const url = `${ETHERSCAN_V2_URL}?${query.toString()}`
    const response = await request(
      url,
      {
        body,
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        method: 'POST'
      },
      fetchImpl
    )
    if (!response) return { status: 'unavailable' }
    if (isInvalidApiKey(response)) return { status: 'invalid_api_key' }
    if (isAlreadyVerified(response.result)) return { status: 'already_verified' }
    if (
      response.status === '1' &&
      response.message.toUpperCase() === 'OK' &&
      /^[A-Za-z0-9_-]{8,128}$/u.test(response.result)
    ) {
      return { status: 'accepted', guid: response.result }
    }
    if (isUnavailableResult(response.result)) return { status: 'unavailable' }
    return { status: 'rejected' }
  }

  const status = async (
    chainId: number,
    guid: string,
    apiKey: string
  ): Promise<EtherscanVerificationStatus> => {
    validateApiKey(apiKey)
    validateChainId(chainId)
    validateGuid(guid)
    const query = new URLSearchParams({
      apikey: apiKey,
      chainid: String(chainId),
      module: 'contract',
      action: 'checkverifystatus',
      guid
    })
    const url = `${ETHERSCAN_V2_URL}?${query.toString()}`
    const response = await request(url, { headers: { accept: 'application/json' }, method: 'GET' }, fetchImpl)
    if (!response) return { status: 'unavailable' }
    if (isInvalidApiKey(response)) return { status: 'invalid_api_key' }
    if (isAlreadyVerified(response.result) || /^pass\s*-\s*verified$/iu.test(response.result)) {
      return { status: 'verified' }
    }
    if (/pending|queue|in progress/iu.test(response.result)) return { status: 'pending' }
    if (isUnavailableResult(response.result)) {
      return { status: 'unavailable' }
    }
    return { status: 'rejected' }
  }

  return Object.freeze({ status, submit })
}

export { ETHERSCAN_V2_URL, FETCH_TIMEOUT_MS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES }
