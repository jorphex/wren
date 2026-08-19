import log from 'electron-log'
import crypto from 'crypto'
import { getAddress } from 'ethers'

import accounts from '../accounts'
import { createRpcProvider, estimateL1GasCost } from '../chains/optimism'
import nebulaApi from '../nebula'
import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { NATIVE_CURRENCY } from '../../resources/constants'
import { FRAME_SEND_ORIGIN, originIdForName } from '../../resources/domain/origin'
import { isWatchOnlyAccountType } from '../../resources/domain/signer'
import { parseTokenDecimalAmount } from '../../resources/domain/token/amount'
import {
  NativeMaxQuoteService,
  type NativeMaxPublicQuote,
  type NativeMaxQueueValidation,
  type NativeMaxTrustedMetadata
} from './max'
import { SEND_ERROR, SendValidationError, buildSendTransaction, type SendDraft } from './transaction'

import type { Balance, Chain } from '../store/state'

const sendOriginId = originIdForName(FRAME_SEND_ORIGIN)
const nebula = nebulaApi()
let rpcId = 0

function sendRpc(chainId: number, method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    provider.connection.send(
      { id: ++rpcId, jsonrpc: '2.0', method, params },
      (response) => {
        if (response?.error) return reject(new Error('Configured RPC request failed'))
        return resolve(response?.result)
      },
      { type: 'ethereum', id: chainId }
    )
  })
}

const nativeMaxQuotes = new NativeMaxQuoteService({
  rpc: sendRpc,
  estimateGas: (transaction) => provider.estimateGas(transaction),
  estimateL1Fee: async (transaction) => {
    const chainId = parseInt(transaction.chainId, 16)
    const connection = provider.connection.connections.ethereum[chainId]
    const connectedProvider = [connection?.active, connection?.primary, connection?.secondary].find(
      (candidate) => candidate?.connected && candidate.provider
    )?.provider
    if (!connectedProvider) throw new Error('Configured RPC is unavailable')
    if (
      typeof transaction.nonce !== 'string' ||
      typeof transaction.from !== 'string' ||
      typeof transaction.to !== 'string' ||
      typeof transaction.value !== 'string'
    ) {
      throw new Error('Native Max transaction is incomplete')
    }

    return estimateL1GasCost(createRpcProvider(connectedProvider), {
      chainId,
      type: parseInt(transaction.type, 16),
      nonce: transaction.nonce,
      from: transaction.from,
      to: transaction.to,
      value: transaction.value,
      ...(transaction.data !== undefined ? { data: transaction.data } : {}),
      ...(transaction.gasLimit !== undefined ? { gasLimit: transaction.gasLimit } : {}),
      ...(transaction.gasPrice !== undefined ? { gasPrice: transaction.gasPrice } : {}),
      ...(transaction.maxFeePerGas !== undefined ? { maxFeePerGas: transaction.maxFeePerGas } : {}),
      ...(transaction.maxPriorityFeePerGas !== undefined
        ? { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }
        : {})
    })
  },
  now: () => Date.now(),
  quoteId: () => crypto.randomBytes(16).toString('hex')
})

type SendResult<T extends Record<string, unknown> = Record<string, never>> =
  ({ success: true } & T) | { success: false; error: string }

const failure = <T extends Record<string, unknown> = Record<string, never>>(
  error: unknown
): SendResult<T> => ({
  success: false,
  error: error instanceof SendValidationError ? error.code : 'send-unavailable'
})

function currentAccount() {
  const account = accounts.current()
  if (!account) throw new SendValidationError(SEND_ERROR.AccountChanged)
  return account
}

function chainAvailable(chain: Chain | undefined) {
  return Boolean(chain?.on && chain.connection.endpoints.some((endpoint) => endpoint.connected))
}

function assetsWithNativeDecimals(assets: Balance[], chainId: number): Balance[] {
  const nativeDecimals = store('main.networksMeta.ethereum', chainId, 'nativeCurrency', 'decimals')
  if (!Number.isInteger(nativeDecimals) || nativeDecimals < 0) return assets

  return assets.map((asset) =>
    asset.chainId === chainId && asset.address.toLowerCase() === NATIVE_CURRENCY
      ? { ...asset, decimals: nativeDecimals }
      : asset
  )
}

function ensureOrigin(chainId: number) {
  const chain = { type: 'ethereum' as const, id: chainId }
  const existing = store('main.origins', sendOriginId)

  if (!existing) {
    requireStoreAction('initOrigin')(sendOriginId, {
      chain,
      name: FRAME_SEND_ORIGIN,
      provenance: 'managed',
      sessionOnly: false
    })
    return
  }

  requireStoreAction('addOriginRequest')(sendOriginId)
  if (existing.chain?.id !== chainId)
    requireStoreAction('switchOriginChain')(sendOriginId, chainId, 'ethereum')
}

