import { Interface, getAddress, isHexString, keccak256 } from 'ethers'

import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import type { Chain } from '../chains'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'
const MAX_SIGNATURE_BYTES = 64 * 1024
const MAX_CODE_BYTES = 32 * 1024
const MAX_RESULT_BYTES = 256
const erc1271 = new Interface([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4 magicValue)'
])

interface ChainRpc {
  send(payload: JSONRPCRequestPayload, callback: RPCRequestCallback, targetChain: Chain): void
}

export type Erc1271Validation =
  | {
      status: 'valid'
      account: string
      chainId: number
      blockNumber: string
      blockHash: string
      codeHash: string
      source: 'eth_call'
    }
  | {
      status: 'invalid' | 'unavailable'
      account: string
      chainId: number
      reason: string
      source: 'eth_call' | 'eth_getCode'
    }

const rpc = (
  connection: ChainRpc,
  targetChain: Chain,
  method: string,
  params: unknown[],
  timeoutMs: number
) =>
  new Promise<RPCResponsePayload>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    timer.unref()

    connection.send(
      { id: 1, jsonrpc: '2.0', method, params },
      (response) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(response)
      },
      targetChain
    )
  })

const boundedBytes = (value: unknown, maxBytes: number, allowEmpty = false): value is string =>
  typeof value === 'string' &&
  isHexString(value) &&
  value.length % 2 === 0 &&
  (allowEmpty || value !== '0x') &&
  (value.length - 2) / 2 <= maxBytes

const blockIdentity = (value: unknown, expectedNumber: bigint) => {
  if (!value || typeof value !== 'object') return
  const block = value as { number?: unknown; hash?: unknown }
  if (parseRpcQuantity(block.number) !== expectedNumber || !isHexString(block.hash, 32)) return
  return { blockNumber: toRpcQuantity(expectedNumber), blockHash: block.hash.toLowerCase() }
}

