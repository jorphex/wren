import type { AddressBook, AddressBookEntry, AddressBookSaveRequest } from '../resources/domain/addressBook'
import type { Token } from './store/state/types/token'

type AssetSuggestionReference = { account: string; handlerId: string }

type AccountRemovalManager = {
  accountsForSignerRemoval(
    signerId: string,
    signerAddresses: readonly string[],
    retainedSignerAddresses: readonly string[]
  ): string[]
  getSelectedAddresses(): string[]
  remove(address: string): string[]
  removeMany(addresses: readonly string[]): string[]
}

type SignerRemovalManager = {
  addressesExcept(id: string): string[]
  get(id: string): { addresses?: string[]; deviceId?: string; type?: string } | undefined
  remove(id: string): void
}

export type AccountRemovalResult = {
  currentAddresses: string[]
  removedAddresses: string[]
  selectionChanged: boolean
}

export type SignerRemovalPlan = {
  accountAddresses: string[]
  journal: {
    addresses: string[]
    deviceId?: string
    kind: 'hardware' | 'hot' | 'lattice'
  }
  retainedSignerAddresses: string[]
  signerAddresses: string[]
}

export function performDurableRemoval<T>(dependencies: {
  begin(): void
  rollbackPreparation(): void
  remove(): T
  onDeferredRemoval(error: unknown): T
  finish(): void
  commit(): void
  restoreFence(): void
  onDeferredCommit(error: unknown): void
}): T {
  dependencies.begin()
  try {
    dependencies.commit()
  } catch (error) {
    dependencies.rollbackPreparation()
    throw error
  }

  let result: T
  try {
    result = dependencies.remove()
  } catch (error) {
    // The journal is already durable. Report the removal as accepted and keep
    // its fence in place so active/startup recovery can finish it safely.
    return dependencies.onDeferredRemoval(error)
  }
  try {
    dependencies.finish()
  } catch (error) {
    dependencies.restoreFence()
    dependencies.onDeferredCommit(error)
    return result
  }
  try {
    dependencies.commit()
  } catch (error) {
    // The first commit durably recorded enough information to finish after a
    // restart. Restore the same fence in live state until compaction succeeds.
    dependencies.restoreFence()
    dependencies.onDeferredCommit(error)
  }
  return result
}

export function performDurableRemovalRetry<T>(dependencies: {
  remove(): T
  notify(result: T): void
  finish(): void
  commit(): void
  restoreFence(): void
}): T {
  const result = dependencies.remove()
  dependencies.notify(result)
  try {
    dependencies.finish()
    dependencies.commit()
  } catch (error) {
    dependencies.restoreFence()
    throw error
  }
  return result
}

const sameAddresses = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((address, index) => address === right[index])

const removalResult = (
  previousAddresses: string[],
  removedAddresses: string[],
  accounts: AccountRemovalManager
): AccountRemovalResult => {
  const currentAddresses = accounts.getSelectedAddresses()
  return {
    currentAddresses,
    removedAddresses,
    selectionChanged: !sameAddresses(previousAddresses, currentAddresses)
  }
}

export function removeWalletAccount(
  address: string,
  dependencies: { accounts: AccountRemovalManager }
): AccountRemovalResult {
  const previousAddresses = dependencies.accounts.getSelectedAddresses()
  const removedAddresses = dependencies.accounts.remove(address)
  return removalResult(previousAddresses, removedAddresses, dependencies.accounts)
}

export function removeSignerAndAccounts(
  signerId: string,
  dependencies: {
    accounts: AccountRemovalManager
    signers: SignerRemovalManager
  },
  plan = prepareSignerRemoval(signerId, dependencies)
): AccountRemovalResult {
  const previousAddresses = dependencies.accounts.getSelectedAddresses()
  // A removal can be retried after another signer has connected. Recompute the
  // exclusive accounts at execution time so a durable journal never removes an
  // address that has since become shared.
  const authorizedAddresses = new Set(plan.accountAddresses.map((address) => address.toLowerCase()))
  const accountAddresses = dependencies.accounts
    .accountsForSignerRemoval(signerId, plan.signerAddresses, dependencies.signers.addressesExcept(signerId))
    .filter((address) => authorizedAddresses.has(address.toLowerCase()))
  const removedAddresses = dependencies.accounts.removeMany(accountAddresses)
  const result = removalResult(previousAddresses, removedAddresses, dependencies.accounts)
  dependencies.signers.remove(signerId)
  return result
}

export function prepareSignerRemoval(
  signerId: string,
  dependencies: {
    accounts: AccountRemovalManager
    signers: SignerRemovalManager
  }
): SignerRemovalPlan {
  const signer = dependencies.signers.get(signerId)
  if (!signer) throw new Error('Signer is unavailable')

  const signerAddresses = [...(signer.addresses || [])]
  const retainedSignerAddresses = dependencies.signers.addressesExcept(signerId)
  const accountAddresses = dependencies.accounts.accountsForSignerRemoval(
    signerId,
    signerAddresses,
    retainedSignerAddresses
  )
  // Keep authority over every address reported by the signer. Execution and
  // startup recovery independently preserve addresses still owned elsewhere.
  const journalAddresses = [...new Set([...accountAddresses, ...signerAddresses])]
  const kind =
    signer.type === 'ring' || signer.type === 'seed'
      ? 'hot'
      : signer.type === 'lattice'
        ? 'lattice'
        : 'hardware'
  return {
    accountAddresses,
    journal: {
      addresses: journalAddresses,
      ...(kind === 'lattice' && signer.deviceId ? { deviceId: signer.deviceId } : {}),
      kind
    },
    retainedSignerAddresses,
    signerAddresses
  }
}

export function resetApplicationProfile(dependencies: {
  removeContractVerificationCredential(): { success: boolean }
  clearPersistedState(): void
}): boolean {
  const credential = dependencies.removeContractVerificationCredential()
  if (!credential.success) return false
  dependencies.clearPersistedState()
  return true
}

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