async function queue(draft: SendDraft): Promise<SendResult<{ handlerId: string }>> {
  let maxQuoteId: string | undefined
  try {
    const account = currentAccount()
    const chain = store('main.networks.ethereum', draft.chainId) as Chain | undefined
    const assets = assetsWithNativeDecimals(
      (store('main.balances', account.id) || []) as Balance[],
      draft.chainId
    )
    const selectedAsset = assets.find(
      (asset) =>
        asset.chainId === draft.chainId && asset.address.toLowerCase() === draft.assetAddress.toLowerCase()
    )
    let maxValidation: NativeMaxQueueValidation | undefined
    if (draft.maxQuoteId) {
      if (!selectedAsset || selectedAsset.address.toLowerCase() !== NATIVE_CURRENCY) {
        throw new SendValidationError(SEND_ERROR.MaxQuoteStale)
      }
      const amount = parseTokenDecimalAmount(draft.amount, selectedAsset.decimals)
      if (amount === undefined) throw new SendValidationError(SEND_ERROR.AmountInvalid)
      maxQuoteId = draft.maxQuoteId
      maxValidation = await nativeMaxQuotes.validateForQueue({
        quoteId: draft.maxQuoteId,
        account: draft.account,
        assetAddress: draft.assetAddress,
        chainId: draft.chainId,
        recipient: draft.recipient,
        amount: amount.toString(10)
      })
    }
    const validationAssets = maxValidation
      ? assets.map((asset) =>
          asset === selectedAsset ? { ...asset, balance: maxValidation.metadata.evidence.balance } : asset
        )
      : assets
    const built = buildSendTransaction(draft, {
      account: account.id,
      assets: validationAssets,
      networkAvailable: chainAvailable(chain),
      watchOnly: isWatchOnlyAccountType(account.lastSignerType)
    })
    const transaction = maxValidation
      ? { ...built.transaction, ...maxValidation.transaction }
      : built.transaction

    ensureOrigin(draft.chainId)

    return await new Promise((resolve) => {
      let queued = false
      try {
        provider.sendTransaction(
          {
            id: ++rpcId,
            jsonrpc: '2.0',
            method: 'eth_sendTransaction',
            chainId: transaction.chainId,
            _origin: sendOriginId,
            params: [transaction]
          },
          (response) => {
            if (!queued && response?.error) {
              if (maxQuoteId) nativeMaxQuotes.queueFailed(maxQuoteId)
              log.warn('Could not queue Send transaction')
              resolve({ success: false, error: 'send-unavailable' })
            }
          },
          { type: 'ethereum', id: draft.chainId },
          (handlerId) => {
            queued = true
            requireStoreAction('setDash')({ showing: true })
            resolve({ success: true, handlerId })
          },
          {
            recentRecipient: Object.freeze({ address: getAddress(draft.recipient).toLowerCase() }),
            ...(maxValidation ? { nativeMax: maxValidation.metadata } : {})
          }
        )
      } catch (error) {
        if (maxQuoteId) nativeMaxQuotes.queueFailed(maxQuoteId)
        resolve(failure<{ handlerId: string }>(error))
      }
    })
  } catch (error) {
    if (maxQuoteId) nativeMaxQuotes.queueFailed(maxQuoteId)
    return Promise.resolve(failure(error))
  }
}

async function resolveRecipient(value: unknown): Promise<SendResult<{ address: string; name?: string }>> {
  if (typeof value !== 'string') return { success: false, error: SEND_ERROR.RecipientInvalid }
  const recipient = value.trim()
  if (!recipient || recipient.length > 255) return { success: false, error: SEND_ERROR.RecipientInvalid }

  try {
    return { success: true, address: getAddress(recipient) }
  } catch {
    // Continue with ENS resolution.
  }

  if (recipient.toLowerCase().startsWith('0x')) {
    return { success: false, error: SEND_ERROR.RecipientInvalid }
  }

  try {
    const result = await nebula.ens.resolve(recipient, { timeout: 8_000 })
    const address = result.addresses.eth
    if (!address) return { success: false, error: SEND_ERROR.RecipientInvalid }
    return { success: true, address: getAddress(address), name: result.name }
  } catch (error) {
    log.info('Could not resolve Send recipient', {
      reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown'
    })
    return { success: false, error: SEND_ERROR.RecipientLookupUnavailable }
  }
}

async function maxAmount(
  input: unknown
): Promise<SendResult<{ amount: string } & Partial<NativeMaxPublicQuote>>> {
  try {
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['account', 'assetAddress', 'chainId', 'recipient'].includes(key))
    ) {
      throw new SendValidationError(SEND_ERROR.AssetUnavailable)
    }
    const { account: requestedAccount, chainId, assetAddress, recipient } = input as Record<string, unknown>
    if (
      !Number.isSafeInteger(chainId) ||
      (chainId as number) <= 0 ||
      typeof assetAddress !== 'string' ||
      typeof requestedAccount !== 'string' ||
      (recipient !== undefined && typeof recipient !== 'string')
    ) {
      throw new SendValidationError(SEND_ERROR.AssetUnavailable)
    }
    const account = currentAccount()
    if (account.id.toLowerCase() !== requestedAccount.toLowerCase()) {
      throw new SendValidationError(SEND_ERROR.AccountChanged)
    }
    const assets = (store('main.balances', account.id) || []) as Balance[]
    const asset = assets.find(
      (candidate) =>
        candidate.chainId === chainId && candidate.address.toLowerCase() === assetAddress.toLowerCase()
    )
    if (!asset) throw new SendValidationError(SEND_ERROR.AssetUnavailable)

    if (asset.address.toLowerCase() !== NATIVE_CURRENCY) {
      try {
        return { success: true, amount: BigInt(asset.balance).toString(10) }
      } catch {
        throw new SendValidationError(SEND_ERROR.AssetUnavailable)
      }
    }
    if (typeof recipient !== 'string') {
      throw new SendValidationError(SEND_ERROR.RecipientInvalid)
    }
    const quote = await nativeMaxQuotes.quote({
      account: account.id,
      assetAddress,
      chainId: chainId as number,
      recipient
    })
    return { success: true, ...quote }
  } catch (error) {
    return failure<{ amount: string } & Partial<NativeMaxPublicQuote>>(error)
  }
}

export function revalidateNativeMaxBeforeSign(
  metadata: NativeMaxTrustedMetadata,
  transaction: Parameters<NativeMaxQuoteService['revalidateBeforeSign']>[1]
) {
  return nativeMaxQuotes.revalidateBeforeSign(metadata, transaction)
}

export default { maxAmount, queue, resolveRecipient, revalidateNativeMaxBeforeSign }
