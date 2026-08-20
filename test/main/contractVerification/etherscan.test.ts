import {
  createEtherscanV2Client,
  ETHERSCAN_V2_URL,
  EtherscanClientError,
  FETCH_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  type EtherscanVerificationInput
} from '../../../main/contractVerification/etherscan'

const API_KEY = 'Abcdefghijklmnop_1234567890'
const ADDRESS = `0x${'12'.repeat(20)}`
const GUID = 'a7lpxkm9kpcpicx7daftmjifrfhiuhf5vqqnawhkfhzfrcpnxj'

const solidityInput = (overrides: Partial<EtherscanVerificationInput> = {}): EtherscanVerificationInput => ({
  chainId: 1,
  compilerVersion: 'v0.8.24+commit.e11b9ed9',
  constructorArguments: '00ff',
  contractAddress: ADDRESS,
  contractIdentifier: 'contracts/Verified.sol:Verified',
  evmVersion: 'shanghai',
  language: 'Solidity',
  licenseType: 3,
  optimization: { runs: 200, used: true },
  standardJsonInput: {
    language: 'Solidity',
    sources: { 'contracts/Verified.sol': { content: 'contract Verified {}' } },
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  ...overrides
})

const vyperInput = (): EtherscanVerificationInput => ({
  chainId: 11155111,
  compilerVersion: 'vyper:0.4.0',
  constructorArguments: '',
  contractAddress: ADDRESS,
  contractIdentifier: 'contracts/Verified.vy:Verified',
  language: 'Vyper',
  optimization: { runs: 0, used: false },
  standardJsonInput: {
    language: 'Vyper',
    sources: { 'contracts/Verified.vy': { content: '@external\ndef value(): return 1' } },
    settings: {}
  }
})

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init
  })

const acceptedResponse = () => jsonResponse({ status: '1', message: 'OK', result: GUID })

test('submits Solidity using the documented query and form-body split', async () => {
  const fetchImpl = jest.fn(async () => acceptedResponse()) as unknown as typeof fetch
  const input = solidityInput()

  await expect(createEtherscanV2Client(fetchImpl).submit(input, API_KEY)).resolves.toEqual({
    status: 'accepted',
    guid: GUID
  })

  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const [url, options] = (fetchImpl as jest.Mock).mock.calls[0]
  const requestUrl = new URL(String(url))
  expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(ETHERSCAN_V2_URL)
  expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
    action: 'verifysourcecode',
    apikey: API_KEY,
    chainid: '1',
    module: 'contract'
  })
  expect(String(url)).not.toContain(ADDRESS)
  expect(String(url)).not.toContain('Verified.sol')
  expect(options).toEqual(
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      signal: expect.any(AbortSignal)
    })
  )
  const form = new URLSearchParams(String(options.body))
  expect(Object.fromEntries(form)).toMatchObject({
    codeformat: 'solidity-standard-json-input',
    compilerversion: 'v0.8.24+commit.e11b9ed9',
    constructorArguments: '00ff',
    contractaddress: ADDRESS,
    contractname: 'contracts/Verified.sol:Verified',
    evmVersion: 'shanghai',
    licenseType: '3',
    optimizationUsed: '1',
    runs: '200'
  })
  expect(JSON.parse(form.get('sourceCode') || '')).toEqual(input.standardJsonInput)
})

test('submits Vyper JSON using only the fields documented for the V2 Vyper endpoint', async () => {
  const fetchImpl = jest.fn(async () => acceptedResponse()) as unknown as typeof fetch

  await expect(createEtherscanV2Client(fetchImpl).submit(vyperInput(), API_KEY)).resolves.toEqual({
    status: 'accepted',
    guid: GUID
  })

  const form = new URLSearchParams(String((fetchImpl as jest.Mock).mock.calls[0][1].body))
  expect(form.get('codeformat')).toBe('vyper-json')
  expect(form.get('compilerversion')).toBe('vyper:0.4.0')
  expect(form.get('optimizationUsed')).toBe('0')
  expect(form.has('runs')).toBe(false)
  expect(form.has('evmVersion')).toBe(false)
  expect(form.has('licenseType')).toBe(false)
})

test('treats an already-verified response as idempotent success', async () => {
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ status: '0', message: 'NOTOK', result: 'Contract source code already verified' })
  ) as unknown as typeof fetch

  await expect(createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)).resolves.toEqual({
    status: 'already_verified'
  })
})

