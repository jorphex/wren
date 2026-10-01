import migration from '../../../../../main/store/migrate/migrations/43'
import { PERSISTED_WALLET_CALL_BATCH_TTL_MS } from '../../../../../main/store/state/types/walletCallBatch'
import { createState } from '../setup'

const key = `0x${'a'.repeat(64)}`
const transactionHash = `0x${'1'.repeat(64)}`
const account = '0x1111111111111111111111111111111111111111'

function legacyBatch(overrides = {}) {
  return {
    id: 'legacy-batch',
    origin: 'example.test',
    account,
    chainId: '0x1',
    atomic: false,
    callCount: 1,
    execution: 'pending',
    transactions: [{ hash: transactionHash }],
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 1000 + PERSISTED_WALLET_CALL_BATCH_TTL_MS,
    ...overrides
  }
}

it('marks valid legacy transaction hashes as submitted without changing unrelated state', () => {
  const state = createState(42)
  state.main.accounts = { fixture: { name: 'preserved' } }
  state.main.walletCallBatches = { [key]: legacyBatch() }

  const migrated = migration.migrate(state)

  expect(migrated.main.accounts).toEqual(state.main.accounts)
  expect(migrated.main.walletCallBatches[key].transactions).toEqual([
    { hash: transactionHash, state: 'submitted' }
  ])
})

it('preserves current signed state and prunes malformed or unsafe records', () => {
  const state = createState(42)
  state.main.walletCallBatches = {
    [key]: legacyBatch({ transactions: [{ hash: transactionHash, state: 'signed' }] }),
    unsafe: legacyBatch(),
    [`0x${'b'.repeat(64)}`]: legacyBatch({ account: '0x1' })
  }

  expect(migration.migrate(state).main.walletCallBatches).toEqual({
    [key]: legacyBatch({ transactions: [{ hash: transactionHash, state: 'signed' }] })
  })
})

it('returns malformed inputs unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: {} })).toEqual({ main: {} })
})

it('replaces a malformed ledger container without changing the surrounding state', () => {
  const state = createState(42)
  state.main.accounts = { fixture: { name: 'preserved' } }
  state.main.walletCallBatches = ['not', 'a', 'record']

  expect(migration.migrate(state).main).toMatchObject({
    accounts: state.main.accounts,
    walletCallBatches: {}
  })
})
