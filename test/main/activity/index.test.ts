jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))

import { requireStoreAction } from '../../../main/store/action'
import { requestActivityEntry, recordRequestActivity } from '../../../main/activity'
import { RequestStatus, TxClassification, type TransactionRequest } from '../../../main/accounts/types'

const account = `0x${'a'.repeat(40)}`
const hash = `0x${'b'.repeat(64)}`

const transaction = (overrides: Partial<TransactionRequest> = {}): TransactionRequest =>
  ({
    type: 'transaction',
    handlerId: 'request-secret-not-persisted',
    origin: 'https://app.example',
    account,
    payload: { jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction', params: [] },
    data: { from: account, to: `0x${'c'.repeat(40)}`, chainId: '0x1', data: '0xdeadbeef' },
    created: 100,
    status: RequestStatus.Confirmed,
    tx: { hash, confirmations: 13 },
    approvals: [],
    feesUpdatedByUser: false,
    recipientType: 'external',
    recognizedActions: [],
    classification: TxClassification.NATIVE_TRANSFER,
    simulation: { status: 'unavailable' },
    ...overrides
  }) as TransactionRequest

beforeEach(() => jest.clearAllMocks())

it('persists only bounded terminal metadata and excludes request payloads', () => {
  const entry = requestActivityEntry(transaction(), undefined, 200)

  expect(entry).toMatchObject({
    account,
    origin: 'https://app.example',
    type: 'transaction',
    outcome: 'confirmed',
    chainId: 1,
    transactionHash: hash,
    createdAt: 100,
    completedAt: 200
  })
  expect(JSON.stringify(entry)).not.toMatch(/deadbeef|request-secret|eth_sendTransaction/)
})

it('does not record nonterminal requests without an explicit outcome', () => {
  expect(requestActivityEntry(transaction({ status: undefined, tx: undefined }))).toBeUndefined()
})

it('records an explicit completion through the bounded store action', () => {
  const action = jest.fn()
  ;(requireStoreAction as jest.Mock).mockReturnValue(action)

  expect(recordRequestActivity(transaction({ status: undefined, tx: undefined }), 'completed')).toEqual(
    expect.objectContaining({ outcome: 'completed' })
  )
  expect(action).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'completed' }))
})

it('never lets history persistence interfere with request completion', () => {
  ;(requireStoreAction as jest.Mock).mockReturnValue(() => {
    throw new Error('disk unavailable')
  })

  expect(
    recordRequestActivity(transaction({ status: undefined, tx: undefined }), 'completed')
  ).toBeUndefined()
})

it('ignores legacy request summaries that lack newer nested context', () => {
  const action = jest.fn()
  ;(requireStoreAction as jest.Mock).mockReturnValue(action)
  const legacy = {
    type: 'sign',
    handlerId: 'legacy',
    account,
    origin: 'legacy.test',
    payload: {},
    data: { rawMessage: 'private', decodedMessage: 'private' }
  }

  expect(() => recordRequestActivity(legacy as never, 'completed')).not.toThrow()
  expect(action).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'sign', account, origin: 'legacy.test', outcome: 'completed' })
  )
  expect(JSON.stringify(action.mock.calls)).not.toContain('private')
})
