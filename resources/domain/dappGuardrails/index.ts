import { z } from 'zod'

export const DAPP_GUARDRAIL_VERSION = 1
export const MAX_DAPP_GUARDRAIL_ENTRIES = 64
export const MAX_DAPP_GUARDRAIL_LIST_ENTRIES = 64

const canonicalAddress = /^0x[0-9a-f]{40}$/u
const canonicalQuantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u
const MAX_UINT256 = (1n << 256n) - 1n

const AddressSchema = z.string().regex(canonicalAddress)
const QuantitySchema = z
  .string()
  .regex(canonicalQuantity)
  .refine((value) => BigInt(value) <= MAX_UINT256, 'Quantity exceeds uint256')
const ChainIdSchema = QuantitySchema.refine(
  (value) => value !== '0x0' && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  'Chain ID must be a positive safe integer'
)
const OriginIdSchema = z.string().min(1).max(256)
const TimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const sortedUnique = (values: readonly string[]) =>
  values.every((value, index) => index === 0 || (values[index - 1] as string) < value)

const AddressListSchema = z
  .array(AddressSchema)
  .max(MAX_DAPP_GUARDRAIL_LIST_ENTRIES)
  .refine(sortedUnique, 'Addresses must be sorted and unique')

export const DappGuardrailTokenCeilingSchema = z
  .object({
    token: AddressSchema,
    amount: QuantitySchema
  })
  .strict()

const TokenCeilingsSchema = z
  .array(DappGuardrailTokenCeilingSchema)
  .max(MAX_DAPP_GUARDRAIL_LIST_ENTRIES)
  .refine(
    (ceilings) => sortedUnique(ceilings.map(({ token }) => token)),
    'Token ceilings must be sorted and unique'
  )

export const DappGuardrailSchema = z
  .object({
    version: z.literal(DAPP_GUARDRAIL_VERSION),
    account: AddressSchema,
    originId: OriginIdSchema,
    chainId: ChainIdSchema,
    mode: z.enum(['block', 'warn']),
    targets: AddressListSchema.optional(),
    spenders: AddressListSchema.optional(),
    nativeValueCeiling: QuantitySchema.optional(),
    tokenCeilings: TokenCeilingsSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .refine(({ createdAt, updatedAt }) => updatedAt >= createdAt, 'Updated time precedes creation time')
  .refine(
    (guardrail) =>
      guardrail.targets !== undefined ||
      guardrail.spenders !== undefined ||
      guardrail.nativeValueCeiling !== undefined ||
      guardrail.tokenCeilings !== undefined ||
      guardrail.expiresAt !== undefined,
    'Guardrail must contain at least one restriction'
  )

export const DappGuardrailsSchema = z
  .record(AddressSchema, z.record(OriginIdSchema, z.record(ChainIdSchema, DappGuardrailSchema)))
  .superRefine((accounts, ctx) => {
    if (Object.keys(accounts).length > MAX_DAPP_GUARDRAIL_ENTRIES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many guardrail accounts' })
    }

    Object.entries(accounts).forEach(([account, origins]) => {
      if (Object.keys(origins).length > MAX_DAPP_GUARDRAIL_ENTRIES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [account],
          message: 'Too many guardrail origins'
        })
      }

      Object.entries(origins).forEach(([originId, chains]) => {
        if (Object.keys(chains).length > MAX_DAPP_GUARDRAIL_ENTRIES) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [account, originId],
            message: 'Too many guardrail chains'
          })
        }

        Object.entries(chains).forEach(([chainId, guardrail]) => {
          if (
            guardrail.account !== account ||
            guardrail.originId !== originId ||
            guardrail.chainId !== chainId
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [account, originId, chainId],
              message: 'Guardrail principal does not match its keys'
            })
          }
        })
      })
    })
  })

const DappGuardrailPrincipalSchema = z
  .object({ account: AddressSchema, originId: OriginIdSchema, chainId: ChainIdSchema })
  .strict()

const DappGuardrailTokenAmountSchema = z.object({ token: AddressSchema, amount: QuantitySchema }).strict()

const unverifiableReasons = ['targets', 'nativeValue', 'tokenAmounts', 'spenders'] as const
const UnverifiableReasonSchema = z.enum(unverifiableReasons)

export const DappGuardrailIntentSchema = z
  .object({
    targets: AddressListSchema,
    nativeValue: QuantitySchema,
    tokenAmounts: z
      .array(DappGuardrailTokenAmountSchema)
      .max(MAX_DAPP_GUARDRAIL_LIST_ENTRIES)
      .refine(
        (amounts) => sortedUnique(amounts.map(({ token }) => token)),
        'Token amounts must be sorted and unique'
      ),
    spenders: AddressListSchema,
    unverifiable: z
      .array(UnverifiableReasonSchema)
      .max(unverifiableReasons.length)
      .refine(
        (reasons) =>
          reasons.every(
            (reason, index) =>
              index === 0 ||
              unverifiableReasons.indexOf(reasons[index - 1] as (typeof unverifiableReasons)[number]) <
                unverifiableReasons.indexOf(reason)
          ),
        'Unverifiable reasons must be in schema order and unique'
      )
  })
  .strict()