test('returns only fixed submission failures and does not retry a POST', async () => {
  const raw = `${ADDRESS} is invalid for source private contract Verified {}`
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ status: '0', message: 'NOTOK', result: raw })
  ) as unknown as typeof fetch

  const result = await createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)
  expect(result).toEqual({ status: 'rejected' })
  expect(JSON.stringify(result)).not.toContain(ADDRESS)
  expect(JSON.stringify(result)).not.toContain(raw)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('classifies transient submission failures as unavailable without exposing raw text', async () => {
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ status: '0', message: 'NOTOK', result: 'Max rate limit reached, try again' })
  ) as unknown as typeof fetch

  await expect(createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)).resolves.toEqual({
    status: 'unavailable'
  })
})

test('returns a fixed invalid-key result without exposing the key or upstream text', async () => {
  const raw = `Invalid API Key ${API_KEY}`
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ status: '0', message: 'NOTOK', result: raw })
  ) as unknown as typeof fetch

  const result = await createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)
  expect(result).toEqual({ status: 'invalid_api_key' })
  expect(JSON.stringify(result)).not.toContain(API_KEY)
  expect(JSON.stringify(result)).not.toContain(raw)
})

test.each([
  ['Pass - Verified', { status: 'verified' }],
  ['Already Verified', { status: 'verified' }],
  ['Pending in queue', { status: 'pending' }],
  ['In progress', { status: 'pending' }],
  ['Fail - Unable to verify', { status: 'rejected' }],
  ['Invalid API Key', { status: 'invalid_api_key' }],
  ['Max rate limit reached', { status: 'unavailable' }]
])('maps status result %s to a fixed outcome', async (rawResult, expected) => {
  const success = rawResult === 'Pass - Verified'
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ status: success ? '1' : '0', message: success ? 'OK' : 'NOTOK', result: rawResult })
  ) as unknown as typeof fetch

  await expect(createEtherscanV2Client(fetchImpl).status(1, GUID, API_KEY)).resolves.toEqual(expected)
})

test('checks status with the documented GET query and no request body', async () => {
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ status: '0', message: 'NOTOK', result: 'Pending in queue' })
  ) as unknown as typeof fetch

  await createEtherscanV2Client(fetchImpl).status(8453, GUID, API_KEY)

  const [url, options] = (fetchImpl as jest.Mock).mock.calls[0]
  const requestUrl = new URL(String(url))
  expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(ETHERSCAN_V2_URL)
  expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
    action: 'checkverifystatus',
    apikey: API_KEY,
    chainid: '8453',
    guid: GUID,
    module: 'contract'
  })
  expect(options).toEqual(
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: expect.any(AbortSignal)
    })
  )
  expect(options.body).toBeUndefined()
})

test.each([100, 747474])(
  'supports Wren network %s through the official Etherscan V2 endpoint',
  async (chainId) => {
    const fetchImpl = jest.fn(async () => acceptedResponse()) as unknown as typeof fetch

    await expect(
      createEtherscanV2Client(fetchImpl).submit(solidityInput({ chainId }), API_KEY)
    ).resolves.toEqual({ status: 'accepted', guid: GUID })

    const requestUrl = new URL(String((fetchImpl as jest.Mock).mock.calls[0][0]))
    expect(requestUrl.searchParams.get('chainid')).toBe(String(chainId))
  }
)

