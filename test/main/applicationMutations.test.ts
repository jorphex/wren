import {
  performDurableRemoval,
  performDurableRemovalRetry,
  prepareSignerRemoval,
  persistAddressBookEntry,
  persistCustomToken,
  removeSignerAndAccounts,
  removeWalletAccount,
  resetApplicationProfile
} from '../../main/applicationMutations'

const address = '0x0000000000000000000000000000000000000001'

test('returns the canonical contact persisted by a store action whose return value is ignored', () => {
  const entry = {
    address,
    name: 'Workshop',
    note: '',
    provenance: { status: 'saved' as const },
    createdAt: 1,
    updatedAt: 1
  }
  let addressBook = {}
  const save = jest.fn(() => {
    addressBook = { [address]: entry }
    return { ignored: true }
  })

  expect(
    persistAddressBookEntry(
      { mode: 'add', address, name: entry.name, note: '' },
      { save, current: () => addressBook }
    )
  ).toEqual({ success: true, entry })
  expect(save).toHaveBeenCalledTimes(1)
})

test('fails when contact persistence does not produce a canonical entry', () => {
  expect(() =>
    persistAddressBookEntry(
      { mode: 'add', address, name: 'Workshop', note: '' },
      { save: jest.fn(), current: () => ({}) }
    )
  ).toThrow('Saved contact was unavailable')
})

test('persists a token before resolving its asset-suggestion request', () => {
  const order: string[] = []
  const token = {
    address,
    chainId: 1,
    name: 'Workshop token',
    symbol: 'WORK',
    decimals: 18,
    logoURI: 'https://assets.example/work.png'
  }
  const request = { account: address, handlerId: 'asset-suggestion' }

  expect(
    persistCustomToken(token, request, {
      save: (tokens) => {
        order.push('save')
        expect(tokens).toEqual([token])
      },
      resolve: (account, handlerId) => {
        order.push('resolve')
        expect({ account, handlerId }).toEqual(request)
      }
    })
  ).toEqual({ success: true })
  expect(order).toEqual(['save', 'resolve'])
})

test('removes the verifier credential before clearing persisted state', () => {
  const order: string[] = []
  expect(
    resetApplicationProfile({
      removeContractVerificationCredential: () => {
        order.push('credential')
        return { success: true }
      },
      clearPersistedState: () => order.push('persisted-state')
    })
  ).toBe(true)
  expect(order).toEqual(['credential', 'persisted-state'])
})

test('fails closed when the verifier credential cannot be removed', () => {
  const clearPersistedState = jest.fn()
  expect(
    resetApplicationProfile({
      removeContractVerificationCredential: () => ({ success: false }),
      clearPersistedState
    })
  ).toBe(false)
  expect(clearPersistedState).not.toHaveBeenCalled()
})

test('removes a wallet account and reports a selected-account change', () => {
  const order: string[] = []
  let selected = [address]
  const accounts = {
    accountsForSignerRemoval: jest.fn(),
    current: () => ({ id: address }),
    getSelectedAddresses: () => selected,
    remove: jest.fn((removedAddress: string) => {
      order.push('account')
      expect(removedAddress).toBe(address)
      selected = []
      return [address]
    }),
    removeMany: jest.fn()
  }

  expect(removeWalletAccount(address, { accounts })).toEqual({
    currentAddresses: [],
    removedAddresses: [address],
    selectionChanged: true
  })
  expect(order).toEqual(['account'])
})

