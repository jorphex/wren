import fs from 'fs'
import path from 'path'

import { simulateTransaction, simulateWalletCalls } from '../../main/transaction/simulation'
import { isBroadTokenAuthorityEffect } from '../../resources/domain/transaction/effects'
import { projectInspectorSimulation } from '../../main/inspector'
import traces from '../fixtures/simulation/geth-call-traces.json'
import { ACCOUNT, TARGET, createDappClient, startJsonRpcFixture } from './support/harness'

const HASH = `0x${'ab'.repeat(32)}`
const BLOCK = { hash: HASH, number: '0x123' }
const SELECTOR = { blockHash: HASH, requireCanonical: true }
const transaction = {
  chainId: '0x1237',
  from: ACCOUNT,
  to: TARGET,
  gasLimit: '0x7a120',
  value: '0x0',
  data: '0x'
}
const clone = (value) => JSON.parse(JSON.stringify(value))
const unsupported = { code: -32601, message: 'Method not found' }
const exercised = []

async function preview(options = {}) {
  const trace = clone(options.trace || traces.nested)
  const fixture = await startJsonRpcFixture(async (payload) => {
    const { method, params } = payload
    if (options.handle) {
      const response = await options.handle(payload)
      if (response) return response
    }
    if (method === 'eth_getCode') return { result: '0x' }
    if (method === 'eth_simulateV1') return { error: options.simulateError || unsupported }
    if (method === 'eth_getBlockByNumber') return { result: BLOCK }
    if (method === 'eth_call') return { result: '0x' }
    if (method === 'debug_traceCall') {
      return { result: params[2].tracer === 'callTracer' ? trace : { pre: {}, post: {} } }
    }
    return { error: unsupported }
  })
  const client = createDappClient(fixture.url, 'https://simulation.example')
  const send = (payload, callback) => {
    client.request(payload.method, payload.params).then(
      (result) => callback({ id: payload.id, jsonrpc: '2.0', result }),
      (error) =>
        callback({ id: payload.id, jsonrpc: '2.0', error: { code: error.code, message: error.message } })
    )
  }
  try {
    const started = Date.now()
    const result = await (options.batch ? simulateWalletCalls : simulateTransaction)(
      options.batch ? [transaction, transaction] : { ...transaction, ...options.transaction },
      { send, timeoutMs: options.timeoutMs || 2000, onCoreResult: options.onCoreResult }
    )
    return { result, elapsed: Date.now() - started, requests: fixture.requests.map(({ payload }) => payload) }
  } finally {
    await fixture.close()
  }
}

afterEach(() => {
  exercised.push(expect.getState().currentTestName)
})

afterAll(() => {
  const directory = path.resolve('compiled')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'simulation-fallback-e2e.json'),
    JSON.stringify(
      {
        scope:
          'Production preview through isolated HTTP RPC; synthetic real-Geth trace fixtures; no broadcasts',
        fixtureImage: traces.image,
        casesExercised: exercised,
        outcome: 'Use the accompanying Jest result for pass/fail; this artifact records exercised cases.'
      },
      null,
      2
    ) + '\n'
  )
})