export type DappGuardrailTokenCeiling = z.infer<typeof DappGuardrailTokenCeilingSchema>
export type DappGuardrail = z.infer<typeof DappGuardrailSchema>
export type DappGuardrails = z.infer<typeof DappGuardrailsSchema>
export type DappGuardrailIntent = z.infer<typeof DappGuardrailIntentSchema>
export type DappGuardrailUnverifiableReason = z.infer<typeof UnverifiableReasonSchema>

export type DappGuardrailViolation = {
  code:
    | 'expired'
    | 'targets-unverifiable'
    | 'target-not-allowed'
    | 'native-value-unverifiable'
    | 'native-value-exceeded'
    | 'token-amounts-unverifiable'
    | 'token-not-allowed'
    | 'token-amount-exceeded'
    | 'spenders-unverifiable'
    | 'spender-not-allowed'
  message: string
  field: 'expiresAt' | 'targets' | 'nativeValueCeiling' | 'tokenCeilings' | 'spenders'
}

export function parseDappGuardrails(value: unknown): DappGuardrails {
  return DappGuardrailsSchema.parse(value)
}

export function lookupDappGuardrail(
  value: unknown,
  principal: { account: string; originId: string; chainId: string }
): DappGuardrail | undefined {
  const guardrails = DappGuardrailsSchema.parse(value)
  const parsedPrincipal = DappGuardrailPrincipalSchema.parse(principal)
  return guardrails[parsedPrincipal.account]?.[parsedPrincipal.originId]?.[parsedPrincipal.chainId]
}

export function evaluateDappGuardrail(
  value: unknown,
  candidate: unknown,
  now = Date.now()
): DappGuardrailViolation[] {
  const guardrail = DappGuardrailSchema.parse(value)
  const intent = DappGuardrailIntentSchema.parse(candidate)
  const evaluatedAt = TimestampSchema.parse(now)
  const unverifiable = new Set(intent.unverifiable)
  const violations: DappGuardrailViolation[] = []

  if (guardrail.expiresAt !== undefined && evaluatedAt >= guardrail.expiresAt) {
    violations.push({ code: 'expired', message: 'Guardrail has expired', field: 'expiresAt' })
  }

  if (guardrail.targets !== undefined) {
    if (unverifiable.has('targets')) {
      violations.push({
        code: 'targets-unverifiable',
        message: 'Request targets could not be verified',
        field: 'targets'
      })
    } else if (intent.targets.some((target) => !guardrail.targets?.includes(target))) {
      violations.push({
        code: 'target-not-allowed',
        message: 'Request target is not allowed',
        field: 'targets'
      })
    }
  }

  if (guardrail.nativeValueCeiling !== undefined) {
    if (unverifiable.has('nativeValue')) {
      violations.push({
        code: 'native-value-unverifiable',
        message: 'Native value could not be verified',
        field: 'nativeValueCeiling'
      })
    } else if (BigInt(intent.nativeValue) > BigInt(guardrail.nativeValueCeiling)) {
      violations.push({
        code: 'native-value-exceeded',
        message: 'Native value exceeds the guardrail ceiling',
        field: 'nativeValueCeiling'
      })
    }
  }

  if (guardrail.tokenCeilings !== undefined) {
    if (unverifiable.has('tokenAmounts')) {
      violations.push({
        code: 'token-amounts-unverifiable',
        message: 'Token amounts could not be verified',
        field: 'tokenCeilings'
      })
    } else {
      const ceilings = new Map(guardrail.tokenCeilings.map(({ token, amount }) => [token, amount]))
      const unknownToken = intent.tokenAmounts.find(({ token }) => !ceilings.has(token))
      const exceededToken = intent.tokenAmounts.find(({ token, amount }) => {
        const ceiling = ceilings.get(token)
        return ceiling !== undefined && BigInt(amount) > BigInt(ceiling)
      })

      if (unknownToken) {
        violations.push({
          code: 'token-not-allowed',
          message: 'Token is not allowed',
          field: 'tokenCeilings'
        })
      }
      if (exceededToken) {
        violations.push({
          code: 'token-amount-exceeded',
          message: 'Token amount exceeds the guardrail ceiling',
          field: 'tokenCeilings'
        })
      }
    }
  }

  if (guardrail.spenders !== undefined) {
    if (unverifiable.has('spenders')) {
      violations.push({
        code: 'spenders-unverifiable',
        message: 'Token spenders could not be verified',
        field: 'spenders'
      })
    } else if (intent.spenders.some((spender) => !guardrail.spenders?.includes(spender))) {
      violations.push({
        code: 'spender-not-allowed',
        message: 'Token spender is not allowed',
        field: 'spenders'
      })
    }
  }

  return violations
}
