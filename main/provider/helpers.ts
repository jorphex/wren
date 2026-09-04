import {
  padToEven,
  unpadHexString,
  addHexPrefix,
  stripHexPrefix,
  intToHex,
  toBuffer,
  pubToAddress,
  ecrecover,
  hashPersonalMessage
} from '@ethereumjs/util'
import log from 'electron-log'
import BN from 'bignumber.js'
import isUtf8 from 'isutf8'
import { isHexString } from 'ethers'

import store from '../store'
import { usesBaseFee, TransactionData, GasFeesSource } from '../../resources/domain/transaction'
import { normalizeAccessList } from '../../resources/domain/transaction/accessList'
import { getAddress } from '../../resources/utils'
import {
  MAX_UINT256,
  normalizeTransactionQuantities,
  parseRpcQuantity,
  toRpcQuantity
} from '../../resources/domain/transaction/quantity'
import {
  increaseByTenPercent,
  maximumRpcQuantity,
  minimumReplacementFee,
  requiresReplacementFeeBump
} from '../../resources/domain/transaction/replacement'

import type { Chain } from '../store/state'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface StoredFeeRequest {
  mode?: string
  status?: string
  data: Record<string, unknown>
}

const isStoredFeeRequest = (value: unknown): value is StoredFeeRequest =>
  isRecord(value) && isRecord(value['data'])

export function decodeMessage(rawMessage: string) {
  if (isHexString(rawMessage)) {
    const buff = Buffer.from(stripHexPrefix(rawMessage), 'hex')
    return buff.length === 32 || !isUtf8(buff) ? rawMessage : buff.toString('utf8')
  }

  // replace all multiple line returns with just one to prevent excess space in message
  return rawMessage.replaceAll(/[\n\r]+/g, '\n')
}

export function checkExistingNonceGas(tx: TransactionData) {
  const { from, nonce } = tx

  const storedRequests: unknown = store('main.accounts', (from || '').toLowerCase(), 'requests')
  const requests = isRecord(storedRequests) ? Object.values(storedRequests) : []
  const existing = requests.filter(
    (request): request is StoredFeeRequest =>
      isStoredFeeRequest(request) &&
      request.mode === 'monitor' &&
      request.status !== 'error' &&
      request.data['nonce'] === nonce
  )

  const maxStoredQuantity = (field: 'gasPrice' | 'maxFeePerGas' | 'maxPriorityFeePerGas') =>
    maximumRpcQuantity(existing, (request) => request.data[field])

  if (existing.length > 0) {
    if (tx.maxPriorityFeePerGas && tx.maxFeePerGas) {
      const existingFee = maxStoredQuantity('maxPriorityFeePerGas')
      const existingMax = maxStoredQuantity('maxFeePerGas')
      const requestedFee = parseRpcQuantity(tx.maxPriorityFeePerGas)
      const requestedMax = parseRpcQuantity(tx.maxFeePerGas)
      if (
        existingFee !== undefined &&
        existingMax !== undefined &&
        requestedFee !== undefined &&
        requestedMax !== undefined &&
        existingMax >= existingFee &&
        requestedMax >= requestedFee &&
        (requiresReplacementFeeBump(existingFee, requestedFee) ||
          requiresReplacementFeeBump(existingMax, requestedMax))
      ) {
        // Bump fees by 10%
        const bumpedFee = [minimumReplacementFee(existingFee), requestedFee].reduce((a, b) => (a > b ? a : b))
        const bumpedBase = [
          increaseByTenPercent(existingMax - existingFee),
          requestedMax - requestedFee
        ].reduce((a, b) => (a > b ? a : b))
        const bumpedMax = bumpedBase + bumpedFee
        if (bumpedMax > MAX_UINT256) return tx

        tx.maxFeePerGas = toRpcQuantity(bumpedMax)
        tx.maxPriorityFeePerGas = toRpcQuantity(bumpedFee)
        tx.gasFeesSource = GasFeesSource.Frame
        tx.feesUpdated = true
      }
    } else if (tx.gasPrice) {
      const existingPrice = maxStoredQuantity('gasPrice')
      const requestedPrice = parseRpcQuantity(tx.gasPrice)
      if (
        existingPrice !== undefined &&
        requestedPrice !== undefined &&
        requiresReplacementFeeBump(existingPrice, requestedPrice)
      ) {
        // Bump price by 10%
        const bumpedPrice = minimumReplacementFee(existingPrice)
        const replacementPrice = bumpedPrice > requestedPrice ? bumpedPrice : requestedPrice
        if (replacementPrice > MAX_UINT256) return tx

        tx.gasPrice = toRpcQuantity(replacementPrice)
        tx.gasFeesSource = GasFeesSource.Frame
        tx.feesUpdated = true
      }
    }
  }

  return tx
}

