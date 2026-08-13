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
  status: 'partial',
  files: [
    {
      name: 'metadata.json',
      path: '',
      content: JSON.stringify({
        output: {
          abi: mockAbi,
          devdoc: { title: 'mock sourcify abi' }
        }
      })
    }
  ]
}

const sourcifyNotFoundResponse = {
  error: 'Files have not been found!'
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
  const endpoint = `/server/files/any/137/${contractAddress}`

  const mockSourcifyApi = (status, response, delay) => {
    mockApiResponse(domain, endpoint, status, response, delay)
  }

  it('retrieves a contract from sourcify', async () => {
    mockSourcifyApi(200, sourcifyResponse)

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toStrictEqual({
      abi: JSON.stringify(mockAbi),
      name: 'mock sourcify abi',
      source: 'sourcify'
    })
  })

  it('does not retrieve a contract when the request fails', async () => {
    mockSourcifyApi(400)

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract when the contract is not found', async () => {
    mockSourcifyApi(200, sourcifyNotFoundResponse)

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('does not throw when Sourcify returns a malformed files field', async () => {
    mockSourcifyApi(200, { status: 'partial', files: { unexpected: true } })

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()
  })

  it('selects metadata.json when source files appear first', async () => {
    mockSourcifyApi(200, {
      ...sourcifyResponse,
      files: [
        { name: 'Contract.sol', path: 'contracts/Contract.sol', content: 'contract Contract {}' },
        ...sourcifyResponse.files
      ]
    })

    return expect(fetchSourcifyContract(contractAddress, 137)).resolves.toMatchObject({
      name: 'mock sourcify abi',
      source: 'sourcify'
    })
  })

  it('does not retrieve a contract when the request times out', async () => {
    mockSourcifyApi(200, sourcifyResponse, 10000)

    const contract = expect(fetchSourcifyContract(contractAddress, 137)).resolves.toBeUndefined()

    jest.advanceTimersByTime(4000)

    return contract
  })
})
