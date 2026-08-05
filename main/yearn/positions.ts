import { Interface, formatUnits, getAddress } from 'ethers'

import {
  YEARN_CHAIN_IDS,
  YearnPositionsResultSchema,
  type YearnCatalogResult,
  type YearnPosition,
  type YearnPositionVariant,
  type YearnPositionsResult,
  type YearnVault
} from '../../resources/domain/yearn'
import { isWatchOnlyAccountType } from '../../resources/domain/signer'

const erc20 = new Interface(['function balanceOf(address account) view returns (uint256)'])
const erc4626 = new Interface(['function convertToAssets(uint256 shares) view returns (uint256)'])
const yvUsdLocked = new Interface([
  'function cooldownDuration() view returns (uint256)',
  'function withdrawalWindow() view returns (uint256)',
  'function getCooldownStatus(address user) view returns (uint256 cooldownEnd,uint256 windowEnd,uint256 shares)'
])

export interface YearnPositionAccount {
  address: string
  name?: string
  lastSignerType?: string
}

export interface YearnNetworkStatus {
  on: boolean
  connected: boolean
}

interface YearnPositionsDependencies {
  getCatalog: () => Promise<YearnCatalogResult>
  getCurrentAccount: () => YearnPositionAccount | null
  getNetworkStatus: (chainId: number) => YearnNetworkStatus | null
  readContract: (chainId: number, address: string, data: string) => Promise<string>
  now?: () => number
}

const boundedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Vault balances are unavailable'
  return message.trim().slice(0, 240) || 'Vault balances are unavailable'
}

const decodeUint = (contract: Interface, method: string, result: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error('RPC returned an invalid contract value')
  }
  return contract.decodeFunctionResult(method, result)[0] as bigint
}

const balanceCall = (address: string) => erc20.encodeFunctionData('balanceOf', [address])
const convertCall = (shares: bigint) => erc4626.encodeFunctionData('convertToAssets', [shares])

async function readVaultPosition(
  vault: YearnVault,
  account: string,
  readContract: YearnPositionsDependencies['readContract'],
  now: () => number
): Promise<YearnPosition> {
  const balanceTargets = [vault.asset.address, ...vault.variants.map(({ address }) => address)]
  const balanceResults = await Promise.allSettled(
    balanceTargets.map((target) => readContract(vault.chainId, target, balanceCall(account)))
  )
  const errors: string[] = []
  const assetResult = balanceResults[0]
  let assetBalanceRaw: bigint | null = null
  if (assetResult?.status === 'fulfilled') {
    try {
      assetBalanceRaw = decodeUint(erc20, 'balanceOf', assetResult.value)
    } catch (error) {
      errors.push(boundedError(error))
    }
  } else if (assetResult?.status === 'rejected') {
    errors.push(boundedError(assetResult.reason))
  }

  const shareBalances = vault.variants.map((variant, index) => {
    const result = balanceResults[index + 1]
    if (result?.status !== 'fulfilled') {
      if (result?.status === 'rejected') errors.push(boundedError(result.reason))
      return { variant, shares: 0n, failed: true }
    }
    try {
      return { variant, shares: decodeUint(erc20, 'balanceOf', result.value), failed: false }
    } catch (error) {
      errors.push(boundedError(error))
      return { variant, shares: 0n, failed: true }
    }
  })

  const assetResults = await Promise.allSettled(
    shareBalances.map(({ variant, shares, failed }) =>
      failed || shares === 0n
        ? Promise.resolve(null)
        : readContract(vault.chainId, variant.address, convertCall(shares))
    )
  )

  const variants: YearnPositionVariant[] = shareBalances.map(({ variant, shares, failed }, index) => {
    const result = assetResults[index]
    let assetsRaw: bigint | null = shares === 0n && !failed ? 0n : null
    if (result?.status === 'fulfilled' && result.value !== null) {
      try {
        assetsRaw = decodeUint(erc4626, 'convertToAssets', result.value)
      } catch (error) {
        errors.push(boundedError(error))
      }
    } else if (result?.status === 'rejected') {
      errors.push(boundedError(result.reason))
    }

    return {
      id: variant.id,
      address: variant.address,
      symbol: variant.symbol,
      decimals: variant.decimals,
      sharesRaw: shares.toString(),
      shares: formatUnits(shares, variant.decimals),
      assetSymbol: variant.asset.symbol,
      assetDecimals: variant.asset.decimals,
      assetsRaw: assetsRaw?.toString() ?? null,
      assets: assetsRaw === null ? null : formatUnits(assetsRaw, variant.asset.decimals)
    }
  })
  const lockedIndex = vault.variants.findIndex(({ id }) => id === 'locked')
  if (lockedIndex >= 0) {
    const locked = variants[lockedIndex]
    const lockedAddress = vault.variants[lockedIndex]?.address
    if (locked && lockedAddress) {
      try {
        const [durationResult, windowResult, statusResult] = await Promise.all([
          readContract(vault.chainId, lockedAddress, yvUsdLocked.encodeFunctionData('cooldownDuration')),
          readContract(vault.chainId, lockedAddress, yvUsdLocked.encodeFunctionData('withdrawalWindow')),
          readContract(
            vault.chainId,
            lockedAddress,
            yvUsdLocked.encodeFunctionData('getCooldownStatus', [account])
          )
        ])
        const cooldownDuration = decodeUint(yvUsdLocked, 'cooldownDuration', durationResult)
        const withdrawalWindow = decodeUint(yvUsdLocked, 'withdrawalWindow', windowResult)
        if (!/^0x[0-9a-fA-F]{192}$/.test(statusResult)) {
          throw new Error('RPC returned an invalid cooldown value')
        }
        const [cooldownEndRaw, windowEndRaw, cooldownShares] = yvUsdLocked.decodeFunctionResult(
          'getCooldownStatus',
          statusResult
        ) as unknown as [bigint, bigint, bigint]
        const cooldownEnd = Number(cooldownEndRaw)
        const windowEnd = Number(windowEndRaw)
        const duration = Number(cooldownDuration)
        const window = Number(withdrawalWindow)
        const current = Math.floor(now() / 1000)
        if (![cooldownEnd, windowEnd, duration, window].every(Number.isSafeInteger)) {
          throw new Error('RPC returned an invalid cooldown value')
        }
        const status =
          cooldownShares === 0n
            ? ('none' as const)
            : current < cooldownEnd
              ? ('cooling-down' as const)
              : current <= windowEnd
                ? ('withdrawal-window' as const)
                : ('expired' as const)
        locked.cooldown = {
          status,
          sharesRaw: cooldownShares.toString(),
          shares: formatUnits(cooldownShares, locked.decimals),
          cooldownEnd,
          windowEnd,
          cooldownDuration: duration,
          withdrawalWindow: window
        }
      } catch (error) {
        errors.push(boundedError(error))
        locked.cooldown = null
      }
    }
  }
  const hasPosition = variants.some(
    ({ sharesRaw, cooldown }) => sharesRaw !== '0' || (cooldown?.sharesRaw || '0') !== '0'
  )

  return {
    vaultId: vault.id,
    chainId: vault.chainId,
    status: vault.status === 'unavailable' && hasPosition ? 'withdraw-only' : vault.status,
    hasPosition,
    assetBalanceRaw: assetBalanceRaw?.toString() ?? null,
    assetBalance: assetBalanceRaw === null ? null : formatUnits(assetBalanceRaw, vault.asset.decimals),
    variants,
    ...(errors.length > 0 && { error: errors[0] })
  }
}

