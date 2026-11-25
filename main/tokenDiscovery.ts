import BigNumber from 'bignumber.js'
import { Interface } from 'ethers'

import { toTokenId } from '../resources/domain/balance'
import { toRpcQuantity } from '../resources/domain/transaction/quantity'
import TokenLoader from './externalData/inventory/tokens'
import type { Token } from './store/state'
import {
  INCOMING_TOKEN_REFERENCE_TTL,
  type IncomingTokenReference
} from './store/state/types/accountActivity'

export const TOKEN_DISCOVERY_PAGE_SIZE = 16
export type DiscoveryScope = {
  account: string
  chainId: number
  source: 'activity' | 'catalog'
}
type DiscoveryNetwork = {
  routes: string
  provider?: object | null
  known: ReadonlySet<string>
  incoming: IncomingTokenReference[]
}
type Rpc = (chainId: number, method: string, params: readonly unknown[]) => Promise<unknown>
type DiscoveredToken = Omit<Token, 'logoURI'> & { balance: string }
type Target = { address: string; receipt?: IncomingTokenReference; skip: boolean }

const erc20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
])
const ADDRESS = /^0x[0-9a-f]{40}$/u
const word = /^0x[0-9a-fA-F]{64}$/u

const tokenText = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : ''
  return text && text.length <= max ? text : undefined
}

