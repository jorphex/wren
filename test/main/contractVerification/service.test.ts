import { getCreateAddress, keccak256 } from 'ethers'

import {
  createContractVerificationService,
  type ContractVerificationServiceDependencies
} from '../../../main/contractVerification/service'
import { ContractVerificationJobLedger } from '../../../main/contractVerification/jobLedger'
import type { ContractVerificationArtifactIntake } from '../../../main/contractVerification/artifactIntake'
import type { EtherscanApiKeyStore } from '../../../main/contractVerification/credentialStorage'
import type {
  ContractVerificationArtifact,
  ContractVerificationJobRecord
} from '../../../resources/domain/contractVerification'
import { WREN_DEPLOY_ORIGIN, originIdForName } from '../../../resources/domain/origin'
import type { OperationLifecycle } from '../../../main/store/state/types/operationLifecycle'

const ADDRESS = `0x${'12'.repeat(20)}`
const ACCOUNT = `0x${'34'.repeat(20)}`
const CODE = '0x6001600055'
const HASH_10 = `0x${'10'.repeat(32)}`
const HASH_5 = `0x${'05'.repeat(32)}`
const TX_HASH = `0x${'ab'.repeat(32)}`
const COMPILER = '0.8.24+commit.e11b9ed9'
const CONTRACT = 'contracts/Counter.sol:Counter'
const API_KEY = 'Abcdefghijklmnop_1234567890'
const GUID = 'etherscan-guid-0001'
const REMOTE_ID = '550e8400-e29b-41d4-a716-446655440000'

