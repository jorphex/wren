import { z } from 'zod'
import { parseRpcQuantity } from '../../../../resources/domain/transaction/quantity'

const RpcQuantitySchema = z.string().refine((value) => parseRpcQuantity(value) !== undefined, {
  message: 'must be a canonical uint256 RPC quantity'
})

const GasLevelsSchema = z.object({
  slow: z.string().optional(),
  standard: z.string().optional(),
  fast: z.string().optional(),
  asap: z.string().optional(),
  custom: z.string().optional()
})

const GasEstimateSchema = z.object({
  gasEstimate: z.string(),
  cost: z.object({
    usd: z.number().nullish()
  })
})

const GasSampleSchema = z.object({
  label: z.string(),
  estimates: z
    .object({
      low: GasEstimateSchema,
      high: GasEstimateSchema
    })
    .partial()
})

export const GasFeesSchema = z
  .object({
    nextBaseFee: RpcQuantitySchema,
    maxBaseFeePerGas: RpcQuantitySchema,
    maxPriorityFeePerGas: RpcQuantitySchema,
    maxFeePerGas: RpcQuantitySchema
  })
  .partial()

export const GasSchema = z.object({
  samples: z.array(GasSampleSchema).default([]),
  price: z.object({
    selected: GasLevelsSchema.keyof(),
    levels: GasLevelsSchema,
    fees: GasFeesSchema.nullish()
  })
})

export type Gas = z.infer<typeof GasSchema>
export type GasFees = z.infer<typeof GasFeesSchema>
