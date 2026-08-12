import { ACTIVITY_RETENTION_MS, pruneActivity } from '../../../../main/store/state/types/activity'

const now = 1_800_000_000_000
const entry = (index: number, completedAt = now) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  account: `0x${'a'.repeat(40)}`,
  origin: 'example.test',
  type: 'transaction',
  outcome: 'confirmed',
  createdAt: completedAt,
  completedAt
})

it('prunes entries older than 90 days while retaining the exact boundary', () => {
  const boundary = entry(1, now - ACTIVITY_RETENTION_MS)
  const expired = entry(2, boundary.completedAt - 1)

  expect(pruneActivity([expired, boundary], now)).toEqual([boundary])
})

it('bounds history to the 500 newest valid entries deterministically', () => {
  const entries = Array.from({ length: 501 }, (_, index) => entry(index + 1, now - index))
  const pruned = pruneActivity([...entries].reverse(), now)

  expect(pruned).toHaveLength(500)
  expect(pruned[0]).toEqual(entries[0])
  expect(pruned[499]).toEqual(entries[499])
})
