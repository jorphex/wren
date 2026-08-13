import log from 'electron-log'
import { id, Interface } from 'ethers'
import { fetchSourcifyContract } from './sources/sourcify'
import { fetchEtherscanContract } from './sources/etherscan'

// this list should be in order of descending priority as each source will
// be searched in turn
const fetchSources = [fetchSourcifyContract, fetchEtherscanContract]

type ContractSourceResult = ContractSource | undefined

export interface ContractSource {
  abi: string
  name: string
  source: string
}

export interface DecodedCallData {
  contractAddress: string
  codeAddress?: string
  contractName: string
  source: string
  method: string
  args: Array<{
    name: string
    type: string
    value: string
  }>
  confidence: 'verified-abi' | 'standard-abi'
  retained?: boolean
}

export interface SuggestedCallData {
  method: string
  signature: string
  source: 'bundled-selector-directory'
}

interface ContractCacheEntry {
  value: ContractSourceResult
  expiresAt: number
}

const MAX_CONTRACT_CACHE_ENTRIES = 256
const NEGATIVE_CACHE_TTL_MS = 30_000
const contractCache = new Map<string, ContractCacheEntry>()

const COMMON_FUNCTION_SIGNATURES = [
  'approve(address,uint256)',
  'balanceOf(address)',
  'decimals()',
  'name()',
  'symbol()',
  'totalSupply()',
  'transfer(address,uint256)',
  'transferFrom(address,address,uint256)',
  'allowance(address,address)',
  'setApprovalForAll(address,bool)',
  'isApprovedForAll(address,address)',
  'safeTransferFrom(address,address,uint256)',
  'safeTransferFrom(address,address,uint256,bytes)',
  'safeTransferFrom(address,address,uint256,uint256,bytes)',
  'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  'deposit()',
  'withdraw(uint256)',
  'multicall(bytes[])',
  'execute(address,uint256,bytes)',
  'upgradeToAndCall(address,bytes)',
  'changeAdmin(address)',
  'grantRole(bytes32,address)',
  'revokeRole(bytes32,address)',
  'renounceOwnership()',
  'transferOwnership(address)'
] as const

const selectorDirectory = (() => {
  const candidates = new Map<string, string[]>()
  for (const signature of COMMON_FUNCTION_SIGNATURES) {
    const selector = id(signature).slice(0, 10).toLowerCase()
    candidates.set(selector, [...(candidates.get(selector) || []), signature])
  }
  return new Map(Array.from(candidates.entries()).filter(([, signatures]) => signatures.length === 1))
})()

function parseAbi(abiData: string): Interface | undefined {
  try {
    return new Interface(abiData)
  } catch (e) {
    log.warn('could not parse ABI data')
  }

  return undefined
}

export function suggestCallData(calldata: string): SuggestedCallData | undefined {
  if (typeof calldata !== 'string' || !/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2})*$/u.test(calldata)) return
  const signature = selectorDirectory.get(calldata.slice(0, 10).toLowerCase())?.[0]
  if (!signature) return
  return {
    method: signature.slice(0, signature.indexOf('(')),
    signature,
    source: 'bundled-selector-directory'
  }
}

export function decodeCallData(calldata: string, abi: string) {
  const contractInterface = parseAbi(abi)

  if (contractInterface) {
    const sighash = calldata.slice(0, 10)

    try {
      const abiMethod = contractInterface.getFunction(sighash)
      if (!abiMethod) throw new Error(`Unknown ABI method ${sighash}`)
      const decoded = contractInterface.decodeFunctionData(sighash, calldata)

      return {
        method: abiMethod.name,
        args: abiMethod.inputs.map((input, i) => ({
          name: input.name,
          type: input.type,
          value: decoded[i].toString()
        }))
      }
    } catch (e) {
      log.warn('unknown ABI method for signature', sighash)
    }
  }

  return undefined
}

export async function fetchContract(
  contractAddress: Address,
  chainId: number,
  codeIdentity = ''
): Promise<ContractSourceResult> {
  const cacheKey = `${chainId}:${contractAddress.toLowerCase()}:${codeIdentity}`
  const cached = codeIdentity ? contractCache.get(cacheKey) : undefined
  if (cached && cached.expiresAt > Date.now()) {
    contractCache.delete(cacheKey)
    contractCache.set(cacheKey, cached)
    return cached.value
  }
  if (cached) contractCache.delete(cacheKey)

  const fetches = fetchSources.map((getContract) => getContract(contractAddress, chainId))

  let contract: ContractSourceResult = undefined
  let i = 0

  while (!contract && i < fetches.length) {
    contract = await fetches[i]
    i += 1
  }

  if (!contract) {
    log.warn('could not fetch verified contract source', { chainId })
  }

  if (codeIdentity) {
    contractCache.set(cacheKey, {
      value: contract,
      expiresAt: contract ? Number.MAX_SAFE_INTEGER : Date.now() + NEGATIVE_CACHE_TTL_MS
    })
    while (contractCache.size > MAX_CONTRACT_CACHE_ENTRIES) {
      const oldest = contractCache.keys().next().value
      if (oldest === undefined) break
      contractCache.delete(oldest)
    }
  }

  return contract
}
