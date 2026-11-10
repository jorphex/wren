import fs from 'fs'
import path from 'path'
import { Interface } from 'ethers'

import Account from '../../main/accounts/Account'
import store from '../../main/store'
import { loadSigningMetadata } from '../../main/reveal/signingMetadata'
import { createDappClient, startJsonRpcFixture, ACCOUNT, TARGET } from './support/harness'
import { waitUntil } from './support/issue105'

// Keep account publication and RPC real; replace desktop/device boundaries only.
jest.mock('../../main/accounts', () => ({ RequestMode: { Normal: 'normal', Monitor: 'monitor' } }))
jest.mock('../../main/provider', () => ({ on: jest.fn(), off: jest.fn() }))
jest.mock('../../main/signers', () => ({ get: jest.fn() }))
jest.mock('../../main/windows', () => ({ showTray: jest.fn() }))
jest.mock('../../main/windows/nav', () => ({ forward: jest.fn() }))
jest.mock('../../main/activity', () => ({ recordRequestActivity: jest.fn() }))
jest.mock('../../main/nebula', () => () => ({ ready: () => false, once() {} }))
jest.mock('../../main/store', () => {
  const store = (...keys) =>
    keys.flatMap((key) => String(key).split('.')).reduce((value, key) => value?.[key], mockState)
  store.observer = () => ({ remove() {} })
  store.navClearReq = () => {}
  return { __esModule: true, default: store }
})
jest.mock('../../main/reveal', () => ({
  __esModule: true,
  default: {
    signingMetadata: (...args) => mockReadMetadata(...args),
    identity: async () => ({}),
    decode: async () => undefined,
    recog: async () => []
  }
}))

const YFI = '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e'
const OTHER = '0x3333333333333333333333333333333333333333'
const abi = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
])
const cases = []
let mockState
let mockReadMetadata
let upstream
let account
let release

const transfer = (token, overrides = {}) => ({
  type: 'transfer',
  standard: 'erc20',
  token,
  from: OTHER,
  to: ACCOUNT,
  amount: '76572805682394724',
  ...overrides
})
const simulation = (effects, overrides = {}) => ({
  status: 'succeeded',
  source: 'eth_simulateV1',
  advancedChecks: { status: 'pending' },
  effects,
  ...overrides
})

function request(chainId = '0x1') {
  const req = {
    handlerId: 'metadata-review',
    type: 'transaction',
    account: ACCOUNT,
    origin: 'https://metadata-test.invalid',
    data: { from: ACCOUNT, to: OTHER, data: '0x', value: '0x0', chainId },
    classification: 'CONTRACT_CALL',
    recognizedActions: [],
    approvals: []
  }
  account.requests[req.handlerId] = req
  return req
}

async function rpcFixture({
  hold = false,
  fail = [],
  values = {},
  onRead = () => {},
  slowToken,
  slowField
} = {}) {
  const barrier = new Promise((resolve) => {
    release = resolve
  })
  upstream = await startJsonRpcFixture(async ({ method, params }) => {
    expect(method).toBe('eth_call')
    expect(params[1]).toBe('latest')
    const fn = abi.getFunction(params[0].data.slice(0, 10)).name
    onRead(params[0].to, fn)
    if (hold || params[0].to === slowToken || fn === slowField) await barrier
    if (fail.includes(fn)) return { error: { code: -32005, message: 'RPC temporarily unavailable' } }
    return {
      result: abi.encodeFunctionResult(fn, [
        values[fn] ?? { decimals: 6, symbol: 'NEW', name: 'New Token' }[fn]
      ])
    }
  })
  const client = createDappClient(upstream.url, 'https://metadata-test.invalid')
  const chains = []
  mockReadMetadata = (chainId, targets, onToken, beforeBatch) =>
    loadSigningMetadata(
      chainId,
      targets,
      {
        rpc: (chain, method, params) => {
          chains.push(chain)
          return client.request(method, params)
        },
        fetchContract: async () => {
          throw new Error('Token display must not need a source service')
        }
      },
      onToken,
      beforeBatch
    )
  return chains
}

beforeEach(() => {
  mockState = { main: { accounts: {}, balances: { [ACCOUNT]: [] }, tokens: { custom: [], known: {} } } }
  mockReadMetadata = async () => {
    throw new Error('Unexpected metadata lookup')
  }
  account = new Account(
    { address: ACCOUNT, name: 'Fixture', created: '1:1', active: true },
    {
      update: (summary) => {
        mockState.main.accounts[ACCOUNT] = summary
      }
    }
  )
})

