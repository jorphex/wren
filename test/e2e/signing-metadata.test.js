import { Interface } from 'ethers'
import { loadSigningMetadata } from '../../main/reveal/signingMetadata'
import { createDappClient, startJsonRpcFixture, TARGET } from './support/harness'

const spender = '0x3333333333333333333333333333333333333333'
const abi = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
])
let upstream

afterEach(async () => upstream?.close())

async function fixture(overrides = {}) {
  const chains = []
  upstream = await startJsonRpcFixture(({ method, params }) => {
    if (method === 'eth_getCode') return { result: '0x60006000' }
    const fn = abi.getFunction(params[0].data.slice(0, 10)).name
    if (overrides[fn] === null) return { error: { code: -32000, message: 'reverted' } }
    return {
      result: abi.encodeFunctionResult(fn, [
        overrides[fn] ?? { decimals: 6, symbol: 'USDC', name: 'USD Coin' }[fn]
      ])
    }
  })
  const client = createDappClient(upstream.url, 'https://metadata-test.invalid')
  return {
    chains,
    rpc: (chain, method, params) => {
      chains.push(chain)
      return client.request(method, params)
    },
    fetchContract: async (address, chain, codeHash) => {
      expect(address).toBe(spender)
      expect(chain).toBe(4663)
      expect(codeHash).toMatch(/^0x[0-9a-f]{64}$/u)
      return { name: 'SwapRouter', source: 'sourcify', abi: '[]' }
    }
  }
}

it('reads unknown token units and a source-backed spender name on the requested chain', async () => {
  const deps = await fixture()
  const metadata = await loadSigningMetadata(
    4663,
    { tokens: [TARGET, TARGET.toUpperCase().replace('0X', '0x')], spender },
    deps
  )
  expect(metadata.tokens).toEqual([
    { address: TARGET, chainId: 4663, decimals: 6, symbol: 'USDC', name: 'USD Coin' }
  ])
  expect(metadata.spender).toEqual({
    address: spender,
    contractName: 'SwapRouter',
    contractSource: 'sourcify'
  })
  expect(deps.chains.every((chain) => chain === 4663)).toBe(true)
  expect(upstream.requests.filter(({ payload }) => payload.method === 'eth_call')).toHaveLength(3)
})

it('keeps decimals absent when the token reverts, and does not invent a name', async () => {
  const deps = await fixture({ decimals: null })
  deps.fetchContract = async () => undefined
  const metadata = await loadSigningMetadata(4663, { tokens: [TARGET], spender }, deps)
  expect(metadata.tokens[0].decimals).toBeUndefined()
  expect(metadata.spender).toBeUndefined()
})

it('does not call source services for an account without contract code', async () => {
  const deps = await fixture()
  deps.rpc = (_chain, method) => {
    expect(method).toBe('eth_getCode')
    return Promise.resolve('0x')
  }
  deps.fetchContract = () => {
    throw new Error('Source lookup should not run')
  }
  expect((await loadSigningMetadata(4663, { tokens: [], spender }, deps)).spender).toBeUndefined()
})

it('rejects invalid chains and addresses without issuing requests', async () => {
  const deps = {
    rpc: () => {
      throw new Error('Unexpected RPC')
    },
    fetchContract: () => {
      throw new Error('Unexpected source request')
    }
  }
  expect(await loadSigningMetadata(0, { tokens: [TARGET], spender }, deps)).toEqual({ tokens: [] })
  expect(await loadSigningMetadata(4663, { tokens: ['invalid'], spender: 'invalid' }, deps)).toEqual({
    tokens: []
  })
})

it('bounds unresponsive RPC and source reads without failing the review', async () => {
  jest.useFakeTimers()
  try {
    const pending = loadSigningMetadata(
      4663,
      { tokens: [TARGET], spender },
      {
        rpc: () => new Promise(() => {}),
        fetchContract: () => new Promise(() => {})
      }
    )
    await jest.advanceTimersByTimeAsync(5000)
    expect(await pending).toEqual({ tokens: [] })
  } finally {
    jest.useRealTimers()
  }
})
