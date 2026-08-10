import { parseAccountCode, parseDelegationIndicator } from '../../../../resources/domain/account/code'
import { keccak256 } from 'ethers'

const delegate = 'aAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'

it('classifies canonical empty, delegated, and contract code', () => {
  expect(parseAccountCode('0x')).toEqual({ status: 'no-code', codeHash: keccak256('0x') })
  expect(parseAccountCode(`0xEF0100${delegate}`)).toEqual({
    status: 'delegated',
    delegate: `0x${delegate.toLowerCase()}`,
    codeHash: keccak256(`0xEF0100${delegate}`)
  })
  expect(parseAccountCode('0x60006000')).toEqual({
    status: 'contract',
    codeHash: keccak256('0x60006000')
  })
})

it.each([undefined, null, '', '0x0', '0xzz', '6000', `0x${'00'.repeat(128 * 1024 + 1)}`])(
  'rejects malformed or oversized code %p',
  (value) => {
    expect(parseAccountCode(value)).toBeUndefined()
  }
)

it('recognizes only the exact EIP-7702 delegation designator', () => {
  expect(parseDelegationIndicator(`0xef0100${delegate}`)).toBe(`0x${delegate.toLowerCase()}`)
  expect(parseDelegationIndicator(`0xef0100${delegate}00`)).toBeUndefined()
  expect(parseDelegationIndicator(`0x6000${delegate}`)).toBeUndefined()
})

it('returns detached immutable classifications', () => {
  const first = parseAccountCode('0x6000')
  const second = parseAccountCode('0x6000')

  expect(first).toEqual(second)
  expect(first).not.toBe(second)
  expect(Object.isFrozen(first)).toBe(true)
})
