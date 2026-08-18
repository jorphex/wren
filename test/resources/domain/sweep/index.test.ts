import { erc20Interface } from '../../../../resources/contracts'
import {
  assertSweepEvidenceStable,
  buildSweepBalanceCall,
  createSweepEvidence,
  parseSweepBalanceResult,
  snapshotSweepEvidence,
  snapshotSweepSelection
} from '../../../../resources/domain/sweep'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const tokenA = '0x3333333333333333333333333333333333333333'
const tokenB = '0x4444444444444444444444444444444444444444'

it('normalizes one explicit account, chain, recipient, and bounded asset selection', () => {
  expect(
    snapshotSweepSelection({ account, chainId: 10, recipient, tokens: [tokenA, tokenB], includeNative: true })
  ).toEqual({
    version: '1',
    account,
    chainId: '0xa',
    recipient,
    tokens: [tokenA, tokenB],
    includeNative: true
  })
  expect(() =>
    snapshotSweepSelection({
      account,
      chainId: 1,
      recipient,
      tokens: Array.from({ length: 16 }, (_, index) => `0x${(index + 16).toString(16).padStart(40, '0')}`),
      includeNative: true
    })
  ).toThrow(/between 1 and 16/)
  expect(() =>
    snapshotSweepSelection({ account, chainId: 1, recipient, tokens: [tokenA, tokenA], includeNative: false })
  ).toThrow(/duplicates/)
  expect(() =>
    snapshotSweepSelection({
      account,
      chainId: 1,
      recipient: account,
      tokens: [tokenA],
      includeNative: false
    })
  ).toThrow(/differ/)
})

it('uses bundled ERC-20 balanceOf encoding and parses only ABI results', () => {
  expect(buildSweepBalanceCall(tokenA, account)).toEqual({
    to: tokenA,
    data: erc20Interface.encodeFunctionData('balanceOf', [account]),
    value: '0x0'
  })
  expect(parseSweepBalanceResult(erc20Interface.encodeFunctionResult('balanceOf', [123n]))).toBe(123n)
  expect(() => parseSweepBalanceResult('0x01')).toThrow(/invalid/)
})

it('orders positive token transfers first and fixes native Max last after aggregate fees', () => {
  const selection = snapshotSweepSelection({
    account,
    chainId: 10,
    recipient,
    tokens: [tokenA, tokenB],
    includeNative: true
  })
  const evidence = createSweepEvidence(selection, ['0x5', '0x7'], '0x100', '0x30')
  expect(evidence.tokens).toEqual([
    { address: tokenA, balance: '0x5' },
    { address: tokenB, balance: '0x7' }
  ])
  expect(evidence.native).toEqual({ selected: true, balance: '0x100', value: '0xd0' })
  expect(evidence.calls.map(({ to }) => to)).toEqual([tokenA, tokenB, recipient])
  expect(evidence.calls.at(-1)).toEqual({ to: recipient, data: '0x', value: '0xd0' })
  expect(snapshotSweepEvidence(evidence)).toEqual(evidence)
  expect(() => createSweepEvidence(selection, ['0x0', '0x7'], '0x100', '0x30')).toThrow(/no pending balance/)
  expect(() => createSweepEvidence(selection, ['0x5', '0x7'], '0x20', '0x30')).toThrow(/cannot cover/)
})

it('detects any asset, fee, or call drift without mutating reviewed evidence', () => {
  const selection = snapshotSweepSelection({
    account,
    chainId: 1,
    recipient,
    tokens: [tokenA],
    includeNative: true
  })
  const expected = createSweepEvidence(selection, ['0x5'], '0x100', '0x30')
  const actual = createSweepEvidence(selection, ['0x6'], '0x100', '0x30')
  expect(() => assertSweepEvidenceStable(expected, actual)).toThrow(/changed/)
  expect(expected.tokens[0]?.balance).toBe('0x5')
})
