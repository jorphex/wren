import migrations from '../../../../../main/store/migrate'
import migration from '../../../../../main/store/migrate/migrations/74'
import { createState } from '../setup'

const canonicalColorwayPrimary = {
  dark: {
    background: 'rgb(17, 21, 19)',
    text: 'rgb(231, 238, 232)'
  },
  light: {
    background: 'rgb(17, 21, 19)',
    text: 'rgb(231, 238, 232)'
  }
}

type PaletteState = ReturnType<typeof createState> & {
  main: ReturnType<typeof createState>['main'] & {
    colorwayPrimary: unknown
    signers: Record<string, unknown>
  }
}

test('canonicalizes legacy primary colors without changing wallet state', () => {
  const state = createState(73) as PaletteState
  state.main.colorwayPrimary = {
    dark: { background: 'rgb(18, 22, 20)', text: 'rgb(230, 237, 231)' },
    light: { background: 'rgb(250, 250, 250)', text: 'rgb(20, 20, 20)' }
  }
  state.main.accounts = { account: { name: 'Preserved account' } }
  state.main.signers = { signer: { type: 'seed' } }

  const migrated = migrations.apply(state) as PaletteState

  expect(migrated.main._version).toBe(75)
  expect(migrated.main.colorwayPrimary).toEqual(canonicalColorwayPrimary)
  expect(migrated.main.accounts).toEqual({ account: { name: 'Preserved account' } })
  expect(migrated.main.signers).toEqual({ signer: { type: 'seed' } })
})

test('preserves malformed migration envelopes for framework rejection', () => {
  expect(migration.migrate(null)).toBeNull()
})
