import {
  clearTransactionFeeDraftSafety,
  isTransactionFeeDraftSafe,
  setTransactionFeeDraftSafety,
  subscribeToTransactionFeeDraftSafety
} from '../../../../resources/domain/request'

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
