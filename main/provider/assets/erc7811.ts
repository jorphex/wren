import { isAddress } from 'ethers'

import { parseRpcQuantity, toRpcQuantity } from '../../../resources/domain/transaction/quantity'

const MAX_FILTER_CHAINS = 64
const MAX_ASSET_FILTERS = 256
const MAX_ASSET_TYPES = 64
const MAX_ASSET_TYPE_LENGTH = 64

type AssetSelector = Readonly<{ address: string; type: string }>

export type Erc7811AssetsRequest = Readonly<{
  account: string
  assetFilter?: Readonly<Record<string, readonly AssetSelector[]>>
  assetTypeFilter?: readonly string[]
  chainFilter?: readonly string[]
}>

export type ParsedAssetsRequest =
  Readonly<{ mode: 'legacy' }> | Readonly<{ mode: 'erc7811'; request: Erc7811AssetsRequest }>

export type Erc7811Asset = Readonly<{
  address: string
  balance: string
  type: 'native' | 'erc20'
  metadata?: Readonly<{ name: string; symbol: string; decimals: number }>
}>

const invalidParams = (message: string) => ({ code: -32602, message: `Invalid params: ${message}` })

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalChain(value: unknown) {
  const parsed = parseRpcQuantity(value)
  if (
    parsed === undefined ||
    parsed <= 0n ||
    parsed > BigInt(Number.MAX_SAFE_INTEGER) ||
    typeof value !== 'string' ||
    toRpcQuantity(parsed) !== value.toLowerCase()
  ) {
    throw invalidParams('chain ids must be canonical EIP-155 hex quantities')
  }
  return toRpcQuantity(parsed)
}

function assetType(value: unknown) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ASSET_TYPE_LENGTH) {
    throw invalidParams('asset types must be non-empty bounded strings')
  }
  return value
}

function assetSelector(value: unknown): AssetSelector {
  if (!record(value) || Object.keys(value).some((key) => key !== 'address' && key !== 'type')) {
    throw invalidParams('asset filters must contain only address and type')
  }
  const address = value['address']
  if (address !== 'native' && (typeof address !== 'string' || !isAddress(address))) {
    throw invalidParams('asset filter address must be native or an EVM address')
  }
  return Object.freeze({
    address: address === 'native' ? address : address.toLowerCase(),
    type: assetType(value['type'])
  })
}

export function parseAssetsRequest(params: unknown): ParsedAssetsRequest {
  if (params === undefined || (Array.isArray(params) && params.length === 0)) {
    return Object.freeze({ mode: 'legacy' })
  }
  if (!Array.isArray(params) || params.length !== 1 || !record(params[0])) {
    throw invalidParams('wallet_getAssets requires one request object')
  }

  const value = params[0]
  const keys = Object.keys(value)
  if (keys.some((key) => !['account', 'assetFilter', 'assetTypeFilter', 'chainFilter'].includes(key))) {
    throw invalidParams('wallet_getAssets request contains unknown fields')
  }
  if (typeof value['account'] !== 'string' || !isAddress(value['account'])) {
    throw invalidParams('wallet_getAssets account must be an EVM address')
  }

  let assetFilter: Record<string, readonly AssetSelector[]> | undefined
  if (value['assetFilter'] !== undefined) {
    if (!record(value['assetFilter'])) throw invalidParams('assetFilter must be a chain-keyed object')
    const entries = Object.entries(value['assetFilter'])
    if (entries.length > MAX_FILTER_CHAINS) throw invalidParams('assetFilter has too many chains')
    let total = 0
    assetFilter = {}
    for (const [chain, selectors] of entries) {
      if (!Array.isArray(selectors)) throw invalidParams('assetFilter chain values must be arrays')
      total += selectors.length
      if (total > MAX_ASSET_FILTERS) throw invalidParams('assetFilter has too many assets')
      assetFilter[canonicalChain(chain)] = Object.freeze(selectors.map(assetSelector))
    }
    assetFilter = Object.freeze(assetFilter)
  }

  let assetTypeFilter: readonly string[] | undefined
  if (value['assetTypeFilter'] !== undefined) {
    if (!Array.isArray(value['assetTypeFilter']) || value['assetTypeFilter'].length > MAX_ASSET_TYPES) {
      throw invalidParams('assetTypeFilter must be a bounded array')
    }
    assetTypeFilter = Object.freeze([...new Set(value['assetTypeFilter'].map(assetType))])
  }

  let chainFilter: readonly string[] | undefined
  if (value['chainFilter'] !== undefined) {
    if (!Array.isArray(value['chainFilter']) || value['chainFilter'].length > MAX_FILTER_CHAINS) {
      throw invalidParams('chainFilter must be a bounded array')
    }
    chainFilter = Object.freeze([...new Set(value['chainFilter'].map(canonicalChain))])
  }

  return Object.freeze({
    mode: 'erc7811',
    request: Object.freeze({
      account: value['account'].toLowerCase(),
      ...(assetFilter === undefined ? {} : { assetFilter }),
      ...(assetTypeFilter === undefined ? {} : { assetTypeFilter }),
      ...(chainFilter === undefined ? {} : { chainFilter })
    })
  })
}

const nativeAsset = (asset: RPC.GetAssets.NativeCurrency): Erc7811Asset =>
  Object.freeze({ address: 'native', balance: asset.balance, type: 'native' })

const erc20Asset = (asset: RPC.GetAssets.Erc20): Erc7811Asset =>
  Object.freeze({
    address: asset.address.toLowerCase(),
    balance: asset.balance,
    type: 'erc20',
    metadata: Object.freeze({ name: asset.name, symbol: asset.symbol, decimals: asset.decimals })
  })

export function formatErc7811Assets(
  assets: Readonly<{
    nativeCurrency: readonly RPC.GetAssets.NativeCurrency[]
    erc20: readonly RPC.GetAssets.Erc20[]
  }>,
  request: Erc7811AssetsRequest,
  chainAuthorized: (chainId: number) => boolean
) {
  const available = [
    ...assets.nativeCurrency.map((asset) => ({ chainId: asset.chainId, asset: nativeAsset(asset) })),
    ...assets.erc20.map((asset) => ({ chainId: asset.chainId, asset: erc20Asset(asset) }))
  ].filter(({ chainId }) => chainAuthorized(chainId))

  const result: Record<string, Erc7811Asset[]> = {}
  if (request.assetFilter) {
    for (const [chain, selectors] of Object.entries(request.assetFilter)) {
      const chainId = Number(BigInt(chain))
      if (!chainAuthorized(chainId)) continue
      result[chain] = available
        .filter((candidate) => candidate.chainId === chainId)
        .map(({ asset }) => asset)
        .filter((asset) =>
          selectors.some(
            (selector) =>
              selector.type === asset.type && selector.address.toLowerCase() === asset.address.toLowerCase()
          )
        )
    }
    return result
  }

  const requestedChains = request.chainFilter ? new Set(request.chainFilter) : undefined
  const requestedTypes = request.assetTypeFilter ? new Set(request.assetTypeFilter) : undefined
  if (requestedChains) {
    for (const chain of requestedChains) {
      if (chainAuthorized(Number(BigInt(chain)))) result[chain] = []
    }
  }

  for (const { chainId, asset } of available) {
    const chain = toRpcQuantity(BigInt(chainId))
    if (requestedChains && !requestedChains.has(chain)) continue
    if (requestedTypes && !requestedTypes.has(asset.type)) continue
    ;(result[chain] ||= []).push(asset)
  }
  return result
}