const rawArtifact = (): ContractVerificationArtifact => ({
  format: 'solidity-standard-json',
  language: 'Solidity',
  compilerVersion: null,
  sourceCount: 1,
  contractCandidates: [],
  localRuntimeMatch: false,
  stdJsonInput: {
    language: 'Solidity',
    sources: { 'contracts/Counter.sol': { content: 'contract Counter {}' } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai' }
  },
  compilerOutput: null
})

const buildArtifact = (code = CODE): ContractVerificationArtifact => ({
  ...rawArtifact(),
  format: 'hardhat-2-build-info',
  compilerVersion: COMPILER,
  contractCandidates: [CONTRACT],
  localRuntimeMatch: true,
  compilerOutput: {
    contracts: {
      'contracts/Counter.sol': {
        Counter: {
          evm: { deployedBytecode: { object: code.slice(2), linkReferences: {}, immutableReferences: {} } }
        }
      }
    }
  }
})

const operationAddress = getCreateAddress({ from: ACCOUNT, nonce: 0n }).toLowerCase()

const managedOperation = (settled = false): OperationLifecycle => ({
  id: '10000000-0000-4000-8000-000000000001',
  kind: 'transaction',
  account: ACCOUNT,
  origin: originIdForName(WREN_DEPLOY_ORIGIN),
  chainId: 1,
  state: 'confirmed',
  createdAt: 1,
  updatedAt: 2,
  expiresAt: 100_000,
  visibleInActivity: true,
  notification: {},
  transaction: {
    hash: TX_HASH,
    nonce: '0x0',
    deployment: {
      version: 1,
      inspectionId: '1'.repeat(32),
      initcodeHash: `0x${'22'.repeat(32)}`,
      initcodeBytes: 5,
      value: '0x0'
    }
  },
  receipt: {
    transactionHash: TX_HASH,
    blockHash: HASH_5,
    blockNumber: '0x5',
    status: '0x1',
    contractAddress: operationAddress
  },
  settlement: settled ? { status: 'complete', basis: 'confirmations' } : { status: 'monitoring' }
})

type HarnessOptions = {
  artifact?: ContractVerificationArtifact
  now?: number
  operation?: OperationLifecycle
  persisted?: readonly ContractVerificationJobRecord[]
}

const harness = (options: HarnessOptions = {}) => {
  let timestamp = options.now ?? 100
  let artifact = options.artifact || rawArtifact()
  let operation = options.operation
  let code = CODE
  let unstable = false
  let network = {
    type: 'ethereum' as const,
    chainId: 1,
    configured: true,
    enabled: true,
    connected: true
  }
  let persisted: readonly ContractVerificationJobRecord[] = options.persisted || []
  let apiKey: string | undefined = API_KEY
  let id = 0
  const jobs = new ContractVerificationJobLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })
  const artifactIntake = {
    inspect: jest.fn(),
    select: jest.fn(),
    peek: jest.fn(),
    dispose: jest.fn(),
    consume: jest.fn(() => ({ artifact, contractIdentifier: artifact.localRuntimeMatch ? CONTRACT : null }))
  } as unknown as ContractVerificationArtifactIntake
  const credentialStore = {
    credentialPath: '/private/credential',
    status: jest.fn(() => ({ available: true, configured: Boolean(apiKey), backend: 'secret_service' })),
    load: jest.fn(() => apiKey),
    save: jest.fn((value: string) => {
      apiKey = value
      return { available: true, configured: true, backend: 'secret_service' }
    }),
    remove: jest.fn(() => {
      apiKey = undefined
      return { available: true, configured: false, backend: 'secret_service' }
    })
  } as unknown as EtherscanApiKeyStore
  const sourcify = {
    submit: jest.fn(async () => ({ status: 'accepted' as const, verificationId: REMOTE_ID })),
    status: jest.fn(async () => ({ status: 'pending' as const }))
  }
  const etherscan = {
    submit: jest.fn(async () => ({ status: 'accepted' as const, guid: GUID })),
    status: jest.fn(async () => ({ status: 'pending' as const }))
  }
  const rpc = jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    if (method === 'eth_getCode') return code
    if (method === 'eth_getTransactionReceipt') {
      return {
        transactionHash: TX_HASH,
        blockHash: HASH_5,
        blockNumber: '0x5',
        status: '0x1',
        contractAddress: operationAddress
      }
    }
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === '0x5') return { number: '0x5', hash: HASH_5 }
      if (params[0] === 'latest') return { number: '0x10', hash: HASH_10 }
      return { number: '0x10', hash: unstable ? `0x${'11'.repeat(32)}` : HASH_10 }
    }
    throw new Error('unsupported method')
  })
  const dependencies: ContractVerificationServiceDependencies = {
    artifactIntake,
    credentialStore,
    etherscan,
    getNetwork: () => network,
    jobs,
    operations: { get: () => operation },
    rpc,
    sourcify
  }
  const service = createContractVerificationService(dependencies, {
    now: () => timestamp,
    randomUUID: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, '0')}`
  })

  const prepare = (overrides: Record<string, unknown> = {}) =>
    service.prepare({
      artifactToken: 'artifact-token',
      chainId: 1,
      address: ADDRESS,
      compilerVersion: COMPILER,
      contractIdentifier: CONTRACT,
      ...overrides
    })

  const prepareAndPublish = async () => {
    const result = await prepare()
    if (!result.success) throw new Error(result.error)
    return service.publish({
      acknowledgementToken: result.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  }

  return {
    service,
    prepare,
    prepareAndPublish,
    jobs,
    rpc,
    sourcify,
    etherscan,
    artifactIntake,
    credentialStore,
    persisted: () => persisted,
    setArtifact: (value: ContractVerificationArtifact) => {
      artifact = value
    },
    setCode: (value: string) => {
      code = value
    },
    setNetwork: (value: Partial<typeof network>) => {
      network = { ...network, ...value }
    },
    setOperation: (value: OperationLifecycle | undefined) => {
      operation = value
    },
    setTime: (value: number) => {
      timestamp = value
    },
    setUnstable: (value: boolean) => {
      unstable = value
    },
    removeKey: () => {
      apiKey = undefined
    }
  }
}

test('prepares a renderer-safe, block-bound raw standard JSON target', async () => {
  const subject = harness()
  const result = await subject.prepare({ address: ADDRESS.toUpperCase().replace('0X', '0x') })

  expect(result).toEqual({
    success: true,
    prepared: expect.objectContaining({
      acknowledgementToken: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      target: { address: ADDRESS, chainId: 1, runtimeCodeHash: keccak256(CODE) },
      localRuntimeMatch: 'server-required',
      deploymentSettlement: 'not-applicable'
    })
  })
  expect(Object.isFrozen(result)).toBe(true)
  expect(JSON.stringify(result)).not.toContain('contract Counter')
  expect(subject.rpc.mock.calls).toEqual([
    [1, 'eth_getBlockByNumber', ['latest', false]],
    [1, 'eth_getCode', [ADDRESS, '0x10']],
    [1, 'eth_getBlockByNumber', ['0x10', false]]
  ])
})

test('requires an enabled configured connection, stable canonical block, and nonempty code', async () => {
  const missing = harness()
  missing.setNetwork({ configured: false })
  await expect(missing.prepare()).resolves.toEqual({ success: false, error: 'network-missing' })

  const disabled = harness()
  disabled.setNetwork({ enabled: false })
  await expect(disabled.prepare()).resolves.toEqual({ success: false, error: 'network-disabled' })

  const disconnected = harness()
  disconnected.setNetwork({ connected: false })
  await expect(disconnected.prepare()).resolves.toEqual({ success: false, error: 'network-disconnected' })

  const unstable = harness()
  unstable.setUnstable(true)
  await expect(unstable.prepare()).resolves.toEqual({ success: false, error: 'unstable-chain' })

  const empty = harness()
  empty.setCode('0x')
  await expect(empty.prepare()).resolves.toEqual({ success: false, error: 'address-has-no-code' })
})

test('locally matches build-info runtime and rejects a mismatch before publication', async () => {
  const matched = harness({ artifact: buildArtifact() })
  await expect(matched.prepare({ compilerVersion: undefined })).resolves.toEqual({
    success: true,
    prepared: expect.objectContaining({ localRuntimeMatch: 'matched' })
  })

  const mismatch = harness({ artifact: buildArtifact('0x6002600055') })
  await expect(mismatch.prepare({ compilerVersion: undefined })).resolves.toEqual({
    success: false,
    error: 'artifact-mismatch'
  })
})

test('binds only exact managed successful deployment evidence and gates publishing on settlement', async () => {
  const subject = harness({ operation: managedOperation(false) })
  const prepared = await subject.prepare({
    address: operationAddress,
    operationId: managedOperation().id
  })
  expect(prepared).toEqual({
    success: true,
    prepared: expect.objectContaining({
      deploymentSettlement: 'pending',
      target: expect.objectContaining({
        address: operationAddress,
        creationEvidence: {
          transactionHash: TX_HASH,
          blockHash: HASH_5,
          blockNumber: '0x5',
          operationId: managedOperation().id
        }
      })
    })
  })
  if (!prepared.success) throw new Error('expected prepared result')
  await expect(
    subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'operation-unsettled' })
  expect(subject.sourcify.submit).not.toHaveBeenCalled()
  await expect(
    subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'session-expired' })

  const expired = harness({
    operation: { ...managedOperation(true), settlement: { status: 'complete', basis: 'expired' } }
  })
  const expiredPrepared = await expired.prepare({
    address: operationAddress,
    operationId: managedOperation().id
  })
  expect(expiredPrepared).toEqual({
    success: true,
    prepared: expect.objectContaining({ deploymentSettlement: 'pending' })
  })
  if (!expiredPrepared.success) throw new Error('expected expired prepared result')
  await expect(
    expired.service.publish({
      acknowledgementToken: expiredPrepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'operation-unsettled' })
  expect(expired.sourcify.submit).not.toHaveBeenCalled()

  const foreign = harness({ operation: { ...managedOperation(true), origin: 'foreign' } })
  await expect(
    foreign.prepare({ address: operationAddress, operationId: managedOperation().id })
  ).resolves.toEqual({ success: false, error: 'invalid-operation' })

  const ordinary = harness({
    operation: {
      ...managedOperation(true),
      transaction: { hash: TX_HASH, nonce: '0x0' }
    }
  })
  await expect(
    ordinary.prepare({ address: operationAddress, operationId: managedOperation().id })
  ).resolves.toEqual({ success: false, error: 'invalid-operation' })

  const reverted = harness({ operation: { ...managedOperation(true), state: 'failed' } })
  await expect(
    reverted.prepare({ address: operationAddress, operationId: managedOperation().id })
  ).resolves.toEqual({ success: false, error: 'operation-not-confirmed' })

  const invalidAccount = harness({ operation: { ...managedOperation(true), account: ADDRESS } })
  await expect(
    invalidAccount.prepare({ address: operationAddress, operationId: managedOperation().id })
  ).resolves.toEqual({ success: false, error: 'invalid-operation' })
})

test('rejects canonical receipt mismatch and target mutation before the Sourcify side effect', async () => {
  const reorged = harness({ operation: managedOperation(true) })
  reorged.rpc.mockImplementationOnce(async () => ({
    transactionHash: TX_HASH,
    blockHash: `0x${'99'.repeat(32)}`,
    blockNumber: '0x5',
    status: '0x1',
    contractAddress: operationAddress
  }))
  await expect(
    reorged.prepare({ address: operationAddress, operationId: managedOperation().id })
  ).resolves.toEqual({ success: false, error: 'target-changed' })

  const mutated = harness()
  const prepared = await mutated.prepare()
  if (!prepared.success) throw new Error('expected prepared result')
  mutated.setCode('0x6002600055')
  await expect(
    mutated.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'target-changed' })
  expect(mutated.sourcify.submit).not.toHaveBeenCalled()
})

test('consumes explicit acknowledgement once and persists intent before its single Sourcify POST', async () => {
  const subject = harness()
  const prepared = await subject.prepare()
  if (!prepared.success) throw new Error('expected prepared result')
  await expect(
    subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'no'
    })
  ).resolves.toEqual({ success: false, error: 'confirmation-required' })

  subject.sourcify.submit.mockImplementationOnce(async (input) => {
    expect(input.stdJsonInput).toEqual(expect.objectContaining({ sources: expect.any(Object) }))
    expect(subject.persisted()[0]).toEqual(
      expect.objectContaining({
        status: 'publishing',
        destinations: expect.arrayContaining([{ destination: 'sourcify', status: 'not-submitted' }])
      })
    )
    return { status: 'accepted', verificationId: REMOTE_ID }
  })
  const published = await subject.service.publish({
    acknowledgementToken: prepared.prepared.acknowledgementToken,
    confirmation: 'PUBLISH_CONTRACT_SOURCE'
  })
  expect(published).toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'publishing',
      destinations: expect.arrayContaining([
        { destination: 'sourcify', status: 'checking', remoteId: REMOTE_ID }
      ])
    })
  })
  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
  await expect(
    subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'session-expired' })
})

test('expires acknowledgement sessions and enforces bounded concurrent preparation', async () => {
  const subject = harness({ now: 1 })
  const first = await subject.prepare()
  const second = await subject.prepare()
  expect(first.success && second.success).toBe(true)
  await expect(subject.prepare()).resolves.toEqual({ success: false, error: 'session-capacity' })
  subject.setTime(10 * 60 * 1000 + 1)
  if (!first.success) throw new Error('expected prepared result')
  await expect(
    subject.service.publish({
      acknowledgementToken: first.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'session-expired' })
})

test('persists accepted, already-published, and fixed rejected/unavailable outcomes', async () => {
  const accepted = harness()
  await expect(accepted.prepareAndPublish()).resolves.toEqual({
    success: true,
    job: expect.objectContaining({ status: 'publishing' })
  })

  const already = harness()
  already.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  await expect(already.prepareAndPublish()).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'published',
      destinations: [
        { destination: 'sourcify', status: 'already-published' },
        { destination: 'etherscan-forwarded', status: 'not-submitted' },
        { destination: 'blockscout-forwarded', status: 'not-submitted' },
        { destination: 'routescan-forwarded', status: 'not-submitted' },
        { destination: 'etherscan-direct', status: 'not-submitted' }
      ]
    })
  })

  const unavailable = harness()
  unavailable.sourcify.submit.mockResolvedValueOnce({ status: 'error', reason: 'timeout' })
  await expect(unavailable.prepareAndPublish()).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'unknown',
      destinations: expect.arrayContaining([
        { destination: 'sourcify', status: 'unavailable', reasonCode: 'request-timeout' }
      ])
    })
  })

  const rejected = harness()
  rejected.sourcify.submit.mockResolvedValueOnce({ status: 'error', reason: 'rejected' })
  await expect(rejected.prepareAndPublish()).resolves.toEqual({
    success: true,
    job: expect.objectContaining({ status: 'rejected' })
  })
})

test('polls accepted Sourcify IDs without POST and treats external metadata as non-terminal', async () => {
  const subject = harness()
  const published = await subject.prepareAndPublish()
  if (!published.success) throw new Error('expected job')
  subject.sourcify.status.mockResolvedValueOnce({
    status: 'succeeded',
    creationMatch: null,
    runtimeMatch: 'exact_match',
    externalVerifications: {
      etherscan: { verificationId: 'external-ticket' },
      blockscout: { explorerUrl: `https://eth.blockscout.com/address/${ADDRESS}` },
      routescan: {
        statusUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
        error: 'rejected'
      }
    }
  })
  const refreshed = await subject.service.refresh(published.job.id)
  expect(refreshed).toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'published',
      destinations: [
        { destination: 'sourcify', status: 'published', remoteId: REMOTE_ID },
        {
          destination: 'etherscan-forwarded',
          status: 'unknown',
          reasonCode: 'status-unavailable'
        },
        {
          destination: 'blockscout-forwarded',
          status: 'unknown',
          explorerUrl: `https://eth.blockscout.com/address/${ADDRESS}`,
          reasonCode: 'status-unavailable'
        },
        {
          destination: 'routescan-forwarded',
          status: 'rejected',
          statusUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
          reasonCode: 'destination-rejected'
        },
        { destination: 'etherscan-direct', status: 'not-submitted' }
      ]
    })
  })
  expect(subject.sourcify.status).toHaveBeenCalledWith(REMOTE_ID, { chainId: 1, address: ADDRESS })
  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
})

