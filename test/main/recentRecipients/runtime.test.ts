import store from '../../../main/store'
import { requireStoreAction } from '../../../main/store/action'
import operationLifecycleRuntime from '../../../main/operationLifecycle/runtime'
import {
  RecentRecipientsRuntime,
  shouldClearRecentRecipientCandidates
} from '../../../main/recentRecipients/runtime'

import type { OperationReconciliationObservation } from '../../../main/operationLifecycle/reconciler'
import type { OperationLifecycle } from '../../../main/store/state/types/operationLifecycle'

jest.mock('../../../main/store', () => jest.fn())
jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))
jest.mock('../../../main/operationLifecycle/runtime', () => ({
  __esModule: true,
  default: { observe: jest.fn() }
}))

const operationId = '11111111-1111-4111-8111-111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const recordRecentRecipientUse = jest.fn()
const removeRecentRecipientUse = jest.fn()
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
  ;(store as jest.Mock).mockImplementation((path: string) =>
    path === 'main.rememberRecentRecipients' ? true : undefined
  )
  ;(requireStoreAction as jest.Mock).mockImplementation((name: string) =>
    name === 'recordRecentRecipientUse' ? recordRecentRecipientUse : removeRecentRecipientUse
  )
  ;(operationLifecycleRuntime.observe as jest.Mock).mockImplementation((next) => {
    observer = next
    return jest.fn()
  })
  observer = undefined
})

it('clears pending candidates for Activity clearing, explicit clearing, and opt-out only', () => {
  expect(shouldClearRecentRecipientCandidates('clearActivity', [])).toBe(true)
  expect(shouldClearRecentRecipientCandidates('clearRecentRecipients', [])).toBe(true)
  expect(shouldClearRecentRecipientCandidates('setRememberRecentRecipients', [false])).toBe(true)
  expect(shouldClearRecentRecipientCandidates('setRememberRecentRecipients', [true])).toBe(false)
  expect(shouldClearRecentRecipientCandidates('setTransactionNotifications', [false])).toBe(false)
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
  ;(store as jest.Mock).mockReturnValue(false)
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
