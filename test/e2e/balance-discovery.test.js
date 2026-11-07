import { Interface } from 'ethers'
import Restore from 'react-restore'

import createBalancesLoader from '../../main/externalData/balances/scan'
import TokenLoader from '../../main/externalData/inventory/tokens'
import { buildSendTransaction } from '../../main/send/transaction'
import * as storeActions from '../../main/store/actions'
import { createDappClient, startJsonRpcFixture } from './support/harness'
import { balanceWorkerHarness, saveIssueEvidence, waitUntil } from './support/issue105'

const account = '0x1111111111111111111111111111111111111111'
const secondAccount = '0x2222222222222222222222222222222222222222'
const multicall = new Interface([
  'function tryAggregate(bool requireSuccess,tuple(address target,bytes callData)[] calls) returns (tuple(bool success,bytes returnData)[])'
])
const erc20 = new Interface([
  'function balanceOf(address) returns (uint256)',
  'function transfer(address,uint256) returns (bool)'
])
const tokens = (count) =>
  Array.from({ length: count }, (_, index) => ({
    address: `0x${(index + 100).toString(16).padStart(40, '0')}`,
    chainId: 1,
    decimals: 0,
    name: `Fixture ${index}`,
    symbol: `T${index}`
  }))
const evidence = []
let server
let worker
let publisher

afterEach(async () => {
  publisher?.stop()
  publisher = undefined
  worker?.close()
  worker = undefined
  await server?.close()
  server = undefined
})

afterAll(() =>
  saveIssueEvidence('balance-discovery', {
    scope: 'Loopback RPC and original worker/controller with fixture IPC',
    evidence
  })
)

it('discovers a newly cataloged token through RPC with readable units and keeps exclusions out of the scan', async () => {
  const address = '0x00000000efe302beaa2b3e6e1b18d08d69a9012a'
  const queried = new Set()
  server = await startJsonRpcFixture(async (payload) => {
    const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
    return {
      result: multicall.encodeFunctionResult('tryAggregate', [
        calls.map(({ target }) => {
          const token = target.toLowerCase()
          queried.add(token)
          return token === address
            ? [true, erc20.encodeFunctionResult('balanceOf', [2_500_000n])]
            : [false, '0x']
        })
      ])
    }
  })
  const rpc = createDappClient(server.url, 'https://catalog-refresh.invalid')
  worker = balanceWorkerHarness({
    connections: { ethereum: { 1: {} } },
    send(payload, callback) {
      rpc.request(payload.method, payload.params).then(
        (result) => callback({ result }),
        (error) => callback({ error })
      )
    }
  })
  await waitUntil(() => worker.events.some(({ name }) => name === 'ready'))
  worker.controller.scanForTokenBalances(account, [], [1])
  await waitUntil(() =>
    worker.events.some(({ name, args }) => name === 'tokenBalances' && args[0] === account)
  )
  const loaded = worker.events
    .filter(({ name, args }) => name === 'tokenBalances' && args[0] === account)
    .flatMap(({ args }) => args[1])
  expect(loaded).toEqual([
    expect.objectContaining({ address, chainId: 1, symbol: 'AUSD', decimals: 6, displayBalance: '2.5' })
  ])
  const excluded = new TokenLoader().getBlacklist([1])
  expect(excluded.length).toBeGreaterThan(0)
  expect(excluded.every((token) => !queried.has(token.address.toLowerCase()))).toBe(true)
  evidence.push({
    case: 'refreshed-catalog-discovery',
    loaded,
    queriedTokens: queried.size,
    excluded: excluded.length
  })
}, 30_000)