afterEach(async () => {
  release?.()
  account.close()
  await upstream?.close()
  upstream = undefined
  release = undefined
  cases.push({ name: expect.getState().currentTestName, assertions: expect.getState().assertionCalls })
})

afterAll(() => {
  const target = path.resolve(process.env.WREN_E2E_EVIDENCE_DIR || 'compiled')
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(
    path.join(target, 'transaction-metadata.json'),
    JSON.stringify(
      {
        scope:
          'Production account simulation publication, bundled catalog and token reads through isolated HTTP RPC; no hardware or broadcasts',
        cases,
        outcome: 'See the accompanying Jest results for pass/fail.'
      },
      null,
      2
    ) + '\n'
  )
})

it('publishes catalog YFI immediately without a balance or metadata RPC', () => {
  const req = request()
  account.applySimulationResult(req, simulation([transfer(YFI)]), false)
  expect(store('main.accounts', ACCOUNT, 'requests', req.handlerId).tokenMetadata).toEqual([
    expect.objectContaining({ address: YFI, chainId: 1, name: 'yearn finance', symbol: 'YFI', decimals: 18 })
  ])
  expect(store('main.balances', ACCOUNT)).toEqual([])
})

it('reads a newly received token before advanced checks finish and deduplicates repeated simulation', async () => {
  const chains = await rpcFixture({ hold: true })
  const req = request('0x1237')
  const data = JSON.stringify(req.data)
  const effects = [transfer(TARGET), transfer(TARGET.toUpperCase().replace('0X', '0x'))]
  account.applySimulationResult(req, simulation(effects), false)
  await waitUntil(() => upstream.requests.length === 3, 2000)
  expect(req.tokenMetadata).toEqual([])
  account.applySimulationResult(req, simulation(effects), false)
  release()
  await waitUntil(
    () => req.tokenMetadata?.[0]?.symbol === 'NEW' && req.tokenMetadata[0].name === 'New Token',
    2000
  )
  expect(req.tokenMetadata).toEqual([
    { address: TARGET, chainId: 4663, name: 'New Token', symbol: 'NEW', decimals: 6 }
  ])
  expect(chains).toEqual([4663, 4663, 4663])
  expect(upstream.requests).toHaveLength(3)
  expect(req.simulation.advancedChecks.status).toBe('pending')
  expect(JSON.stringify(req.data)).toBe(data)
  expect(req.locked).toBeUndefined()
  expect(req.status).toBeUndefined()
  expect(req.approvals).toEqual([])
  expect(store('main.balances', ACCOUNT)).toEqual([])
  account.applySimulationResult(req, simulation([]))
  expect(req.tokenMetadata).toEqual([])
  account.applySimulationResult(req, simulation(effects))
  expect(req.tokenMetadata[0]?.symbol).toBe('NEW')
  expect(upstream.requests).toHaveLength(3)
})

it('keeps saved custom-token units ahead of stale balances and the bundled catalog', () => {
  const req = request()
  mockState.main.tokens.custom = [
    { address: YFI, chainId: 1, name: 'Saved Token', symbol: 'SAVED', decimals: 8 }
  ]
  mockState.main.balances[ACCOUNT] = [
    { address: YFI, chainId: 1, name: 'Stale', symbol: 'OLD', decimals: 18 }
  ]
  account.applySimulationResult(req, simulation([transfer(YFI)]))
  expect(req.tokenMetadata).toEqual([
    { address: YFI, chainId: 1, name: 'Saved Token', symbol: 'SAVED', decimals: 8 }
  ])
})

it('does not reuse catalog or saved units from another network', async () => {
  const chains = await rpcFixture()
  const req = request('0x1237')
  mockState.main.tokens.custom = [
    { address: YFI, chainId: 1, name: 'Wrong Chain', symbol: 'WRONG', decimals: 18 }
  ]
  account.applySimulationResult(req, simulation([transfer(YFI)]))
  await waitUntil(() => req.tokenMetadata?.[0]?.symbol === 'NEW', 2000)
  expect(req.tokenMetadata[0]).toMatchObject({ chainId: 4663, decimals: 6 })
  expect(chains).toEqual([4663, 4663, 4663])
})

it('publishes available labels without inventing decimals when the decimals read reverts', async () => {
  await rpcFixture({ fail: ['decimals'] })
  const req = request('0x1237')
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await waitUntil(
    () => req.tokenMetadata?.[0]?.symbol === 'NEW' && req.tokenMetadata[0].name === 'New Token',
    2000
  )
  expect(req.tokenMetadata[0]).toEqual({ address: TARGET, chainId: 4663, name: 'New Token', symbol: 'NEW' })
  expect(req.simulation.effects[0].amount).toBe('76572805682394724')
})