describe('single-transaction preview across RPC capabilities', () => {
  it.each([
    [-32601, 'Method not found'],
    [-32004, 'Method not supported'],
    [-32002, 'the resource eth_simulateV1 is not available.'],
    [-32000, 'the method eth_simulateV1 does not exist/is not available'],
    [-32600, 'Unsupported method: eth_simulateV1']
  ])('falls back for explicit unsupported method (%s)', async (code, message) => {
    const { result, requests } = await preview({ simulateError: { code, message } })
    expect(result.status).toBe('succeeded')
    expect(result.source).toBe('eth_call')
    expect(result.effects?.map(({ amount }) => amount)).toEqual(['7', '9', '11'])
    expect(result.effectsEvidence).toEqual({
      source: 'debug_traceCall',
      blockHash: HASH,
      blockNumber: BLOCK.number
    })
    expect(projectInspectorSimulation(result).effectsEvidence).toEqual(result.effectsEvidence)
    const executions = requests.filter(({ method }) => method === 'eth_call' || method === 'debug_traceCall')
    expect(executions).toHaveLength(3)
    for (const request of executions) expect(request.params[1]).toEqual(SELECTOR)
    expect(executions[0].params[0]).toEqual({
      from: ACCOUNT,
      to: TARGET,
      gas: '0x7a120',
      value: '0x0',
      data: '0x'
    })
    expect(executions.slice(1).map(({ params }) => params[0])).toEqual([
      executions[0].params[0],
      executions[0].params[0]
    ])
    expect(
      requests.find(({ method, params }) => method === 'debug_traceCall' && params[2].tracer === 'callTracer')
        .params[2].tracerConfig.withLog
    ).toBe(true)
  })

  it.each([
    [3, 'execution reverted', 'reverted'],
    [-32005, 'Rate limit exceeded', 'failed'],
    [-32602, 'Invalid params', 'failed'],
    [-32000, 'Method eth_simulateV1 failed: upstream unavailable', 'failed'],
    [-32603, 'Internal error', 'failed']
  ])('does not hide execution or provider errors (%s)', async (code, message, status) => {
    const { result, requests } = await preview({ simulateError: { code, message } })
    expect(result.status).toBe(status)
    expect(requests.some(({ method }) => method === 'eth_call' || method === 'debug_traceCall')).toBe(false)
  })

  it('keeps basic execution when headers or block-hash selectors are unsupported', async () => {
    for (const headerUnsupported of [true, false]) {
      const { result, requests } = await preview({
        handle: ({ method, params }) => {
          if (headerUnsupported && method === 'eth_getBlockByNumber') return { error: unsupported }
          if (!headerUnsupported && method === 'eth_call' && typeof params[1] === 'object') {
            return {
              error: {
                code: -32602,
                message: 'invalid argument 1: json: cannot unmarshal object into Go value of type string'
              }
            }
          }
        }
      })
      expect(result).toMatchObject({
        status: 'succeeded',
        source: 'eth_call',
        advancedChecks: { status: 'partly-unavailable' }
      })
      expect(result.effectsEvidence).toBeUndefined()
      expect(requests.filter(({ method }) => method === 'debug_traceCall')).toHaveLength(0)
      expect(requests.filter(({ method }) => method === 'eth_call').at(-1).params[1]).toBe('latest')
    }
  })

  it('does not retry latest after a reorg or a genuine pinned-call failure', async () => {
    for (const error of [
      { code: -32000, message: 'hash is not currently canonical' },
      { code: 3, message: 'execution reverted' }
    ]) {
      const { result, requests } = await preview({
        handle: ({ method }) => (method === 'eth_call' ? { error } : undefined)
      })
      expect(result.status).not.toBe('succeeded')
      expect(result.effects).toBeUndefined()
      expect(requests.filter(({ method }) => method === 'eth_call')).toHaveLength(1)
    }
  })

  it('does not attach trace events when the reviewed call has no explicit gas limit', async () => {
    const { result } = await preview({ transaction: { gasLimit: undefined } })
    expect(result.status).toBe('succeeded')
    expect(result.effectsEvidence).toBeUndefined()
    expect(result.advancedChecks.status).toBe('partly-unavailable')
  })

  it('keeps creation events unavailable when eth_call cannot bind the reviewed creation nonce', async () => {
    const trace = { ...clone(traces.nested), type: 'CREATE' }
    const { result } = await preview({ transaction: { to: undefined, nonce: '0x7' }, trace })
    expect(result.status).toBe('succeeded')
    expect(result.effectsEvidence).toBeUndefined()
    expect(result.advancedChecks.status).toBe('partly-unavailable')
  })

  it('preserves reviewed calldata, fees, gas and access list in every fallback execution', async () => {
    const tx = {
      data: '0x12345678',
      value: '0x7',
      maxFeePerGas: '0x12',
      maxPriorityFeePerGas: '0x2',
      accessList: [{ address: TARGET, storageKeys: [`0x${'0'.repeat(64)}`] }]
    }
    const trace = { ...clone(traces.nested), input: tx.data, value: tx.value }
    const { result, requests } = await preview({ transaction: tx, trace })
    expect(result.effects).toHaveLength(3)
    const calls = requests.filter(({ method }) => ['eth_call', 'debug_traceCall'].includes(method))
    for (const { params } of calls) expect(params[0]).toMatchObject({ ...tx, gas: transaction.gasLimit })
  })

  it('keeps root logs and excludes reverted ancestors while preserving delegate-call emitters', async () => {
    const childRevert = clone(traces.childRevert)
    childRevert.calls[0].logs = clone(traces.nested.calls[0].logs)
    childRevert.calls[0].calls = [clone(traces.delegate.calls[0])]
    const rootOnly = { ...clone(traces.nested), calls: [] }
    rootOnly.logs = [rootOnly.logs[0]]
    for (const [trace, amounts, emitters] of [
      [childRevert, ['7', '11'], [TARGET, TARGET]],
      [traces.delegate, ['9'], [TARGET]],
      [rootOnly, ['7'], [TARGET]]
    ]) {
      const { result } = await preview({ trace })
      expect(result.effects.map(({ amount }) => amount)).toEqual(amounts)
      expect(result.effects.map(({ token }) => token)).toEqual(emitters)
    }
  })

  it('reconstructs event order from child positions on clients without global log indices', async () => {
    const trace = clone(traces.nested)
    delete trace.logs[0].index
    delete trace.logs[1].index
    delete trace.calls[0].logs[0].index
    const { result } = await preview({ trace })
    expect(result.effects?.map(({ amount }) => amount)).toEqual(['7', '9', '11'])
    expect(result.effectsEvidence?.source).toBe('debug_traceCall')
    expect(result.effectsTruncated).toBeUndefined()
  })

  it.each(['missing-position', 'out-of-range-position', 'reversed-positions'])(
    'rejects ambiguous position-only trace ordering: %s',
    async (kind) => {
      const trace = clone(traces.nested)
      for (const log of [...trace.logs, ...trace.calls[0].logs]) delete log.index
      if (kind === 'missing-position') delete trace.calls[0].logs[0].position
      if (kind === 'out-of-range-position') trace.logs[1].position = '0x2'
      if (kind === 'reversed-positions') {
        trace.logs[0].position = '0x1'
        trace.logs[1].position = '0x0'
      }
      const { result } = await preview({ trace })
      expect(result.effectsEvidence).toBeUndefined()
      expect(result.advancedChecks.status).toBe('partly-unavailable')
    }
  )

  it.each([
    'root-revert',
    'wrong-sender',
    'wrong-gas',
    'wrong-input',
    'wrong-emitter',
    'duplicate-index',
    'missing-index',
    'malformed-data',
    'no-logs'
  ])('keeps unusable trace events out of the preview: %s', async (kind) => {
    const trace = clone(traces.nested)
    if (kind === 'root-revert') trace.error = 'execution reverted'
    if (kind === 'wrong-sender') trace.from = TARGET
    if (kind === 'wrong-gas') trace.gas = '0x5208'
    if (kind === 'wrong-input') trace.input = '0x1234'
    if (kind === 'wrong-emitter') trace.logs[0].address = ACCOUNT
    if (kind === 'duplicate-index') trace.calls[0].logs[0].index = '0x0'
    if (kind === 'missing-index') delete trace.calls[0].logs[0].index
    if (kind === 'malformed-data') trace.logs[0].data = '0xzz'
    if (kind === 'no-logs') {
      delete trace.logs
      delete trace.calls[0].logs
    }
    const { result } = await preview({ trace })
    expect(result.status).toBe('succeeded')
    expect(result.effects).toBeUndefined()
    expect(result.effectsEvidence).toBeUndefined()
    expect(result.advancedChecks.status).toBe('partly-unavailable')
  })

  it('bounds logs and marks partial effects without losing broad approval evidence', async () => {
    const trace = clone(traces.nested)
    trace.calls = []
    trace.logs = Array.from({ length: 270 }, (_, index) => ({
      ...clone(trace.logs[0]),
      index: `0x${index.toString(16)}`,
      position: '0x0'
    }))
    trace.logs[0].topics[0] = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
    trace.logs[0].data = `0x${'f'.repeat(64)}`
    const { result } = await preview({ trace })
    expect(result.effectsTruncated).toBe(true)
    expect(result.effects.length).toBeLessThanOrEqual(100)
    expect(result.effects.some((effect) => isBroadTokenAuthorityEffect(effect, ACCOUNT))).toBe(true)
  })

  it('retains the shared deadline and publishes core execution before optional traces finish', async () => {
    const core = []
    const { result, elapsed } = await preview({
      timeoutMs: 250,
      onCoreResult: (value) => core.push(value),
      handle: async ({ method }) => {
        if (method === 'debug_traceCall') {
          await new Promise((resolve) => setTimeout(resolve, 450))
          return { error: unsupported }
        }
      }
    })
    expect(elapsed).toBeLessThan(1100)
    expect(core).toHaveLength(1)
    expect(core[0]).toMatchObject({ status: 'succeeded', advancedChecks: { status: 'pending' } })
    expect(result).toMatchObject({ status: 'succeeded', advancedChecks: { status: 'partly-unavailable' } })
    expect(result.effectsEvidence).toBeUndefined()
  })

  it('preserves primary simulation effects instead of merging trace logs', async () => {
    const { result, requests } = await preview({
      handle: ({ method }) =>
        method === 'eth_simulateV1'
          ? {
              result: [
                {
                  calls: [
                    { status: '0x1', gasUsed: '0x5208', returnData: '0x', logs: [traces.nested.logs[0]] }
                  ]
                }
              ]
            }
          : undefined
    })
    expect(result.source).toBe('eth_simulateV1')
    expect(result.effects.map(({ amount }) => amount)).toEqual(['7'])
    expect(result.effectsEvidence).toBeUndefined()
    expect(requests.some(({ method }) => method === 'eth_getBlockByNumber')).toBe(false)
  })

  it('does not replace stateful Wallet Calls with independent eth_calls', async () => {
    const { result, requests } = await preview({ batch: true })
    expect(result.status).not.toBe('succeeded')
    expect(
      requests.some(({ method }) => ['eth_call', 'debug_traceCall', 'eth_getBlockByNumber'].includes(method))
    ).toBe(false)
  })
})