export function feeTotalOverMax(rawTx: TransactionData, maxTotalFee: bigint) {
  const baseFeeTransaction = usesBaseFee(rawTx)
  const feePerGas = parseRpcQuantity(baseFeeTransaction ? rawTx.maxFeePerGas : rawTx.gasPrice)
  const gasLimit = parseRpcQuantity(rawTx.gasLimit)
  const priorityFee = baseFeeTransaction ? parseRpcQuantity(rawTx.maxPriorityFeePerGas) : 0n

  // Invalid signing quantities fail closed at the final main-process boundary.
  return (
    feePerGas === undefined ||
    gasLimit === undefined ||
    priorityFee === undefined ||
    priorityFee > feePerGas ||
    feePerGas * gasLimit > maxTotalFee
  )
}

function parseValue(value = '') {
  const parsedHex = parseInt(value, 16)
  return (!!parsedHex && addHexPrefix(unpadHexString(value))) || '0x0'
}

export function getRawTx(newTx: RPC.SendTransaction.TxParams): TransactionData {
  const {
    nonce: rawNonce,
    gasPrice,
    gas,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
    from,
    to,
    data,
    value,
    chainId,
    accessList
  } = newTx
  const getNonce = () => {
    // pass through hex string or undefined
    if (rawNonce === undefined || isHexString(rawNonce)) {
      return rawNonce
    }

    // convert positive integer strings to hex, reject everything else
    const nonceBN = new BN(rawNonce)
    if (nonceBN.isNaN() || !nonceBN.isInteger() || nonceBN.isNegative()) {
      throw new Error('Invalid nonce')
    }
    return addHexPrefix(nonceBN.toString(16))
  }
  const nonce = getNonce()
  const normalizedAccessList = normalizeAccessList(accessList)
  const normalizedGasLimit = gasLimit || gas

  const tx: TransactionData = {
    ...(gasPrice !== undefined && { gasPrice }),
    ...(maxPriorityFeePerGas !== undefined && { maxPriorityFeePerGas }),
    ...(maxFeePerGas !== undefined && { maxFeePerGas }),
    ...(from && { from: getAddress(from) }),
    ...(to && { to: getAddress(to) }),
    type: '0x0',
    value: parseValue(value),
    data: addHexPrefix(padToEven(stripHexPrefix(data || '0x'))),
    ...(normalizedAccessList !== undefined && { accessList: normalizedAccessList }),
    ...(normalizedGasLimit !== undefined && { gasLimit: normalizedGasLimit }),
    chainId,
    ...(nonce !== undefined && { nonce }),
    gasFeesSource: GasFeesSource.Dapp
  }

  return normalizeTransactionQuantities(tx)
}

export function gasFees(rawTx: TransactionData) {
  return store('main.networksMeta', 'ethereum', parseInt(rawTx.chainId, 16), 'gas')
}

export function resError(errorData: string | Error | EVMError, request: RPCId, res: RPCErrorCallback) {
  const error: EVMError =
    typeof errorData === 'string'
      ? { message: errorData, code: -32603 }
      : {
          message: errorData.message || 'Internal error',
          code: 'code' in errorData && typeof errorData.code === 'number' ? errorData.code : -32603
        }

  if (typeof errorData !== 'string' && 'data' in errorData) error.data = errorData.data

  log.warn(error)
  res({ id: request.id, jsonrpc: request.jsonrpc, error })
}

export function getSignedAddress(signed: string, message: string, cb: Callback<string>) {
  const signature = Buffer.from((signed || '').replace('0x', ''), 'hex')
  if (signature.length !== 65) return cb(new Error('Wren verifySignature: Signature has incorrect length'))
  let v = signature[64]
  if (v === undefined) return cb(new Error('Wren verifySignature: Signature recovery byte is missing'))
  v = v === 0 || v === 1 ? v + 27 : v
  const r = toBuffer(signature.slice(0, 32))
  const s = toBuffer(signature.slice(32, 64))
  const hash = hashPersonalMessage(toBuffer(message))
  const verifiedAddress = '0x' + pubToAddress(ecrecover(hash, BigInt(v), r, s)).toString('hex')
  cb(null, verifiedAddress)
}

export function getActiveChainDetails() {
  const chains: Record<string, Chain> = store('main.networks.ethereum') || {}

  return Object.values(chains)
    .filter((chain) => chain.on)
    .sort((a, b) => a.id - b.id)
    .map((chain) => {
      return {
        id: intToHex(chain.id),
        name: chain.name
      }
    })
}

export function ecRecover(payload: JSONRPCRequestPayload, res: RPCRequestCallback) {
  const [message, signed] = Array.isArray(payload.params) ? payload.params : []

  if (typeof message !== 'string' || typeof signed !== 'string') {
    return resError({ code: -32602, message: 'Invalid personal_ecRecover params' }, payload, res)
  }

  getSignedAddress(signed, message, (err, verifiedAddress) => {
    if (err) return resError(err.message, payload, res)
    res({ id: payload.id, jsonrpc: payload.jsonrpc, result: verifiedAddress })
  })
}
