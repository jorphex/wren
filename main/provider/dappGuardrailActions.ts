import { z } from 'zod'

import {
  DappGuardrailSchema,
  DappGuardrailsSchema,
  type DappGuardrail
} from '../../resources/domain/dappGuardrails'
import { isWrenOwnedOriginName, originIdForInvoker } from '../../resources/domain/origin'
import { permissionCovers } from './permissions'
import type { Origin, Permission } from '../store/state'

const AddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/u)
const QuantitySchema = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u)
const ChainIdSchema = QuantitySchema.refine(
  (value) => value !== '0x0' && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  'Chain ID must be a positive safe integer'
)

export const DappGuardrailPolicyBodySchema = z
  .object({
    mode: z.enum(['block', 'warn']),
    targets: z.array(AddressSchema).max(64).optional(),
    spenders: z.array(AddressSchema).max(64).optional(),
    nativeValueCeiling: QuantitySchema.optional(),
    tokenCeilings: z
      .array(z.object({ token: AddressSchema, amount: QuantitySchema }).strict())
      .max(64)
      .optional(),
    expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
  })
  .strict()
  .superRefine((body, context) => {
    if (
      body.targets === undefined &&
      body.spenders === undefined &&
      body.nativeValueCeiling === undefined &&
      body.tokenCeilings === undefined &&
      body.expiresAt === undefined
    ) {
      context.addIssue({ code: 'custom', message: 'A guardrail must contain at least one restriction' })
    }
    for (const key of ['targets', 'spenders'] as const) {
      const values = body[key]
      if (
        values &&
        (new Set(values).size !== values.length ||
          values.some((value, index) => {
            const previous = values[index - 1]
            return previous !== undefined && value <= previous
          }))
      ) {
        context.addIssue({ code: 'custom', path: [key], message: `${key} must be sorted and unique` })
      }
    }
    if (body.tokenCeilings) {
      const tokens = body.tokenCeilings.map(({ token }) => token)
      if (
        new Set(tokens).size !== tokens.length ||
        tokens.some((token, index) => {
          const previous = tokens[index - 1]
          return previous !== undefined && token <= previous
        })
      ) {
        context.addIssue({
          code: 'custom',
          path: ['tokenCeilings'],
          message: 'tokenCeilings must be sorted and unique'
        })
      }
    }
  })

export const SaveDappGuardrailRequestSchema = z
  .object({
    account: AddressSchema,
    originId: z.string().uuid(),
    chainId: ChainIdSchema,
    body: DappGuardrailPolicyBodySchema
  })
  .strict()

export const RemoveDappGuardrailRequestSchema = SaveDappGuardrailRequestSchema.omit({ body: true }).strict()

export type DappGuardrailPolicyBody = z.infer<typeof DappGuardrailPolicyBodySchema>
export type SaveDappGuardrailRequest = z.infer<typeof SaveDappGuardrailRequestSchema>
export type RemoveDappGuardrailRequest = z.infer<typeof RemoveDappGuardrailRequestSchema>

type GuardrailAction = 'saveDappGuardrail' | 'removeDappGuardrail'

interface DappGuardrailActionDependencies {
  getAccount(account: string): unknown
  getPermission(account: string, originId: string): Permission | undefined
  getOrigin(originId: string): Origin | undefined
  getChain(chainId: string): { on?: boolean } | undefined
  getCompanionCredential(fingerprint: string): unknown
  getNativeCredential(fingerprint: string): unknown
  getGuardrails(): unknown
  save(guardrail: DappGuardrail): void
  remove(request: RemoveDappGuardrailRequest): void
  onPolicyChanged?(account: string, originId: string): void
  now?(): number
}

const isCurrentCredential = (value: unknown, fingerprint: string, kind?: string) =>
  !!value &&
  typeof value === 'object' &&
  'protocolVersion' in value &&
  value.protocolVersion === 3 &&
  'fingerprint' in value &&
  value.fingerprint === fingerprint &&
  (kind === undefined || ('kind' in value && value.kind === kind))

const hasCurrentPrincipal = (
  originId: string,
  origin: Origin,
  dependencies: DappGuardrailActionDependencies
) => {
  if (isWrenOwnedOriginName(origin.name) || !['direct', 'companion', 'native'].includes(origin.provenance)) {
    return false
  }

  if (origin.provenance === 'direct') {
    return !origin.sourceId && originIdForInvoker(origin.name, { provenance: 'direct' }) === originId
  }

  if (!origin.sourceId) return false
  if (origin.provenance === 'companion') {
    return (
      isCurrentCredential(dependencies.getCompanionCredential(origin.sourceId), origin.sourceId) &&
      originIdForInvoker(origin.name, { provenance: 'companion', sourceId: origin.sourceId }) === originId
    )
  }
  return (
    isCurrentCredential(dependencies.getNativeCredential(origin.sourceId), origin.sourceId, 'native') &&
    originIdForInvoker(origin.name, { provenance: 'native', sourceId: origin.sourceId }) === originId
  )
}

const trustedContext = (
  request: RemoveDappGuardrailRequest,
  dependencies: DappGuardrailActionDependencies,
  now: number
) => {
  const { account, originId, chainId } = request
  if (!dependencies.getAccount(account)) return false
  const permission = dependencies.getPermission(account, originId)
  const origin = dependencies.getOrigin(originId)
  const chain = dependencies.getChain(chainId)
  return !!(
    permission &&
    origin &&
    chain?.on === true &&
    origin.name === permission.origin &&
    origin.chain.type === 'ethereum' &&
    permissionCovers(permission, { account, chainId, handlerId: originId, method: 'eth_accounts', now }) &&
    hasCurrentPrincipal(originId, origin, dependencies)
  )
}

export function applyDappGuardrailRendererAction(
  action: GuardrailAction,
  input: unknown,
  dependencies: DappGuardrailActionDependencies
) {
  const schema =
    action === 'saveDappGuardrail' ? SaveDappGuardrailRequestSchema : RemoveDappGuardrailRequestSchema
  const parsed = schema.safeParse(input)
  if (!parsed.success) return false
  const request = parsed.data
  const now = dependencies.now?.() ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0) return false
  const currentGuardrails = DappGuardrailsSchema.safeParse(dependencies.getGuardrails())
  if (!currentGuardrails.success) return false
  const existing = currentGuardrails.data[request.account]?.[request.originId]?.[request.chainId]

  if (action === 'removeDappGuardrail') {
    const origin = dependencies.getOrigin(request.originId)
    if (
      !existing ||
      !dependencies.getAccount(request.account) ||
      !origin ||
      !hasCurrentPrincipal(request.originId, origin, dependencies)
    ) {
      return false
    }
    dependencies.remove(request)
  } else {
    if (!trustedContext(request, dependencies, now)) return false
    const saveRequest = request as SaveDappGuardrailRequest
    const guardrail = DappGuardrailSchema.safeParse({
      version: 1,
      account: request.account,
      originId: request.originId,
      chainId: request.chainId,
      ...saveRequest.body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: existing ? existing.revision + 1 : 1
    })
    if (!guardrail.success || !Number.isSafeInteger(guardrail.data.revision)) return false
    const nextGuardrails = DappGuardrailsSchema.safeParse({
      ...currentGuardrails.data,
      [request.account]: {
        ...currentGuardrails.data[request.account],
        [request.originId]: {
          ...currentGuardrails.data[request.account]?.[request.originId],
          [request.chainId]: guardrail.data
        }
      }
    })
    if (!nextGuardrails.success) return false
    dependencies.save(guardrail.data)
  }

  dependencies.onPolicyChanged?.(request.account, request.originId)
  return true
}
