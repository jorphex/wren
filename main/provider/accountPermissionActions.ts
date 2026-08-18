import { FRAME_SEND_ORIGIN } from '../../resources/domain/origin'
import type { Permission } from '../store/state'

import { applyPermissionAction } from './permissionEvents'

type PermissionAction = 'toggleAccess' | 'clearPermissions'

interface PermissionAccounts {
  getSelectedAddresses(): string[]
  rejectUnapprovedRequestsForOrigins(accountId: string, origins: readonly string[]): boolean
}

interface PermissionProvider {
  accountsChanged(addresses: string[], originIds?: readonly string[]): void
}

interface PermissionActionDependencies {
  accounts: PermissionAccounts
  provider: PermissionProvider
  getPermissions(address: string): Record<string, Permission>
  mutate(address: string, ...args: unknown[]): void
  removeGuardrails(address: string, originIds: readonly string[]): void
}

export function applyAccountPermissionRendererAction(
  action: PermissionAction,
  args: readonly unknown[],
  dependencies: PermissionActionDependencies
) {
  const [account, permissionId, desiredAccess] = args
  if (typeof account !== 'string') return false

  const address = account.toLowerCase()
  const permissions = dependencies.getPermissions(address)
  const permission =
    action === 'toggleAccess' && typeof permissionId === 'string' ? permissions[permissionId] : undefined

  if (action === 'toggleAccess') {
    if (!permission || typeof desiredAccess !== 'boolean') return false
    if (permission.origin === FRAME_SEND_ORIGIN || desiredAccess !== false) return false
  }

  const externalPermissions = Object.values(permissions).filter(({ origin }) => origin !== FRAME_SEND_ORIGIN)
  if (action === 'clearPermissions' && externalPermissions.length === 0) return false

  const revokedPermissions =
    action === 'clearPermissions'
      ? externalPermissions
      : permission && desiredAccess === false
        ? [permission]
        : []
  const affectedOriginIds = permission ? [permission.handlerId] : undefined

  let mutated = false
  try {
    applyPermissionAction(
      address,
      () => {
        dependencies.mutate(address, ...args.slice(1))
        mutated = true
        dependencies.removeGuardrails(
          address,
          revokedPermissions.map(({ handlerId }) => handlerId)
        )
      },
      dependencies.accounts,
      dependencies.provider,
      affectedOriginIds
    )
  } finally {
    if (mutated) {
      dependencies.accounts.rejectUnapprovedRequestsForOrigins(
        address,
        revokedPermissions.map(({ handlerId }) => handlerId)
      )
    }
  }
  return true
}