export function createYearnPositionsService({
  getCatalog,
  getCurrentAccount,
  getNetworkStatus,
  readContract,
  now = Date.now
}: YearnPositionsDependencies) {
  return async (): Promise<YearnPositionsResult> => {
    const account = getCurrentAccount()
    const parsedAddress = account
      ? (() => {
          try {
            return getAddress(account.address)
          } catch {
            return null
          }
        })()
      : null
    const publicAccount = parsedAddress
      ? {
          address: parsedAddress,
          name: (account?.name || '').slice(0, 128),
          readOnly: isWatchOnlyAccountType(account?.lastSignerType)
        }
      : null
    const catalog = await getCatalog()

    const chains = await Promise.all(
      YEARN_CHAIN_IDS.map(async (chainId) => {
        if (!publicAccount) {
          return { chainId, status: 'no-account' as const, reason: 'Select an account', positions: [] }
        }
        const network = getNetworkStatus(chainId)
        if (!network?.on) {
          return { chainId, status: 'disabled' as const, reason: 'Enable this chain in Wren', positions: [] }
        }
        if (!network.connected) {
          return {
            chainId,
            status: 'disconnected' as const,
            reason: 'Wren is not connected to this chain',
            positions: []
          }
        }

        const vaults = catalog.vaults.filter((vault) => vault.chainId === chainId)
        const settled = await Promise.allSettled(
          vaults.map((vault) => readVaultPosition(vault, publicAccount.address, readContract, now))
        )
        const positions = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        const failed = settled.filter((result) => result.status === 'rejected')
        const partial = positions.some(({ error }) => Boolean(error)) || failed.length > 0
        const status = positions.length === 0 && failed.length > 0 ? 'error' : partial ? 'partial' : 'ready'
        const reason = failed[0]?.status === 'rejected' ? boundedError(failed[0].reason) : undefined

        return { chainId, status, positions, ...(reason && { reason }) }
      })
    )

    return YearnPositionsResultSchema.parse({ account: publicAccount, chains })
  }
}
