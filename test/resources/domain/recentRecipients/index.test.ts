import {
  addRecentRecipientUse,
  MAX_RECENT_RECIPIENT_USES,
  projectRecentRecipients,
  pruneRecentRecipientUses,
  RECENT_RECIPIENT_RETENTION_MS,
  RecentRecipientUseSchema,
  removeRecentRecipientUse
} from '../../../../resources/domain/recentRecipients'
import { projectRecentRecipients as projectForRenderer } from '../../../../resources/domain/recentRecipients/projection'

const now = 1_800_000_000_000
const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`
const address = (digit: string) => `0x${digit.repeat(40)}`

test('accepts only the privacy-minimal use shape and canonicalizes addresses', () => {
  expect(
    RecentRecipientUseSchema.parse({ operationId: id(1), address: address('A'), confirmedAt: now })
  ).toEqual({ operationId: id(1), address: address('a'), confirmedAt: now })
  expect(
    RecentRecipientUseSchema.safeParse({
      operationId: id(1),
      address: address('a'),
      confirmedAt: now,
      chainId: 1
    }).success
  ).toBe(false)
})

test('adds idempotently, orders newest first, and bounds the ledger', () => {
  let uses: unknown = []
  for (let index = 0; index < MAX_RECENT_RECIPIENT_USES + 5; index += 1) {
    uses = addRecentRecipientUse(
      uses,
      { operationId: id(index + 1), address: address((index % 10).toString()), confirmedAt: now - index },
      now
    )
  }
  const result = addRecentRecipientUse(
    uses,
    { operationId: id(2), address: address('f'), confirmedAt: now },
    now
  )

  expect(result).toHaveLength(MAX_RECENT_RECIPIENT_USES)
  expect(result[0]).toEqual({ operationId: id(2), address: address('f'), confirmedAt: now })
  expect(result.filter(({ operationId }) => operationId === id(2))).toHaveLength(1)
})

test('prunes malformed, expired, future, and duplicate-operation entries', () => {
  expect(
    pruneRecentRecipientUses(
      [
        { operationId: id(1), address: address('1'), confirmedAt: now - 2 },
        { operationId: id(1), address: address('2'), confirmedAt: now - 1 },
        { operationId: id(2), address: address('2'), confirmedAt: now + 1 },
        {
          operationId: id(3),
          address: address('3'),
          confirmedAt: now - RECENT_RECIPIENT_RETENTION_MS - 1
        },
        { operationId: 'bad', address: address('4'), confirmedAt: now }
      ],
      now
    )
  ).toEqual([{ operationId: id(1), address: address('2'), confirmedAt: now - 1 }])
})

test('removes by operation and projects each address at its newest confirmed use', () => {
  const uses = [
    { operationId: id(1), address: address('1'), confirmedAt: now - 3 },
    { operationId: id(2), address: address('2'), confirmedAt: now - 2 },
    { operationId: id(3), address: address('1'), confirmedAt: now - 1 }
  ]

  expect(projectRecentRecipients(uses, now)).toEqual([uses[2], uses[1]])
  expect(projectForRenderer(uses, now)).toEqual([uses[2], uses[1]])
  expect(removeRecentRecipientUse(uses, id(3), now)).toEqual([uses[1], uses[0]])
})

test('renderer projection fails closed on noncanonical or oversized record shapes', () => {
  expect(
    projectForRenderer(
      [
        { operationId: id(1), address: address('A'), confirmedAt: now },
        { operationId: id(2), address: address('2'), confirmedAt: now, chainId: 1 },
        { operationId: id(3), address: address('3'), confirmedAt: now + 1 }
      ],
      now
    )
  ).toEqual([])
})
