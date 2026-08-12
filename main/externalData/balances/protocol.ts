import { z } from 'zod'

import type { Token } from '../../store/state'
import type { CurrencyBalance, TokenBalance } from './scan'

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

const BalancesWorkerEventSchema = z.discriminatedUnion('type', [
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

export type BalancesWorkerCommand = z.infer<typeof BalancesWorkerCommandSchema>
export type BalancesWorkerEvent =
  | { type: 'ready' }
  | { type: 'tokenBalances'; address: Address; balances: TokenBalance[] }
  | { type: 'tokenBlacklist'; address: Address; tokens: Token[] }
  | { type: 'chainBalances'; address: Address; balances: CurrencyBalance[] }

export function parseBalancesWorkerCommand(value: unknown) {
  const result = BalancesWorkerCommandSchema.safeParse(value)
  return result.success ? result.data : undefined
}

export function parseBalancesWorkerEvent(value: unknown): BalancesWorkerEvent | undefined {
  const result = BalancesWorkerEventSchema.safeParse(value)
  return result.success ? result.data : undefined
}
