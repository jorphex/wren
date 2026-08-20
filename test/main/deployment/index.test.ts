import { getCreateAddress, keccak256 } from 'ethers'

import {
  createDeploymentService,
  DeploymentEvidenceError,
  type DeploymentAccountContext,
  type DeploymentAdmissionInput,
  type DeploymentNetworkContext,
  type DeploymentServiceDependencies
} from '../../../main/deployment'
import { MAX_DEPLOYMENT_INITCODE_BYTES } from '../../../resources/domain/deployment'

const account = '0x1111111111111111111111111111111111111111'
const otherAccount = '0x2222222222222222222222222222222222222222'
const draft = Object.freeze({ account, chainId: 1, initcode: '0x60AA00', value: '1.25' })
const id = 'a'.repeat(32)

function harness(overrides: Partial<DeploymentServiceDependencies> = {}) {
  let now = 1_000
  let currentAccount: DeploymentAccountContext | undefined = {
    id: account,
    status: 'ok',
    watchOnly: false,
    signerCapable: true
  }
  let network: DeploymentNetworkContext | undefined = {
    type: 'ethereum',
    chainId: 1,
    configured: true,
    enabled: true,
    connected: true,
    nativeDecimals: 2
  }
  const admissions: DeploymentAdmissionInput[] = []
  const dependencies: DeploymentServiceDependencies = {
    getCurrentAccount: () => currentAccount,
    getNetwork: (chainId) => (network?.chainId === chainId ? network : undefined),
    estimateGas: async () => '0x7d00',
    simulateTransaction: async () => ({
      status: 'succeeded',
      source: 'eth_call',
      gasUsed: '0x5208',
      advancedChecks: { status: 'complete' }
    }),
    getPendingNonce: async () => '0x0',
    ensureDeploymentOrigin: async () => 'managed-deployment-origin',
    admitTransaction: async (input) => {
      admissions.push(input)
      return { handlerId: 'handler-1' }
    },
    ...overrides
  }
  let nextId = 0
  const service = createDeploymentService(dependencies, {
    now: () => now,
    inspectionId: () => (nextId++ === 0 ? id : nextId.toString(16).padStart(32, '0')),
    evidenceTimeoutMs: 20
  })
  return {
    service,
    admissions,
    setNow: (value: number) => (now = value),
    setAccount: (value: DeploymentAccountContext | undefined) => (currentAccount = value),
    setNetwork: (value: DeploymentNetworkContext | undefined) => (network = value)
  }
}