it.each([
  { chainId: 1, address: '0x720cd16b011b987da3518fbf38c3071d4f0d1495' },
  { chainId: 42161, address: '0x63806c056fa458c548fb416b15e358a9d685710a' },
  { chainId: 8453, address: '0xb008bdcf9cdff9da684a190941dc3dca8c2cdd44' }
])('uses FLUX contract units for balances and sending on chain $chainId', async ({ chainId, address }) => {
  const token = new TokenLoader().getTokens([chainId]).find((entry) => entry.address === address)
  expect(token).toBeDefined()
  server = await startJsonRpcFixture(async (payload) => {
    const rawBalance = erc20.encodeFunctionResult('balanceOf', [10_000_000_000n])
    if (payload.params[0].to.toLowerCase() === address) return { result: rawBalance }
    const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
    expect(calls).toHaveLength(1)
    expect(calls[0].target.toLowerCase()).toBe(address)
    return { result: multicall.encodeFunctionResult('tryAggregate', [[[true, rawBalance]]]) }
  })
  const rpc = createDappClient(server.url, 'https://catalog-refresh.invalid')
  worker = balanceWorkerHarness({
    connections: { ethereum: { [chainId]: {} } },
    send(payload, callback) {
      rpc.request(payload.method, payload.params).then(
        (result) => callback({ result }),
        (error) => callback({ error })
      )
    }
  })
  await waitUntil(() => worker.events.some(({ name }) => name === 'ready'))
  worker.controller.updateKnownTokenBalances(account, [token])
  await waitUntil(() =>
    worker.events.some(({ name, args }) => name === 'tokenBalances' && args[0] === account)
  )
  const [balance] = worker.events
    .filter(({ name, args }) => name === 'tokenBalances' && args[0] === account)
    .flatMap(({ args }) => args[1])
  expect(balance).toEqual(expect.objectContaining({ address, chainId, displayBalance: '100' }))
  const { amount, transaction } = buildSendTransaction(
    { account, amount: '1', assetAddress: address, chainId, recipient: secondAccount },
    { account, assets: [balance], networkAvailable: true, watchOnly: false }
  )
  const [recipient, transferAmount] = erc20.decodeFunctionData('transfer', transaction.data)
  expect(recipient.toLowerCase()).toBe(secondAccount)
  expect(amount).toBe(100_000_000n)
  expect(transferAmount).toBe(100_000_000n)
  evidence.push({
    case: 'flux-contract-units',
    chainId,
    address,
    displayBalance: balance.displayBalance,
    transferAmount: transferAmount.toString()
  })
})

it('bounds batch size/concurrency and preserves ordered successful balances around a failed batch', async () => {
  let active = 0
  let peak = 0
  const sizes = []
  server = await startJsonRpcFixture(async (payload) => {
    const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
    sizes.push(calls.length)
    active++
    peak = Math.max(peak, active)
    try {
      await new Promise((resolve) => setTimeout(resolve, calls[0].target.endsWith('0064') ? 25 : 5))
      if (calls[0].target.endsWith('012c')) throw new Error('Fixture middle batch failure')
      return {
        result: multicall.encodeFunctionResult('tryAggregate', [
          calls.map(({ target }) => [true, erc20.encodeFunctionResult('balanceOf', [BigInt(target)])])
        ])
      }
    } finally {
      active--
    }
  })
  const rpc = createDappClient(server.url, 'https://issue105.invalid')
  const balances = await createBalancesLoader({
    request: ({ method, params }) => rpc.request(method, params)
  }).getTokenBalances(account, tokens(405))
  expect(Math.max(...sizes)).toBeLessThanOrEqual(200)
  expect(peak).toBeLessThanOrEqual(2)
  expect(balances.map(({ address }) => address)).toEqual(
    [...tokens(200), ...tokens(405).slice(400)].map(({ address }) => address)
  )
  expect(balances.every(({ address, balance }) => BigInt(balance) === BigInt(address))).toBe(true)
  evidence.push({ case: 'bounded-partial-results', sizes, peak, returnedBalances: balances.length })
})

