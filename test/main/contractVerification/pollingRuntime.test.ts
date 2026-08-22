import {
  CONTRACT_VERIFICATION_POLL_INTERVAL_MS,
  ContractVerificationPollingRuntime,
  wakeContractVerificationPollingForActiveResult
} from '../../../main/contractVerification/pollingRuntime'
import type { ContractVerificationJobRecord } from '../../../resources/domain/contractVerification'

const job = (status: ContractVerificationJobRecord['destinations'][number]['status']) =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    target: {
      address: `0x${'1'.repeat(40)}`,
      chainId: 1,
      runtimeCodeHash: `0x${'2'.repeat(64)}`
    },
    language: 'Solidity',
    compilerVersion: '0.8.30',
    contractIdentifier: 'src/Vault.sol:Vault',
    sourceHash: '3'.repeat(64),
    submissionHash: '4'.repeat(64),
    status: status === 'not-submitted' ? 'publishing' : 'publishing',
    destinations: [{ destination: 'sourcify', status }],
    createdAt: 1,
    updatedAt: 1
  }) as ContractVerificationJobRecord

const directJob = (
  status: ContractVerificationJobRecord['destinations'][number]['status']
): ContractVerificationJobRecord => ({
  ...job('published'),
  status: 'published',
  destinations: [
    { destination: 'sourcify', status: 'published' },
    {
      destination: 'etherscan-direct',
      status,
      remoteId: 'etherscan-remote-id'
    }
  ]
})

const settlePolling = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ContractVerificationPollingRuntime', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('resumes accepted status checks without resubmitting publication', async () => {
    const checking = job('checking')
    const service = {
      list: jest.fn(() => ({ success: true as const, jobs: [checking] })),
      refresh: jest.fn(async () => ({ success: true }))
    }
    const runtime = new ContractVerificationPollingRuntime(service)

    runtime.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(service.refresh).toHaveBeenCalledWith(checking.id)

    jest.advanceTimersByTime(CONTRACT_VERIFICATION_POLL_INTERVAL_MS)
    await Promise.resolve()
    await Promise.resolve()
    expect(service.refresh).toHaveBeenCalledTimes(2)
    runtime.stop()
  })

  it('checks a crash-time publication intent once and leaves terminal jobs idle', async () => {
    const intent = job('not-submitted')
    let jobs: readonly ContractVerificationJobRecord[] = [intent]
    const service = {
      list: jest.fn(() => ({ success: true as const, jobs })),
      refresh: jest.fn(async () => {
        jobs = [
          { ...intent, status: 'unknown', destinations: [{ ...intent.destinations[0]!, status: 'unknown' }] }
        ]
        return { success: false }
      })
    }
    const runtime = new ContractVerificationPollingRuntime(service)

    runtime.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(service.refresh).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    runtime.stop()
  })

  it('does not poll terminal destination states', async () => {
    const forwardedUnknown = {
      ...job('published'),
      status: 'published',
      destinations: [
        { destination: 'sourcify', status: 'published' },
        {
          destination: 'etherscan-forwarded',
          status: 'unknown',
          reasonCode: 'status-unavailable'
        }
      ]
    } as ContractVerificationJobRecord
    const service = {
      list: jest.fn(() => ({ success: true as const, jobs: [forwardedUnknown] })),
      refresh: jest.fn()
    }
    const runtime = new ContractVerificationPollingRuntime(service)

    runtime.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(service.refresh).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
    runtime.stop()
  })

  it('wakes an idle runtime after a direct Etherscan submission is accepted', async () => {
    const checking = directJob('checking')
    let jobs: readonly ContractVerificationJobRecord[] = []
    const service = {
      list: jest.fn(() => ({ success: true as const, jobs })),
      refresh: jest.fn(async () => {
        jobs = [directJob('verified')]
        return { success: true as const, job: jobs[0] }
      })
    }
    const runtime = new ContractVerificationPollingRuntime(service)

    runtime.start()
    await settlePolling()
    expect(service.refresh).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)

    jobs = [checking]
    const accepted = { success: true as const, job: checking }
    expect(wakeContractVerificationPollingForActiveResult(runtime, accepted)).toBe(accepted)
    await settlePolling()

    expect(service.refresh).toHaveBeenCalledWith(checking.id)
    expect(jest.getTimerCount()).toBe(0)
    runtime.stop()
  })

  it('wakes an idle runtime when credential recovery returns a checking job', async () => {
    const needsCredential = directJob('needs-api-key')
    const checking = directJob('checking')
    let jobs: readonly ContractVerificationJobRecord[] = [needsCredential]
    const service = {
      list: jest.fn(() => ({ success: true as const, jobs })),
      refresh: jest.fn(async () => {
        jobs = [directJob('verified')]
        return { success: true as const, job: jobs[0] }
      })
    }
    const runtime = new ContractVerificationPollingRuntime(service)

    runtime.start()
    await settlePolling()
    expect(service.refresh).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)

    jobs = [checking]
    wakeContractVerificationPollingForActiveResult(runtime, { success: true, job: checking })
    await settlePolling()

    expect(service.refresh).toHaveBeenCalledWith(checking.id)
    expect(jest.getTimerCount()).toBe(0)
    runtime.stop()
  })

  it('leaves an idle runtime asleep for failed or terminal results', async () => {
    const checking = directJob('checking')
    const terminal = directJob('verified')
    let jobs: readonly ContractVerificationJobRecord[] = []
    const service = {
      list: jest.fn(() => ({ success: true as const, jobs })),
      refresh: jest.fn()
    }
    const runtime = new ContractVerificationPollingRuntime(service)

    runtime.start()
    await settlePolling()
    jobs = [checking]
    wakeContractVerificationPollingForActiveResult(runtime, { success: false, job: checking })
    await settlePolling()
    jobs = [terminal]
    wakeContractVerificationPollingForActiveResult(runtime, { success: true, job: terminal })
    await settlePolling()

    expect(service.refresh).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
    runtime.stop()
  })
})