test('projects an accepted Sourcify rejection while preserving its remote evidence', async () => {
  const subject = harness()
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.sourcify.status.mockResolvedValueOnce({ status: 'failed', reason: 'no_match' })

  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'rejected',
      destinations: expect.arrayContaining([
        {
          destination: 'sourcify',
          status: 'rejected',
          remoteId: REMOTE_ID,
          reasonCode: 'publication-rejected'
        }
      ])
    })
  })
  expect(subject.sourcify.status).toHaveBeenCalledTimes(1)
  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
})

test('marks crash-uncertain persisted publication intent unknown without resubmitting', async () => {
  const initial: ContractVerificationJobRecord = {
    id: '90000000-0000-4000-8000-000000000001',
    target: { address: ADDRESS, chainId: 1, runtimeCodeHash: keccak256(CODE) },
    language: 'Solidity',
    compilerVersion: COMPILER,
    contractIdentifier: CONTRACT,
    sourceHash: '1'.repeat(64),
    submissionHash: '2'.repeat(64),
    status: 'publishing',
    destinations: [
      { destination: 'sourcify', status: 'not-submitted' },
      { destination: 'etherscan-forwarded', status: 'not-submitted' },
      { destination: 'blockscout-forwarded', status: 'not-submitted' },
      { destination: 'routescan-forwarded', status: 'not-submitted' },
      { destination: 'etherscan-direct', status: 'not-submitted' }
    ],
    createdAt: 1,
    updatedAt: 1
  }
  const subject = harness({ persisted: [initial] })
  await expect(subject.service.refresh(initial.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'unknown',
      destinations: expect.arrayContaining([
        { destination: 'sourcify', status: 'unknown', reasonCode: 'status-unavailable' }
      ])
    })
  })
  expect(subject.sourcify.submit).not.toHaveBeenCalled()
})

