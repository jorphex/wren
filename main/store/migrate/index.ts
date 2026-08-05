import log from 'electron-log'
import { z } from 'zod'

import legacyMigrations from './migrations/legacy'
import migration38 from './migrations/38'
import migration39 from './migrations/39'
import migration40 from './migrations/40'
import migration41 from './migrations/41'
import migration42 from './migrations/42'
import migration43 from './migrations/43'
import migration44 from './migrations/44'
import migration45 from './migrations/45'
import migration46 from './migrations/46'
import migration47 from './migrations/47'
import migration48 from './migrations/48'
import migration49 from './migrations/49'
import migration50 from './migrations/50'
import migration51 from './migrations/51'
import migration52 from './migrations/52'

import type { Migration } from '../state'

const migrations: Migration[] = [
  ...legacyMigrations,
  migration38,
  migration39,
  migration40,
  migration41,
  migration42,
  migration43,
  migration44,
  migration45,
  migration46,
  migration47,
  migration48,
  migration49,
  migration50,
  migration51,
  migration52
].sort((m1, m2) => m1.version - m2.version)

// Version number of latest known migration
const latestMigration = migrations[migrations.length - 1]
if (!latestMigration) throw new Error('No state migrations are registered')
const latest = latestMigration.version

const MigratableStateSchema = z
  .object({
    main: z
      .object({
        _version: z.coerce.number().default(0)
      })
      .passthrough()
  })
  .passthrough()

export type MigratableState = z.infer<typeof MigratableStateSchema>

function parseMigratableState(state: unknown, context: string): MigratableState {
  const parsed = MigratableStateSchema.safeParse(state)
  if (parsed.success) return parsed.data

  log.error(`${context}: state is not migratable`, parsed.error.issues)
  throw new Error(`${context}: state is not migratable`)
}

export default {
  // Apply migrations to current state
  apply: (state: unknown, migrateToVersion = latest): MigratableState => {
    let current = parseMigratableState(state, 'Before migration')

    migrations.forEach(({ version, migrate }) => {
      if (current.main._version < version && version <= migrateToVersion) {
        log.info(`Applying state migration: ${version}`)

        current = parseMigratableState(migrate(current), `After migration ${version}`)
        current.main._version = version
      }
    })

    return current
  },
  latest
}
