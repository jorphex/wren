import { z } from 'zod'

import { fetchWithTimeout, readJsonWithLimit } from '../../resources/utils/fetch'

const MAX_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_RPC_RESPONSE_BYTES = 64 * 1024
const chainIdSchema = z.string().regex(/^0x[1-9a-fA-F][0-9a-fA-F]*$/, 'must be a canonical hex quantity')

const httpsUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value)

    if (url.protocol !== 'https:') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must use HTTPS' })
    }

    if (url.username || url.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not contain credentials' })
    }
  })

const requestParamsSchema = z.tuple([
  z.object({
    chainId: z.unknown()
  })
])

const addChainParamsSchema = z.tuple([
  z.object({
    chainId: z.unknown(),
    chainName: z.string().trim().min(1),
    nativeCurrency: z.object({
      name: z.string().trim().min(1),
      symbol: z.string().trim().min(1),
      decimals: z.number().int().nonnegative()
    }),
    rpcUrls: z.array(httpsUrlSchema).min(1).max(5),
    blockExplorerUrls: z.array(httpsUrlSchema).optional().default([]),
    iconUrls: z.array(httpsUrlSchema).optional().default([])
  })
])

export interface NormalizedAddChainRequest {
  id: number
  name: string
  symbol: string
  nativeCurrencyName: string
  nativeCurrencyDecimals: number
  rpcUrls: string[]
  blockExplorerUrls: string[]
  iconUrls: string[]
}

function invalidParams(message: string) {
  return { code: -32602, message: `Invalid params: ${message}` }
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw invalidParams(result.error.issues[0]?.message || 'invalid request')
  return result.data
}

export function parseChainId(value: unknown): number {
  const chainId = parseSchema(chainIdSchema, value)
  const parsed = BigInt(chainId)

  if (parsed > MAX_CHAIN_ID) {
    throw invalidParams('chainId exceeds the largest safely supported value')
  }

  return Number(parsed)
}

export function parseChainRequestId(params: unknown): number {
  const [{ chainId }] = parseSchema(requestParamsSchema, params)
  return parseChainId(chainId)
}

export function parseAddChainRequest(params: unknown): NormalizedAddChainRequest {
  const [{ chainId, chainName, nativeCurrency, rpcUrls, blockExplorerUrls, iconUrls }] = parseSchema(
    addChainParamsSchema,
    params
  )

  return {
    id: parseChainId(chainId),
    name: chainName,
    symbol: nativeCurrency.symbol,
    nativeCurrencyName: nativeCurrency.name,
    nativeCurrencyDecimals: nativeCurrency.decimals,
    rpcUrls,
    blockExplorerUrls: blockExplorerUrls || [],
    iconUrls: iconUrls || []
  }
}

export async function verifyRpcChainId(
  rpcUrls: readonly string[],
  expectedChainId: number,
  timeout = 5000
): Promise<string> {
  const urls = parseSchema(z.array(httpsUrlSchema).min(1).max(5), rpcUrls)
  let reportedDifferentChain = false

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          redirect: 'error'
        },
        timeout
      )

      if (!response.ok) continue

      const body = await readJsonWithLimit<{ result?: unknown }>(response, MAX_RPC_RESPONSE_BYTES)
      const reportedChainId = parseChainId(body.result)

      if (reportedChainId === expectedChainId) return url
      reportedDifferentChain = true
    } catch {
      // Try the next user-approved endpoint.
    }
  }

  if (reportedDifferentChain) throw new Error('RPC endpoint reports a different chain ID')
  throw new Error('Could not verify the chain ID with the supplied RPC endpoints')
}