test('manually recovers a missing accepted Sourcify job without resubmitting it', async () => {
  const subject = harness()
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.sourcify.status.mockResolvedValueOnce({ status: 'unknown', reason: 'not_found' })
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'unknown',
      destinations: expect.arrayContaining([
        {
          destination: 'sourcify',
          status: 'unknown',
          remoteId: REMOTE_ID,
          reasonCode: 'status-unavailable'
        }
      ])
    })
  })
  subject.sourcify.status.mockResolvedValueOnce({
    status: 'succeeded',
    creationMatch: null,
    runtimeMatch: 'exact_match',
    externalVerifications: {}
  })
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'published',
      destinations: expect.arrayContaining([
        { destination: 'sourcify', status: 'published', remoteId: REMOTE_ID }
      ])
    })
  })
  expect(subject.sourcify.status).toHaveBeenCalledTimes(2)
  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
})

test('manually follows a missing accepted Sourcify job through pending to rejected', async () => {
  const subject = harness()
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.sourcify.status.mockResolvedValueOnce({ status: 'unknown', reason: 'not_found' })
  await subject.service.refresh(publication.job.id)

  subject.sourcify.status.mockResolvedValueOnce({ status: 'pending' })
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'unknown',
      destinations: expect.arrayContaining([
        {
          destination: 'sourcify',
          status: 'unknown',
          remoteId: REMOTE_ID,
          reasonCode: 'status-unavailable'
        }
      ])
    })
  })

  subject.sourcify.status.mockResolvedValueOnce({ status: 'failed', reason: 'no_match' })
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      status: 'rejected',
      destinations: expect.arrayContaining([
        {
          destination: 'sourcify',
          status: 'rejected',
          remoteId: REMOTE_ID,
          reasonCode: 'publication-rejected'
        }
      ])
    })
  })
  expect(subject.sourcify.status).toHaveBeenCalledTimes(3)
  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
})

