import store from '../../../main/store'
import { requireStoreAction } from '../../../main/store/action'
import operationLifecycleRuntime from '../../../main/operationLifecycle/runtime'
import operationLifecycleLedger from '../../../main/operationLifecycle'
import {
  applyRecentRecipientPrivacyAction,
  RecentRecipientsRuntime
} from '../../../main/recentRecipients/runtime'

import type { OperationReconciliationObservation } from '../../../main/operationLifecycle/reconciler'
import type { OperationLifecycle } from '../../../main/store/state/types/operationLifecycle'

jest.mock('../../../main/store', () => jest.fn())
jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))
jest.mock('../../../main/operationLifecycle/runtime', () => ({
  __esModule: true,
  default: { observe: jest.fn() }
}))
jest.mock('../../../main/operationLifecycle', () => ({
  __esModule: true,
  default: { get: jest.fn(), listStored: jest.fn(() => []), put: jest.fn() }
}))

const operationId = '11111111-1111-4111-8111-111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const recordRecentRecipientUse = jest.fn()
const removeRecentRecipientUse = jest.fn()
const recordOutboundAddressFingerprints = jest.fn()
let observer: ((observation: OperationReconciliationObservation) => void) | undefined

const operation = (
  state: OperationLifecycle['state'],
  options: Partial<OperationLifecycle> = {}
): OperationLifecycle =>
  ({
    id: operationId,
    kind: 'transaction',
    account: '0x1111111111111111111111111111111111111111',
    origin: 'wren-send',
    chainId: 1,
    state,
    createdAt: 1,
    updatedAt: 10,
    expiresAt: 1_000,
    visibleInActivity: true,
    notification: {},
    transaction: { hash: `0x${'a'.repeat(64)}`, nonce: '0x0' },
    ...options
  }) as OperationLifecycle

const publish = (current: OperationLifecycle) =>
  observer?.(Object.freeze({ previous: current, current }) as OperationReconciliationObservation)

beforeEach(() => {
  jest.clearAllMocks()
  ;(store as jest.Mock).mockImplementation((path: string) => {
    if (path === 'main.rememberRecentRecipients') return true
    if (path === 'main.instanceId') return '00000000-0000-4000-8000-000000000001'
    return undefined
  })
  ;(requireStoreAction as jest.Mock).mockImplementation((name: string) => {
    if (name === 'recordRecentRecipientUse') return recordRecentRecipientUse
    if (name === 'recordOutboundAddressFingerprints') return recordOutboundAddressFingerprints
    return removeRecentRecipientUse
  })
  ;(operationLifecycleLedger.get as jest.Mock).mockImplementation((_id) => undefined)
  ;(operationLifecycleLedger.listStored as jest.Mock).mockReturnValue([])
  ;(operationLifecycleLedger.put as jest.Mock).mockImplementation((value) => value)
  ;(operationLifecycleRuntime.observe as jest.Mock).mockImplementation((next) => {
    observer = next
    return jest.fn()
  })
  observer = undefined
})

it('clears opted-in raw recipient evidence without discarding outbound fingerprints', () => {
  const fingerprint = { digest: 'c'.repeat(64), prefix: '1234', suffix: 'abcd' }
  const pending = operation('submitted', {
    broadcast: {
      phase: 'unconfirmed',
      pendingRecipient: recipient,
      pendingOutboundFingerprints: [fingerprint]
    }
  })
  ;(operationLifecycleLedger.listStored as jest.Mock).mockReturnValue([pending])
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(pending)

  new RecentRecipientsRuntime().clearCandidates()

  expect(operationLifecycleLedger.put).toHaveBeenCalledWith(
    expect.objectContaining({
      broadcast: { phase: 'unconfirmed', pendingOutboundFingerprints: [fingerprint] }
    }),
    -1
  )
})