export async function validateErc1271Signature(
  {
    account,
    chainId,
    digest,
    signature
  }: { account: unknown; chainId: unknown; digest: unknown; signature: unknown },
  connection: ChainRpc,
  timeoutMs = 10_000
): Promise<Erc1271Validation> {
  let normalizedAccount: string
  try {
    if (typeof account !== 'string') throw new Error('invalid address')
    normalizedAccount = getAddress(account).toLowerCase()
  } catch {
    return {
      status: 'unavailable',
      account: typeof account === 'string' ? account.toLowerCase() : '',
      chainId: typeof chainId === 'number' ? chainId : 0,
      reason: 'Contract signer address is invalid',
      source: 'eth_getCode'
    }
  }

  if (
    typeof chainId !== 'number' ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    typeof digest !== 'string' ||
    !isHexString(digest, 32)
  ) {
    return {
      status: 'unavailable',
      account: normalizedAccount,
      chainId: typeof chainId === 'number' ? chainId : 0,
      reason: 'Contract signature context is invalid',
      source: 'eth_call'
    }
  }
  if (!boundedBytes(signature, MAX_SIGNATURE_BYTES, true)) {
    return {
      status: 'invalid',
      account: normalizedAccount,
      chainId,
      reason: 'Contract signature bytes are invalid',
      source: 'eth_call'
    }
  }

  const targetChain = { type: 'ethereum' as const, id: chainId }
  let validationBlock: { blockNumber: string; blockHash: string }
  try {
    const blockResponse = await rpc(connection, targetChain, 'eth_blockNumber', [], timeoutMs)
    const parsedBlock = blockResponse.error ? undefined : parseRpcQuantity(blockResponse.result)
    if (parsedBlock === undefined) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: 'Validation block could not be established',
        source: 'eth_getCode'
      }
    }
    const blockNumber = toRpcQuantity(parsedBlock)
    const identityResponse = await rpc(
      connection,
      targetChain,
      'eth_getBlockByNumber',
      [blockNumber, false],
      timeoutMs
    )
    const identity = identityResponse.error ? undefined : blockIdentity(identityResponse.result, parsedBlock)
    if (!identity) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: 'Validation block identity could not be established',
        source: 'eth_getCode'
      }
    }
    validationBlock = identity
  } catch {
    return {
      status: 'unavailable',
      account: normalizedAccount,
      chainId,
      reason: 'Validation block check timed out',
      source: 'eth_getCode'
    }
  }

  const blockReference = {
    blockHash: validationBlock.blockHash,
    requireCanonical: true
  }

  let initialCode: string
  try {
    const codeResponse = await rpc(
      connection,
      targetChain,
      'eth_getCode',
      [normalizedAccount, blockReference],
      timeoutMs
    )
    if (codeResponse.error || !boundedBytes(codeResponse.result, MAX_CODE_BYTES)) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: codeResponse.error
          ? 'Contract signer code could not be read'
          : codeResponse.result === '0x'
            ? 'Signer has no contract code'
            : 'Contract signer returned invalid code evidence',
        source: 'eth_getCode'
      }
    }
    initialCode = codeResponse.result.toLowerCase()
  } catch {
    return {
      status: 'unavailable',
      account: normalizedAccount,
      chainId,
      reason: 'Contract signer code check timed out',
      source: 'eth_getCode'
    }
  }

  let callResult: string
  try {
    const response = await rpc(
      connection,
      targetChain,
      'eth_call',
      [
        {
          to: normalizedAccount,
          data: erc1271.encodeFunctionData('isValidSignature', [digest, signature])
        },
        blockReference
      ],
      timeoutMs
    )
    if (response.error) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: 'Contract signature check failed',
        source: 'eth_call'
      }
    }
    if (!boundedBytes(response.result, MAX_RESULT_BYTES, true)) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: 'Contract returned malformed signature evidence',
        source: 'eth_call'
      }
    }
    callResult = response.result
  } catch {
    return {
      status: 'unavailable',
      account: normalizedAccount,
      chainId,
      reason: 'Contract signature check timed out',
      source: 'eth_call'
    }
  }

  let magicValue: string
  try {
    ;[magicValue] = erc1271.decodeFunctionResult('isValidSignature', callResult)
  } catch {
    return {
      status: 'unavailable',
      account: normalizedAccount,
      chainId,
      reason: 'Contract returned malformed signature evidence',
      source: 'eth_call'
    }
  }
  if (magicValue.toLowerCase() !== ERC1271_MAGIC_VALUE) {
    return {
      status: 'invalid',
      account: normalizedAccount,
      chainId,
      reason: 'Contract rejected the signature',
      source: 'eth_call'
    }
  }

  try {
    const finalCode = await rpc(
      connection,
      targetChain,
      'eth_getCode',
      [normalizedAccount, blockReference],
      timeoutMs
    )
    if (
      finalCode.error ||
      !boundedBytes(finalCode.result, MAX_CODE_BYTES) ||
      finalCode.result.toLowerCase() !== initialCode
    ) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: 'Contract signer code changed during validation',
        source: 'eth_getCode'
      }
    }
    const finalIdentity = await rpc(
      connection,
      targetChain,
      'eth_getBlockByNumber',
      [validationBlock.blockNumber, false],
      timeoutMs
    )
    const parsedBlock = parseRpcQuantity(validationBlock.blockNumber)
    const identity =
      finalIdentity.error || parsedBlock === undefined
        ? undefined
        : blockIdentity(finalIdentity.result, parsedBlock)
    if (!identity || identity.blockHash !== validationBlock.blockHash) {
      return {
        status: 'unavailable',
        account: normalizedAccount,
        chainId,
        reason: 'Validation block changed during signature validation',
        source: 'eth_getCode'
      }
    }
  } catch {
    return {
      status: 'unavailable',
      account: normalizedAccount,
      chainId,
      reason: 'Contract signer code recheck timed out',
      source: 'eth_getCode'
    }
  }

  return {
    status: 'valid',
    account: normalizedAccount,
    chainId,
    blockNumber: validationBlock.blockNumber,
    blockHash: validationBlock.blockHash,
    codeHash: keccak256(initialCode),
    source: 'eth_call'
  }
}
