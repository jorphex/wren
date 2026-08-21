import { z } from 'zod'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import type { SignerCapabilities } from '../signers/capabilities'
import { PermissionSchema } from '../store/state/types/permission'
import { accountCapabilityConsentMethods } from '../api/protectedMethods'
import protectedMethods from '../api/protectedMethods'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'

import type { Permission } from '../store/state'
import type { PermissionScope } from '../store/state/types/permission'

export const PERMISSION_SCOPE_CAVEAT = 'wren:permissionScope' as const
export const PERMISSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

const emptyParamsSchema = z.tuple([])
const requiredMethodSchema = z.string().min(1).max(128)
const requestParamsSchema = z.tuple([
  z
    .object({
      eth_accounts: z
        .object({
          requiredMethods: z.array(requiredMethodSchema).max(32).optional()
        })
        .strict()
    })
    .strict()
])

const typedDataMethods = new Map<string, SignTypedDataVersion>([
  ['signTypedData', SignTypedDataVersion.V1],
  ['signTypedData_v1', SignTypedDataVersion.V1],
  ['signTypedData_v3', SignTypedDataVersion.V3],
  ['signTypedData_v4', SignTypedDataVersion.V4],
  ['eth_signTypedData', SignTypedDataVersion.V1],
  ['eth_signTypedData_v1', SignTypedDataVersion.V1],
  ['eth_signTypedData_v3', SignTypedDataVersion.V3],
  ['eth_signTypedData_v4', SignTypedDataVersion.V4]
])

function invalidParams(message: string) {
  return { code: -32602, message: `Invalid params: ${message}` }
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? [])
  if (!result.success) throw invalidParams(result.error.issues[0]?.message || 'invalid permission request')
  return result.data
}

export function parseGetPermissions(params: unknown) {
  parseSchema(emptyParamsSchema, params)
}

export function parseRequestPermissions(params: unknown) {
  const [request] = parseSchema(requestParamsSchema, params)
  return {
    parentCapability: 'eth_accounts' as const,
    requiredMethods: [...new Set(request.eth_accounts.requiredMethods || [])]
  }
}

export function findUnsupportedRequiredMethod(methods: readonly string[], capabilities: SignerCapabilities) {
  return methods.find((method) => {
    if (method === 'personal_sign' || method === 'eth_sign') return !capabilities.personalMessage
    if (method === 'eth_sendTransaction' || method === 'wallet_sendCalls') {
      return capabilities.transactionEnvelopes.length === 0
    }

    const typedDataVersion = typedDataMethods.get(method)
    return !typedDataVersion || !capabilities.typedDataVersions.includes(typedDataVersion)
  })
}

const normalizedMethods = [...new Set(protectedMethods)]
  .filter((method) => !accountCapabilityConsentMethods.has(method))
  .sort()

const canonicalChain = (value: number | bigint | string) => {
  const parsed =
    typeof value === 'number'
      ? Number.isSafeInteger(value) && value > 0
        ? BigInt(value)
        : undefined
      : parseRpcQuantity(value)
  return parsed && parsed > 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
    ? toRpcQuantity(parsed)
    : undefined
}

export function createAccountPermission({
  account,
  chains,
  handlerId,
  origin,
  now = Date.now()
}: {
  account: string
  chains: Array<number | bigint | string>
  handlerId: string
  origin: string
  now?: number
}): Permission {
  const scope: PermissionScope = {
    account: account.toLowerCase(),
    methods: normalizedMethods,
    chains: [...new Set(chains.map(canonicalChain).filter((chain): chain is string => !!chain))].sort(
      (left, right) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0)
    ),
    expiresAt: now + PERMISSION_LIFETIME_MS
  }

  return PermissionSchema.parse({
    version: 1,
    origin,
    provider: true,
    handlerId,
    parentCapability: 'eth_accounts',
    caveats: [{ type: PERMISSION_SCOPE_CAVEAT, value: scope }],
    grantedAt: now
  })
}

export function permissionCovers(
  permission: unknown,
  {
    account,
    chainId,
    handlerId,
    method,
    now = Date.now()
  }: {
    account: string
    chainId?: number | bigint | string
    handlerId: string
    method: string
    now?: number
  }
) {
  const parsed = PermissionSchema.safeParse(permission)
  if (!parsed.success) return false

  const grant = parsed.data
  const scope = grant.caveats[0].value
  if (
    grant.handlerId !== handlerId ||
    scope.account !== account.toLowerCase() ||
    now >= scope.expiresAt ||
    !scope.methods.includes(method)
  ) {
    return false
  }

  if (chainId === undefined) return true
  const chain = canonicalChain(chainId)
  return !!chain && scope.chains.includes(chain)
}

export function grantedAccountPermission(permission: unknown) {
  const grant = PermissionSchema.parse(permission)
  return {
    invoker: grant.origin,
    parentCapability: grant.parentCapability,
    caveats: grant.caveats
  }
}

export function requestedAccountPermission(date = Date.now()) {
  return {
    parentCapability: 'eth_accounts',
    date
  }
}
