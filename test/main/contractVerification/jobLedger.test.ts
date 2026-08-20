import { ContractVerificationJobLedger } from '../../../main/contractVerification/jobLedger'
import {
  ContractVerificationJobRecord,
  MAX_CONTRACT_VERIFICATION_JOBS
} from '../../../resources/domain/contractVerification'

const id = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`

const job = (
  index = 1,
  overrides: Partial<ContractVerificationJobRecord> = {}
): ContractVerificationJobRecord => ({
  id: id(index),
  target: {
    address: `0x${'1'.repeat(40)}`,
    chainId: 1,
    runtimeCodeHash: `0x${'2'.repeat(64)}`
  },
  language: 'Solidity',
  compilerVersion: '0.8.28+commit.7893614a',
  contractIdentifier: 'contracts/Counter.sol:Counter',
  sourceHash: '3'.repeat(64),
  submissionHash: '4'.repeat(64),
  status: 'publishing',
  destinations: [{ destination: 'sourcify', status: 'checking', remoteId: `poll-${index}` }],
  createdAt: index,
  updatedAt: index,
  ...overrides
})

const fixture = (initial: unknown = []) => {
  let persisted = initial
  const save = jest.fn((jobs) => {
    persisted = jobs
  })
  const ledger = new ContractVerificationJobLedger({ load: () => persisted, save })
  return { ledger, save, persisted: () => persisted }
}

test('stores immutable cloned snapshots and exposes list/get in newest-first order', () => {
  const { ledger, persisted } = fixture()
  const first = job(1)
  const second = job(2)

  expect(ledger.put(first)).toEqual(first)
  expect(ledger.put(second)).toEqual(second)
  expect(ledger.list().map(({ id: candidate }) => candidate)).toEqual([second.id, first.id])
  expect(ledger.get(first.id)).toEqual(first)
  expect(ledger.get(id(999))).toBeUndefined()

  const stored = persisted() as readonly ContractVerificationJobRecord[]
  expect(Object.isFrozen(stored)).toBe(true)
  expect(Object.isFrozen(stored[0])).toBe(true)
  expect(Object.isFrozen(stored[0]?.destinations)).toBe(true)
  expect(Object.isFrozen(ledger.list())).toBe(true)
  expect(ledger.get(first.id)).not.toBe(first)
})

test('rejects duplicates and every immutable identity mutation', () => {
  const { ledger, save } = fixture()
  const original = job()
  ledger.put(original)
  expect(() => ledger.put(original)).toThrow('already exists')

  const mutations: ContractVerificationJobRecord[] = [
    { ...original, id: id(2), updatedAt: 2 },
    { ...original, target: { ...original.target, chainId: 10 }, updatedAt: 2 },
    { ...original, language: 'Vyper', updatedAt: 2 },
    { ...original, compilerVersion: '0.8.29', updatedAt: 2 },
    { ...original, contractIdentifier: 'contracts/Counter.sol:Other', updatedAt: 2 },
    { ...original, sourceHash: '5'.repeat(64), updatedAt: 2 },
    { ...original, submissionHash: '6'.repeat(64), updatedAt: 2 },
    { ...original, createdAt: 0, updatedAt: 2 }
  ]
  for (const mutation of mutations) {
    expect(() => ledger.update(original.id, mutation)).toThrow('identity cannot change')
  }
  expect(save).toHaveBeenCalledTimes(1)
})

test('allows idempotent progress but rejects time, job status, and destination rollback', () => {
  const original = job(1, { updatedAt: 2 })
  const { ledger, save } = fixture([original])

  expect(ledger.update(original.id, original)).toEqual(original)
  expect(() => ledger.update(original.id, { ...original, updatedAt: 1 })).toThrow(
    'update cannot move backwards'
  )

  const published = {
    ...original,
    status: 'published' as const,
    destinations: [
      {
        ...original.destinations[0]!,
        status: 'published' as const,
        statusUrl: 'https://repo.sourcify.dev/contracts/full_match/1/address/'
      }
    ],
    updatedAt: 3
  }
  expect(ledger.update(original.id, published)).toEqual(published)
  expect(() => ledger.update(original.id, { ...published, status: 'publishing', updatedAt: 4 })).toThrow(
    'status cannot move backwards'
  )
  expect(() =>
    ledger.update(original.id, {
      ...published,
      destinations: [{ destination: 'sourcify', status: 'not-submitted' }],
      updatedAt: 4
    })
  ).toThrow('evidence cannot move backwards or change')
  expect(save).toHaveBeenCalledTimes(2)

  const rejected = job(2, {
    status: 'rejected',
    destinations: [{ destination: 'sourcify', status: 'rejected' }]
  })
  const rejectedLedger = fixture([rejected]).ledger
  expect(() => rejectedLedger.update(rejected.id, { ...rejected, status: 'partial', updatedAt: 3 })).toThrow(
    'status cannot move backwards'
  )
})

test('preserves accepted polling IDs and URLs and rejects duplicate or removed destinations', () => {
  const original = job(1, {
    destinations: [
      {
        destination: 'sourcify',
        status: 'checking',
        remoteId: 'poll-1',
        statusUrl: 'https://sourcify.dev/server/check-by-addresses'
      }
    ]
  })
  const { ledger } = fixture([original])

  const { remoteId: _remoteId, ...withoutRemoteId } = original.destinations[0]!
  const { statusUrl: _statusUrl, ...withoutStatusUrl } = original.destinations[0]!

  for (const destinations of [
    [withoutRemoteId],
    [{ ...original.destinations[0]!, remoteId: undefined }],
    [{ ...original.destinations[0]!, remoteId: 'other-poll' }],
    [withoutStatusUrl],
    [{ ...original.destinations[0]!, statusUrl: undefined }],
    [{ ...original.destinations[0]!, statusUrl: 'https://example.invalid/other' }]
  ]) {
    expect(() => ledger.update(original.id, { ...original, destinations, updatedAt: 2 })).toThrow()
  }

  expect(() =>
    ledger.update(original.id, {
      ...original,
      destinations: [original.destinations[0]!, original.destinations[0]!],
      updatedAt: 2
    })
  ).toThrow()
  expect(() => ledger.update(original.id, { ...original, destinations: [], updatedAt: 2 })).toThrow()
})

test('records pre-submit failures and pauses accepted explorer polling for a replacement key', () => {
  const intent = job(1, {
    status: 'publishing',
    destinations: [
      { destination: 'sourcify', status: 'published' },
      { destination: 'etherscan-direct', status: 'unknown' }
    ]
  })
  const { ledger } = fixture([intent])
  const unavailable = {
    ...intent,
    status: 'partial' as const,
    destinations: [
      intent.destinations[0]!,
      { destination: 'etherscan-direct' as const, status: 'unavailable' as const }
    ],
    updatedAt: 2
  }
  expect(ledger.update(intent.id, unavailable)).toEqual(unavailable)

  const accepted = job(2, {
    status: 'partial',
    destinations: [
      { destination: 'sourcify', status: 'published' },
      { destination: 'etherscan-direct', status: 'checking', remoteId: 'GUID_12345678' }
    ]
  })
  const acceptedLedger = fixture([accepted]).ledger
  const needsKey = {
    ...accepted,
    destinations: [
      accepted.destinations[0]!,
      {
        destination: 'etherscan-direct' as const,
        status: 'needs-api-key' as const,
        remoteId: 'GUID_12345678',
        reasonCode: 'api-key-required' as const
      }
    ],
    updatedAt: 3
  }
  expect(acceptedLedger.update(accepted.id, needsKey)).toEqual(needsKey)
  expect(
    acceptedLedger.update(accepted.id, {
      ...needsKey,
      destinations: [
        needsKey.destinations[0]!,
        { ...needsKey.destinations[1]!, status: 'checking' as const }
      ],
      updatedAt: 4
    })
  ).toMatchObject({ destinations: [expect.anything(), { status: 'checking', remoteId: 'GUID_12345678' }] })
})

test('adds a destination without changing existing evidence and supports callback updates', () => {
  const original = job(1, {
    status: 'partial',
    destinations: [
      { destination: 'sourcify', status: 'published', remoteId: 'poll-1' },
      { destination: 'etherscan-direct', status: 'needs-api-key', reasonCode: 'api-key-required' }
    ]
  })
  const { ledger } = fixture([original])

  const updated = ledger.update(original.id, (current) => ({
    ...current,
    status: 'published',
    destinations: [
      current.destinations[0]!,
      {
        destination: 'etherscan-direct',
        status: 'verified',
        remoteId: 'guid-1',
        explorerUrl: 'https://etherscan.io/address/0x1111111111111111111111111111111111111111#code'
      }
    ],
    updatedAt: 2
  }))

  expect(updated.status).toBe('published')
  expect(updated.destinations[0]).toEqual(original.destinations[0])
  expect(updated.destinations[1]).toMatchObject({ status: 'verified', remoteId: 'guid-1' })
})

test('normalizes malformed restart state without losing accepted polling evidence', () => {
  const checking = job(3)
  const older = job(2, {
    status: 'published',
    destinations: [{ destination: 'sourcify', status: 'published' }]
  })
  const { ledger, save, persisted } = fixture([
    older,
    { ...job(4), source: 'private source' },
    checking,
    { ...job(5), apiKey: 'secret' }
  ])

  expect(ledger.list()).toEqual([checking, older])
  expect(ledger.get(checking.id)?.destinations[0]).toMatchObject({
    status: 'checking',
    remoteId: 'poll-3'
  })
  expect(save).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(persisted())).not.toContain('private source')
  expect(JSON.stringify(persisted())).not.toContain('secret')
})

test('at capacity evicts only the oldest fully terminal row and never active accepted polling jobs', () => {
  const oldestTerminal = job(1, {
    status: 'published',
    destinations: [{ destination: 'sourcify', status: 'published' }]
  })
  const active = Array.from({ length: MAX_CONTRACT_VERIFICATION_JOBS - 1 }, (_, offset) => job(offset + 2))
  const { ledger, persisted } = fixture([oldestTerminal, ...active])
  const appended = job(999)

  expect(ledger.put(appended)).toEqual(appended)
  const ids = (persisted() as readonly ContractVerificationJobRecord[]).map(({ id: candidate }) => candidate)
  expect(ids).toHaveLength(MAX_CONTRACT_VERIFICATION_JOBS)
  expect(ids).toContain(appended.id)
  expect(ids).not.toContain(oldestTerminal.id)
  expect(active.every(({ id: candidate }) => ids.includes(candidate))).toBe(true)
})

test.each(['partial', 'unknown', 'preparing', 'publishing'] as const)(
  'does not evict a %s row to append at capacity',
  (status) => {
    const rows = Array.from({ length: MAX_CONTRACT_VERIFICATION_JOBS }, (_, offset) =>
      job(offset + 1, { status })
    )
    const { ledger, save } = fixture(rows.reverse())

    expect(() => ledger.put(job(999))).toThrow('limit reached')
    expect(save).not.toHaveBeenCalled()
  }
)
