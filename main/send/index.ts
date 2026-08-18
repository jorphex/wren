import log from 'electron-log'
import { getAddress } from 'ethers'

import accounts from '../accounts'
import nebulaApi from '../nebula'
import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { NATIVE_CURRENCY } from '../../resources/constants'
import { FRAME_SEND_ORIGIN, originIdForName } from '../../resources/domain/origin'
import { isWatchOnlyAccountType } from '../../resources/domain/signer'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { SEND_ERROR, SendValidationError, buildSendTransaction, type SendDraft } from './transaction'

import type { Balance, Chain } from '../store/state'

const sendOriginId = originIdForName(FRAME_SEND_ORIGIN)
const nebula = nebulaApi()
const MAX_ESTIMATE_PASSES = 4
let rpcId = 0

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

function queue(draft: SendDraft): Promise<SendResult<{ handlerId: string }>> {
  try {
    const account = currentAccount()
    const chain = store('main.networks.ethereum', draft.chainId) as Chain | undefined
    const assets = assetsWithNativeDecimals(
      (store('main.balances', account.id) || []) as Balance[],
      draft.chainId
    )
    const { transaction } = buildSendTransaction(draft, {
      account: account.id,
      assets,
      networkAvailable: chainAvailable(chain),
      watchOnly: isWatchOnlyAccountType(account.lastSignerType)
    })

    ensureOrigin(draft.chainId)

    return new Promise((resolve) => {
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
              log.warn('Could not queue Send transaction')
              resolve({ success: false, error: 'send-unavailable' })
            }
          },
          { type: 'ethereum', id: draft.chainId },
          (handlerId) => {
            queued = true
            requireStoreAction('setDash')({ showing: true })
            resolve({ success: true, handlerId })
          }
        )
      } catch (error) {
        resolve(failure<{ handlerId: string }>(error))
      }
    })
  } catch (error) {
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
  chainId: unknown,
  assetAddress: unknown,
  recipient: unknown
): Promise<SendResult<{ amount: string }>> {
  try {
    if (!Number.isSafeInteger(chainId) || (chainId as number) <= 0 || typeof assetAddress !== 'string') {
      throw new SendValidationError(SEND_ERROR.AssetUnavailable)
    }
    const account = currentAccount()
    const assets = (store('main.balances', account.id) || []) as Balance[]
    const asset = assets.find(
      (candidate) =>
        candidate.chainId === chainId && candidate.address.toLowerCase() === assetAddress.toLowerCase()
    )
    if (!asset) throw new SendValidationError(SEND_ERROR.AssetUnavailable)

    const rawBalance = BigInt(asset.balance)
    if (asset.address.toLowerCase() !== NATIVE_CURRENCY) {
      return { success: true, amount: rawBalance.toString(10) }
    }

    const gas = store('main.networksMeta.ethereum', chainId as number, 'gas')
    const gasPrice = gas?.price?.fees?.maxFeePerGas || gas?.price?.levels?.fast
    if (!gasPrice) throw new SendValidationError(SEND_ERROR.FeeUnavailable)

    let target: string
    try {
      target = getAddress(recipient as string)
    } catch {
      throw new SendValidationError(SEND_ERROR.RecipientInvalid)
    }

    const feePerGas = BigInt(gasPrice)
    let candidate = rawBalance > feePerGas * 21_000n ? rawBalance - feePerGas * 21_000n : 0n
    if (candidate === 0n) return { success: true, amount: '0' }

    for (let pass = 0; pass < MAX_ESTIMATE_PASSES; pass += 1) {
      let gasLimit: bigint | undefined
      try {
        gasLimit = parseRpcQuantity(
          await provider.estimateGas({
            chainId: toRpcQuantity(BigInt(chainId as number)),
            from: account.id,
            to: target,
            value: toRpcQuantity(candidate)
          })
        )
      } catch {
        throw new SendValidationError(SEND_ERROR.FeeUnavailable)
      }
      if (gasLimit === undefined) throw new SendValidationError(SEND_ERROR.FeeUnavailable)

      const reserve = feePerGas * gasLimit
      const nextCandidate = rawBalance > reserve ? rawBalance - reserve : 0n
      if (nextCandidate === candidate) return { success: true, amount: candidate.toString(10) }
      candidate = nextCandidate
    }

    throw new SendValidationError(SEND_ERROR.FeeUnavailable)
  } catch (error) {
    return failure<{ amount: string }>(error)
  }
}

export default { maxAmount, queue, resolveRecipient }
