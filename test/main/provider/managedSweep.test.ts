import { GasFeesSource, type TransactionData } from '../../../resources/domain/transaction'
import type { SweepDraft } from '../../../resources/domain/sweep'
import {
  assertManagedSweepCallEvidence,
  assertManagedSweepQuoteStable,
  assertManagedSweepSimulationSucceeded,
  buildManagedSweepQuote,
  ManagedSweepQuoteStore,
  publicManagedSweepQuote
} from '../../../main/provider/managedSweep'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const token = '0x3333333333333333333333333333333333333333'
const draft: SweepDraft = { account, chainId: 10, recipient, tokens: [token], includeNative: true }

function dependencies(overrides: Record<string, unknown> = {}) {
  const prepare = jest.fn(async ({ account, chainId, pendingNonce, calls }) => ({
    calls: calls.map((call: { to: string; data: string; value: string }, index: number) => ({
      transaction: {
        from: account,
        chainId,
        nonce: `0x${(BigInt(pendingNonce) + BigInt(index)).toString(16)}`,
        type: '0x0',
        gasLimit: '0x1',
        gasPrice: '0xa',
        gasFeesSource: GasFeesSource.Frame,
        ...call
      } as TransactionData,
      maxFee: '0xa'
    })),
    maxFee: `0x${(BigInt(calls.length) * 10n).toString(16)}`
  }))
  const deps = {
    getPendingNativeBalance: jest.fn(async () => '0x64'),
    getPendingTokenBalance: jest.fn(async () => '0x5'),
    getPendingNonce: jest.fn(async () => '0x7'),
    prepare,
    l1Fees: jest.fn(async () => ['0x3', '0x4']),
    simulate: jest.fn(async () => ({
      status: 'succeeded' as const,
      source: 'eth_simulateV1' as const,
      calls: [
        { status: 'succeeded' as const, source: 'eth_simulateV1' as const, gasUsed: '0x1' },
        { status: 'succeeded' as const, source: 'eth_simulateV1' as const, gasUsed: '0x1' }
      ],
      accountCodeEvidence: {
        source: 'configured-rpc' as const,
        sender: {
          source: 'eth_getCode' as const,
          trust: 'configured-rpc' as const,
          role: 'sender' as const,
          account,
          status: 'no-code' as const,
          codeHash: `0x${'00'.repeat(32)}`
        },
        targets: []
      }
    })),
    ...overrides
  }
  return { deps, prepare }
}

it('converges exact token-first/native-last calls with aggregate execution and OP L1 fees', async () => {
  const { deps, prepare } = dependencies()
  const quote = await buildManagedSweepQuote(draft, deps)

  expect(prepare).toHaveBeenCalledTimes(2)
  expect(quote.evidence.maximumFee).toBe('0x1b')
  expect(quote.evidence.native).toEqual({ selected: true, balance: '0x64', value: '0x49' })
  expect(quote.evidence.calls.map(({ to }) => to)).toEqual([token, recipient])
  expect(quote.evidence.calls.at(-1)?.value).toBe('0x49')
  expect(quote.pendingNonce).toBe('0x7')
  expect(quote.l1Fees).toEqual(['0x3', '0x4'])
})

it('fails closed when a selected token is drained or stateful simulation does not succeed', async () => {
  await expect(
    buildManagedSweepQuote(draft, dependencies({ getPendingTokenBalance: async () => '0x0' }).deps)
  ).rejects.toThrow(/no pending balance/)
  await expect(
    buildManagedSweepQuote(
      draft,
      dependencies({ simulate: async () => ({ status: 'reverted', calls: [], reason: 'revert' }) }).deps
    )
  ).rejects.toThrow(/simulation did not succeed/)
})