it('aggregates pending-metadata removal failures without skipping later operations', () => {
  const fingerprint = { digest: 'c'.repeat(64), prefix: '1234', suffix: 'abcd' }
  const first = operation('submitted', {
    broadcast: { phase: 'unconfirmed', pendingRecipient: recipient }
  })
  const second = operation('submitted', {
    id: '22222222-2222-4222-8222-222222222222',
    broadcast: { phase: 'unconfirmed', pendingOutboundFingerprints: [fingerprint] }
  })
  ;(operationLifecycleLedger.listStored as jest.Mock).mockReturnValue([first, second])
  ;(operationLifecycleLedger.get as jest.Mock).mockImplementation((id) => (id === first.id ? first : second))
  ;(operationLifecycleLedger.put as jest.Mock)
    .mockImplementationOnce(() => {
      throw new Error('ledger write failed')
    })
    .mockImplementationOnce((value) => value)

  expect(new RecentRecipientsRuntime().clearCandidates({ outbound: true })).toBe(false)
  expect(operationLifecycleLedger.put).toHaveBeenCalledTimes(2)
})

it('suppresses failed-to-remove pending recipients for the rest of the session', () => {
  const fingerprint = { digest: 'd'.repeat(64), prefix: '2222', suffix: '2222' }
  const pending = operation('submitted', {
    broadcast: {
      phase: 'unconfirmed',
      pendingRecipient: recipient,
      pendingOutboundFingerprints: [fingerprint]
    }
  })
  const confirmed = operation('confirmed', {
    broadcast: {
      phase: 'unconfirmed',
      pendingRecipient: recipient,
      pendingOutboundFingerprints: [fingerprint]
    },
    receipt: {
      transactionHash: `0x${'a'.repeat(64)}`,
      blockHash: `0x${'b'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x1'
    }
  })
  ;(operationLifecycleLedger.listStored as jest.Mock).mockReturnValue([pending])
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(pending)
  ;(operationLifecycleLedger.put as jest.Mock).mockImplementationOnce(() => {
    throw new Error('ledger write failed')
  })
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  expect(runtime.clearCandidates({ outbound: true })).toBe(false)
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(confirmed)
  publish(confirmed)

  expect(recordRecentRecipientUse).not.toHaveBeenCalled()
  expect(recordOutboundAddressFingerprints).not.toHaveBeenCalled()
  expect(operationLifecycleLedger.put).toHaveBeenCalledTimes(2)
})

it('acknowledges privacy clearing only after metadata removal and commit both succeed', () => {
  const events: string[] = []
  const result = applyRecentRecipientPrivacyAction('disable', {
    updateSession: () => events.push('session'),
    clearPendingMetadata: () => {
      events.push('metadata')
      return true
    },
    commit: () => events.push('commit')
  })

  expect(events).toEqual(['session', 'metadata', 'commit'])
  expect(result).toEqual({ success: true, durable: true })
})

it('does not claim durability or commit a partial metadata removal', () => {
  const commit = jest.fn()
  const result = applyRecentRecipientPrivacyAction('clear', {
    updateSession: jest.fn(),
    clearPendingMetadata: () => false,
    commit
  })

  expect(commit).not.toHaveBeenCalled()
  expect(result).toEqual({
    success: false,
    durable: false,
    sessionOnly: true,
    error: 'metadata-removal-failed'
  })
})

it('clears both pending recipient and outbound evidence with Activity memory', () => {
  const fingerprint = { digest: 'c'.repeat(64), prefix: '1234', suffix: 'abcd' }
  const pending = operation('submitted', {
    broadcast: {
      phase: 'unconfirmed',
      pendingRecipient: recipient,
      pendingOutboundFingerprints: [fingerprint]
    }
  })
  ;(operationLifecycleLedger.listStored as jest.Mock).mockReturnValue([pending])
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(pending)

  new RecentRecipientsRuntime().clearCandidates({ outbound: true })

  expect(operationLifecycleLedger.put).toHaveBeenCalledWith(
    expect.objectContaining({ broadcast: { phase: 'unconfirmed' } }),
    -1
  )
})

it('records only an opted-in tracked candidate after a canonical successful receipt', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  expect(runtime.track({ operationId, address: recipient.toUpperCase().replace('0X', '0x') })).toBe(true)

  publish(
    operation('confirmed', {
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '0xa',
        status: '0x1'
      },
      settlement: { status: 'monitoring' }
    })
  )

  expect(recordRecentRecipientUse).toHaveBeenCalledWith({
    operationId,
    address: recipient,
    confirmedAt: 10
  })
})

it('never retains a candidate while the preference is disabled', () => {
  ;(store as jest.Mock).mockImplementation((path: string) =>
    path === 'main.rememberRecentRecipients' ? false : '00000000-0000-4000-8000-000000000001'
  )
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  expect(runtime.track({ operationId, address: recipient })).toBe(false)
  publish(
    operation('confirmed', {
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '0xa',
        status: '0x1'
      }
    })
  )

  expect(recordRecentRecipientUse).not.toHaveBeenCalled()
})

it('recovers opted-in recipient and outbound fingerprints after restart on canonical success', () => {
  const fingerprint = { digest: 'd'.repeat(64), prefix: '2222', suffix: '2222' }
  const confirmed = operation('confirmed', {
    broadcast: {
      phase: 'unconfirmed',
      pendingRecipient: recipient,
      pendingOutboundFingerprints: [fingerprint]
    },
    receipt: {
      transactionHash: `0x${'a'.repeat(64)}`,
      blockHash: `0x${'b'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x1'
    }
  })
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(confirmed)
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  publish(confirmed)

  expect(recordRecentRecipientUse).toHaveBeenCalledWith({
    operationId,
    address: recipient,
    confirmedAt: 10
  })
  expect(recordOutboundAddressFingerprints).toHaveBeenCalledWith([fingerprint], 10)
  expect(operationLifecycleLedger.put).toHaveBeenCalledWith(
    expect.objectContaining({ broadcast: { phase: 'unconfirmed' } }),
    -1
  )
})

it('records restart-safe outbound memory without a raw recipient when remembering is disabled', () => {
  const fingerprint = { digest: 'e'.repeat(64), prefix: '1234', suffix: 'abcd' }
  const confirmed = operation('confirmed', {
    broadcast: { phase: 'acknowledged', pendingOutboundFingerprints: [fingerprint] },
    receipt: {
      transactionHash: `0x${'a'.repeat(64)}`,
      blockHash: `0x${'b'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x1'
    }
  })
  ;(store as jest.Mock).mockImplementation((path: string) =>
    path === 'main.rememberRecentRecipients' ? false : '00000000-0000-4000-8000-000000000001'
  )
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(confirmed)
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  publish(confirmed)

  expect(recordRecentRecipientUse).not.toHaveBeenCalled()
  expect(recordOutboundAddressFingerprints).toHaveBeenCalledWith([fingerprint], 10)
  expect(operationLifecycleLedger.put).toHaveBeenCalledWith(
    expect.objectContaining({ broadcast: { phase: 'acknowledged' } }),
    -1
  )
})

it('does not merge pending outbound fingerprints from a reverted receipt', () => {
  const fingerprint = { digest: 'f'.repeat(64), prefix: '1234', suffix: 'abcd' }
  const reverted = operation('confirmed', {
    broadcast: { phase: 'acknowledged', pendingOutboundFingerprints: [fingerprint] },
    receipt: {
      transactionHash: `0x${'a'.repeat(64)}`,
      blockHash: `0x${'b'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x0'
    }
  })
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(reverted)
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  publish(reverted)

  expect(recordOutboundAddressFingerprints).not.toHaveBeenCalled()
  expect(operationLifecycleLedger.put).toHaveBeenCalledWith(
    expect.objectContaining({ broadcast: { phase: 'acknowledged' } }),
    -1
  )
})

it('consumes persisted confirmation metadata only once across duplicate observations', () => {
  const fingerprint = { digest: 'a'.repeat(64), prefix: '1234', suffix: 'abcd' }
  let stored = operation('confirmed', {
    broadcast: { phase: 'acknowledged', pendingOutboundFingerprints: [fingerprint] },
    receipt: {
      transactionHash: `0x${'a'.repeat(64)}`,
      blockHash: `0x${'b'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x1'
    }
  })
  ;(operationLifecycleLedger.get as jest.Mock).mockImplementation(() => stored)
  ;(operationLifecycleLedger.put as jest.Mock).mockImplementation((value) => {
    stored = value
    return value
  })
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  publish(stored)
  publish(stored)

  expect(recordOutboundAddressFingerprints).toHaveBeenCalledTimes(1)
  expect(operationLifecycleLedger.put).toHaveBeenCalledTimes(1)
})

it('retains pending fingerprints when confirmed-memory persistence fails', () => {
  const fingerprint = { digest: 'b'.repeat(64), prefix: '1234', suffix: 'abcd' }
  const confirmed = operation('confirmed', {
    broadcast: { phase: 'acknowledged', pendingOutboundFingerprints: [fingerprint] },
    receipt: {
      transactionHash: `0x${'a'.repeat(64)}`,
      blockHash: `0x${'b'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x1'
    }
  })
  recordOutboundAddressFingerprints.mockImplementationOnce(() => {
    throw new Error('memory unavailable')
  })
  ;(operationLifecycleLedger.get as jest.Mock).mockReturnValue(confirmed)
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  expect(() => publish(confirmed)).not.toThrow()
  expect(operationLifecycleLedger.put).not.toHaveBeenCalled()
})

it('fails malformed candidate metadata closed without affecting transaction execution', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()

  expect(runtime.track({ operationId, address: 'not-an-address' })).toBe(false)
  expect(recordRecentRecipientUse).not.toHaveBeenCalled()
})

it('does not record a failed ordinary receipt even if an invalid confirmed observation arrives', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  runtime.track({ operationId, address: recipient })

  publish(
    operation('confirmed', {
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '0xa',
        status: '0x0'
      }
    })
  )

  expect(recordRecentRecipientUse).not.toHaveBeenCalled()
})

