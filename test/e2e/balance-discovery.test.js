import { Interface } from 'ethers'

import createBalancesLoader from '../../main/externalData/balances/scan'
import { createDappClient, startJsonRpcFixture } from './support/harness'
import { balanceWorkerHarness, saveIssueEvidence, waitUntil } from './support/issue105'

const account = '0x1111111111111111111111111111111111111111'
const secondAccount = '0x2222222222222222222222222222222222222222'
const multicall = new Interface([
  'function tryAggregate(bool requireSuccess,tuple(address target,bytes callData)[] calls) returns (tuple(bool success,bytes returnData)[])'
])
const erc20 = new Interface(['function balanceOf(address) returns (uint256)'])
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

afterEach(async () => {
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
