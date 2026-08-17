import log from 'electron-log'

import { fetchWithTimeout, readJsonWithLimit } from '../../../resources/utils/fetch'

import type { ContractSource } from '..'

interface EtherscanSourceCodeResponse {
  status?: string
  message?: string
  result?: unknown
}

interface ContractSourceCodeResult {
  ABI?: unknown
  ContractName?: unknown
  Implementation?: unknown
}

const ETHERSCAN_API_KEY = '3SYU5MW5QK8RPCJV1XVICHWKT774993S24'
const MAX_ETHERSCAN_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_PROXY_DEPTH = 4
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const getEndpoint = (chainId: number, contractAddress: string) => {
  return `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${contractAddress}&apikey=${ETHERSCAN_API_KEY}`
}

const sourceByChain = {
  1: 'etherscan.io',
  10: 'optimistic.etherscan.io',
  137: 'polygonscan.com',
  42161: 'arbiscan.io'
}

async function parseResponse<T>(response: Response): Promise<T | undefined> {
  if (
    response?.status === 200 &&
    (response?.headers.get('content-type') || '').toLowerCase().includes('json')
  ) {
    return readJsonWithLimit<T>(response, MAX_ETHERSCAN_RESPONSE_BYTES)
  }
  return undefined
}

async function fetchSourceCode(endpointUrl: string): Promise<ContractSourceCodeResult[] | undefined> {
  try {
    const res = await fetchWithTimeout(endpointUrl, {}, 4000)
    const parsedResponse = await parseResponse<EtherscanSourceCodeResponse>(res)

    return parsedResponse?.status === '1' &&
      parsedResponse.message === 'OK' &&
      Array.isArray(parsedResponse.result)
      ? (parsedResponse.result as ContractSourceCodeResult[])
      : undefined
  } catch (e) {
    log.warn(
      (e as Error).name === 'AbortError'
        ? 'Etherscan request timed out'
        : 'Unable to parse Etherscan response'
    )
    return undefined
  }
}

export function chainSupported(chainId: string) {
  return Object.prototype.hasOwnProperty.call(sourceByChain, chainId)
}

function verifiedAbi(value: unknown): value is string {
  if (typeof value !== 'string' || value === 'Contract source code not verified') return false

  try {
    return Array.isArray(JSON.parse(value))
  } catch {
    return false
  }
}

async function fetchEtherscanContractAt(
  contractAddress: Address,
  chainId: keyof typeof sourceByChain,
  visited: Set<string>
): Promise<ContractSource | undefined> {
  const normalizedAddress = contractAddress.toLowerCase()
  if (visited.has(normalizedAddress) || visited.size >= MAX_PROXY_DEPTH) {
    log.warn(`Etherscan proxy resolution exceeded its safe bound on chain ${chainId}`)
    return
  }
  visited.add(normalizedAddress)

  try {
    const endpoint = getEndpoint(chainId, contractAddress)
    const result = await fetchSourceCode(endpoint)

    if (result?.length) {
      const source = result[0]
      if (!source) return
      const implementation = typeof source.Implementation === 'string' ? source.Implementation : ''

      if (implementation && implementation.toLowerCase() !== normalizedAddress) {
        if (!ADDRESS.test(implementation)) {
          log.warn(`Etherscan returned an invalid proxy implementation on chain ${chainId}`)
          return
        }
        return fetchEtherscanContractAt(implementation, chainId, visited)
      }

      if (!verifiedAbi(source.ABI)) {
        log.warn(`Contract ${contractAddress} does not have verified ABI in Etherscan`)
        return undefined
      }

      const name = typeof source.ContractName === 'string' ? source.ContractName.trim() : ''
      if (!name) return

      return {
        abi: source.ABI,
        name,
        source: sourceByChain[chainId]
      }
    }
  } catch {
    log.warn(`Contract ${contractAddress} not found in Etherscan`)
  }

  return undefined
}

export async function fetchEtherscanContract(
  contractAddress: Address,
  chainId: number
): Promise<ContractSource | undefined> {
  if (!ADDRESS.test(contractAddress) || !Object.prototype.hasOwnProperty.call(sourceByChain, chainId)) return

  return fetchEtherscanContractAt(contractAddress, chainId as keyof typeof sourceByChain, new Set())
}