it('removes persisted evidence on reorg and can record the retained candidate again', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  runtime.track({ operationId, address: recipient })

  publish(operation('reorged'))
  publish(
    operation('confirmed', {
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'c'.repeat(64)}`,
        blockNumber: '0xb',
        status: '0x1'
      },
      settlement: { status: 'monitoring' }
    })
  )

  expect(removeRecentRecipientUse).toHaveBeenCalledWith(operationId)
  expect(recordRecentRecipientUse).toHaveBeenCalledTimes(1)
})

it('releases finalized candidates and removes failed, replaced, stopped, or submitted uses', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  runtime.track({ operationId, address: recipient })

  publish(
    operation('confirmed', {
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '0xa',
        status: '0x1'
      },
      settlement: { status: 'complete', basis: 'finalized' }
    })
  )
  publish(operation('reorged'))
  for (const state of ['submitted', 'failed', 'replaced', 'stopped'] as const) publish(operation(state))
  publish(
    operation('confirmed', {
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'d'.repeat(64)}`,
        blockNumber: '0xc',
        status: '0x1'
      }
    })
  )

  expect(recordRecentRecipientUse).toHaveBeenCalledTimes(1)
  expect(removeRecentRecipientUse).toHaveBeenCalledTimes(5)
})

it('bounds unconfirmed candidates and evicts the oldest registration', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  for (let index = 0; index <= 100; index += 1) {
    runtime.track({
      operationId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
      address: recipient
    })
  }

  publish(
    operation('confirmed', {
      id: '00000000-0000-4000-8000-000000000000',
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '0xa',
        status: '0x1'
      }
    })
  )
  publish(
    operation('confirmed', {
      id: '00000000-0000-4000-8000-000000000100',
      receipt: {
        transactionHash: `0x${'a'.repeat(64)}`,
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '0xa',
        status: '0x1'
      }
    })
  )

  expect(recordRecentRecipientUse).toHaveBeenCalledTimes(1)
  expect(recordRecentRecipientUse).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: '00000000-0000-4000-8000-000000000100' })
  )
})

it('treats wallet-call confirmation as successful without requiring single-receipt evidence', () => {
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  runtime.track({ operationId, address: recipient })

  publish(
    operation('confirmed', {
      kind: 'walletCalls',
      transaction: undefined,
      walletCalls: { batchOperationId: operationId },
      settlement: { status: 'monitoring' }
    })
  )

  expect(recordRecentRecipientUse).toHaveBeenCalledWith({ operationId, address: recipient, confirmedAt: 10 })
})

it('contains persistence failures so lifecycle observers keep running', () => {
  recordRecentRecipientUse.mockImplementationOnce(() => {
    throw new Error('disk unavailable')
  })
  removeRecentRecipientUse.mockImplementationOnce(() => {
    throw new Error('disk unavailable')
  })
  const runtime = new RecentRecipientsRuntime()
  runtime.start()
  runtime.track({ operationId, address: recipient })

  expect(() => publish(operation('submitted'))).not.toThrow()
  expect(() =>
    publish(
      operation('confirmed', {
        receipt: {
          transactionHash: `0x${'a'.repeat(64)}`,
          blockHash: `0x${'b'.repeat(64)}`,
          blockNumber: '0xa',
          status: '0x1'
        }
      })
    )
  ).not.toThrow()
})