test('removes exclusive accounts before protected signer cleanup', () => {
  const order: string[] = []
  const sharedAddress = '0x0000000000000000000000000000000000000002'
  let selected = [address]
  const accounts = {
    accountsForSignerRemoval: jest.fn((signerId, signerAddresses, retainedAddresses) => {
      expect({ signerId, signerAddresses, retainedAddresses }).toEqual({
        signerId: 'seed-id',
        signerAddresses: [address, sharedAddress],
        retainedAddresses: [sharedAddress]
      })
      return [address]
    }),
    current: () => ({ id: address }),
    getSelectedAddresses: () => selected,
    remove: jest.fn(),
    removeMany: jest.fn((addresses) => {
      order.push('accounts')
      expect(addresses).toEqual([address])
      selected = []
      return [address]
    })
  }
  const signers = {
    get: jest.fn(() => ({ addresses: [address, sharedAddress] })),
    addressesExcept: jest.fn(() => [sharedAddress]),
    remove: jest.fn(() => order.push('signer'))
  }

  expect(
    removeSignerAndAccounts('seed-id', {
      accounts,
      signers
    })
  ).toEqual({ currentAddresses: [], removedAddresses: [address], selectionChanged: true })
  expect(order).toEqual(['accounts', 'signer'])
})

test('keeps exclusive accounts removed when protected signer cleanup is deferred', () => {
  const accounts = {
    accountsForSignerRemoval: jest.fn(() => [address]),
    current: () => ({ id: address }),
    getSelectedAddresses: () => [address],
    remove: jest.fn(),
    removeMany: jest.fn(() => [address])
  }
  const signers = {
    get: jest.fn(() => ({ addresses: [address] })),
    addressesExcept: jest.fn(() => []),
    remove: jest.fn(() => {
      throw new Error('signer storage unavailable')
    })
  }
  expect(() => removeSignerAndAccounts('seed-id', { accounts, signers })).toThrow(
    'signer storage unavailable'
  )
  expect(accounts.removeMany).toHaveBeenCalledWith([address])
})

test('recomputes shared ownership before a deferred signer removal retry', () => {
  const sharedAddress = '0x0000000000000000000000000000000000000002'
  const accounts = {
    accountsForSignerRemoval: jest.fn((_signerId, _signerAddresses, retainedAddresses) =>
      retainedAddresses.includes(sharedAddress) ? [address] : [address, sharedAddress]
    ),
    getSelectedAddresses: () => [sharedAddress],
    remove: jest.fn(),
    removeMany: jest.fn((addresses) => addresses)
  }
  const signers = {
    get: jest.fn(),
    addressesExcept: jest.fn(() => [sharedAddress]),
    remove: jest.fn()
  }

  const result = removeSignerAndAccounts(
    'removed-signer',
    { accounts, signers },
    {
      accountAddresses: [address, sharedAddress],
      journal: { addresses: [address, sharedAddress], kind: 'hardware' },
      retainedSignerAddresses: [],
      signerAddresses: [address, sharedAddress]
    }
  )

  expect(accounts.accountsForSignerRemoval).toHaveBeenCalledWith(
    'removed-signer',
    [address, sharedAddress],
    [sharedAddress]
  )
  expect(accounts.removeMany).toHaveBeenCalledWith([address])
  expect(result.removedAddresses).toEqual([address])
})

test('never expands a signer retry beyond its currently authorized journal addresses', () => {
  const preservedAddress = '0x0000000000000000000000000000000000000002'
  const accounts = {
    accountsForSignerRemoval: jest.fn(() => [address, preservedAddress]),
    getSelectedAddresses: () => [preservedAddress],
    remove: jest.fn(),
    removeMany: jest.fn((addresses) => addresses)
  }
  const signers = {
    get: jest.fn(),
    addressesExcept: jest.fn(() => []),
    remove: jest.fn()
  }

  const result = removeSignerAndAccounts(
    'removed-signer',
    { accounts, signers },
    {
      accountAddresses: [address],
      journal: { addresses: [address], kind: 'hardware' },
      retainedSignerAddresses: [],
      signerAddresses: [address, preservedAddress]
    }
  )

  expect(accounts.removeMany).toHaveBeenCalledWith([address])
  expect(result.removedAddresses).toEqual([address])
})