it('coalesces repeated discovery while native and another account continue through the worker', async () => {
  const held = []
  let release
  const hold = new Promise((resolve) => {
    release = resolve
  })
  server = await startJsonRpcFixture(async (payload) => {
    if (payload.method === 'eth_getBalance') return { result: '0x1234' }
    const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
    const owner = erc20.decodeFunctionData('balanceOf', calls[0].callData)[0].toLowerCase()
    if (owner === account) {
      held.push(calls.length)
      await hold
    }
    return { result: multicall.encodeFunctionResult('tryAggregate', [calls.map(() => [false, '0x'])]) }
  })
  const rpc = createDappClient(server.url, 'https://issue105.invalid')
  worker = balanceWorkerHarness({
    connections: { ethereum: { 1: {} } },
    send(payload, callback) {
      rpc.request(payload.method, payload.params).then(
        (result) => callback({ result }),
        (error) => callback({ error })
      )
    }
  })
  try {
    await waitUntil(() => worker.events.some(({ name }) => name === 'ready')).catch((error) => {
      throw new Error(`${error.message}: ${JSON.stringify(worker.logs)}`)
    })
    worker.controller.scanForTokenBalances(account, [], [1])
    await waitUntil(() => held.length > 0)
    for (let i = 0; i < 3; i++) worker.controller.scanForTokenBalances(account, [], [1])
    worker.controller.updateChainBalances(account, [{ chainId: 1, decimals: 18 }])
    worker.controller.scanForTokenBalances(secondAccount, [], [1])
    await waitUntil(() =>
      worker.events.some(({ name, args }) => name === 'chainBalances' && args[0] === account)
    )
    await waitUntil(() =>
      worker.events.some(({ name, args }) => name === 'tokenBalances' && args[0] === secondAccount)
    )
    expect(held.length).toBeLessThanOrEqual(2)
    expect(Math.max(...held)).toBeLessThanOrEqual(200)
    const heldAtPeak = held.length
    release()
    await waitUntil(() =>
      worker.events.some(({ name, args }) => name === 'tokenBalances' && args[0] === account)
    )
    const before = held.length
    worker.controller.scanForTokenBalances(account, [], [1])
    await waitUntil(() => held.length > before)
    evidence.push({ case: 'coalescing-independent-progress', heldAtPeak, subsequentScanStarted: true })
  } finally {
    release()
    saveIssueEvidence('coalescing-state', {
      held,
      events: worker.events,
      methods: server.requests.map(({ payload }) => payload.method),
      logs: worker.logs.filter(({ level }) => level !== 'debug')
    })
  }
}, 30_000)

it('coalesces tracked reads independently of discovery and another network, then permits a retry', async () => {
  const held = []
  let release
  const hold = new Promise((resolve) => {
    release = resolve
  })
  server = await startJsonRpcFixture(async (payload) => {
    const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
    const tracked = BigInt(calls[0].target) < 1000n
    const mainnet = payload.params[0].to === '0x5ba1e12693dc8f9c48aad8770482f4739beed696'
    if (tracked && mainnet) {
      held.push(calls.length)
      await hold
    }
    return {
      result: multicall.encodeFunctionResult('tryAggregate', [
        calls.map(() => (tracked ? [true, erc20.encodeFunctionResult('balanceOf', [1n])] : [false, '0x']))
      ])
    }
  })
  const rpc = createDappClient(server.url, 'https://issue105.invalid')
  worker = balanceWorkerHarness({
    connections: { ethereum: { 1: {}, 10: {} } },
    send(payload, callback) {
      rpc.request(payload.method, payload.params).then(
        (result) => callback({ result }),
        (error) => callback({ error })
      )
    }
  })
  try {
    await waitUntil(() => worker.events.some(({ name }) => name === 'ready'))
    worker.controller.updateKnownTokenBalances(account, tokens(401))
    await waitUntil(() => held.length === 2)
    worker.controller.updateKnownTokenBalances(account, tokens(401))
    worker.controller.updateKnownTokenBalances(
      account,
      tokens(1).map((token) => ({ ...token, chainId: 10 }))
    )
    worker.controller.scanForTokenBalances(account, [], [1])
    await waitUntil(() =>
      worker.events.some(
        ({ name, args }) => name === 'tokenBalances' && args[1].some(({ chainId }) => chainId === 10)
      )
    )
    await waitUntil(() =>
      worker.events.some(({ name, args }) => name === 'tokenBalances' && args[1].length === 0)
    )
    expect(held).toEqual([200, 200])
    release()
    await waitUntil(() =>
      worker.events.some(({ name, args }) => name === 'tokenBalances' && args[1].length === 401)
    )
    expect(held).toEqual([200, 200, 1])
    worker.controller.updateKnownTokenBalances(account, tokens(1))
    await waitUntil(() => held.length === 4)
    evidence.push({
      case: 'tracked-discovery-network-independence',
      held,
      otherNetwork: 10,
      subsequentReadStarted: true
    })
  } finally {
    release()
  }
}, 30_000)