test.each([0, 56, 421614, 999999, Number.MAX_SAFE_INTEGER + 1])(
  'rejects unsupported chain %s before network access',
  async (chainId) => {
    const fetchImpl = jest.fn()
    await expect(
      createEtherscanV2Client(fetchImpl).submit(solidityInput({ chainId }), API_KEY)
    ).rejects.toMatchObject({
      code: 'invalid_chain'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  }
)

test.each(['short', 'contains a space 1234', 'punctuation!not-allowed', 'a'.repeat(129)])(
  'rejects malformed API key without exposing it in the error',
  async (apiKey) => {
    const fetchImpl = jest.fn()
    const promise = createEtherscanV2Client(fetchImpl).submit(solidityInput(), apiKey)
    await expect(promise).rejects.toBeInstanceOf(EtherscanClientError)
    await expect(promise).rejects.not.toThrow(apiKey)
    expect(fetchImpl).not.toHaveBeenCalled()
  }
)

test('rejects malformed source input and unsupported languages with fixed errors', async () => {
  const fetchImpl = jest.fn()
  const client = createEtherscanV2Client(fetchImpl)

  await expect(
    client.submit(solidityInput({ standardJsonInput: '{private source' }), API_KEY)
  ).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(
    client.submit(solidityInput({ language: 'Yul' as 'Solidity' }), API_KEY)
  ).rejects.toMatchObject({ code: 'unsupported_language' })
  await expect(
    client.submit(
      { ...solidityInput(), secretExtra: 'must not be accepted' } as EtherscanVerificationInput,
      API_KEY
    )
  ).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(client.submit(solidityInput({ contractAddress: '0x1234' }), API_KEY)).rejects.toMatchObject({
    code: 'invalid_input'
  })
  await expect(client.submit(solidityInput({ constructorArguments: '0x00' }), API_KEY)).rejects.toMatchObject(
    { code: 'invalid_input' }
  )
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('bounds the encoded request body before network access', async () => {
  const fetchImpl = jest.fn()
  const source = '\u0080'.repeat(3 * 1024 * 1024)
  const request = createEtherscanV2Client(fetchImpl).submit(
    solidityInput({
      standardJsonInput: {
        language: 'Solidity',
        sources: { 'Huge.sol': { content: source } },
        settings: {}
      }
    }),
    API_KEY
  )

  await expect(request).rejects.toMatchObject({ code: 'request_too_large' })
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(MAX_REQUEST_BYTES).toBe(16 * 1024 * 1024)
})

test('refuses redirects and requests redirect:error', async () => {
  const fetchImpl = jest.fn(async (_url, options) => {
    expect(options?.redirect).toBe('error')
    throw new TypeError('redirect blocked with secret details')
  }) as unknown as typeof fetch

  await expect(createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)).resolves.toEqual({
    status: 'unavailable'
  })
})

test('does not return a key-bearing request URL from transport failures', async () => {
  let rawFailure = ''
  const fetchImpl = jest.fn(async (url) => {
    rawFailure = `transport failed for ${String(url)}`
    throw new Error(rawFailure)
  }) as unknown as typeof fetch

  const result = await createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)

  expect(rawFailure).toContain(API_KEY)
  expect(result).toEqual({ status: 'unavailable' })
  expect(JSON.stringify(result)).not.toContain(API_KEY)
  expect(JSON.stringify(result)).not.toContain(rawFailure)
})

test('keeps the ten-second timeout active through response body reading', async () => {
  jest.useFakeTimers()
  const fetchImpl = jest.fn(async (_url, options) => {
    const signal = options?.signal
    return new Response(
      new ReadableStream({
        start(stream) {
          signal?.addEventListener('abort', () => stream.error(new Error('raw timeout detail')), {
            once: true
          })
        }
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  }) as unknown as typeof fetch

  try {
    const request = createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)
    await Promise.resolve()
    jest.advanceTimersByTime(FETCH_TIMEOUT_MS)
    await expect(request).resolves.toEqual({ status: 'unavailable' })
  } finally {
    jest.useRealTimers()
  }
})

test('rejects oversized, malformed, non-JSON, and non-strict responses', async () => {
  const responses = [
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_RESPONSE_BYTES + 1) }
    }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), {
      headers: { 'content-type': 'application/json' }
    }),
    new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    jsonResponse({ status: '1', message: 'OK', result: GUID, extra: 'not allowed' }),
    jsonResponse({ status: 1, message: 'OK', result: GUID })
  ]

  for (const response of responses) {
    const fetchImpl = jest.fn(async () => response) as unknown as typeof fetch
    await expect(createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)).resolves.toEqual({
      status: 'unavailable'
    })
  }
})

test('rejects a response reported as redirected even when a fetch mock returns it', async () => {
  const response = acceptedResponse()
  Object.defineProperty(response, 'redirected', { value: true })
  Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/result' })
  const fetchImpl = jest.fn(async () => response) as unknown as typeof fetch

  await expect(createEtherscanV2Client(fetchImpl).submit(solidityInput(), API_KEY)).resolves.toEqual({
    status: 'unavailable'
  })
})

test('rejects invalid GUIDs before status network access', async () => {
  const fetchImpl = jest.fn()
  await expect(createEtherscanV2Client(fetchImpl).status(1, '../raw-guid', API_KEY)).rejects.toMatchObject({
    code: 'invalid_guid'
  })
  expect(fetchImpl).not.toHaveBeenCalled()
})