it('publishes decimals and symbol before a stalled optional name read completes', async () => {
  await rpcFixture({ slowField: 'name' })
  const req = request('0x1237')
  const data = JSON.stringify(req.data)
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await waitUntil(() => req.tokenMetadata?.[0]?.symbol === 'NEW' && req.tokenMetadata[0].decimals === 6, 1000)
  expect(req.tokenMetadata[0].name).toBe('')
  expect(JSON.stringify(req.data)).toBe(data)
  release()
  await waitUntil(() => req.tokenMetadata[0].name === 'New Token', 2000)
  expect(upstream.requests).toHaveLength(3)
})

it('publishes labels while stalled decimals retain the exact base-unit amount', async () => {
  await rpcFixture({ slowField: 'decimals' })
  const req = request('0x1237')
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await waitUntil(
    () => req.tokenMetadata?.[0]?.name === 'New Token' && req.tokenMetadata[0].symbol === 'NEW',
    1000
  )
  expect(req.tokenMetadata[0].decimals).toBeUndefined()
  expect(req.simulation.effects[0].amount).toBe('76572805682394724')
  release()
  await waitUntil(() => req.tokenMetadata[0].decimals === 6, 2000)
})

it('recovers automatically after one temporary failure without duplicate reads during cooldown', async () => {
  const failed = ['decimals', 'symbol', 'name']
  await rpcFixture({ fail: failed })
  const req = request('0x1237')
  const effects = [transfer(TARGET)]
  account.applySimulationResult(req, simulation(effects))
  await account.transactionMetadataReads.get(req).pending
  expect(req.tokenMetadata).toEqual([])
  expect(upstream.requests).toHaveLength(3)
  failed.length = 0
  for (let index = 0; index < 10; index++) account.applySimulationResult(req, simulation(effects))
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(upstream.requests).toHaveLength(3)
  await waitUntil(
    () => req.tokenMetadata?.[0]?.name === 'New Token' && req.tokenMetadata[0].symbol === 'NEW',
    6500
  )
  expect(req.tokenMetadata[0].decimals).toBe(6)
  expect(upstream.requests).toHaveLength(6)
  for (let index = 0; index < 10; index++) account.applySimulationResult(req, simulation(effects))
  expect(upstream.requests).toHaveLength(6)
})

it('publishes newly cached token details on retry without another RPC read or a holding', async () => {
  await rpcFixture({ fail: ['decimals', 'symbol', 'name'] })
  const req = request('0x1237')
  const data = JSON.stringify(req.data)
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await account.transactionMetadataReads.get(req).pending
  expect(store('main.accounts', ACCOUNT, 'requests', req.handlerId).tokenMetadata).toEqual([])
  const token = { address: TARGET, chainId: 4663, name: 'Cached Token', symbol: 'CACHED', decimals: 6 }
  mockState.main.tokens.custom = [token]
  await waitUntil(
    () => store('main.accounts', ACCOUNT, 'requests', req.handlerId).tokenMetadata?.[0]?.symbol === 'CACHED',
    6500
  )
  expect(store('main.accounts', ACCOUNT, 'requests', req.handlerId).tokenMetadata).toEqual([token])
  expect(req.tokenMetadata).toEqual([token])
  expect(store('main.balances', ACCOUNT)).toEqual([])
  expect(JSON.stringify(req.data)).toBe(data)
  expect(upstream.requests).toHaveLength(3)
})

it('stops after one retry when metadata remains unavailable', async () => {
  await rpcFixture({ fail: ['decimals', 'symbol', 'name'] })
  const req = request('0x1237')
  const effects = [transfer(TARGET)]
  account.applySimulationResult(req, simulation(effects))
  await waitUntil(() => upstream.requests.length === 6, 6500)
  await account.transactionMetadataReads.get(req).pending
  for (let index = 0; index < 10; index++) account.applySimulationResult(req, simulation(effects))
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(req.tokenMetadata).toEqual([])
  expect(upstream.requests).toHaveLength(6)
})

