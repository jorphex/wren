import log from 'electron-log'

import { fetchSourcifyContract } from '../../../../main/contracts/sources/sourcify'

let fetchMock

function mockApiResponse(
  domain,
  path,
  status,
  body,
  timeout = 0,
  headers = { 'content-type': 'application/json' }
) {
  const endpoint = `https://${domain}${path}`

  if (timeout) {
    fetchMock.mockImplementationOnce((url, { signal }) => {
      if (url !== endpoint) return Promise.reject(new Error(`Unexpected URL: ${url}`))

      return new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('This operation was aborted', 'AbortError')),
          { once: true }
        )
      })
    })
    return
  }

  fetchMock.mockImplementationOnce((url) => {
    if (url !== endpoint) return Promise.reject(new Error(`Unexpected URL: ${url}`))

    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers })
    )
  })
}

const mockAbi = [
  {
    inputs: [],
    name: 'retrieve',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint256', name: 'num', type: 'uint256' }],
    name: 'store',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

const sourcifyResponse = {
  match: 'exact_match',
  abi: mockAbi,
  devdoc: { title: 'mock sourcify abi' },
  compilation: {
    name: 'MockContract',
    fullyQualifiedName: 'contracts/MockContract.sol:MockContract'
  }
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  log.transports.console.level = false
})

beforeEach(() => {
  fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected fetch request'))
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

afterEach(() => {
  fetchMock.mockRestore()
})

describe('#fetchSourcifyContract', () => {
  const contractAddress = '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0'
  const domain = 'sourcify.dev'
  const endpoint = `/server/v2/contract/137/${contractAddress}?fields=abi,devdoc,compilation`

  const mockSourcifyApi = (status, response, delay, headers) => {
    mockApiResponse(domain, endpoint, status, response, delay, headers)
  }

  it('retrieves an exact-match contract through Sourcify API v2', async () => {
    mockSourcifyApi(200, sourcifyResponse)

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toStrictEqual({
      abi: JSON.stringify(mockAbi),
      name: 'mock sourcify abi',
      source: 'sourcify'
    })
  })

  it('accepts a non-exact match and falls back to the compiler contract name', async () => {
    mockSourcifyApi(200, {
      ...sourcifyResponse,
      match: 'match',
      devdoc: {}
    })

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toMatchObject({
      name: 'MockContract',
      source: 'sourcify'
    })
  })

  it('falls back to the fully qualified name when other names are absent', async () => {
    mockSourcifyApi(200, {
      ...sourcifyResponse,
      devdoc: {},
      compilation: { fullyQualifiedName: 'contracts/MockContract.sol:MockContract' }
    })

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toMatchObject({
      name: 'MockContract'
    })
  })

  it('does not retrieve a contract when the request fails', async () => {
    mockSourcifyApi(404)

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('does not request malformed addresses or chain IDs', async () => {
    await expect(fetchSourcifyContract('not-an-address', 137)).resolves.toBeUndefined()
    await expect(fetchSourcifyContract(contractAddress, 0)).resolves.toBeUndefined()
    return expect(fetchSourcifyContract(contractAddress, Number.NaN)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract without a verified match', async () => {
    mockSourcifyApi(200, { ...sourcifyResponse, match: null })

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract with a malformed ABI or missing name', async () => {
    mockSourcifyApi(200, { ...sourcifyResponse, abi: { unexpected: true } })
    await expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()

    mockSourcifyApi(200, { match: 'match', abi: mockAbi, devdoc: {}, compilation: {} })
    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('does not parse a non-JSON response', async () => {
    mockSourcifyApi(200, sourcifyResponse, 0, { 'content-type': 'text/html' })

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract when the request times out', async () => {
    mockSourcifyApi(200, sourcifyResponse, 10000)

    const contract = expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()

    jest.advanceTimersByTime(4000)

    return contract
  })
})
