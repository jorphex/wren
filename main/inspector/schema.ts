import { z } from 'zod'

const MAX_RESULT_BYTES = 512 * 1024
const AddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/)
const HashSchema = z.string().regex(/^0x[0-9a-f]{64}$/)
const QuantitySchema = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/)
const DecimalSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/)
const ReasonSchema = z.string().min(1).max(240)

const NormalizedTransactionSchema = z
  .object({
    chainId: QuantitySchema.optional(),
    type: QuantitySchema.optional(),
    nonce: QuantitySchema.optional(),
    from: AddressSchema.optional(),
    to: AddressSchema.nullable().optional(),
    value: QuantitySchema.optional(),
    data: z.string().regex(/^0x(?:[0-9a-f]{2})*$/),
    gas: QuantitySchema.optional(),
    gasLimit: QuantitySchema.optional(),
    gasPrice: QuantitySchema.optional(),
    maxFeePerGas: QuantitySchema.optional(),
    maxPriorityFeePerGas: QuantitySchema.optional(),
    accessList: z
      .object({
        addresses: z.number().int().nonnegative().max(256),
        storageKeys: z.number().int().nonnegative().max(4096)
      })
      .strict()
      .optional(),
    requestedBlock: z
      .string()
      .regex(/^(?:latest|pending|safe|finalized|earliest|0x(?:0|[1-9a-f][0-9a-f]*))$/)
      .optional()
  })
  .strict()

const LocalDecodeSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('decoded'),
      source: z.literal('bundled-standard-abi'),
      selector: z.string().regex(/^0x[0-9a-f]{8}$/),
      method: z.string().min(1).max(96),
      signature: z.string().min(1).max(256),
      arguments: z
        .array(
          z
            .object({
              name: z.string().min(1).max(96),
              type: z.string().min(1).max(96),
              value: z.string().max(512)
            })
            .strict()
        )
        .max(16),
      truncated: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      status: z.enum(['unknown', 'unavailable']),
      source: z.literal('bundled-standard-abi'),
      selector: z
        .string()
        .regex(/^0x[0-9a-f]{0,8}$/)
        .optional(),
      reason: ReasonSchema
    })
    .strict()
])

const EffectSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('transfer'),
      standard: z.enum(['erc20', 'erc721', 'erc1155']),
      token: AddressSchema,
      from: AddressSchema,
      to: AddressSchema,
      amount: DecimalSchema.optional(),
      tokenId: DecimalSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('approval'),
      standard: z.enum(['erc20', 'erc721']),
      token: AddressSchema,
      owner: AddressSchema,
      spender: AddressSchema,
      amount: DecimalSchema.optional(),
      tokenId: DecimalSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('operator-approval'),
      standard: z.literal('erc721-or-erc1155'),
      token: AddressSchema,
      owner: AddressSchema,
      operator: AddressSchema,
      approved: z.boolean()
    })
    .strict()
])

const AccountCodeSchema = z
  .object({
    role: z.enum(['sender', 'target']),
    account: AddressSchema,
    status: z.enum(['no-code', 'contract', 'delegated', 'unavailable']),
    codeHash: HashSchema.optional(),
    delegate: AddressSchema.optional(),
    delegateCodeStatus: z.enum(['no-code', 'contract', 'delegated', 'unavailable']).optional(),
    reason: ReasonSchema.optional()
  })
  .strict()

const CallTraceSchema = z
  .object({
    type: z.enum(['CALL', 'STATICCALL', 'DELEGATECALL', 'CALLCODE', 'CREATE', 'CREATE2', 'SELFDESTRUCT']),
    depth: z.number().int().min(0).max(32),
    from: AddressSchema,
    to: AddressSchema.optional(),
    value: DecimalSchema,
    inputBytes: z
      .number()
      .int()
      .nonnegative()
      .max(512 * 1024),
    selector: z
      .string()
      .regex(/^0x[0-9a-f]{8}$/)
      .optional(),
    failure: ReasonSchema.optional()
  })
  .strict()

const SimulationSchema = z
  .object({
    status: z.enum(['succeeded', 'reverted', 'unavailable', 'failed']),
    source: z.enum(['eth_simulateV1', 'eth_call']).optional(),
    gasUsed: QuantitySchema.optional(),
    reason: ReasonSchema.optional(),
    effects: z.array(EffectSchema).max(100).optional(),
    effectsTruncated: z.boolean().optional(),
    allowance: z
      .object({
        token: AddressSchema,
        owner: AddressSchema,
        spender: AddressSchema,
        currentAmount: DecimalSchema,
        requestedAmount: DecimalSchema
      })
      .strict()
      .optional(),
    delegation: z
      .object({
        status: z.enum(['delegated', 'undelegated', 'unavailable']),
        account: AddressSchema,
        delegate: AddressSchema.optional(),
        reason: ReasonSchema.optional()
      })
      .strict()
      .optional(),
    accountCode: z.array(AccountCodeSchema).max(17).optional(),
    nativeBalanceChanges: z
      .object({
        status: z.enum(['succeeded', 'unavailable', 'failed']),
        changes: z
          .array(
            z
              .object({
                account: AddressSchema,
                before: DecimalSchema,
                after: DecimalSchema,
                change: z.string().regex(/^-?(?:0|[1-9][0-9]{0,77})$/)
              })
              .strict()
          )
          .max(128)
          .optional(),
        truncated: z.boolean().optional(),
        reason: ReasonSchema.optional()
      })
      .strict()
      .optional(),
    callTrace: z
      .object({ calls: z.array(CallTraceSchema).max(100), truncated: z.boolean().optional() })
      .strict()
      .optional(),
    proxyImplementation: z
      .object({
        status: z.enum(['succeeded', 'unavailable', 'failed']),
        changes: z
          .array(
            z
              .object({
                proxy: AddressSchema,
                kind: z.enum(['initialized', 'changed', 'cleared']),
                beforeImplementation: AddressSchema.optional(),
                afterImplementation: AddressSchema.optional()
              })
              .strict()
          )
          .max(32)
          .optional(),
        truncated: z.boolean().optional(),
        reason: ReasonSchema.optional()
      })
      .strict()
      .optional(),
    advancedStatus: z.enum(['pending', 'complete', 'partly-unavailable']).optional()
  })
  .strict()