it('fails closed when a selected token returns false without reverting', async () => {
  const { deps } = dependencies()
  const simulated = await deps.simulate([])
  deps.simulate.mockResolvedValue({
    ...simulated,
    status: 'succeeded',
    source: 'eth_simulateV1',
    calls: [
      {
        status: 'succeeded',
        source: 'eth_simulateV1',
        gasUsed: '0x1',
        returnDataKind: 'abi-bool-false'
      },
      { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x1' }
    ]
  })
  await expect(buildManagedSweepQuote(draft, deps)).rejects.toThrow(/did not return transfer success/)
})

it('fails closed when delegated target implementation evidence is unavailable', () => {
  expect(() =>
    assertManagedSweepSimulationSucceeded(
      {
        status: 'succeeded',
        source: 'eth_simulateV1',
        calls: [{ status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x1' }],
        accountCodeEvidence: {
          source: 'configured-rpc',
          sender: {
            source: 'eth_getCode',
            trust: 'configured-rpc',
            role: 'sender',
            account,
            status: 'no-code',
            codeHash: `0x${'00'.repeat(32)}`
          },
          targets: [
            {
              source: 'eth_getCode',
              trust: 'configured-rpc',
              role: 'target',
              account: token,
              status: 'delegated',
              codeHash: `0x${'11'.repeat(32)}`,
              delegate: recipient,
              delegateCodeStatus: 'unavailable'
            }
          ]
        }
      },
      1,
      1
    )
  ).toThrow(/account-code evidence is unavailable or unsupported/)
})

it('requires a byte-for-byte fresh nonce, fee, L1, simulation, and evidence snapshot', async () => {
  const expectedBuilt = await buildManagedSweepQuote(draft, dependencies().deps)
  const expected = Object.freeze({ ...expectedBuilt, quoteId: 'quote', expiresAt: 100 })
  const changed = await buildManagedSweepQuote(
    draft,
    dependencies({ getPendingNonce: async () => '0x8' }).deps
  )
  expect(() => assertManagedSweepQuoteStable(expected, changed)).toThrow(/fresh quote/)
})

it('rejects nonce, prepared fee/gas, L1, token, and remaining-funding drift before each signer', async () => {
  const quote = await buildManagedSweepQuote(draft, dependencies().deps)
  const reviewed = quote.preparation
  const first = reviewed.calls[0]?.transaction as TransactionData
  const base = {
    evidence: quote.evidence,
    index: 0,
    transaction: first,
    pendingNonce: first.nonce,
    pendingNativeBalance: '0x64',
    pendingTokenBalance: '0x5',
    reviewedPreparation: reviewed,
    freshPreparation: reviewed,
    freshL1Fees: quote.l1Fees
  }
  expect(() => assertManagedSweepCallEvidence(base)).not.toThrow()
  expect(() => assertManagedSweepCallEvidence({ ...base, pendingNonce: '0x8' })).toThrow(/nonce/)
  expect(() =>
    assertManagedSweepCallEvidence({ ...base, transaction: { ...first, gasPrice: '0xb' } })
  ).toThrow(/call changed/)
  expect(() =>
    assertManagedSweepCallEvidence({
      ...base,
      freshPreparation: {
        ...reviewed,
        calls: reviewed.calls.map((call, index) =>
          index === 0
            ? { ...call, transaction: { ...call.transaction, gasLimit: '0x2' }, maxFee: '0x14' }
            : call
        )
      }
    })
  ).toThrow(/gas or fee/)
  expect(() => assertManagedSweepCallEvidence({ ...base, freshL1Fees: ['0x4', '0x4'] })).toThrow(/data fees/)
  expect(() => assertManagedSweepCallEvidence({ ...base, pendingTokenBalance: '0x4' })).toThrow(
    /token balance/
  )
  expect(() => assertManagedSweepCallEvidence({ ...base, pendingNativeBalance: '0x63' })).toThrow(
    /affordable/
  )

  const second = reviewed.calls[1]?.transaction as TransactionData
  const remainingPreparation = {
    ...reviewed,
    calls: reviewed.calls.slice(1),
    maxFee: reviewed.calls[1]?.maxFee || '0x0'
  }
  expect(() =>
    assertManagedSweepCallEvidence({
      evidence: quote.evidence,
      index: 1,
      transaction: second,
      pendingNonce: second.nonce,
      pendingNativeBalance: '0x57',
      reviewedPreparation: reviewed,
      freshPreparation: remainingPreparation,
      freshL1Fees: quote.l1Fees.slice(1)
    })
  ).not.toThrow()
  expect(() =>
    assertManagedSweepCallEvidence({
      evidence: quote.evidence,
      index: 1,
      transaction: second,
      pendingNonce: second.nonce,
      pendingNativeBalance: '0x56',
      reviewedPreparation: reviewed,
      freshPreparation: remainingPreparation,
      freshL1Fees: quote.l1Fees.slice(1)
    })
  ).toThrow(/affordable/)
})

it('keeps quotes bounded, ephemeral, expiring, identity-bound, and one-use', async () => {
  let now = 10
  const store = new ManagedSweepQuoteStore(
    () => 'quote',
    () => now,
    5
  )
  const built = await buildManagedSweepQuote(draft, dependencies().deps)
  const stored = store.put(built)
  expect(publicManagedSweepQuote(stored)).toMatchObject({ quoteId: 'quote', expiresAt: 15 })
  expect(store.take('quote', built.evidence)).toBe(stored)
  expect(() => store.take('quote', built.evidence)).toThrow(/invalid or expired/)

  const second = store.put(built)
  now = 15
  expect(() => store.take(second.quoteId, built.evidence)).toThrow(/invalid or expired/)
})