it('lets the parent timeout arrive over delayed IPC before the worker watchdog', async () => {
  let delay = 350
  server = await startJsonRpcFixture(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay))
    return {
      result: multicall.encodeFunctionResult('tryAggregate', [
        [[true, erc20.encodeFunctionResult('balanceOf', [1n])]]
      ])
    }
  })
  const rpc = createDappClient(server.url, 'https://issue105.invalid')
  worker = balanceWorkerHarness(
    {
      connections: { ethereum: { 1: {} } },
      send(payload, callback) {
        rpc.request(payload.method, payload.params).then(
          (result) => callback({ result }),
          (error) => callback({ error })
        )
      }
    },
    { timeScale: 0.02, responseDelay: 75 }
  )
  await waitUntil(() => worker.events.some(({ name }) => name === 'ready'))
  worker.controller.updateKnownTokenBalances(account, tokens(1))
  await waitUntil(() => worker.events.some(({ name }) => name === 'tokenBalances'))
  await new Promise((resolve) => setTimeout(resolve, 150))
  const warnings = worker.logs.filter(({ level }) => level === 'warn').map(({ args }) => args.join(' '))
  expect(warnings).not.toEqual(
    expect.arrayContaining([expect.stringContaining('unknown balance RPC request')])
  )
  expect(warnings).not.toEqual(expect.arrayContaining([expect.stringContaining('no heartbeat')]))
  const settled = worker.events.find(({ name }) => name === 'tokenBalances')
  expect(settled.args[1]).toEqual([])
  expect(worker.rpcResponses[0].response.error.code).toBe(-32002)
  expect(settled.at).toBeGreaterThanOrEqual(worker.rpcResponses[0].at)
  expect(worker.logs.some(({ args }) => args.join(' ').includes('discarded late balance RPC response'))).toBe(
    false
  )
  delay = 0
  worker.controller.updateKnownTokenBalances(account, tokens(1))
  await waitUntil(() => worker.events.filter(({ name }) => name === 'tokenBalances').length === 2)
  expect(worker.events.filter(({ name }) => name === 'tokenBalances')[1].args[1][0].balance).toBe('0x01')
  evidence.push({
    case: 'parent-deadline-ipc-grace',
    timeScale: 0.02,
    responseDelay: 75,
    warnings,
    retrySucceeded: true
  })
})

it.each(['added tokens', 'changed metadata', 'new tokens after an upstream failure'])(
  'retains %s received during an active tracked read without a later polling tick',
  async (kind) => {
    const firstToken = tokens(1)[0]
    const replacement =
      kind === 'changed metadata'
        ? [{ ...firstToken, decimals: 2, name: 'Updated token', symbol: 'NEW' }]
        : tokens(3).slice(1)
    const observed = []
    let active = 0
    let peak = 0
    let release
    const hold = new Promise((resolve) => {
      release = resolve
    })
    server = await startJsonRpcFixture(async (payload) => {
      const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
      observed.push(calls.map(({ target }) => target.toLowerCase()))
      active++
      peak = Math.max(peak, active)
      try {
        if (observed.length === 1) {
          await hold
          if (kind === 'new tokens after an upstream failure') throw new Error('Fixture initial read failed')
        }
        return {
          result: multicall.encodeFunctionResult('tryAggregate', [
            calls.map(() => [true, erc20.encodeFunctionResult('balanceOf', [123n])])
          ])
        }
      } finally {
        active--
      }
    })
    const rpc = createDappClient(server.url, 'https://issue105.invalid')
    worker = balanceWorkerHarness({
      connections: { ethereum: { 1: {} } },
      send(payload, callback) {
        rpc.request(payload.method, payload.params).then(
          (result) => callback({ result }),
          (error) => callback({ error })
        )
      }
    })
    try {
      await waitUntil(() => worker.events.some(({ name }) => name === 'ready'))
      worker.controller.updateKnownTokenBalances(account, [firstToken])
      await waitUntil(() => observed.length === 1)
      for (const token of replacement) worker.controller.updateKnownTokenBalances(account, [token])
      release()
      await waitUntil(() => observed.length > 1, 1000)
      await waitUntil(() => {
        const loaded = worker.events
          .filter(({ name }) => name === 'tokenBalances')
          .flatMap(({ args }) => args[1])
        return replacement.every((token) =>
          loaded.some((balance) => balance.address === token.address && balance.decimals === token.decimals)
        )
      })
      expect(peak).toBe(1)
      expect(observed).toHaveLength(2)
      expect(new Set(observed[1])).toEqual(new Set(replacement.map(({ address }) => address)))
      const loaded = worker.events
        .filter(({ name }) => name === 'tokenBalances')
        .flatMap(({ args }) => args[1])
      if (kind === 'changed metadata') {
        expect(loaded).toEqual([
          expect.objectContaining({
            decimals: 2,
            name: 'Updated token',
            symbol: 'NEW',
            displayBalance: '1.23'
          })
        ])
      }
      if (kind === 'new tokens after an upstream failure')
        expect(loaded.some(({ address }) => address === firstToken.address)).toBe(false)
      evidence.push({ case: kind, observed, peak, results: loaded })
    } finally {
      release()
    }
  }
)

