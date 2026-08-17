import log from 'electron-log'

import { fetchWithTimeout, readJsonWithLimit } from '../../../resources/utils/fetch'

import type { JsonFragment } from 'ethers'
import type { ContractSource } from '..'

interface SourcifyContractResponse {
  match?: 'match' | 'exact_match' | null
  abi?: JsonFragment[]
  devdoc?: {
    title?: unknown
  }
  compilation?: {
    name?: unknown
    fullyQualifiedName?: unknown
  }
}

const MAX_SOURCIFY_RESPONSE_BYTES = 8 * 1024 * 1024
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function getEndpointUrl(contractAddress: Address, chainId: number) {
  return `https://sourcify.dev/server/v2/contract/${chainId}/${contractAddress}?fields=abi,devdoc,compilation`
}

async function parseResponse<T>(response: Response): Promise<T | undefined> {
  if (
    response?.status === 200 &&
    (response?.headers.get('content-type') || '').toLowerCase().includes('json')
  ) {
    return await readJsonWithLimit<T>(response, MAX_SOURCIFY_RESPONSE_BYTES)
  }
  return undefined
}

async function fetchContractMetadata(
  contractAddress: Address,
  chainId: number
): Promise<SourcifyContractResponse | undefined> {
  const endpointUrl = getEndpointUrl(contractAddress, chainId)

  try {
    const res = await fetchWithTimeout(endpointUrl, {}, 4000)
    return await parseResponse<SourcifyContractResponse>(res)
  } catch (e) {
    log.warn(
      (e as Error).name === 'AbortError' ? 'Sourcify request timed out' : 'Unable to parse Sourcify response',
      e
    )
    return undefined
  }
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function contractName(result: SourcifyContractResponse) {
  const qualifiedName = nonEmptyString(result.compilation?.fullyQualifiedName)
  return (
    nonEmptyString(result.devdoc?.title) ||
    nonEmptyString(result.compilation?.name) ||
    qualifiedName?.split(':').pop()
  )
}

export async function fetchSourcifyContract(
  contractAddress: Address,
  chainId: number
): Promise<ContractSource | undefined> {
  if (!ADDRESS.test(contractAddress) || !Number.isSafeInteger(chainId) || chainId <= 0) return

  const result = await fetchContractMetadata(contractAddress, chainId)
  const name = result && contractName(result)

  if (
    !result ||
    !['match', 'exact_match'].includes(result.match || '') ||
    !Array.isArray(result.abi) ||
    !name
  )
    return

  return { abi: JSON.stringify(result.abi), name, source: 'sourcify' }
}