describe('deployment preparation service', () => {
  it('prepares bounded configured-RPC evidence and a provisional CREATE address', async () => {
    const { service } = harness()
    const result = await service.prepare(draft)

    expect(result).toEqual({
      success: true,
      inspection: {
        id,
        preparedAt: 1_000,
        expiresAt: 61_000,
        account,
        chainId: '0x1',
        initcode: { bytes: 3, hash: keccak256('0x60aa00') },
        value: '0x7d',
        gasEstimate: {
          status: 'succeeded',
          source: 'configured-rpc',
          method: 'eth_estimateGas',
          value: '0x7d00',
          padded: true
        },
        simulation: {
          status: 'succeeded',
          source: 'configured-rpc',
          method: 'eth_call',
          gasUsed: '0x5208',
          advancedChecks: 'complete'
        },
        pendingNonce: {
          status: 'succeeded',
          source: 'configured-rpc',
          method: 'eth_getTransactionCount',
          nonce: '0x0',
          provisionalAddress: getCreateAddress({ from: account, nonce: 0 }).toLowerCase(),
          provisional: true
        }
      }
    })
  })

  it.each([
    [{ ...draft, initcode: '0x' }, 'invalid-initcode'],
    [{ ...draft, initcode: `0x${'00'.repeat(MAX_DEPLOYMENT_INITCODE_BYTES + 1)}` }, 'initcode-too-large'],
    [{ ...draft, value: '1.001' }, 'value-precision'],
    [{ ...draft, chainId: 0 }, 'invalid-chain-id'],
    [{ ...draft, account: 'bad' }, 'invalid-account']
  ])('maps domain failure for %p to %s', async (input, error) => {
    await expect(harness().service.prepare(input)).resolves.toEqual({ success: false, error })
  })

  it.each([
    [undefined, 'account-unavailable'],
    [{ id: otherAccount, status: 'ok', watchOnly: false, signerCapable: true }, 'account-changed'],
    [{ id: account, status: 'ok', watchOnly: true, signerCapable: false }, 'watch-only'],
    [{ id: account, status: 'ok', watchOnly: false, signerCapable: false }, 'signer-unavailable'],
    [{ id: account, status: 'disconnected', watchOnly: false, signerCapable: true }, 'account-unavailable']
  ])('rejects ineligible account context', async (value, error) => {
    const test = harness()
    test.setAccount(value as DeploymentAccountContext | undefined)
    await expect(test.service.prepare(draft)).resolves.toEqual({ success: false, error })
  })

  it.each([
    [undefined, 'network-missing'],
    [
      { type: 'ethereum', chainId: 1, configured: true, enabled: false, connected: true, nativeDecimals: 2 },
      'network-disabled'
    ],
    [
      { type: 'ethereum', chainId: 1, configured: true, enabled: true, connected: false, nativeDecimals: 2 },
      'network-disconnected'
    ],
    [
      {
        type: 'ethereum',
        chainId: 1,
        configured: true,
        enabled: true,
        connected: true,
        nativeDecimals: '18'
      },
      'invalid-native-decimals'
    ]
  ])('rejects unavailable network context', async (value, error) => {
    const test = harness()
    test.setNetwork(value as DeploymentNetworkContext | undefined)
    await expect(test.service.prepare(draft)).resolves.toEqual({ success: false, error })
  })

  it('rejects account and network changes raced by configured-RPC evidence', async () => {
    let resolveGas!: (value: string) => void
    const gas = new Promise<string>((resolve) => (resolveGas = resolve))
    const accountTest = harness({ estimateGas: () => gas })
    const accountPreparation = accountTest.service.prepare(draft)
    await Promise.resolve()
    accountTest.setAccount({ id: otherAccount, status: 'ok', watchOnly: false, signerCapable: true })
    resolveGas('0x1')
    await expect(accountPreparation).resolves.toEqual({ success: false, error: 'account-changed' })

    let resolveSimulation!: (value: unknown) => void
    const simulation = new Promise<unknown>((resolve) => (resolveSimulation = resolve))
    const networkTest = harness({ simulateTransaction: () => simulation })
    const networkPreparation = networkTest.service.prepare(draft)
    await Promise.resolve()
    networkTest.setNetwork({
      type: 'ethereum',
      chainId: 1,
      configured: true,
      enabled: true,
      connected: false,
      nativeDecimals: 2
    })
    resolveSimulation({ status: 'succeeded', source: 'eth_call' })
    await expect(networkPreparation).resolves.toEqual({ success: false, error: 'network-changed' })
  })

  it.each([
    [
      { status: 'reverted', source: 'eth_call', reason: 'secret endpoint detail' },
      'reverted',
      'execution-reverted'
    ],
    [
      { status: 'unavailable', source: 'eth_call', reason: 'secret endpoint detail' },
      'unavailable',
      'rpc-unavailable'
    ],
    [{ status: 'failed', source: 'eth_call', reason: 'secret endpoint detail' }, 'failed', 'rpc-error'],
    [{ status: 'pending', source: 'eth_call' }, 'failed', 'invalid-response'],
    [{ status: 'succeeded' }, 'failed', 'invalid-response'],
    [{ status: 'reverted', reason: 'secret endpoint detail' }, 'failed', 'invalid-response'],
    [{ status: 'succeeded', source: 'bogus' }, 'failed', 'invalid-response'],
    [{ status: 'succeeded', source: 'eth_call', gasUsed: 'bad' }, 'failed', 'invalid-response']
  ])('projects simulation %p without raw RPC details', async (raw, status, reasonCode) => {
    const result = await harness({ simulateTransaction: async () => raw }).service.prepare(draft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.inspection.simulation).toEqual(expect.objectContaining({ status, reasonCode }))
      expect(JSON.stringify(result.inspection.simulation)).not.toContain('secret endpoint detail')
    }
  })

  it('projects thrown, unavailable, timeout, malformed gas, and malformed nonce evidence', async () => {
    const failed = await harness({
      estimateGas: async () => {
        throw new Error('https://secret-rpc.invalid')
      },
      simulateTransaction: async () => {
        throw new DeploymentEvidenceError('unavailable')
      },
      getPendingNonce: async () => '0x00'
    }).service.prepare(draft)
    expect(failed.success).toBe(true)
    if (failed.success) {
      expect(failed.inspection.gasEstimate).toEqual(
        expect.objectContaining({ status: 'failed', reasonCode: 'rpc-error' })
      )
      expect(failed.inspection.simulation).toEqual(
        expect.objectContaining({ status: 'unavailable', reasonCode: 'rpc-unavailable' })
      )
      expect(failed.inspection.pendingNonce).toEqual(
        expect.objectContaining({ status: 'failed', reasonCode: 'invalid-response' })
      )
      expect(JSON.stringify(failed.inspection)).not.toContain('secret-rpc')
    }

    const timeoutPreparation = harness({
      simulateTransaction: () => new Promise(() => {})
    }).service.prepare(draft)
    await jest.advanceTimersByTimeAsync(20)
    const timeout = await timeoutPreparation
    expect(timeout.success).toBe(true)
    if (timeout.success) {
      expect(timeout.inspection.simulation).toEqual(
        expect.objectContaining({ status: 'unavailable', reasonCode: 'timeout' })
      )
    }
  })
})

