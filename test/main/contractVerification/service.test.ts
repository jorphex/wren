import fs from 'fs'
import os from 'os'
import path from 'path'
import { getCreateAddress, keccak256 } from 'ethers'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => process.cwd()), on: jest.fn() } }))

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
  commitState?: (jobs: readonly ContractVerificationJobRecord[]) => void
  now?: number
  operation?: OperationLifecycle
  persisted?: readonly ContractVerificationJobRecord[]
  uuidOffset?: number
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
  let id = options.uuidOffset ?? 0
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
      if (operation?.receipt) return operation.receipt
      return {
        transactionHash: TX_HASH,
        blockHash: HASH_5,
        blockNumber: '0x5',
        status: '0x1',
        contractAddress: operationAddress
      }
    }
    if (method === 'eth_getBlockByNumber') {
      if (operation?.receipt && params[0] === operation.receipt.blockNumber) {
        return { number: operation.receipt.blockNumber, hash: operation.receipt.blockHash }
      }
      if (params[0] === '0x5') return { number: '0x5', hash: HASH_5 }
      if (params[0] === 'latest') return { number: '0x10', hash: HASH_10 }
      return { number: '0x10', hash: unstable ? `0x${'11'.repeat(32)}` : HASH_10 }
    }
    throw new Error('unsupported method')
  })
  const dependencies: ContractVerificationServiceDependencies = {
    artifactIntake,
    commitState: jest.fn(() => options.commitState?.(persisted)),
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
    commitState: dependencies.commitState as jest.Mock,
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

const seedEquivalentJob = async (
  subject: ReturnType<typeof harness>,
  source: ContractVerificationJobRecord,
  overrides: Partial<ContractVerificationJobRecord> = {}
) => {
  const sequence = subject.persisted().length + 1
  const job = subject.jobs.put({
    ...source,
    id: `90000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    createdAt: source.createdAt + sequence,
    updatedAt: source.updatedAt + sequence,
    ...overrides
  })
  const selected = await subject.service.reselect({
    artifactToken: 'equivalent-artifact',
    jobId: job.id,
    compilerVersion: job.compilerVersion,
    contractIdentifier: job.contractIdentifier
  })
  if (!selected.success) throw new Error(`expected equivalent source selection: ${selected.error}`)
  return job
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
        destinations: expect.arrayContaining([
          {
            destination: 'sourcify',
            status: 'unknown',
            publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
            reasonCode: 'status-unavailable'
          }
        ])
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
        {
          destination: 'sourcify',
          status: 'checking',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          remoteId: REMOTE_ID
        }
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

test('serializes equivalent Sourcify publications before the first POST settles', async () => {
  const subject = harness()
  const firstPrepared = await subject.prepare()
  const secondPrepared = await subject.prepare()
  if (!firstPrepared.success || !secondPrepared.success) throw new Error('expected prepared sessions')
  let release: ((value: { status: 'accepted'; verificationId: string }) => void) | undefined
  subject.sourcify.submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )

  const first = subject.service.publish({
    acknowledgementToken: firstPrepared.prepared.acknowledgementToken,
    confirmation: 'PUBLISH_CONTRACT_SOURCE'
  })
  while (subject.sourcify.submit.mock.calls.length === 0) await Promise.resolve()
  await expect(
    subject.service.publish({
      acknowledgementToken: secondPrepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted' })

  release?.({ status: 'accepted', verificationId: REMOTE_ID })
  await expect(first).resolves.toEqual({ success: true, job: expect.any(Object) })
  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
})

test.each(['address-first', 'operation-first'] as const)(
  'distinguishes address-only and operation-backed Sourcify publications when submitted %s',
  async (order) => {
    const operation = managedOperation(true)
    const subject = harness({ operation })
    subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
    const publishTarget = async (operationId?: string) => {
      const prepared = await subject.prepare({
        address: operationAddress,
        ...(operationId ? { operationId } : {})
      })
      if (!prepared.success) throw new Error('expected prepared target')
      return subject.service.publish({
        acknowledgementToken: prepared.prepared.acknowledgementToken,
        confirmation: 'PUBLISH_CONTRACT_SOURCE'
      })
    }

    await expect(publishTarget(order === 'operation-first' ? operation.id : undefined)).resolves.toEqual({
      success: true,
      job: expect.any(Object)
    })
    await expect(publishTarget(order === 'address-first' ? operation.id : undefined)).resolves.toEqual({
      success: true,
      job: expect.any(Object)
    })

    expect(subject.sourcify.submit).toHaveBeenCalledTimes(2)
    expect(subject.sourcify.submit.mock.calls.map(([request]) => request.creationTransactionHash)).toEqual(
      order === 'address-first' ? [undefined, TX_HASH] : [TX_HASH, undefined]
    )
  }
)

test('distinguishes Sourcify publications backed by different creation transactions', async () => {
  const firstOperation = managedOperation(true)
  const subject = harness({ operation: firstOperation })
  subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
  const publishOperation = async (operation: OperationLifecycle) => {
    subject.setOperation(operation)
    const prepared = await subject.prepare({ address: operationAddress, operationId: operation.id })
    if (!prepared.success) throw new Error('expected prepared operation')
    return subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  }

  await expect(publishOperation(firstOperation)).resolves.toEqual({ success: true, job: expect.any(Object) })
  const secondTransactionHash = `0x${'cd'.repeat(32)}`
  const secondOperation: OperationLifecycle = {
    ...firstOperation,
    id: '10000000-0000-4000-8000-000000000002',
    transaction: { ...firstOperation.transaction!, hash: secondTransactionHash },
    receipt: {
      ...firstOperation.receipt!,
      transactionHash: secondTransactionHash,
      blockHash: `0x${'06'.repeat(32)}`,
      blockNumber: '0x6'
    }
  }
  await expect(publishOperation(secondOperation)).resolves.toEqual({ success: true, job: expect.any(Object) })

  expect(subject.sourcify.submit).toHaveBeenCalledTimes(2)
  expect(subject.sourcify.submit.mock.calls.map(([request]) => request.creationTransactionHash)).toEqual([
    TX_HASH,
    secondTransactionHash
  ])
})

test('fences the same Sourcify creation transaction across block-only evidence changes', async () => {
  const firstOperation = managedOperation(true)
  const subject = harness({ operation: firstOperation })
  subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
  const publishOperation = async (operation: OperationLifecycle) => {
    subject.setOperation(operation)
    const prepared = await subject.prepare({ address: operationAddress, operationId: operation.id })
    if (!prepared.success) throw new Error('expected prepared operation')
    return subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  }

  await expect(publishOperation(firstOperation)).resolves.toEqual({ success: true, job: expect.any(Object) })
  const reorged: OperationLifecycle = {
    ...firstOperation,
    id: '10000000-0000-4000-8000-000000000003',
    receipt: {
      ...firstOperation.receipt!,
      blockHash: `0x${'07'.repeat(32)}`,
      blockNumber: '0x7'
    }
  }
  await expect(publishOperation(reorged)).resolves.toEqual({ success: false, error: 'already-submitted' })

  expect(subject.sourcify.submit).toHaveBeenCalledTimes(1)
})

test('commits the Sourcify fence before POST and its accepted polling ID before returning', async () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-contract-verification-'))
  const { commitMainState, PersistStore } = jest.requireActual('../../../main/store/persist')
  const readJobs = () => {
    const restartedDisk = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restartedDisk.get('main') as {
      __: Record<string, { main: { contractVerificationJobs: readonly ContractVerificationJobRecord[] } }>
    }
    return Object.values(envelope.__).at(-1)?.main.contractVerificationJobs || []
  }

  try {
    const disk = new PersistStore({ configName: 'config', cwd: directory })
    const subject = harness({
      commitState: (jobs) => commitMainState({ _version: 73, contractVerificationJobs: jobs }, disk)
    })
    const prepared = await subject.prepare()
    if (!prepared.success) throw new Error('expected prepared result')
    let release: ((value: { status: 'accepted'; verificationId: string }) => void) | undefined
    subject.sourcify.submit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )

    const pending = subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
    while (subject.sourcify.submit.mock.calls.length === 0) await Promise.resolve()

    const fencedJobs = readJobs()
    expect(fencedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destinations: expect.arrayContaining([
            expect.objectContaining({
              destination: 'sourcify',
              status: 'unknown',
              publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
            })
          ])
        })
      ])
    )
    const restarted = harness({ persisted: fencedJobs, uuidOffset: 100 })
    await expect(restarted.prepareAndPublish()).resolves.toEqual({
      success: false,
      error: 'already-submitted'
    })
    expect(restarted.sourcify.submit).not.toHaveBeenCalled()

    release?.({ status: 'accepted', verificationId: REMOTE_ID })
    await expect(pending).resolves.toEqual({ success: true, job: expect.any(Object) })
    expect(readJobs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destinations: expect.arrayContaining([
            expect.objectContaining({
              destination: 'sourcify',
              status: 'checking',
              publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
              remoteId: REMOTE_ID
            })
          ])
        })
      ])
    )
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

test('fails closed before Sourcify POST when its publication fence cannot be committed', async () => {
  const subject = harness({
    commitState: () => {
      throw new Error('commit failed')
    }
  })

  await expect(subject.prepareAndPublish()).resolves.toEqual({
    success: false,
    error: 'job-unavailable',
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        expect.objectContaining({
          destination: 'sourcify',
          status: 'unknown',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
        })
      ])
    })
  })
  expect(subject.sourcify.submit).not.toHaveBeenCalled()
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
        {
          destination: 'sourcify',
          status: 'already-published',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
        },
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
        {
          destination: 'sourcify',
          status: 'unavailable',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          reasonCode: 'request-timeout'
        }
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
        {
          destination: 'sourcify',
          status: 'published',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          remoteId: REMOTE_ID
        },
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
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
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
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
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
        {
          destination: 'sourcify',
          status: 'published',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          remoteId: REMOTE_ID
        }
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
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
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
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
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
    expect(subject.jobs.get(publication.job.id)?.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: 'etherscan-direct',
          status: 'unknown',
          publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          reasonCode: 'status-unavailable'
        })
      ])
    )
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
        expect.objectContaining({ destination: 'etherscan-direct', status: 'checking', remoteId: GUID })
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
        expect.objectContaining({ destination: 'etherscan-direct', status: 'verified', remoteId: GUID })
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
        expect.objectContaining({
          destination: 'etherscan-direct',
          status: 'needs-api-key',
          remoteId: GUID,
          reasonCode: 'api-key-required'
        })
      ])
    })
  })
  retry.etherscan.status.mockResolvedValueOnce({ status: 'pending' })
  await expect(retry.service.refresh(publication.job.id)).resolves.toEqual({
    success: true,
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        expect.objectContaining({ destination: 'etherscan-direct', status: 'checking', remoteId: GUID })
      ])
    })
  })
  expect(retry.etherscan.submit).toHaveBeenCalledTimes(2)
})

test('never repeats a transport-ambiguous direct Etherscan POST across equivalent jobs or restart', async () => {
  const subject = harness()
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.etherscan.submit.mockResolvedValueOnce({ status: 'unknown' })

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
        expect.objectContaining({
          destination: 'etherscan-direct',
          status: 'unknown',
          reasonCode: 'transport-failure'
        })
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

  const duplicate = await seedEquivalentJob(subject, publication.job)
  await expect(
    subject.service.publishEtherscan({
      jobId: duplicate.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)

  const restarted = harness({ persisted: subject.persisted(), uuidOffset: 100 })
  const restartedDuplicate = await seedEquivalentJob(restarted, publication.job)
  await expect(
    restarted.service.publishEtherscan({
      jobId: restartedDuplicate.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  expect(restarted.etherscan.submit).not.toHaveBeenCalled()

  subject.setArtifact({
    ...rawArtifact(),
    stdJsonInput: {
      ...rawArtifact().stdJsonInput,
      sources: { 'contracts/Counter.sol': { content: 'contract Counter { uint256 value; }' } }
    }
  })
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const different = await subject.prepareAndPublish()
  if (!different.success) throw new Error('expected different job')
  expect(different.job.submissionHash).not.toBe(publication.job.submissionHash)
  await expect(
    subject.service.publishEtherscan({
      jobId: different.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: true, job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(2)
})

test('serializes equivalent direct Etherscan publications before either POST settles', async () => {
  const subject = harness()
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const firstJob = await subject.prepareAndPublish()
  if (!firstJob.success) throw new Error('expected job')
  const secondJob = await seedEquivalentJob(subject, firstJob.job)

  let release = () => {}
  subject.etherscan.submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 'unknown' })
      })
  )
  const first = subject.service.publishEtherscan({
    jobId: firstJob.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    noConstructorArguments: true
  })
  await expect(
    subject.service.publishEtherscan({
      jobId: secondJob.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  while (subject.etherscan.submit.mock.calls.length === 0) await Promise.resolve()
  release()
  await expect(first).resolves.toEqual({ success: true, job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)
})

test('commits the direct publication fence before POST and restores it while the response is pending', async () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-contract-verification-'))
  const { commitMainState, PersistStore } = jest.requireActual('../../../main/store/persist')

  try {
    const disk = new PersistStore({ configName: 'config', cwd: directory })
    const subject = harness({
      commitState: (jobs) => commitMainState({ _version: 73, contractVerificationJobs: jobs }, disk)
    })
    subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
    const publication = await subject.prepareAndPublish()
    if (!publication.success) throw new Error('expected job')
    let release = () => {}
    subject.etherscan.submit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 'accepted', guid: GUID })
        })
    )

    const pending = subject.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
    while (subject.etherscan.submit.mock.calls.length === 0) await Promise.resolve()

    const restartedDisk = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restartedDisk.get('main') as {
      __: Record<string, { main: { contractVerificationJobs: readonly ContractVerificationJobRecord[] } }>
    }
    const restoredJobs = Object.values(envelope.__).at(-1)?.main.contractVerificationJobs || []
    expect(restoredJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: publication.job.id,
          destinations: expect.arrayContaining([
            expect.objectContaining({
              destination: 'etherscan-direct',
              status: 'unknown',
              publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
            })
          ])
        })
      ])
    )

    const restarted = harness({ persisted: restoredJobs, uuidOffset: 100 })
    const duplicate = await seedEquivalentJob(restarted, publication.job)
    await expect(
      restarted.service.publishEtherscan({
        jobId: duplicate.id,
        confirmation: 'PUBLISH_TO_ETHERSCAN',
        noConstructorArguments: true
      })
    ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
    expect(restarted.etherscan.submit).not.toHaveBeenCalled()

    release()
    await expect(pending).resolves.toEqual({ success: true, job: expect.any(Object) })
    const acceptedDisk = new PersistStore({ configName: 'config', cwd: directory })
    const acceptedEnvelope = acceptedDisk.get('main') as {
      __: Record<string, { main: { contractVerificationJobs: readonly ContractVerificationJobRecord[] } }>
    }
    const acceptedJobs = Object.values(acceptedEnvelope.__).at(-1)?.main.contractVerificationJobs || []
    expect(acceptedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: publication.job.id,
          destinations: expect.arrayContaining([
            expect.objectContaining({
              destination: 'etherscan-direct',
              status: 'checking',
              publicationHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
              remoteId: GUID
            })
          ])
        })
      ])
    )
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

test('fails closed before direct POST when the publication fence cannot be committed', async () => {
  const subject = harness()
  subject.sourcify.submit.mockResolvedValueOnce({ status: 'already_verified' })
  const publication = await subject.prepareAndPublish()
  if (!publication.success) throw new Error('expected job')
  subject.commitState.mockImplementation(() => {
    throw new Error('commit failed')
  })

  await expect(
    subject.service.publishEtherscan({
      jobId: publication.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({
    success: false,
    error: 'job-unavailable',
    job: expect.objectContaining({
      destinations: expect.arrayContaining([
        expect.objectContaining({ destination: 'etherscan-direct', status: 'unknown' })
      ])
    })
  })
  expect(subject.etherscan.submit).not.toHaveBeenCalled()
})

test('scopes direct fences to constructor arguments but not deployment transaction identity', async () => {
  const constructorSubject = harness()
  constructorSubject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
  const noArguments = await constructorSubject.prepareAndPublish()
  if (!noArguments.success) throw new Error('expected job')
  constructorSubject.etherscan.submit.mockResolvedValueOnce({ status: 'unknown' })
  await constructorSubject.service.publishEtherscan({
    jobId: noArguments.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    noConstructorArguments: true
  })
  const correctedArguments = await seedEquivalentJob(constructorSubject, noArguments.job)
  await expect(
    constructorSubject.service.publishEtherscan({
      jobId: correctedArguments.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      constructorArguments: '12ab'
    })
  ).resolves.toEqual({ success: true, job: expect.any(Object) })
  expect(constructorSubject.etherscan.submit).toHaveBeenCalledTimes(2)

  const firstOperation = managedOperation(true)
  const deploymentSubject = harness({ operation: firstOperation })
  deploymentSubject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
  const prepareDeployment = async (operation: OperationLifecycle) => {
    const prepared = await deploymentSubject.prepare({
      address: operationAddress,
      operationId: operation.id
    })
    if (!prepared.success) throw new Error('expected prepared deployment')
    return deploymentSubject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  }
  const firstDeployment = await prepareDeployment(firstOperation)
  if (!firstDeployment.success) throw new Error('expected deployment job')
  deploymentSubject.etherscan.submit.mockResolvedValueOnce({ status: 'unknown' })
  await deploymentSubject.service.publishEtherscan({
    jobId: firstDeployment.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    noConstructorArguments: true
  })

  const secondTransactionHash = `0x${'cd'.repeat(32)}`
  const secondOperation: OperationLifecycle = {
    ...firstOperation,
    id: '10000000-0000-4000-8000-000000000002',
    transaction: { ...firstOperation.transaction!, hash: secondTransactionHash },
    receipt: {
      ...firstOperation.receipt!,
      transactionHash: secondTransactionHash,
      blockHash: `0x${'06'.repeat(32)}`,
      blockNumber: '0x6'
    }
  }
  deploymentSubject.setOperation(secondOperation)
  const secondDeployment = await seedEquivalentJob(deploymentSubject, firstDeployment.job, {
    target: {
      ...firstDeployment.job.target,
      creationEvidence: {
        transactionHash: secondOperation.transaction!.hash,
        blockHash: secondOperation.receipt!.blockHash,
        blockNumber: secondOperation.receipt!.blockNumber,
        operationId: secondOperation.id
      }
    }
  })
  expect(secondDeployment.submissionHash).toBe(firstDeployment.job.submissionHash)
  await expect(
    deploymentSubject.service.publishEtherscan({
      jobId: secondDeployment.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  expect(deploymentSubject.etherscan.submit).toHaveBeenCalledTimes(1)
})

test.each(['address-first', 'operation-first'] as const)(
  'treats address-only and operation-backed %s jobs as the same direct publication',
  async (order) => {
    const operation = managedOperation(true)
    const subject = harness({ operation })
    subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
    const publishTarget = async (operationId?: string) => {
      const prepared = await subject.prepare({
        address: operationAddress,
        ...(operationId ? { operationId } : {})
      })
      if (!prepared.success) throw new Error('expected prepared target')
      return subject.service.publish({
        acknowledgementToken: prepared.prepared.acknowledgementToken,
        confirmation: 'PUBLISH_CONTRACT_SOURCE'
      })
    }

    const first = await publishTarget(order === 'operation-first' ? operation.id : undefined)
    if (!first.success) throw new Error('expected first job')
    subject.etherscan.submit.mockResolvedValueOnce({ status: 'unknown' })
    await subject.service.publishEtherscan({
      jobId: first.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })

    if (order === 'operation-first') subject.setOperation(undefined)
    const secondTarget =
      order === 'operation-first'
        ? {
            address: first.job.target.address,
            chainId: first.job.target.chainId,
            runtimeCodeHash: first.job.target.runtimeCodeHash
          }
        : {
            ...first.job.target,
            creationEvidence: {
              transactionHash: operation.transaction!.hash,
              blockHash: operation.receipt!.blockHash,
              blockNumber: operation.receipt!.blockNumber,
              operationId: operation.id
            }
          }
    const second = await seedEquivalentJob(subject, first.job, { target: secondTarget })
    await expect(
      subject.service.publishEtherscan({
        jobId: second.id,
        confirmation: 'PUBLISH_TO_ETHERSCAN',
        noConstructorArguments: true
      })
    ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
    expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)
  }
)

test('ignores block-only creation-evidence changes for the same deployment transaction', async () => {
  const firstOperation = managedOperation(true)
  const subject = harness({ operation: firstOperation })
  subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
  const publishOperation = async (operation: OperationLifecycle) => {
    const prepared = await subject.prepare({ address: operationAddress, operationId: operation.id })
    if (!prepared.success) throw new Error('expected prepared operation')
    return subject.service.publish({
      acknowledgementToken: prepared.prepared.acknowledgementToken,
      confirmation: 'PUBLISH_CONTRACT_SOURCE'
    })
  }

  const first = await publishOperation(firstOperation)
  if (!first.success) throw new Error('expected first job')
  subject.etherscan.submit.mockResolvedValueOnce({ status: 'unknown' })
  await subject.service.publishEtherscan({
    jobId: first.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    noConstructorArguments: true
  })

  const reorged: OperationLifecycle = {
    ...firstOperation,
    id: '10000000-0000-4000-8000-000000000003',
    receipt: {
      ...firstOperation.receipt!,
      blockHash: `0x${'07'.repeat(32)}`,
      blockNumber: '0x7'
    }
  }
  subject.setOperation(reorged)
  const second = await seedEquivalentJob(subject, first.job, {
    target: {
      ...first.job.target,
      creationEvidence: {
        transactionHash: reorged.transaction!.hash,
        blockHash: reorged.receipt!.blockHash,
        blockNumber: reorged.receipt!.blockNumber,
        operationId: reorged.id
      }
    }
  })
  await expect(
    subject.service.publishEtherscan({
      jobId: second.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)
})

test.each([
  ['checking', { status: 'accepted' as const, guid: GUID }, undefined],
  ['already-verified', { status: 'already_verified' as const }, undefined],
  ['verified', { status: 'accepted' as const, guid: GUID }, { status: 'verified' as const }],
  ['rejected', { status: 'accepted' as const, guid: GUID }, { status: 'rejected' as const }],
  ['rejected', { status: 'rejected' as const }, undefined]
] as const)(
  'fences an equivalent new job and restart after direct Etherscan reaches %s',
  async (expectedStatus, submitResult, pollResult) => {
    const subject = harness()
    subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
    const original = await subject.prepareAndPublish()
    if (!original.success) throw new Error('expected original job')
    subject.etherscan.submit.mockResolvedValueOnce(submitResult)
    const submitted = await subject.service.publishEtherscan({
      jobId: original.job.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
    if (!submitted.success) throw new Error('expected direct result')
    if (pollResult) {
      subject.etherscan.status.mockResolvedValueOnce(pollResult)
      const refreshed = await subject.service.refresh(original.job.id)
      if (!refreshed.success) throw new Error('expected refreshed result')
    }
    expect(subject.jobs.get(original.job.id)?.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: 'etherscan-direct', status: expectedStatus })
      ])
    )

    const duplicate = await seedEquivalentJob(subject, original.job)
    await expect(
      subject.service.publishEtherscan({
        jobId: duplicate.id,
        confirmation: 'PUBLISH_TO_ETHERSCAN',
        noConstructorArguments: true
      })
    ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
    expect(subject.etherscan.submit).toHaveBeenCalledTimes(1)

    const restarted = harness({ persisted: subject.persisted(), uuidOffset: 100 })
    const restartedDuplicate = await seedEquivalentJob(restarted, original.job)
    await expect(
      restarted.service.publishEtherscan({
        jobId: restartedDuplicate.id,
        confirmation: 'PUBLISH_TO_ETHERSCAN',
        noConstructorArguments: true
      })
    ).resolves.toEqual({ success: false, error: 'already-submitted', job: expect.any(Object) })
    expect(restarted.etherscan.submit).not.toHaveBeenCalled()
  }
)

test.each([
  ['unavailable', { status: 'unavailable' as const }],
  ['needs-api-key', { status: 'invalid_api_key' as const }]
] as const)('allows an equivalent new job after explicit direct %s', async (_status, submitResult) => {
  const subject = harness()
  subject.sourcify.submit.mockResolvedValue({ status: 'already_verified' })
  const original = await subject.prepareAndPublish()
  if (!original.success) throw new Error('expected original job')
  subject.etherscan.submit.mockResolvedValueOnce(submitResult)
  await subject.service.publishEtherscan({
    jobId: original.job.id,
    confirmation: 'PUBLISH_TO_ETHERSCAN',
    noConstructorArguments: true
  })

  const duplicate = await seedEquivalentJob(subject, original.job)
  await expect(
    subject.service.publishEtherscan({
      jobId: duplicate.id,
      confirmation: 'PUBLISH_TO_ETHERSCAN',
      noConstructorArguments: true
    })
  ).resolves.toEqual({ success: true, job: expect.any(Object) })
  expect(subject.etherscan.submit).toHaveBeenCalledTimes(2)
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
        expect.objectContaining({
          destination: 'etherscan-direct',
          status: 'rejected',
          reasonCode: 'destination-rejected'
        })
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
