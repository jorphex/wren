import {
  clearTransactionFeeDraftSafety,
  getSignatureRequestClass,
  isTransactionFeeDraftSafe,
  setTransactionFeeDraftSafety,
  subscribeToTransactionFeeDraftSafety
} from '../../../../resources/domain/request'

describe('request lifecycle classes', () => {
  it.each([
    [undefined, 'signerRequest'],
    ['pending', 'signerRequest signerRequestPending'],
    ['success', 'signerRequest signerRequestSuccess'],
    ['error', 'signerRequest signerRequestError'],
    ['declined', 'signerRequest signerRequestDeclined']
  ])('maps %s to the existing request class contract', (status, expected) => {
    expect(getSignatureRequestClass({ status })).toBe(expected)
  })
})

describe('transaction fee draft safety', () => {
  const handlerId = 'fee-draft-request'

  afterEach(() => clearTransactionFeeDraftSafety(handlerId))

  it('notifies subscribers only when safety changes', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToTransactionFeeDraftSafety(listener)

    setTransactionFeeDraftSafety(handlerId, false)
    setTransactionFeeDraftSafety(handlerId, false)
    expect(isTransactionFeeDraftSafe(handlerId)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    clearTransactionFeeDraftSafety(handlerId)
    expect(isTransactionFeeDraftSafe(handlerId)).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })
})
