import {
  persistAddressBookEntry,
  persistCustomToken,
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
