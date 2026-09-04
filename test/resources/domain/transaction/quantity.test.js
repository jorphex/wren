import {
  MAX_UINT256,
  normalizeTransactionQuantities,
  parseRpcQuantity,
  toRpcQuantity
} from '../../../../resources/domain/transaction/quantity'

it.each([
  ['0x0', 0n],
  ['0x1', 1n],
  ['0xABC', 2748n],
  [`0x${MAX_UINT256.toString(16)}`, MAX_UINT256]
])('parses canonical uint256 quantity %s', (value, expected) => {
  expect(parseRpcQuantity(value)).toBe(expected)
})

it.each([undefined, null, 1, '0x', '0x00', '0X1', '1', '0xg', `0x1${'0'.repeat(64)}`])(
  'rejects invalid RPC quantity %p',
  (value) => {
    expect(parseRpcQuantity(value)).toBeUndefined()
  }
)

it('formats canonical uint256 quantities', () => {
  expect(toRpcQuantity(0n)).toBe('0x0')
  expect(toRpcQuantity(MAX_UINT256)).toBe(`0x${MAX_UINT256.toString(16)}`)
})

it.each([-1n, MAX_UINT256 + 1n])('rejects an out-of-range quantity', (value) => {
  expect(() => toRpcQuantity(value)).toThrow('uint256')
})

it('canonicalizes padded transaction quantities without changing other fields', () => {
  expect(normalizeTransactionQuantities({ nonce: '0x000A', gasLimit: '0x005208', data: '0x000A' })).toEqual({
    nonce: '0xa',
    gasLimit: '0x5208',
    data: '0x000A'
  })
})

it('rejects malformed or out-of-range transaction quantities', () => {
  expect(() => normalizeTransactionQuantities({ nonce: '0xg' })).toThrow('nonce')
  expect(() => normalizeTransactionQuantities({ value: `0x1${'0'.repeat(64)}` })).toThrow('value')
})