it('keeps current custom metadata in the store when an older discovery finishes after a tracked read', async () => {
  const token = new TokenLoader().getTokens([1])[0]
  const customToken = {
    ...token,
    address: `0x${token.address.slice(2).toUpperCase()}`,
    decimals: 2,
    name: 'Current custom token',
    symbol: 'CURRENT',
    logoURI: 'https://issue105.invalid/current-token.svg'
  }
  let rawBalance = 123n
  let discoveryHeld = false
  let release
  const hold = new Promise((resolve) => {
    release = resolve
  })
  server = await startJsonRpcFixture(async (payload) => {
    const calls = multicall.decodeFunctionData('tryAggregate', payload.params[0].data)[1]
    const includesToken = calls.some(({ target }) => target.toLowerCase() === token.address.toLowerCase())
    if (includesToken && calls.length > 1) {
      discoveryHeld = true
      await hold
    }
    return {
      result: multicall.encodeFunctionResult('tryAggregate', [
        calls.map(({ target }) =>
          target.toLowerCase() === token.address.toLowerCase()
            ? [true, erc20.encodeFunctionResult('balanceOf', [rawBalance])]
            : [false, '0x']
        )
      ])
    }
  })
  const rpc = createDappClient(server.url, 'https://issue105.invalid')
  worker = balanceWorkerHarness({
    connections: { ethereum: { 1: {} } },
    send(payload, callback) {
      rpc.request(payload.method, payload.params).then(
        (result) => callback({ result }),
        (error) => callback({ error })
      )
    }
  })
  const unrelated = { ...token, chainId: 10, balance: '0x01', displayBalance: 'unchanged fixture' }
  const store = Restore.create(
    {
      main: {
        accounts: { [account]: {} },
        balances: { [account]: [unrelated] },
        tokens: { custom: [], known: { [account]: [] } }
      }
    },
    storeActions
  )
  publisher = worker.createPublisher(store)
  const storedToken = () => store('main.balances', account).find(({ chainId }) => chainId === 1)
  try {
    await waitUntil(() => worker.events.some(({ name }) => name === 'ready'))
    worker.controller.scanForTokenBalances(account, [], [1])
    await waitUntil(() => discoveryHeld)
    store.addCustomTokens([customToken])
    publisher.addTokens(account, [customToken])
    await waitUntil(() => storedToken()?.symbol === 'CURRENT')
    expect(storedToken()).toEqual(expect.objectContaining({ decimals: 2, displayBalance: '1.23' }))
    release()
    await waitUntil(() =>
      worker.events.some(
        ({ name, args }) => name === 'tokenBalances' && args[1].some(({ symbol }) => symbol === token.symbol)
      )
    )
    const stored = storedToken()
    evidence.push({ case: 'custom-metadata-after-discovery', original: token, customToken, stored })
    expect(stored).toEqual(
      expect.objectContaining({
        decimals: 2,
        name: 'Current custom token',
        symbol: 'CURRENT',
        logoURI: customToken.logoURI,
        balance: '0x7b',
        displayBalance: '1.23'
      })
    )
    expect(store('main.balances', account).find(({ chainId }) => chainId === 10)).toEqual(unrelated)
    expect(store('main.tokens.known', account)).toEqual([
      expect.objectContaining({ decimals: 2, symbol: 'CURRENT' })
    ])
    rawBalance = 0n
    store.addCustomTokens([{ ...customToken, logoURI: '' }])
    publisher.addTokens(account, [token])
    await waitUntil(() => storedToken()?.balance === '0x00')
    expect(storedToken()).toEqual(
      expect.objectContaining({
        decimals: 2,
        name: 'Current custom token',
        symbol: 'CURRENT',
        logoURI: '',
        balance: '0x00',
        displayBalance: '0'
      })
    )
    expect(store('main.tokens.known', account)).toEqual([])
    evidence.push({ case: 'custom-metadata-zero-balance', stored: storedToken() })
  } finally {
    release()
  }
})