it('can resume queued metadata after signing ends without counting skipped reads as failed attempts', async () => {
  await rpcFixture({ slowToken: TARGET })
  const req = request('0x1237')
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await waitUntil(() => upstream.requests.length === 3, 2000)
  const effects = [transfer(TARGET), transfer(OTHER)]
  account.applySimulationResult(req, simulation(effects))
  req.locked = true
  release()
  await account.transactionMetadataReads.get(req).pending
  expect(upstream.requests).toHaveLength(3)
  req.locked = false
  account.applySimulationResult(req, simulation(effects))
  await waitUntil(
    () => req.tokenMetadata.some((token) => token.address === OTHER && token.name === 'New Token'),
    2000
  )
  expect(upstream.requests).toHaveLength(6)
})

it.each(['removed', 'closed', 'signing'])(
  'does not retry failed metadata after the request is %s',
  async (change) => {
    await rpcFixture({ fail: ['decimals', 'symbol', 'name'] })
    const req = request('0x1237')
    account.applySimulationResult(req, simulation([transfer(TARGET)]))
    await account.transactionMetadataReads.get(req).pending
    if (change === 'removed') account.clearRequest(req.handlerId)
    if (change === 'closed') account.close()
    if (change === 'signing') req.locked = true
    await new Promise((resolve) => setTimeout(resolve, 5200))
    expect(upstream.requests).toHaveLength(3)
    expect(req.tokenMetadata).toEqual([])
  }
)

it('publishes a ready token while another token is still waiting for RPC', async () => {
  await rpcFixture({ slowToken: OTHER })
  const req = request('0x1237')
  account.applySimulationResult(req, simulation([transfer(TARGET), transfer(OTHER)]))
  await waitUntil(() => req.tokenMetadata?.some(({ address }) => address === TARGET), 1000)
  expect(req.tokenMetadata).toHaveLength(1)
  await waitUntil(() => upstream.requests.length === 6, 2000)
  expect(upstream.requests).toHaveLength(6)
  release()
  await waitUntil(() => req.tokenMetadata?.length === 2, 2000)
})

it('keeps known units when optional labels are missing and the contract decimals read fails', async () => {
  await rpcFixture({ fail: ['decimals', 'symbol'] })
  const req = request('0x1237')
  mockState.main.tokens.known[ACCOUNT] = [
    { address: TARGET, chainId: 4663, name: '', symbol: '', decimals: 6 }
  ]
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await waitUntil(() => req.tokenMetadata?.[0]?.name === 'New Token', 2000)
  expect(req.tokenMetadata[0]).toEqual({
    address: TARGET,
    chainId: 4663,
    name: 'New Token',
    symbol: '',
    decimals: 6
  })
})

it('keeps the fallback and settles bounded metadata reads when RPC stalls', async () => {
  await rpcFixture({ hold: true })
  const req = request('0x1237')
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await waitUntil(() => upstream.requests.length === 3, 2000)
  await new Promise((resolve) => setTimeout(resolve, 4200))
  expect(req.tokenMetadata).toEqual([])
  release()
  account.applySimulationResult(req, simulation([transfer(TARGET)]))
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(req.tokenMetadata).toEqual([])
  expect(upstream.requests).toHaveLength(3)
  expect(req.simulation.effects[0].amount).toBe('76572805682394724')
})

it.each(['removed', 'replaced', 'network changed', 'closed'])(
  'ignores late metadata after the request is %s',
  async (change) => {
    await rpcFixture({ hold: true })
    const req = request('0x1237')
    account.applySimulationResult(req, simulation([transfer(TARGET)]))
    await waitUntil(() => upstream.requests.length === 3, 2000)
    if (change === 'removed') delete account.requests[req.handlerId]
    if (change === 'replaced') request('0x1237')
    if (change === 'network changed') req.data.chainId = '0x1'
    if (change === 'closed') account.close()
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(req.tokenMetadata).toEqual([])
  }
)

it('skips NFT, unrelated and untrusted transfer evidence', () => {
  const req = request()
  account.applySimulationResult(
    req,
    simulation([
      transfer(TARGET, { standard: 'erc721', tokenId: '42', amount: undefined }),
      transfer(TARGET, { from: TARGET, to: OTHER })
    ])
  )
  expect(req.tokenMetadata || []).toEqual([])
  account.applySimulationResult(req, simulation([transfer(TARGET)], { source: 'eth_call' }))
  expect(req.tokenMetadata || []).toEqual([])
})