describe('deployment queue binding', () => {
  it('queues the exact no-to transaction with frozen trusted metadata and no recipient field', async () => {
    const test = harness()
    const prepared = await test.service.prepare(draft)
    expect(prepared.success).toBe(true)
    const result = await test.service.queue({ inspectionId: id, draft })

    expect(result).toEqual(expect.objectContaining({ success: true, handlerId: 'handler-1' }))
    expect(test.admissions).toHaveLength(1)
    const admitted = test.admissions[0]!
    expect(admitted.transaction).toEqual({ from: account, chainId: '0x1', data: '0x60aa00', value: '0x7d' })
    expect(Object.keys(admitted.transaction)).toEqual(['from', 'chainId', 'data', 'value'])
    expect('to' in admitted.transaction).toBe(false)
    expect('recentRecipient' in admitted).toBe(false)
    expect(admitted.metadata).toEqual({
      version: 1,
      inspectionId: id,
      account,
      chainId: '0x1',
      initcodeHash: keccak256('0x60aa00'),
      initcodeBytes: 3,
      value: '0x7d',
      preparedAt: 1_000,
      expiresAt: 61_000,
      provisionalAddress: getCreateAddress({ from: account, nonce: 0 }).toLowerCase(),
      pendingNonce: '0x0'
    })
    expect(Object.isFrozen(admitted.metadata)).toBe(true)
  })

  it.each([
    [{ ...draft, initcode: '0x6000' }],
    [{ ...draft, value: '1.24' }],
    [{ ...draft, account: otherAccount }],
    [{ ...draft, chainId: 10 }]
  ])('rejects an exact draft mutation', async (changedDraft) => {
    const test = harness()
    await test.service.prepare(draft)
    await expect(test.service.queue({ inspectionId: id, draft: changedDraft })).resolves.toEqual(
      expect.objectContaining({ success: false })
    )
    expect(test.admissions).toHaveLength(0)
  })

  it('rejects expiry and replay', async () => {
    const test = harness()
    await test.service.prepare(draft)
    test.setNow(61_000)
    await expect(test.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'inspection-expired'
    })

    const replay = harness()
    await replay.service.prepare(draft)
    await expect(replay.service.queue({ inspectionId: id, draft })).resolves.toEqual(
      expect.objectContaining({ success: true })
    )
    await expect(replay.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'inspection-unavailable'
    })
  })

  it('admits at most once under concurrent queue calls', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    const test = harness({
      admitTransaction: async () => {
        calls += 1
        await gate
        return { handlerId: 'handler-1' }
      }
    })
    await test.service.prepare(draft)
    const first = test.service.queue({ inspectionId: id, draft })
    const second = test.service.queue({ inspectionId: id, draft })
    release()
    await expect(first).resolves.toEqual(expect.objectContaining({ success: true }))
    await expect(second).resolves.toEqual({ success: false, error: 'inspection-unavailable' })
    expect(calls).toBe(1)
  })

  it('consumes the inspection on provider admission failure to avoid duplicate uncertain submission', async () => {
    const test = harness({
      admitTransaction: async () => {
        throw new Error('provider secret')
      }
    })
    await test.service.prepare(draft)
    await expect(test.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'queue-unavailable'
    })
    await expect(test.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'inspection-unavailable'
    })
  })

  it('bounds managed-origin failures and consumes the attempted inspection', async () => {
    const test = harness({
      ensureDeploymentOrigin: async () => {
        throw new Error('origin store secret')
      }
    })
    await test.service.prepare(draft)
    await expect(test.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'origin-unavailable'
    })
    await expect(test.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'inspection-unavailable'
    })
  })

  it('rechecks context after asynchronously ensuring the managed origin', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const test = harness({
      ensureDeploymentOrigin: async () => {
        await gate
        return 'managed-deployment-origin'
      }
    })
    await test.service.prepare(draft)
    const queued = test.service.queue({ inspectionId: id, draft })
    await Promise.resolve()
    test.setNetwork({
      type: 'ethereum',
      chainId: 1,
      configured: true,
      enabled: true,
      connected: false,
      nativeDecimals: 2
    })
    release()
    await expect(queued).resolves.toEqual({ success: false, error: 'network-changed' })
    expect(test.admissions).toHaveLength(0)
  })

  it('rejects account/network context changes at queue time', async () => {
    const accountTest = harness()
    await accountTest.service.prepare(draft)
    accountTest.setAccount({ id: otherAccount, status: 'ok', watchOnly: false, signerCapable: true })
    await expect(accountTest.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'account-changed'
    })

    const networkTest = harness()
    await networkTest.service.prepare(draft)
    networkTest.setNetwork({
      type: 'ethereum',
      chainId: 1,
      configured: true,
      enabled: false,
      connected: true,
      nativeDecimals: 2
    })
    await expect(networkTest.service.queue({ inspectionId: id, draft })).resolves.toEqual({
      success: false,
      error: 'network-disabled'
    })
  })

  it('bounds capacity without evicting fresh inspections', async () => {
    let next = 0
    const test = harness()
    const service = createDeploymentService(
      {
        getCurrentAccount: () => ({ id: account, status: 'ok', watchOnly: false, signerCapable: true }),
        getNetwork: () => ({
          type: 'ethereum',
          chainId: 1,
          configured: true,
          enabled: true,
          connected: true,
          nativeDecimals: 2
        }),
        estimateGas: async () => '0x1',
        simulateTransaction: async () => ({ status: 'succeeded', source: 'eth_call' }),
        getPendingNonce: async () => '0x0',
        ensureDeploymentOrigin: async () => 'origin',
        admitTransaction: async () => ({ handlerId: 'handler' })
      },
      { capacity: 1, inspectionId: () => (++next).toString(16).padStart(32, '0') }
    )
    await expect(service.prepare(draft)).resolves.toEqual(expect.objectContaining({ success: true }))
    await expect(service.prepare(draft)).resolves.toEqual({ success: false, error: 'inspection-capacity' })
    expect(test.admissions).toHaveLength(0)
  })
})
