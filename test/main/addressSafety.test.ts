import {
  assessOutboundAddresses,
  recordOutboundAddresses,
  transactionOutboundTargets,
  walletCallsOutboundTargets
} from '../../main/addressSafety'
import {
  MAX_OUTBOUND_ADDRESS_MEMORY,
  OUTBOUND_ADDRESS_RETENTION_MS
} from '../../main/store/state/types/outboundAddressMemory'

const profile = '00000000-0000-4000-8000-000000000001'
const prior = `0x1234${'a'.repeat(32)}abcd`
const lookalike = `0x1234${'b'.repeat(32)}abcd`
const different = `0x5678${'c'.repeat(32)}dcba`

it('distinguishes an exact previous destination from a different full-address lookalike', () => {
  const memory = recordOutboundAddresses({}, profile, [prior], 1_000)

  expect(assessOutboundAddresses(memory, profile, [prior], 2_000).targets).toEqual([
    { address: prior, state: 'previous', lastSubmittedAt: 1_000 }
  ])
  expect(assessOutboundAddresses(memory, profile, [lookalike], 2_000).targets).toEqual([
    { address: lookalike, state: 'lookalike' }
  ])
  expect(assessOutboundAddresses(memory, profile, [different], 2_000).targets).toEqual([
    { address: different, state: 'new' }
  ])
})

it('persists only a profile-bound digest, address ends, and the latest submitted time', () => {
  const memory = recordOutboundAddresses({}, profile, [prior.toUpperCase()], 1_000)
  const [digest] = Object.keys(memory)

  expect(digest).toMatch(/^[0-9a-f]{64}$/u)
  expect(memory[digest]).toEqual({ digest, prefix: '1234', suffix: 'abcd', lastSubmittedAt: 1_000 })
  expect(JSON.stringify(memory)).not.toContain(prior.slice(6, -4))
  expect(recordOutboundAddresses(memory, profile, [prior], 2_000)[digest].lastSubmittedAt).toBe(2_000)
})

it('drops expired entries and deterministically caps the most recent distinct destinations', () => {
  const addresses = Array.from(
    { length: MAX_OUTBOUND_ADDRESS_MEMORY + 1 },
    (_, index) => `0x${index.toString(16).padStart(40, '0')}`
  )
  const memory = addresses.reduce(
    (current, address, index) => recordOutboundAddresses(current, profile, [address], index + 1),
    {}
  )

  expect(Object.keys(memory)).toHaveLength(MAX_OUTBOUND_ADDRESS_MEMORY)
  expect(
    assessOutboundAddresses(memory, profile, [addresses[0]], addresses.length + 1).targets[0].state
  ).toBe('new')
  expect(
    assessOutboundAddresses(
      recordOutboundAddresses({}, profile, [prior], 1),
      profile,
      [prior],
      OUTBOUND_ADDRESS_RETENTION_MS + 2
    ).targets[0].state
  ).toBe('new')
})

it('extracts direct, decoded ERC-20, and wallet-call targets without duplicates or malformed values', () => {
  expect(
    transactionOutboundTargets({
      data: { to: prior },
      recognizedActions: [
        { id: 'erc20:transfer', data: { recipient: { address: lookalike } } },
        { id: 'erc20:approve', data: { spender: { address: different } } },
        { id: 'erc20:revoke', data: { spender: { address: different } } },
        { id: 'unknown', data: { recipient: { address: `0x${'d'.repeat(40)}` } } }
      ]
    } as never)
  ).toEqual([prior, lookalike, different])
  expect(
    walletCallsOutboundTargets({
      calls: [{ to: prior }, { to: prior.toUpperCase() }, { data: '0x' }]
    } as never)
  ).toEqual([prior])
})

it('fails closed on invalid persistence inputs without blocking a review when profile identity is absent', () => {
  expect(() => recordOutboundAddresses({}, 'not-a-profile', [prior], 1)).toThrow(/profile identity/u)
  expect(() => recordOutboundAddresses({}, profile, [prior], Number.NaN)).toThrow(/timestamp/u)
  expect(assessOutboundAddresses({ poisoned: true }, '', [prior], 1).targets).toEqual([
    { address: prior, state: 'new' }
  ])
})
