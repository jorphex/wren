import { z } from 'zod'

import accounts from '../accounts'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { parseChainId, verifyRpcChainId } from '../provider/chainRequests'

const requestReferenceSchema = z.object({
  account: z.string().min(1),
  handlerId: z.string().uuid()
})

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }, 'Dapp-requested URLs must use HTTPS and omit credentials')

const optionalHttpsUrlSchema = z.union([z.literal(''), httpsUrlSchema])

const requestedChainSchema = z.object({
  type: z.literal('ethereum'),
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  nativeCurrencyName: z.string().trim().min(1),
  nativeCurrencyDecimals: z.number().int().nonnegative(),
  explorer: optionalHttpsUrlSchema,
  icon: optionalHttpsUrlSchema,
  nativeCurrencyIcon: optionalHttpsUrlSchema,
  rpcUrls: z.array(httpsUrlSchema).min(1).max(5),
  isTestnet: z.boolean(),
  primaryColor: z.string()
})

export interface AddChainRequestReference {
  account: string
  handlerId: string
}

export async function addRequestedChain(chainData: unknown, requestReference: unknown) {
  const reference = requestReferenceSchema.parse(requestReference)
  const account = accounts.accounts[reference.account.toLowerCase()]
  if (!account) throw new Error('Add-chain request is no longer pending')
  const request = account.getRequest(reference.handlerId)

  if (!request || request.type !== 'addChain') throw new Error('Add-chain request is no longer pending')

  const chain = requestedChainSchema.parse(chainData)
  const requestedParams = Array.isArray(request.payload.params) ? request.payload.params[0] : undefined
  if (!requestedParams || typeof requestedParams !== 'object' || !('chainId' in requestedParams)) {
    throw new Error('Add-chain request has invalid params')
  }
  const expectedChainId = parseChainId(requestedParams.chainId)

  if (chain.id !== expectedChainId) throw new Error('Chain ID cannot be changed for a dapp request')

  await verifyRpcChainId(chain.rpcUrls, expectedChainId)

  requireStoreAction('addNetwork')(chain)
  if (!store('main.networks', chain.type, chain.id)) throw new Error('Could not add chain')

  account.resolveRequest(request, null)
}