it('bounds token reads across refreshes and keeps all reported effects intact', async () => {
  await rpcFixture()
  const req = request('0x1237')
  const effects = Array.from({ length: 33 }, (_, index) =>
    transfer(`0x${(index + 100).toString(16).padStart(40, '0')}`)
  )
  effects.push(transfer(YFI))
  req.data.chainId = '0x1'
  account.applySimulationResult(req, simulation(effects))
  expect(req.tokenMetadata.some(({ address }) => address === YFI)).toBe(true)
  await waitUntil(() => req.tokenMetadata?.length === 33, 3000)
  account.applySimulationResult(req, simulation(effects))
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(upstream.requests).toHaveLength(32 * 3)
  expect(req.simulation.effects).toHaveLength(34)
})

it.each(['removed', 'signing'])(
  'stops undispatched retry batches after the request is %s',
  async (change) => {
    let retry = false
    const effects = Array.from({ length: 8 }, (_, index) =>
      transfer(`0x${(index + 100).toString(16).padStart(40, '0')}`)
    )
    const firstGroup = new Set(effects.slice(0, 4).map(({ token }) => token))
    const barrier = new Promise((resolve) => {
      release = resolve
    })
    upstream = await startJsonRpcFixture(async ({ params }) => {
      const fn = abi.getFunction(params[0].data.slice(0, 10)).name
      if (!retry) return { error: { code: -32005, message: 'RPC temporarily unavailable' } }
      if (firstGroup.has(params[0].to)) await barrier
      return { result: abi.encodeFunctionResult(fn, [{ decimals: 6, symbol: 'NEW', name: 'New Token' }[fn]]) }
    })
    const client = createDappClient(upstream.url, 'https://metadata-test.invalid')
    mockReadMetadata = (chainId, targets, onToken, beforeBatch) =>
      loadSigningMetadata(
        chainId,
        targets,
        {
          rpc: (_chain, method, params) => client.request(method, params),
          fetchContract: async () => undefined
        },
        onToken,
        beforeBatch
      )
    const req = request('0x1237')
    account.applySimulationResult(req, simulation(effects))
    await account.transactionMetadataReads.get(req).pending
    expect(upstream.requests).toHaveLength(24)
    retry = true
    await waitUntil(() => upstream.requests.length === 36, 6500)
    const pending = account.transactionMetadataReads.get(req).pending
    if (change === 'removed') account.clearRequest(req.handlerId)
    else req.locked = true
    release()
    await pending
    expect(upstream.requests).toHaveLength(36)
    if (change === 'signing') {
      req.locked = false
      account.applySimulationResult(req, simulation(effects))
      await waitUntil(() => req.tokenMetadata?.length === 8, 2000)
      await account.transactionMetadataReads.get(req).pending
      expect(upstream.requests).toHaveLength(48)
    }
  }
)

it('preserves the retry budget for an initial batch skipped during signing', async () => {
  const effects = Array.from({ length: 8 }, (_, index) =>
    transfer(`0x${(index + 100).toString(16).padStart(40, '0')}`)
  )
  const failed = []
  await rpcFixture({ slowToken: effects[0].token, fail: failed })
  const req = request('0x1237')
  account.applySimulationResult(req, simulation(effects))
  await waitUntil(() => upstream.requests.length === 12, 2000)
  req.locked = true
  release()
  await account.transactionMetadataReads.get(req).pending
  expect(upstream.requests).toHaveLength(12)
  failed.push('decimals', 'symbol', 'name')
  req.locked = false
  account.applySimulationResult(req, simulation(effects))
  await account.transactionMetadataReads.get(req).pending
  expect(upstream.requests).toHaveLength(24)
  failed.length = 0
  await waitUntil(() => req.tokenMetadata?.length === 8, 6500)
  await account.transactionMetadataReads.get(req).pending
  expect(upstream.requests).toHaveLength(36)
})

it('keeps retries bounded when the metadata reader fails before dispatch', async () => {
  let reads = 0
  mockReadMetadata = async () => {
    reads++
    throw new Error('Metadata reader unavailable')
  }
  const req = request('0x1237')
  const effects = [transfer(TARGET)]
  account.applySimulationResult(req, simulation(effects))
  await account.transactionMetadataReads.get(req).pending
  for (let index = 0; index < 10; index++) account.applySimulationResult(req, simulation(effects))
  await account.transactionMetadataReads.get(req).pending
  expect(reads).toBe(1)
  await waitUntil(() => reads === 2, 6500)
  await account.transactionMetadataReads.get(req).pending
  for (let index = 0; index < 10; index++) account.applySimulationResult(req, simulation(effects))
  await account.transactionMetadataReads.get(req).pending
  expect(reads).toBe(2)
  expect(req.tokenMetadata).toEqual([])
})
