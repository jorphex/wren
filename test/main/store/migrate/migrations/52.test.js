import migration from '../../../../../main/store/migrate/migrations/52'
import { createState } from '../setup'

it('moves existing profiles to Wren dark mode and preserves a valid Glide edge', () => {
  const left = createState(51)
  left.main.colorway = 'light'
  left.main.glideSide = 'left'
  expect(migration.migrate(left).main).toMatchObject({ colorway: 'dark', glideSide: 'left' })

  const right = createState(51)
  right.main.glideSide = 'outside'
  expect(migration.migrate(right).main).toMatchObject({ colorway: 'dark', glideSide: 'right' })
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