const EvidenceSchema = z
  .object({
    kind: z.enum(['calldata', 'simulation', 'typed-data']),
    status: z.enum(['available', 'partly-unavailable', 'unavailable']),
    source: z.enum(['local', 'configured-rpc']),
    reason: ReasonSchema.optional()
  })
  .strict()

const TypedContextSchema = z
  .object({
    requestChainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    domainChainId: DecimalSchema.optional(),
    risks: z
      .array(
        z.enum([
          'legacy-v1',
          'domain-chain-missing',
          'domain-chain-invalid',
          'domain-chain-mismatch',
          'permit2-allowance',
          'permit2-transfer',
          'permit2-maximum-amount',
          'permit2-noncanonical-contract',
          'eip3009-transfer',
          'eip3009-maximum-amount'
        ])
      )
      .max(16),
    authority: z
      .object({
        standard: z.enum(['permit2', 'eip3009']),
        kind: z.string().min(1).max(64),
        verifyingContract: AddressSchema,
        spender: AddressSchema.optional(),
        authorizer: AddressSchema.optional(),
        grantsAuthority: z.boolean(),
        maximumAmount: z.boolean()
      })
      .strict()
      .optional()
  })
  .strict()

const InspectionBaseSchema = z.object({
  source: z.enum(['direct', 'json-rpc']),
  sourceMethod: z
    .enum([
      'eth_sendTransaction',
      'eth_call',
      'eth_estimateGas',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4'
    ])
    .optional(),
  evidence: z.array(EvidenceSchema).min(1).max(4),
  missingContext: z.array(z.enum(['chainId', 'from', 'to', 'signer'])).max(4)
})

const TransactionInspectionSchema = InspectionBaseSchema.extend({
  kind: z.enum(['transaction', 'calldata']),
  normalized: NormalizedTransactionSchema,
  decode: LocalDecodeSchema,
  simulation: SimulationSchema.optional()
})
  .strict()
  .superRefine((inspection, context) => {
    const transactionMethods = ['eth_sendTransaction', 'eth_call', 'eth_estimateGas']
    if (
      (inspection.source === 'direct' && inspection.sourceMethod !== undefined) ||
      (inspection.source === 'json-rpc' && !transactionMethods.includes(inspection.sourceMethod || ''))
    ) {
      context.addIssue({ code: 'custom', message: 'Transaction inspection source is inconsistent' })
    }
  })

const TypedInspectionSchema = InspectionBaseSchema.extend({
  kind: z.literal('typed-data'),
  normalized: z
    .object({
      version: z.enum(['V3', 'V4']),
      primaryType: z.string().min(1).max(128),
      signer: AddressSchema.optional(),
      typedData: z
        .string()
        .min(1)
        .max(256 * 1024),
      domain: z
        .object({
          name: z.string().max(256).optional(),
          version: z.string().max(128).optional(),
          chainId: z.string().max(78).optional(),
          verifyingContract: AddressSchema.optional()
        })
        .strict()
    })
    .strict(),
  typedContext: TypedContextSchema
})
  .strict()
  .superRefine((inspection, context) => {
    const typedMethods = ['eth_signTypedData_v3', 'eth_signTypedData_v4']
    if (
      (inspection.source === 'direct' && inspection.sourceMethod !== undefined) ||
      (inspection.source === 'json-rpc' && !typedMethods.includes(inspection.sourceMethod || ''))
    ) {
      context.addIssue({ code: 'custom', message: 'Typed-data inspection source is inconsistent' })
    }
  })

export const InspectorInvokeResultSchema = z
  .union([
    z
      .object({
        success: z.literal(true),
        inspection: z.union([TransactionInspectionSchema, TypedInspectionSchema])
      })
      .strict(),
    z.object({ success: z.literal(false), error: ReasonSchema }).strict()
  ])
  .superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_RESULT_BYTES) {
      context.addIssue({ code: 'custom', message: 'Inspector result is too large' })
    }
  })

export type InspectorInvokeResult = z.infer<typeof InspectorInvokeResultSchema>
