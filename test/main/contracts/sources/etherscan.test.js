import log from 'electron-log'

import { fetchEtherscanContract } from '../../../../main/contracts/sources/etherscan'

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

describe('#fetchEtherscanContract', () => {
  const contractAddress = '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0'
  const apiKey = '3SYU5MW5QK8RPCJV1XVICHWKT774993S24'
  const getPath = (chainId, address = contractAddress) =>
    `/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`

  const mockEtherscanApi = (chainId, status, response, timeout, address) => {
    return mockApiResponse('api.etherscan.io', getPath(chainId, address), status, response, timeout)
  }

  const chains = [
    { chainId: 1, source: 'etherscan.io' },
    { chainId: 10, source: 'optimistic.etherscan.io' },
    { chainId: 137, source: 'polygonscan.com' },
    { chainId: 42161, source: 'arbiscan.io' }
  ]

  chains.forEach((chain) => {
    it(`retrieves a contract for ${chain.source} through the unified API v2 endpoint`, async () => {
      mockEtherscanApi(chain.chainId, 200, {
        status: '1',
        message: 'OK',
        result: [
          {
            ABI: JSON.stringify(mockAbi),
            ContractName: `mock ${chain.source} abi`
          }
        ]
      })

      return expect(fetchEtherscanContract(contractAddress, chain.chainId)).resolves.toStrictEqual({
        abi: JSON.stringify(mockAbi),
        name: `mock ${chain.source} abi`,
        source: chain.source
      })
    })
  })

  it('resolves a verified proxy implementation through bounded API v2 reads', async () => {
    const implementation = '0x1111111111111111111111111111111111111111'
    mockEtherscanApi(1, 200, {
      status: '1',
      message: 'OK',
      result: [{ ABI: '[]', ContractName: 'Proxy', Implementation: implementation }]
    })
    mockEtherscanApi(
      1,
      200,
      {
        status: '1',
        message: 'OK',
        result: [{ ABI: JSON.stringify(mockAbi), ContractName: 'Implementation' }]
      },
      0,
      implementation
    )

    return expect(fetchEtherscanContract(contractAddress, 1)).resolves.toStrictEqual({
      abi: JSON.stringify(mockAbi),
      name: 'Implementation',
      source: 'etherscan.io'
    })
  })

  it('fails closed on invalid or cyclic proxy implementation data', async () => {
    mockEtherscanApi(1, 200, {
      status: '1',
      message: 'OK',
      result: [{ ABI: '[]', ContractName: 'Proxy', Implementation: 'not-an-address' }]
    })
    await expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()

    const implementation = '0x1111111111111111111111111111111111111111'
    mockEtherscanApi(1, 200, {
      status: '1',
      message: 'OK',
      result: [{ ABI: '[]', ContractName: 'Proxy', Implementation: implementation }]
    })
    mockEtherscanApi(
      1,
      200,
      {
        status: '1',
        message: 'OK',
        result: [{ ABI: '[]', ContractName: 'Implementation', Implementation: contractAddress }]
      },
      0,
      implementation
    )

    return expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract when the API request fails', async () => {
    mockEtherscanApi(1, 400)

    return expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()
  })

  it('rejects deprecated/error responses and malformed results', async () => {
    mockEtherscanApi(1, 200, {
      status: '0',
      message: 'NOTOK',
      result: 'You are using a deprecated V1 endpoint'
    })
    await expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()

    mockEtherscanApi(1, 200, { status: '1', message: 'OK', result: undefined })
    return expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract when the ABI or name is invalid', async () => {
    mockEtherscanApi(1, 200, {
      status: '1',
      message: 'OK',
      result: [{ ABI: 'Contract source code not verified', ContractName: '' }]
    })
    await expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()

    mockEtherscanApi(1, 200, {
      status: '1',
      message: 'OK',
      result: [{ ABI: '{malformed', ContractName: 'Broken' }]
    })
    await expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()

    mockEtherscanApi(1, 200, {
      status: '1',
      message: 'OK',
      result: [{ ABI: JSON.stringify(mockAbi), ContractName: '  ' }]
    })
    return expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract from an unsupported chain', async () => {
    await expect(fetchEtherscanContract(contractAddress, 4)).resolves.toBeUndefined()
    return expect(fetchEtherscanContract('not-an-address', 1)).resolves.toBeUndefined()
  })

  it('does not retrieve a contract when the request times out', async () => {
    mockEtherscanApi(
      1,
      200,
      {
        status: '1',
        message: 'OK',
        result: [{ ABI: JSON.stringify(mockAbi), ContractName: 'mock etherscan abi' }]
      },
      10000
    )

    const contract = expect(fetchEtherscanContract(contractAddress, 1)).resolves.toBeUndefined()

    jest.advanceTimersByTime(4000)

    return contract
  })
})
