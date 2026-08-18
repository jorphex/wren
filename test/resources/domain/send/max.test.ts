import { calculateNativeMax, sameNativeMaxEvidence } from '../../../../resources/domain/send/max'

const legacyEvidence = {
  balance: '0xf4240',
  gasLimit: '0x5208',
  l1Fee: '0x0',
  nonce: '0x0',
  fee: { feeModel: 'legacy' as const, gasPrice: '0xa' }
}

it('calculates an exact legacy native maximum and reserve', () => {
  expect(calculateNativeMax(legacyEvidence)).toEqual({
    amount: '790000',
    amountQuantity: '0xc0df0',
    reserve: {
      feeModel: 'legacy',
      gasLimit: '0x5208',
      gasPrice: '0xa',
      executionFee: '210000',
      l1Fee: '0',
      total: '210000'
    }
  })
})

it('reserves the EIP-1559 maximum execution fee plus the L1 fee', () => {
  expect(
    calculateNativeMax({
      balance: '0x186a0',
      gasLimit: '0x64',
      l1Fee: '0x3e8',
      nonce: '0x2',
      fee: { feeModel: 'eip1559', maxFeePerGas: '0x64', maxPriorityFeePerGas: '0xa' }
    })
  ).toEqual({
    amount: '89000',
    amountQuantity: '0x15ba8',
    reserve: {
      feeModel: 'eip1559',
      gasLimit: '0x64',
      maxFeePerGas: '0x64',
      maxPriorityFeePerGas: '0xa',
      executionFee: '10000',
      l1Fee: '1000',
      total: '11000'
    }
  })
})

it.each([
  [{ ...legacyEvidence, balance: '0x0' }, 'balance'],
  [{ ...legacyEvidence, gasLimit: '0x0' }, 'gas limit'],
  [
    {
      ...legacyEvidence,
      fee: { feeModel: 'eip1559' as const, maxFeePerGas: '0x9', maxPriorityFeePerGas: '0xa' }
    },
    'relationship'
  ],
  [{ ...legacyEvidence, balance: '0x33450' }, 'positive amount'],
  [{ ...legacyEvidence, gasLimit: `0x1${'0'.repeat(64)}` }, 'gas limit']
])('fails closed for invalid or non-positive evidence %#', (evidence, message) => {
  expect(() => calculateNativeMax(evidence)).toThrow(message)
})

it('binds every fee, balance, gas, L1 and nonce evidence field', () => {
  expect(sameNativeMaxEvidence(legacyEvidence, { ...legacyEvidence })).toBe(true)
  for (const changed of [
    { ...legacyEvidence, balance: '0xf4241' },
    { ...legacyEvidence, gasLimit: '0x5209' },
    { ...legacyEvidence, l1Fee: '0x1' },
    { ...legacyEvidence, nonce: '0x1' },
    { ...legacyEvidence, fee: { feeModel: 'legacy' as const, gasPrice: '0xb' } },
    {
      ...legacyEvidence,
      fee: { feeModel: 'eip1559' as const, maxFeePerGas: '0xa', maxPriorityFeePerGas: '0x1' }
    }
  ]) {
    expect(sameNativeMaxEvidence(legacyEvidence, changed)).toBe(false)
  }
})
