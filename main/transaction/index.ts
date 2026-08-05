import BigNumber from 'bignumber.js'
import { addHexPrefix, intToHex } from '@ethereumjs/util'
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx'
import { Common } from '@ethereumjs/common'

import type { SignerSummary } from '../signers/Signer'
import { getSignerCapabilities } from '../signers/capabilities'
import { GasFeesSource, TransactionData, typeSupportsBaseFee } from '../../resources/domain/transaction'
import { isNonZeroHex } from '../../resources/utils'
import chainConfig from '../chains/config'
import { TransactionRequest, TxClassification } from '../accounts/types'
import { parseRpcQuantity } from '../../resources/domain/transaction/quantity'

import type { Gas } from '../store/state'

export interface Signature {
  v: string
  r: string
  s: string
}

export interface SignerCompatibility {
  signer: string
  tx: string
  compatible: boolean
}

function signerCompatibility(txData: TransactionData, signer: SignerSummary): SignerCompatibility {
  if (typeSupportsBaseFee(txData.type)) {
    const compatible = getSignerCapabilities(signer).nativeEip1559
    return { signer: signer.type, tx: 'london', compatible }
  }

  return {
    signer: signer.type,
    tx: 'legacy',
    compatible: true
  }
}

function londonToLegacy(txData: TransactionData): TransactionData {
  if (txData.type === '0x2') {
    if (txData.accessList !== undefined) {
      throw new Error('Access-list transactions cannot use legacy signer fallback')
    }

    const { type, maxFeePerGas, maxPriorityFeePerGas, ...tx } = txData

    return { ...tx, type: '0x0', ...(maxFeePerGas !== undefined && { gasPrice: maxFeePerGas }) }
  }

  return txData
}

function maxFee(rawTx: TransactionData) {
  const chainId =
    parseRpcQuantity(rawTx.chainId) ??
    (typeof rawTx.chainId === 'string' && /^(?:0|[1-9][0-9]*)$/.test(rawTx.chainId)
      ? BigInt(rawTx.chainId)
      : undefined)
  const nativeUnit = 10n ** 18n

  // for ETH-based chains, the max fee should be 2 ETH
  if (
    [1n, 3n, 4n, 5n, 6n, 10n, 42n, 61n, 62n, 63n, 69n, 8453n, 42161n, 421611n, 7777777n].includes(
      chainId || 0n
    )
  ) {
    return 2n * nativeUnit
  }

  // for Fantom, the max fee should be 250 FTM
  if ([250n, 4002n].includes(chainId || 0n)) {
    return 250n * nativeUnit
  }

  // for all other chains, default to 50 of the chain's currency
  return 50n * nativeUnit
}

function calculateMaxFeePerGas(maxBaseFee: string, maxPriorityFee: string) {
  const maxFeePerGas = BigNumber(maxPriorityFee).plus(maxBaseFee).toString(16)
  return addHexPrefix(maxFeePerGas)
}

function populate(rawTx: TransactionData, chainConfig: Common, gas: Gas): TransactionData {
  const txData: TransactionData = { ...rawTx }

  if (rawTx.accessList !== undefined && !chainConfig.isActivatedEIP(2930)) {
    throw new Error('Transaction access lists are not supported on this chain')
  }

  // non-EIP-1559 case
  if (!chainConfig.isActivatedEIP(1559) || !gas.price.fees) {
    txData.type = intToHex(chainConfig.isActivatedEIP(2930) ? 1 : 0)

    const useFrameGasPrice = !rawTx.gasPrice || isNaN(parseInt(rawTx.gasPrice, 16))
    if (useFrameGasPrice) {
      // No valid dapp-supplied gasPrice, so use the wallet-supplied value.
      const gasPrice = BigNumber(gas.price.levels.fast as string).toString(16)
      txData.gasPrice = addHexPrefix(gasPrice)
      txData.gasFeesSource = GasFeesSource.Frame
    }

    return txData
  }

  // EIP-1559 case
  txData.type = intToHex(2)

  const useFrameMaxFeePerGas = !rawTx.maxFeePerGas || isNaN(parseInt(rawTx.maxFeePerGas, 16))
  const useFrameMaxPriorityFeePerGas =
    !rawTx.maxPriorityFeePerGas || isNaN(parseInt(rawTx.maxPriorityFeePerGas, 16))

  if (!useFrameMaxFeePerGas && !useFrameMaxPriorityFeePerGas) {
    // Return the transaction unchanged when no wallet-supplied values are used.
    return txData
  }

  if (useFrameMaxFeePerGas && useFrameMaxPriorityFeePerGas) {
    // dapp did not supply a valid value for maxFeePerGas or maxPriorityFeePerGas so we change the source flag
    txData.gasFeesSource = GasFeesSource.Frame
  }

  const maxPriorityFee =
    useFrameMaxPriorityFeePerGas && gas.price.fees.maxPriorityFeePerGas
      ? gas.price.fees.maxPriorityFeePerGas
      : (rawTx.maxPriorityFeePerGas as string)

  // if no valid dapp-supplied value for maxFeePerGas we calculate it
  if (useFrameMaxFeePerGas && gas.price.fees.maxBaseFeePerGas) {
    txData.maxFeePerGas = calculateMaxFeePerGas(gas.price.fees.maxBaseFeePerGas, maxPriorityFee)
  }

  // Use the wallet-supplied priority fee when the dapp did not provide a valid value.
  if (useFrameMaxPriorityFeePerGas) {
    txData.maxPriorityFeePerGas = addHexPrefix(BigNumber(maxPriorityFee).toString(16))
  }

  return txData
}

function hexifySignature({ v, r, s }: Signature) {
  return {
    v: addHexPrefix(v),
    r: addHexPrefix(r),
    s: addHexPrefix(s)
  }
}

async function sign(rawTx: TransactionData, signingFn: (tx: TypedTransaction) => Promise<Signature>) {
  const common = chainConfig(
    parseInt(rawTx.chainId, 16),
    parseInt(rawTx.type, 16) === 2 ? 'london' : 'berlin'
  )

  const tx = TransactionFactory.fromTxData(rawTx, { common })

  return signingFn(tx).then((sig) => {
    const signature = hexifySignature(sig)

    return TransactionFactory.fromTxData(
      {
        ...rawTx,
        ...signature
      },
      { common }
    )
  })
}

function classifyTransaction({
  payload: { params },
  recipientType
}: Omit<TransactionRequest, 'classification'>): TxClassification {
  const transaction = params[0]
  if (!transaction) throw new Error('Transaction request has no transaction data')
  const { to, data = '0x' } = transaction

  if (!to) return TxClassification.CONTRACT_DEPLOY
  if (recipientType === 'external' && data.length > 2) return TxClassification.SEND_DATA
  if (isNonZeroHex(data) && recipientType !== 'external') return TxClassification.CONTRACT_CALL
  return TxClassification.NATIVE_TRANSFER
}

export { maxFee, populate, sign, signerCompatibility, londonToLegacy, classifyTransaction }