test('uses an explicit, persisted, idempotent direct Etherscan fallback and resumes its GUID', async () => {
  const subject = harness()
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.etherscan.submit.mockImplementationOnce(async (input, key) => {
    expect(key).toBe(API_KEY)
    expect(input).toEqual(
      expect.objectContaining({
        contractAddress: ADDRESS,
        compilerVersion: `v${COMPILER}`,
        constructorArguments: '12Ab',
        optimization: { used: true, runs: 200 },
        evmVersion: 'shanghai'
      })
    )
    expect(subject.jobs.get(publication.job.id)?.destinations).toContainEqual({
      destination: 'etherscan-direct',
      status: 'unknown',
      reasonCode: 'status-unavailable'
    })
    return { status: 'accepted', guid: GUID }
  })
  const direct = await subject.service.publishEtherscan({
    jobId: publication.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    constructorArguments: '12Ab'
  })
  expect(direct).toEqual({
    success: true,
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        { destination: 'etherscan-direct', status: 'checking', remoteId: GUID }
      ])
    })
  })
  await expect(
    subject.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  subject.etherscan.status.mockResolvedValueOnce({ status: 'verified' })
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        { destination: 'etherscan-direct', status: 'verified', remoteId: GUID }
      ])
    })
  })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)
})

test('retries only unaccepted direct failures and resumes an accepted GUID after key replacement', async () => {
  const retry = harness()
  retry.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const publication = await retry.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  retry.etherscan.submit
    .mockResolvedValueOnce({ status: 'unavailable' })
    .mockResolvedValueOnce({ status: 'accepted', guid: GUID })
  await expect(
    retry.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        {
          destination: 'etherscan-direct',
          status: 'unavailable',
          reasonCode: 'destination-unavailable'
        }
      ])
    })
  })
  await retry.service.publishEtherscan({
    jobId: publication.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    noConstructorArguments: true
  })
  expect(retry.etherscan.submit).toHaveBeenCalledTimes(2)

  retry.etherscan.status.mockResolvedValueOnce({ status: 'invalid_api_key' })
  await expect(retry.service.refresh(publication.job.id)).resolves.toEqual({
    success: false,
    error: 'api-key-required',
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        {
          destination: 'etherscan-direct',
          status: 'needs-api-key',
          remoteId: GUID,
          reasonCode: 'api-key-required'
        }
      ])
    })
  })
  retry.etherscan.status.mockResolvedValueOnce({ status: 'pending' })
  await expect(retry.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        { destination: 'etherscan-direct', status: 'checking', remoteId: GUID }
      ])
    })
  })
  expect(retry.etherscan.submit).toHaveBeenCalledTimes(2)
})

