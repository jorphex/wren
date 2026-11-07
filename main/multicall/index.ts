import { Interface } from 'ethers'
import { addHexPrefix } from '@ethereumjs/util'
import log from 'electron-log'

import type { BytesLike } from 'ethers'
import type EthereumProvider from 'ethereum-provider'

import {
  abi,
  Call,
  CallResult,
  functionSignatureMatcher,
  multicallAddresses,
  MulticallConfig,
  MulticallVersion
} from './constants'

export { Call }

const multicallInterface = new Interface(abi)
const memoizedInterfaces: Record<string, Interface> = {}

function chainConfig(chainId: number, eth: EthereumProvider): MulticallConfig {
  const deployment = multicallAddresses[chainId]
  if (!deployment) throw new Error(`multicall is not supported on chain ${chainId}`)
  return {
    address: deployment.address,
    version: deployment.version,
    chainId,
    provider: eth
  }
}

async function makeCall(functionName: string, params: readonly unknown[], config: MulticallConfig) {
  const data = multicallInterface.encodeFunctionData(functionName, params)

  const response: BytesLike = await config.provider.request({
    method: 'eth_call',
    params: [{ to: config.address, data }, 'latest'],
    chainId: addHexPrefix(config.chainId.toString(16))
  })

  return multicallInterface.decodeFunctionResult(functionName, response)
}

function buildCallData<R, T>(calls: Call<R, T>[]) {
  return calls.map(({ target, call }) => {
    const [fnSignature, ...params] = call
    if (!fnSignature) throw new Error('multicall function signature is required')
    const fnName = getFunctionNameFromSignature(fnSignature)

    const callInterface = getInterface(fnSignature)
    const calldata = callInterface.encodeFunctionData(fnName, params)

    return [target, calldata]
  })
}

function getResultData(results: BytesLike, call: string[], target: string) {
  const [fnSignature] = call
  if (!fnSignature) throw new Error('multicall function signature is required')
  const callInterface = getInterface(fnSignature)
  const fnName = getFunctionNameFromSignature(fnSignature)
  try {
    return callInterface.decodeFunctionResult(fnName, results)
  } catch (e) {
    // Some token contracts return successful calls with malformed returndata.
    // Keep that contract isolated from the rest of the multicall batch.
    log.verbose(`Failed to decode ${fnName}`, { target, results })
    return undefined
  }
}

function getFunctionNameFromSignature(signature: string) {
  const m = signature.match(functionSignatureMatcher)

  if (!m) {
    throw new Error(`could not parse function name from signature: ${signature}`)
  }

  const name = m.groups?.['signature']
  if (!name) throw new Error(`could not parse function name from signature: ${signature}`)
  return name
}

function getInterface(functionSignature: string) {
  const existing = memoizedInterfaces[functionSignature]
  if (existing) return existing
  const created = new Interface([functionSignature])
  memoizedInterfaces[functionSignature] = created
  return created
}

async function aggregate<R, T>(calls: Call<R, T>[], config: MulticallConfig): Promise<CallResult<T>[]> {
  const aggData = buildCallData(calls)
  const response = await makeCall('aggregate', [aggData], config)
  const returndata = response[1]
  if (!Array.isArray(returndata)) throw new Error('multicall aggregate returned malformed data')
  if (returndata.length !== calls.length) {
    throw new Error(`multicall aggregate returned ${returndata.length} results for ${calls.length} calls`)
  }

  return calls.map(({ call, returns, target }, i) => {
    const result = returndata[i]
    if (result === undefined) throw new Error(`multicall aggregate omitted result ${i}`)
    const resultData = getResultData(result, call, target)
    if (!resultData) return { success: false, returnValues: [] }

    return { success: true, returnValues: returns.map((handler, j) => handler(resultData[j])) }
  })
}

async function tryAggregate<R, T>(calls: Call<R, T>[], config: MulticallConfig) {
  const aggData = buildCallData(calls)
  const response = await makeCall('tryAggregate', [false, aggData], config)
  const results = response[0]
  if (!Array.isArray(results)) throw new Error('multicall tryAggregate returned malformed data')
  if (results.length !== calls.length) {
    throw new Error(`multicall tryAggregate returned ${results.length} results for ${calls.length} calls`)
  }

  return calls.map(({ call, returns, target }, i) => {
    const result = results[i]
    if (!Array.isArray(result)) throw new Error(`multicall tryAggregate omitted result ${i}`)
    const [success, returndata] = result

    if (!success) {
      return { success: false, returnValues: [] }
    }

    if (returndata === undefined) throw new Error(`multicall tryAggregate result ${i} omitted returndata`)
    const resultData = getResultData(returndata, call, target)
    if (!resultData) return { success: false, returnValues: [] }

    return { success: true, returnValues: returns.map((handler, j) => handler(resultData[j])) }
  })
}

// public functions
export function supportsChain(chainId: number) {
  return chainId in multicallAddresses
}

export default function (chainId: number, eth: EthereumProvider) {
  const config = chainConfig(chainId, eth)

  async function call<R, T>(calls: Call<R, T>[]): Promise<CallResult<T>[]> {
    return config.version === MulticallVersion.V2 ? tryAggregate(calls, config) : aggregate(calls, config)
  }

  return {
    call,
    batchCall: async function <R, T>(calls: Call<R, T>[], batchSize = 200) {
      if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
        throw new Error('multicall batch size must be a positive integer')
      }
      const numBatches = Math.ceil(calls.length / batchSize)
      const fetchResults: CallResult<T>[][] = new Array(numBatches)
      let nextBatch = 0

      const fetches = Array.from({ length: Math.min(2, numBatches) }, async () => {
        while (nextBatch < numBatches) {
          const batchIndex = nextBatch++
          const batchStart = batchIndex * batchSize
          const batchEnd = Math.min(batchStart + batchSize, calls.length)
          const batchCalls = calls.slice(batchStart, batchEnd)

          try {
            fetchResults[batchIndex] = await call(batchCalls)
          } catch (e) {
            log.error(
              `multicall error (batch ${batchStart}-${batchEnd}), chainId: ${chainId}, first call: ${JSON.stringify(
                calls[batchStart]
              )}`,
              e
            )
            fetchResults[batchIndex] = batchCalls.map(() => ({ success: false, returnValues: [] }))
          }
        }
      })

      await Promise.all(fetches)
      const callResults = ([] as CallResult<T>[]).concat(...fetchResults)

      return callResults
    }
  }
}