test('journals every signer address, including shared addresses, before removal', () => {
  const derivedWithoutAccount = '0x0000000000000000000000000000000000000002'
  const sharedAddress = '0x0000000000000000000000000000000000000003'
  const plan = prepareSignerRemoval('removed-signer', {
    accounts: {
      accountsForSignerRemoval: jest.fn(() => [address]),
      getSelectedAddresses: jest.fn(),
      remove: jest.fn(),
      removeMany: jest.fn()
    },
    signers: {
      addressesExcept: jest.fn(() => [sharedAddress]),
      get: jest.fn(() => ({
        addresses: [address, derivedWithoutAccount, sharedAddress],
        type: 'ledger'
      })),
      remove: jest.fn()
    }
  })

  expect(plan.accountAddresses).toEqual([address])
  expect(plan.journal.addresses).toEqual([address, derivedWithoutAccount, sharedAddress])
})

test('does not remove anything when a durable removal journal cannot be committed', () => {
  const events: string[] = []

  expect(() =>
    performDurableRemoval({
      begin: () => events.push('begin'),
      rollbackPreparation: () => events.push('rollback'),
      remove: () => events.push('remove'),
      onDeferredRemoval: () => events.push('deferred-removal'),
      finish: () => events.push('finish'),
      commit: () => {
        events.push('commit')
        throw new Error('profile commit failed')
      },
      restoreFence: () => events.push('restore-fence'),
      onDeferredCommit: () => events.push('deferred')
    })
  ).toThrow('profile commit failed')

  expect(events).toEqual(['begin', 'commit', 'rollback'])
})

test('reports completion when the durable journal exists but final compaction is deferred', () => {
  const events: string[] = []
  let commits = 0

  expect(
    performDurableRemoval({
      begin: () => events.push('begin'),
      rollbackPreparation: () => events.push('rollback'),
      remove: () => {
        events.push('remove')
        return 'removed'
      },
      finish: () => events.push('finish'),
      onDeferredRemoval: () => 'deferred',
      commit: () => {
        events.push('commit')
        commits += 1
        if (commits === 2) throw new Error('profile compaction failed')
      },
      restoreFence: () => events.push('restore-fence'),
      onDeferredCommit: (error) => events.push((error as Error).message)
    })
  ).toBe('removed')

  expect(events).toEqual([
    'begin',
    'commit',
    'remove',
    'finish',
    'commit',
    'restore-fence',
    'profile compaction failed'
  ])
})

test('reports an admitted cleanup failure as deferred without clearing its journal', () => {
  const events: string[] = []

  expect(
    performDurableRemoval({
      begin: () => events.push('begin'),
      rollbackPreparation: () => events.push('rollback'),
      remove: () => {
        events.push('remove')
        throw new Error('protected storage unavailable')
      },
      onDeferredRemoval: (error) => {
        events.push((error as Error).message)
        return 'deferred'
      },
      finish: () => events.push('finish'),
      commit: () => events.push('commit'),
      restoreFence: () => events.push('restore-fence'),
      onDeferredCommit: () => events.push('deferred-commit')
    })
  ).toBe('deferred')

  expect(events).toEqual(['begin', 'commit', 'remove', 'protected storage unavailable'])
})

test('notifies before retry compaction and restores the fence when that commit fails', () => {
  const events: string[] = []

  expect(() =>
    performDurableRemovalRetry({
      remove: () => {
        events.push('remove')
        return 'removed'
      },
      notify: (result) => events.push(`notify:${result}`),
      finish: () => events.push('finish'),
      commit: () => {
        events.push('commit')
        throw new Error('profile compaction failed')
      },
      restoreFence: () => events.push('restore-fence')
    })
  ).toThrow('profile compaction failed')

  expect(events).toEqual(['remove', 'notify:removed', 'finish', 'commit', 'restore-fence'])
})

test('restores the retry fence when finishing the in-memory journal throws', () => {
  const events: string[] = []

  expect(() =>
    performDurableRemovalRetry({
      remove: () => 'removed',
      notify: () => events.push('notify'),
      finish: () => {
        events.push('finish')
        throw new Error('observer failed')
      },
      commit: () => events.push('commit'),
      restoreFence: () => events.push('restore-fence')
    })
  ).toThrow('observer failed')

  expect(events).toEqual(['notify', 'finish', 'restore-fence'])
})