export function createTokenDiscovery({
  rpc,
  getNetwork,
  track,
  catalog = new TokenLoader(),
  now = Date.now
}: {
  rpc: Rpc
  getNetwork: (scope: DiscoveryScope) => DiscoveryNetwork | undefined
  track: (account: string, token: Token, balance: { balance: string; displayBalance: string }) => void
  catalog?: TokenLoader
  now?: () => number
}) {
  const pages = new Map<number, Map<string, Token>>()
  const pending = new Set<string>()

  function loadCatalog(chainId: number) {
    let tokens = pages.get(chainId)
    if (!tokens) {
      tokens = new Map(catalog.getTokens([chainId]).map((token) => [token.address.toLowerCase(), token]))
      pages.set(chainId, tokens)
    }
    return tokens
  }

  function targets(scope: DiscoveryScope, network: DiscoveryNetwork): Target[] {
    const { account, chainId, source } = scope
    const blocked = new Set(catalog.getDiscoveryExclusions([chainId]).map(toTokenId))
    const allowed = (address: string) =>
      ADDRESS.test(address) &&
      !network.known.has(toTokenId({ chainId, address })) &&
      !blocked.has(toTokenId({ chainId, address }))
    if (source === 'activity') {
      const cutoff = now() - INCOMING_TOKEN_REFERENCE_TTL
      return network.incoming
        .filter((ref) => ref.account === account && ref.timestamp > cutoff)
        .reverse()
        .map((receipt) => ({ address: receipt.token, receipt, skip: !allowed(receipt.token) }))
    }
    // Keep page boundaries stable as a parallel balance scan adds known tokens.
    return [...loadCatalog(chainId).keys()].map((address) => ({ address, skip: !allowed(address) }))
  }

  function isCurrent(scope: DiscoveryScope, network: DiscoveryNetwork, target?: Target) {
    const current = getNetwork(scope)
    if (!current || current.routes !== network.routes || current.provider !== network.provider) return false
    const receipt = target?.receipt
    return (
      !receipt ||
      (receipt.timestamp > now() - INCOMING_TOKEN_REFERENCE_TTL &&
        current.incoming.some(
          (ref) =>
            ref.account === receipt.account &&
            ref.token === receipt.token &&
            ref.blockHash === receipt.blockHash
        ))
    )
  }

  async function read(scope: DiscoveryScope, target: Target): Promise<DiscoveredToken | undefined> {
    const { address, receipt } = target
    const { chainId, account } = scope
    if (receipt) {
      const block = await rpc(chainId, 'eth_getBlockByNumber', [
        toRpcQuantity(BigInt(receipt.blockNumber)),
        false
      ])
      if (!block || typeof block !== 'object' || !('hash' in block) || block.hash !== receipt.blockHash)
        return
    }
    const call = (method: string, args: unknown[] = []) =>
      rpc(chainId, 'eth_call', [{ to: address, data: erc20.encodeFunctionData(method, args) }, 'latest'])
    const raw = await call('balanceOf', [account])
    if (typeof raw !== 'string' || !word.test(raw) || BigInt(raw) === 0n) return

    const balance = toRpcQuantity(BigInt(raw))
    const known = scope.source === 'catalog' ? loadCatalog(chainId).get(address) : undefined
    if (known) {
      const { decimals } = known
      const name = tokenText(known.name, 128)
      const symbol = tokenText(known.symbol, 32)
      if (!name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return
      return { address, chainId, name, symbol, decimals, balance }
    }

    const code = await rpc(chainId, 'eth_getCode', [address, 'latest'])
    if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code)) return
    const [nameResult, symbolResult, decimalsResult, supply] = await Promise.all([
      call('name'),
      call('symbol'),
      call('decimals'),
      call('totalSupply')
    ])
    const readText = (method: string, result: unknown, max: number) =>
      typeof result === 'string' && result.length <= 4098
        ? tokenText(erc20.decodeFunctionResult(method, result)[0], max)
        : undefined
    const name = readText('name', nameResult, 128)
    const symbol = readText('symbol', symbolResult, 32)
    if (
      !name ||
      !symbol ||
      typeof decimalsResult !== 'string' ||
      !word.test(decimalsResult) ||
      BigInt(decimalsResult) > 255n ||
      typeof supply !== 'string' ||
      !word.test(supply)
    )
      return
    return {
      address,
      chainId,
      name,
      symbol,
      decimals: Number(BigInt(decimalsResult)),
      balance
    }
  }

  async function withScope<T>(scope: DiscoveryScope, operation: (network: DiscoveryNetwork) => Promise<T>) {
    const network = getNetwork(scope)
    if (!network || pending.size >= 2 || pending.has(scope.account))
      throw new Error('Token lookup unavailable')
    pending.add(scope.account)
    try {
      return await operation(network)
    } finally {
      pending.delete(scope.account)
    }
  }

  return {
    preview: (scope: DiscoveryScope, offset: number) =>
      withScope(scope, async (network) => {
        const candidates = targets(scope, network)
        const page = candidates.slice(offset, offset + TOKEN_DISCOVERY_PAGE_SIZE)
        const settled = await Promise.allSettled(
          page.map((candidate) => (candidate.skip ? undefined : read(scope, candidate)))
        )
        if (!isCurrent(scope, network)) throw new Error('Token lookup changed')
        const matches = settled.flatMap((result, index) =>
          result.status === 'fulfilled' && result.value && isCurrent(scope, network, page[index])
            ? [result.value]
            : []
        )
        const next = offset + page.length
        return {
          success: true as const,
          matches,
          partial: settled.some((result) => result.status === 'rejected'),
          next: next < candidates.length ? next : null
        }
      }),
    add: (scope: DiscoveryScope, address: string) =>
      withScope(scope, async (network) => {
        if (network.known.has(toTokenId({ chainId: scope.chainId, address }))) return
        const target = targets(scope, network).find((item) => item.address === address && !item.skip)
        if (!target) throw new Error('Token is no longer discoverable')
        const result = await read(scope, target)
        if (!result || !isCurrent(scope, network, target)) throw new Error('Token is no longer available')
        const { balance, ...token } = result
        const current = getNetwork(scope)!
        if (current.known.has(toTokenId(token))) return
        track(scope.account, token, {
          balance,
          displayBalance: new BigNumber(balance).shiftedBy(-token.decimals).toFixed()
        })
      })
  }
}
