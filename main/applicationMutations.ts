import type { AddressBook, AddressBookEntry, AddressBookSaveRequest } from '../resources/domain/addressBook'
import type { Token } from './store/state/types/token'

type AssetSuggestionReference = { account: string; handlerId: string }

export function persistAddressBookEntry(
  request: AddressBookSaveRequest,
  dependencies: {
    save(request: AddressBookSaveRequest): void
    current(): AddressBook
  }
): { success: true; entry: AddressBookEntry } {
  dependencies.save(request)
  const entry = dependencies.current()[request.address.trim().toLowerCase()]
  if (!entry) throw new Error('Saved contact was unavailable')
  return { success: true, entry }
}

export function persistCustomToken(
  token: Token,
  request: AssetSuggestionReference | undefined,
  dependencies: {
    save(tokens: Token[]): void
    resolve(account: string, handlerId: string): void
  }
): { success: true } {
  dependencies.save([token])
  if (request) dependencies.resolve(request.account, request.handlerId)
  return { success: true }
}
