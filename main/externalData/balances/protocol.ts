import { z } from 'zod'

import type { Token } from '../../store/state'
import type { CurrencyBalance, TokenBalance } from './scan'

export const BALANCE_RPC_MAX_IN_FLIGHT = 32
export const BALANCE_RPC_MAX_QUEUED = 8192
export const BALANCE_RPC_TIMEOUT_MS = 12_000
export const BALANCE_RPC_QUEUE_TIMEOUT_MS = 60_000
export const BALANCE_RPC_MAX_REQUEST_BYTES = 8 * 1024 * 1024
export const BALANCE_RPC_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

const MAX_SAFE_CHAIN_ID = Number.MAX_SAFE_INTEGER
const MAX_SAFE_REQUEST_ID = Number.MAX_SAFE_INTEGER

const RpcRequestIdSchema = z.number().int().positive().max(MAX_SAFE_REQUEST_ID)
const RpcChainIdSchema = z.number().int().positive().max(MAX_SAFE_CHAIN_ID)
const RpcAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const RpcDataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/)
const RpcResultSchema = z.string().regex(/^0x[0-9a-fA-F]*$/)
const RpcBlockTagSchema = z.literal('latest')

const BalanceRpcGetBalanceRequestSchema = z
  .object({
    type: z.literal('rpcRequest'),
    id: RpcRequestIdSchema,
    chainId: RpcChainIdSchema,
    method: z.literal('eth_getBalance'),
    params: z.tuple([RpcAddressSchema, RpcBlockTagSchema])
  })
  .strict()
const BalanceRpcCallRequestSchema = z
  .object({
    type: z.literal('rpcRequest'),
    id: RpcRequestIdSchema,
    chainId: RpcChainIdSchema,
    method: z.literal('eth_call'),
    params: z.tuple([
      z
        .object({
          to: RpcAddressSchema,
          data: RpcDataSchema,
          value: z.literal('0x0').optional()
        })
        .strict(),
      RpcBlockTagSchema
    ])
  })
  .strict()
const BalanceRpcRequestSchema = z.discriminatedUnion('method', [
  BalanceRpcGetBalanceRequestSchema,
  BalanceRpcCallRequestSchema
])

const BalanceRpcResultSchema = z.object({ id: RpcRequestIdSchema, result: RpcResultSchema }).strict()
const BalanceRpcErrorSchema = z
  .object({
    id: RpcRequestIdSchema,
    error: z.object({ code: z.number().int(), message: z.string().min(1).max(160) }).strict()
  })
  .strict()
const BalanceRpcResponseSchema = z.union([BalanceRpcResultSchema, BalanceRpcErrorSchema])

const AddressSchema = z.string()
const ChainIdsSchema = z.array(z.number().int().nonnegative())
const NativeCurrencyTargetsSchema = z.array(
  z.object({ chainId: z.number().int().positive(), decimals: z.number().int().min(0).max(255) }).strict()
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isToken(value: unknown): value is Token {
  return (
    isRecord(value) &&
    typeof value['address'] === 'string' &&
    typeof value['chainId'] === 'number' &&
    Number.isInteger(value['chainId']) &&
    value['chainId'] >= 0 &&
    typeof value['name'] === 'string' &&
    typeof value['symbol'] === 'string' &&
    typeof value['decimals'] === 'number' &&
    Number.isInteger(value['decimals']) &&
    value['decimals'] >= 0 &&
    (value['logoURI'] === undefined || typeof value['logoURI'] === 'string')
  )
}

function isTokenBalance(value: unknown): value is TokenBalance {
  return (
    isRecord(value) &&
    typeof value['balance'] === 'string' &&
    typeof value['displayBalance'] === 'string' &&
    (value['logoUri'] === undefined || typeof value['logoUri'] === 'string') &&
    isToken(value)
  )
}

function isCurrencyBalance(value: unknown): value is CurrencyBalance {
  return (
    isRecord(value) &&
    typeof value['chainId'] === 'number' &&
    Number.isInteger(value['chainId']) &&
    value['chainId'] >= 0 &&
    typeof value['balance'] === 'string' &&
    typeof value['displayBalance'] === 'string'
  )
}

// Custom schemas validate without injecting persisted-state defaults or stripping provider metadata.
const WorkerTokenSchema = z.custom<Token>(isToken)
const TokenBalanceSchema = z.custom<TokenBalance>(isTokenBalance)
const CurrencyBalanceSchema = z.custom<CurrencyBalance>(isCurrencyBalance)

const BalancesWorkerCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('heartbeat'), args: z.tuple([]) }),
  z.object({ command: z.literal('rpcResponse'), args: z.tuple([BalanceRpcResponseSchema]) }),
  z.object({
    command: z.literal('updateChainBalance'),
    args: z.tuple([AddressSchema, NativeCurrencyTargetsSchema])
  }),
  z.object({
    command: z.literal('fetchTokenBalances'),
    args: z.tuple([AddressSchema, z.array(WorkerTokenSchema)])
  }),
  z.object({
    command: z.literal('tokenBalanceScan'),
    args: z.tuple([AddressSchema, z.array(WorkerTokenSchema), ChainIdsSchema])
  })
])

const BalancesWorkerEventSchema = z.union([
  BalanceRpcRequestSchema,
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('ready') }),
    z.object({
      type: z.literal('tokenBalances'),
      address: AddressSchema,
      balances: z.array(TokenBalanceSchema)
    }),
    z.object({
      type: z.literal('tokenBlacklist'),
      address: AddressSchema,
      tokens: z.array(WorkerTokenSchema)
    }),
    z.object({
      type: z.literal('chainBalances'),
      address: AddressSchema,
      balances: z.array(CurrencyBalanceSchema)
    })
  ])
])

export type BalancesWorkerCommand = z.infer<typeof BalancesWorkerCommandSchema>
export type BalanceRpcRequest = z.infer<typeof BalanceRpcRequestSchema>
export type BalanceRpcResponse = z.infer<typeof BalanceRpcResponseSchema>
export type BalancesWorkerEvent =
  | { type: 'ready' }
  | BalanceRpcRequest
  | { type: 'tokenBalances'; address: Address; balances: TokenBalance[] }
  | { type: 'tokenBlacklist'; address: Address; tokens: Token[] }
  | { type: 'chainBalances'; address: Address; balances: CurrencyBalance[] }

export function parseBalancesWorkerCommand(value: unknown) {
  const result = BalancesWorkerCommandSchema.safeParse(value)
  if (!result.success) return undefined
  if (
    result.data.command === 'rpcResponse' &&
    serializedBytes(result.data.args[0]) > BALANCE_RPC_MAX_RESPONSE_BYTES
  ) {
    return undefined
  }
  return result.data
}

export function parseBalancesWorkerEvent(value: unknown): BalancesWorkerEvent | undefined {
  const result = BalancesWorkerEventSchema.safeParse(value)
  if (!result.success) return undefined
  if (result.data.type === 'rpcRequest' && serializedBytes(result.data) > BALANCE_RPC_MAX_REQUEST_BYTES) {
    return undefined
  }
  return result.data
}

export function parseBalanceRpcResponse(value: unknown): BalanceRpcResponse | undefined {
  const result = BalanceRpcResponseSchema.safeParse(value)
  if (!result.success || serializedBytes(result.data) > BALANCE_RPC_MAX_RESPONSE_BYTES) return undefined
  return result.data
}

export function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
