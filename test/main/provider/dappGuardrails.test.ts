import store from '../../../main/store'
import {
  assertDappGuardrailReviewStable,
  DappGuardrailError,
  guardrailWarningData,
  reviewDappGuardrail
} from '../../../main/provider/dappGuardrails'
import { ReplacementType, type TransactionRequest } from '../../../main/accounts/types'

jest.mock('../../../main/store', () => ({ __esModule: true, default: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const allowed = '0x2222222222222222222222222222222222222222'
const denied = '0x3333333333333333333333333333333333333333'
const originId = '00000000-0000-5000-8000-000000000000'
const now = 1_800_000_000_000

const request = (overrides: Partial<TransactionRequest> = {}): TransactionRequest => ({
  type: 'transaction',
  handlerId: 'request',
  account,
  origin: originId,
  payload: { id: 1, jsonrpc: '2.0', method: 'eth_sendTransaction', params: [] },
  data: {
    from: account,
    to: denied,
    value: '0x0',
    data: '0x',
    chainId: '0x1',
    type: '0x2',
    gasLimit: '0x5208',
    maxFeePerGas: '0x1',
    maxPriorityFeePerGas: '0x1'
  },
  approvals: [],
  feesUpdatedByUser: false,
  recipientType: '',
  recognizedActions: [],
  simulation: { status: 'pending' },
  classification: 'contract',
  ...overrides
})

const policy = (mode: 'block' | 'warn' = 'block') => ({
  [account]: {
    [originId]: {
      '0x1': {
        version: 1 as const,
        account,
        originId,
        chainId: '0x1',
        mode,
        targets: [allowed],
        createdAt: now,
        updatedAt: now,
        revision: 1
      }
    }
  }
})

test('block mode refuses a violating request with provider authorization semantics', () => {
  expect(() => reviewDappGuardrail(request(), policy(), now)).toThrow(
    expect.objectContaining({ code: 4100, violations: [expect.objectContaining({ field: 'targets' })] })
  )
})

test('warn mode produces fingerprint-bound explicit approval data', () => {
  const review = reviewDappGuardrail(request(), policy('warn'), now)
  expect(review).toMatchObject({ mode: 'warn', violations: [expect.objectContaining({ field: 'targets' })] })
  expect(guardrailWarningData(review!)).toMatchObject({
    fingerprint: review?.fingerprint,
    title: 'Outside this dapp guardrail'
  })
})

test('pre-sign stability rejects policy drift and accepts the exact approved warning', () => {
  const req = request()
  const review = reviewDappGuardrail(req, policy('warn'), now)!
  req.guardrail = { fingerprint: review.fingerprint, mode: review.mode, violations: [...review.violations] }
  req.approvals = [
    {
      type: 'approveDappGuardrailWarning',
      data: { fingerprint: review.fingerprint },
      approved: true,
      approve: jest.fn()
    }
  ]
  ;(store as jest.Mock).mockReturnValue(policy('warn'))
  expect(assertDappGuardrailReviewStable(req)).toMatchObject({ fingerprint: review.fingerprint })

  ;(store as jest.Mock).mockReturnValue({
    ...policy('warn'),
    [account]: {
      [originId]: {
        '0x1': { ...policy('warn')[account][originId]['0x1'], revision: 2, updatedAt: now + 1 }
      }
    }
  })
  expect(() => assertDappGuardrailReviewStable(req)).toThrow(DappGuardrailError)
})

test('user-initiated cancellation remains available outside the dapp policy', () => {
  const review = reviewDappGuardrail(
    request({
      replacement: {
        kind: ReplacementType.Cancel,
        originalActivityId: 'activity',
        originalHash: `0x${'ab'.repeat(32)}`
      }
    }),
    policy(),
    now
  )
  expect(review).toMatchObject({ mode: 'clear', violations: [] })
})