test('does not retry a rejected direct Etherscan submission', async () => {
  const subject = harness()
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.etherscan.submit.mockResolvedValueOnce({ status: 'rejected' })

  await expect(
    subject.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        {
          destination: 'etherscan-direct',
          status: 'rejected',
          reasonCode: 'destination-rejected'
        }
      ])
    })
  })
  await expect(
    subject.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)
})

test.each([100, 747474])('allows audited direct Etherscan fallback on chain %i', async (chainId) => {
  const subject = harness()
  subject.setNetwork({ chainId })
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const prepared = await subject.prepare({ chainId })
  if (!prepared.success) throw new Error('expected prepared result')
  const publication = await subject.service.publish({
    acknowledgementToken: prepared.prepared.acknowledgementToken,
    confirmation: 'PUBLISH_CONTRACT_SOURCE'
  })
  if (!publication.success) throw new Error('expected publication')
  await expect(
    subject.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: true, job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledWith(expect.objectContaining({ chainId }), API_KEY)
})

test('gates direct fallback on destination, key, exact cached source, and current target', async () => {
  const noKey = harness()
  noKey.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const published = await noKey.prepareAndPublish()
  if (!published.success) throw new Error('expected job')
  noKey.removeKey()
  await expect(
    noKey.service.publishEtherscan({
      jobId: published.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'api-key-required', job: expect.any(Object) })

  const mutated = harness()
  mutated.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const mutationJob = await mutated.prepareAndPublish()
  if (!mutationJob.success) throw new Error('expected job')
  mutated.setCode('0x6002600055')
  await expect(
    mutated.service.publishEtherscan({
      jobId: mutationJob.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'target-changed', job: expect.any(Object) })
  expect(mutated.etherscan.submit).not.toHaveBeenCalled()

  const expired = harness({ now: 1 })
  expired.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const expiredJob = await expired.prepareAndPublish()
  if (!expiredJob.success) throw new Error('expected job')
  expired.setTime(10 * 60 * 1000 + 1)
  await expect(
    expired.service.publishEtherscan({
      jobId: expiredJob.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({
    success: false,
    error: 'source-reselection-required',
    job: expect.any(Object)
  })

  const restarted = harness({ persisted: [mutationJob.job] })
  await expect(
    restarted.service.publishEtherscan({
      jobId: mutationJob.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'source-reselection-required', job: expect.any(Object) })
})

test('reselects only the exact persisted source identity and never exposes source, key, or raw responses', async () => {
  const original = harness()
  original.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const publication = await original.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')

  const restarted = harness({ persisted: [publication.job] })
  await expect(
    restarted.service.reselect({
      artifactToken: 'fresh-token',
      jobId: publication.job.id,
      compilerVersion: COMPILER,
      contractIdentifier: CONTRACT
    })
  ).resolves.toEqual({ success: true, job: publication.job })
  const listed = restarted.service.list()
  const fetched = restarted.service.get(publication.job.id)
  const credential = restarted.service.credentialStatus()
  for (const result of [listed, fetched, credential]) {
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('contract Counter')
    expect(serialized).not.toContain(API_KEY)
    expect(serialized).not.toContain('/private/credential')
    expect(Object.isFrozen(result)).toBe(true)
  }
})

test('keeps a job lock owned by the first concurrent refresh', async () => {
  const subject = harness()
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  let finish: ((value: { status: 'pending' }) => void) | undefined
  subject.sourcify.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const first = subject.service.refresh(publication.job.id)
  await Promise.resolve()
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: false,
    error: 'already-submitted'
  })
  finish?.({ status: 'pending' })
  await expect(first).resolves.toEqual({ success: true, job: expect.any(Object) })
  await expect(subject.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.any(Object)
  })
})
