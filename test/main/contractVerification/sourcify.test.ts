import {
  SOURCIFY_MAX_REQUEST_BYTES,
  SOURCIFY_MAX_RESPONSE_BYTES,
  SOURCIFY_SERVER,
  createSourcifyClient
} from '../../../main/contractVerification/sourcify'

const VERIFICATION_ID = '72d12273-0723-448e-a9f6-f7957128efa5'
const ERROR_ID = '1ac6b91a-0605-4459-93dc-18f210a70192'
const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'
const EXPECTED_TARGET = { chainId: 1, address: ADDRESS }

const submission = {
  chainId: 1,
  address: ADDRESS,
  stdJsonInput: { language: 'Solidity', sources: {}, settings: {} },
  compilerVersion: '0.8.30+commit.73712a01',
  contractIdentifier: 'contracts/Example.sol:Example'
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })
}

describe('Sourcify v2 client', () => {
  test('submits only to the fixed endpoint with redirect refusal and no retry', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ verificationId: VERIFICATION_ID }, 202)
    ) as jest.MockedFunction<typeof fetch>
    const client = createSourcifyClient({ fetchImpl })

    await expect(client.submit(submission)).resolves.toEqual({
      status: 'accepted',
      verificationId: VERIFICATION_ID
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      `${SOURCIFY_SERVER}/v2/verify/1/${ADDRESS}`,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: { accept: 'application/json', 'content-type': 'application/json' }
      })
    )
  })

  test('rejects invalid input before a request is made', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>
    const client = createSourcifyClient({ fetchImpl })

    await expect(client.submit({ ...submission, chainId: 0 })).resolves.toEqual({
      status: 'error',
      reason: 'invalid_request'
    })
    await expect(client.submit({ ...submission, address: ADDRESS.toUpperCase() })).resolves.toEqual({
      status: 'error',
      reason: 'invalid_request'
    })
    await expect(
      client.submit({ ...submission, creationTransactionHash: `0x${'A'.repeat(64)}` })
    ).resolves.toEqual({ status: 'error', reason: 'invalid_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('refuses request bodies over sixteen MiB', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>
    const client = createSourcifyClient({ fetchImpl })
    const oversized = 'x'.repeat(SOURCIFY_MAX_REQUEST_BYTES)

    await expect(client.submit({ ...submission, stdJsonInput: { source: oversized } })).resolves.toEqual({
      status: 'error',
      reason: 'request_too_large'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('recognizes only a valid already_verified conflict', async () => {
    const accepted = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({ customCode: 'already_verified', message: 'raw server text', errorId: ERROR_ID }, 409)
      )
    })
    await expect(accepted.submit(submission)).resolves.toEqual({ status: 'already_verified' })

    const malformed = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse(
          {
            customCode: 'already_verified',
            message: 'raw server text',
            errorId: ERROR_ID,
            unexpected: { secret: 'must not escape' }
          },
          409
        )
      )
    })
    await expect(malformed.submit(submission)).resolves.toEqual({
      status: 'error',
      reason: 'rejected'
    })
  })

  test('rejects malformed, extra, non-JSON, and redirect responses', async () => {
    const responses = [
      jsonResponse({ verificationId: 'not-a-uuid' }, 202),
      jsonResponse({ verificationId: VERIFICATION_ID, extra: true }, 202),
      new Response(JSON.stringify({ verificationId: VERIFICATION_ID }), {
        status: 202,
        headers: { 'content-type': 'text/plain' }
      }),
      new Response('', { status: 302, headers: { location: 'https://attacker.invalid' } })
    ]

    for (const response of responses) {
      const client = createSourcifyClient({ fetchImpl: jest.fn(async () => response) })
      const result = await client.submit(submission)
      expect(result).toEqual({ status: 'error', reason: 'invalid_response' })
    }
  })

  test('caps declared and chunked response bodies', async () => {
    const declared = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({}, 202, { 'content-length': String(SOURCIFY_MAX_RESPONSE_BYTES + 1) })
      )
    })
    await expect(declared.submit(submission)).resolves.toEqual({
      status: 'error',
      reason: 'invalid_response'
    })

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(SOURCIFY_MAX_RESPONSE_BYTES))
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      }
    })
    const chunked = createSourcifyClient({
      fetchImpl: jest.fn(
        async () => new Response(stream, { status: 202, headers: { 'content-type': 'application/json' } })
      )
    })
    await expect(chunked.submit(submission)).resolves.toEqual({
      status: 'error',
      reason: 'invalid_response'
    })
  })

  test('returns a bounded timeout and does not retry the POST', async () => {
    jest.useFakeTimers()
    const fetchImpl = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('sensitive request details'), { name: 'AbortError' }))
          )
        })
    ) as jest.MockedFunction<typeof fetch>
    const client = createSourcifyClient({ fetchImpl, timeoutMs: 5 })

    const result = client.submit(submission)
    jest.advanceTimersByTime(5)
    await expect(result).resolves.toEqual({ status: 'error', reason: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  test('keeps the deadline active through response body reading', async () => {
    jest.useFakeTimers()
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () =>
              controller.error(
                Object.assign(new Error('sensitive stalled response detail'), { name: 'AbortError' })
              ),
            { once: true }
          )
        }
      })
      return new Response(stream, { status: 202, headers: { 'content-type': 'application/json' } })
    }) as jest.MockedFunction<typeof fetch>
    const client = createSourcifyClient({ fetchImpl, timeoutMs: 5 })

    try {
      const result = client.submit(submission)
      await Promise.resolve()
      jest.advanceTimersByTime(5)
      await expect(result).resolves.toEqual({ status: 'error', reason: 'timeout' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  test.each([
    [429, 'rate_limited'],
    [500, 'service_unavailable'],
    [503, 'service_unavailable'],
    [400, 'rejected']
  ])('sanitizes HTTP %i submission failures', async (status, reason) => {
    const client = createSourcifyClient({
      fetchImpl: jest.fn(async () => new Response('private upstream detail', { status }))
    })
    await expect(client.submit(submission)).resolves.toEqual({ status: 'error', reason })
  })

  test('projects pending status without returning server fields', async () => {
    const client = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({
          isJobCompleted: false,
          verificationId: VERIFICATION_ID,
          jobStartTime: 'private timing',
          contract: { address: ADDRESS, chainId: '1' }
        })
      )
    })

    await expect(client.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({ status: 'pending' })
  })

  test('projects successful matches and keeps external destinations independent', async () => {
    const client = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({
          isJobCompleted: true,
          verificationId: VERIFICATION_ID,
          contract: {
            match: 'exact_match',
            creationMatch: 'match',
            runtimeMatch: 'exact_match',
            address: ADDRESS,
            chainId: '1'
          },
          externalVerifications: {
            etherscan: {
              verificationId: 'ether-guid',
              statusUrl:
                'https://api.etherscan.io/v2/api?chainid=1&module=contract&action=checkverifystatus&guid=ether-guid',
              explorerUrl: `https://etherscan.io/address/${ADDRESS}#code`
            },
            blockscout: { error: 'Connection timeout with private upstream detail' },
            routescan: {
              verificationId: 'route-guid',
              error: 'NOTOK: rejected',
              explorerUrl: `https://43114.routescan.io/address/${ADDRESS}/contract/1/code`
            },
            attacker: { explorerUrl: 'https://attacker.invalid/source' }
          }
        })
      )
    })

    await expect(client.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'succeeded',
      creationMatch: 'match',
      runtimeMatch: 'exact_match',
      externalVerifications: {
        etherscan: {
          verificationId: 'ether-guid',
          statusUrl: 'https://api.etherscan.io/v2/api',
          explorerUrl: `https://etherscan.io/address/${ADDRESS}#code`
        },
        blockscout: { error: 'unavailable' },
        routescan: {
          verificationId: 'route-guid',
          explorerUrl: `https://43114.routescan.io/address/${ADDRESS}/contract/1/code`,
          error: 'rejected'
        }
      }
    })
  })

  test('omits unsafe, credentialed, and unexpected-host URLs', async () => {
    const client = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({
          isJobCompleted: true,
          verificationId: VERIFICATION_ID,
          contract: {
            match: 'match',
            creationMatch: null,
            runtimeMatch: 'match',
            chainId: '1',
            address: ADDRESS
          },
          externalVerifications: {
            etherscan: {
              verificationId: 'ok',
              statusUrl: 'http://api.etherscan.io/v2/api',
              explorerUrl: 'https://etherscan.io.attacker.invalid/code'
            },
            blockscout: {
              statusUrl: 'https://user:password@eth.blockscout.com/api'
            },
            routescan: {
              explorerUrl: 'https://routescan.io/ok'
            }
          }
        })
      )
    })

    await expect(client.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'succeeded',
      creationMatch: null,
      runtimeMatch: 'match',
      externalVerifications: {
        etherscan: { verificationId: 'ok' },
        routescan: { explorerUrl: 'https://routescan.io/ok' }
      }
    })
  })

  test.each([
    ['no_match', 'no_match'],
    ['compiler_error', 'compiler_error'],
    ['unsupported_chain', 'unsupported_chain'],
    ['validation_error', 'invalid_source'],
    ['private_unexpected_error', 'verification_failed']
  ])('sanitizes completed failure %s', async (customCode, reason) => {
    const client = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({
          isJobCompleted: true,
          verificationId: VERIFICATION_ID,
          contract: {
            match: null,
            creationMatch: null,
            runtimeMatch: null,
            address: ADDRESS,
            chainId: '1'
          },
          error: {
            customCode,
            message: 'private source excerpt and compiler output',
            errorId: ERROR_ID
          }
        })
      )
    })
    await expect(client.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'failed',
      reason
    })
  })

  test('returns bounded unknown, unavailable, MIME, and mismatched-job results', async () => {
    const notFound = createSourcifyClient({
      fetchImpl: jest.fn(async () => new Response('private', { status: 404 }))
    })
    await expect(notFound.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'unknown',
      reason: 'not_found'
    })

    const unavailable = createSourcifyClient({
      fetchImpl: jest.fn(async () => new Response('', { status: 503 }))
    })
    await expect(unavailable.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'unavailable',
      reason: 'service_unavailable'
    })

    const wrongMime = createSourcifyClient({
      fetchImpl: jest.fn(async () => new Response('{}', { headers: { 'content-type': 'text/html' } }))
    })
    await expect(wrongMime.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response'
    })

    const mismatched = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({
          isJobCompleted: false,
          verificationId: '550e8400-e29b-41d4-a716-446655440000'
        })
      )
    })
    await expect(mismatched.status(VERIFICATION_ID, EXPECTED_TARGET)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response'
    })
  })

  test.each([
    [{ chainId: 10, address: ADDRESS }, '1', ADDRESS],
    [EXPECTED_TARGET, '1', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']
  ])('rejects a completed result for a different target', async (expected, chainId, address) => {
    const client = createSourcifyClient({
      fetchImpl: jest.fn(async () =>
        jsonResponse({
          isJobCompleted: true,
          verificationId: VERIFICATION_ID,
          contract: {
            match: 'exact_match',
            creationMatch: 'exact_match',
            runtimeMatch: 'exact_match',
            chainId,
            address
          }
        })
      )
    })

    await expect(client.status(VERIFICATION_ID, expected)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response'
    })
  })

  test('rejects an invalid expected target before polling', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>
    const client = createSourcifyClient({ fetchImpl })

    await expect(
      client.status(VERIFICATION_ID, { chainId: 1, address: ADDRESS.toUpperCase() })
    ).resolves.toEqual({ status: 'unavailable', reason: 'invalid_response' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
