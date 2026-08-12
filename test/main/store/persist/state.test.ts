import {
  pruneTransientPersistedState,
  sanitizePersistedStateUpdate
} from '../../../../main/store/persist/state'

test('removes ignored transient snapshots while retaining versioned wallet state', () => {
  const main = { accounts: {}, extensionCredentials: {} }
  const persisted = {
    unrelated: { retained: true },
    __: {
      44: { main: { accounts: { legacy: true } } },
      45: {
        main,
        tray: { open: true },
        view: { notify: 'extensionConnect', notifyData: { pairingCode: 'not-retained' } },
        windows: { tray: { showing: true } }
      },
      malformed: { view: { retained: 'without a main payload' } }
    }
  }

  expect(pruneTransientPersistedState(persisted)).toEqual({
    unrelated: persisted.unrelated,
    __: {
      44: persisted.__[44],
      45: { main },
      malformed: persisted.__.malformed
    }
  })
})

test('does not rewrite state without transient version siblings', () => {
  const persisted = { __: { 45: { main: { accounts: {} } } } }
  expect(pruneTransientPersistedState(persisted)).toBe(persisted)
})

test('redacts request payload state from full and account persistence updates', () => {
  const account = {
    name: 'Account',
    requests: { pending: { payload: { params: ['private calldata'] }, signed: 'private bytes' } },
    activeRequestId: 'pending'
  }
  expect(sanitizePersistedStateUpdate('main', { accounts: { account }, retained: true })).toEqual({
    path: 'main',
    value: { accounts: { account: { name: 'Account' } }, retained: true }
  })
  expect(sanitizePersistedStateUpdate('main.accounts.account', account)).toEqual({
    path: 'main.accounts.account',
    value: { name: 'Account' }
  })
  expect(sanitizePersistedStateUpdate('main.accounts.account.requests', account.requests)).toBeNull()
  expect(sanitizePersistedStateUpdate('main.accounts.account.activeRequestId', 'pending')).toBeNull()
  expect(sanitizePersistedStateUpdate('main.accounts.account.name', 'Account')).toEqual({
    path: 'main.accounts.account.name',
    value: 'Account'
  })
  expect(account.requests.pending.payload.params).toEqual(['private calldata'])
  expect(account.activeRequestId).toBe('pending')
})
