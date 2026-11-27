import { Interface } from 'ethers'

import { normalizeKongCatalog } from '../../../main/yearn/kong'
import { createYearnPositionsService } from '../../../main/yearn/positions'
import { makeKongVaultList } from './fixtures'

const account = '0x0000000000000000000000000000000000000001'
const erc20 = new Interface(['function balanceOf(address account) view returns (uint256)'])
const erc4626 = new Interface(['function convertToAssets(uint256 shares) view returns (uint256)'])
const yvUsdLocked = new Interface([
  'function cooldownDuration() view returns (uint256)',
  'function withdrawalWindow() view returns (uint256)',
  'function getCooldownStatus(address user) view returns (uint256 cooldownEnd,uint256 windowEnd,uint256 shares)'
])

const catalog = () => {
  const normalized = normalizeKongCatalog(makeKongVaultList(), 1234)
  return { status: 'fresh' as const, fetchedAt: 1234, vaults: normalized.cache.vaults, errors: [] }
}

const encodeUint = (contract: Interface, method: string, value: bigint) =>
  contract.encodeFunctionResult(method, [value])

const reader = (balances: Record<string, bigint> = {}) =>
  jest.fn(async (_chainId: number, address: string, data: string) => {
    if (data.startsWith(erc20.getFunction('balanceOf').selector)) {
      return encodeUint(erc20, 'balanceOf', balances[address.toLowerCase()] || 0n)
    }
    if (data.startsWith(yvUsdLocked.getFunction('cooldownDuration').selector)) {
      return encodeUint(yvUsdLocked, 'cooldownDuration', 14n * 24n * 60n * 60n)
    }
    if (data.startsWith(yvUsdLocked.getFunction('withdrawalWindow').selector)) {
      return encodeUint(yvUsdLocked, 'withdrawalWindow', 5n * 24n * 60n * 60n)
    }
    if (data.startsWith(yvUsdLocked.getFunction('getCooldownStatus').selector)) {
      return yvUsdLocked.encodeFunctionResult('getCooldownStatus', [0n, 0n, 0n])
    }
    const [shares] = erc4626.decodeFunctionData('convertToAssets', data)
    return encodeUint(erc4626, 'convertToAssets', shares * 2n)
  })

describe('Yearn account positions', () => {
  it('does not query RPCs without a selected account', async () => {
    const readContract = reader()
    const getPositions = createYearnPositionsService({
      getCatalog: async () => catalog(),
      getCurrentAccount: () => null,
      getNetworkStatus: () => ({ on: true, connected: true }),
      readContract
    })

    await expect(getPositions()).resolves.toMatchObject({
      account: null,
      chains: [
        { chainId: 1, status: 'no-account' },
        { chainId: 8453, status: 'no-account' }
      ]
    })
    expect(readContract).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'disconnected'])('isolates a %s chain', async (status) => {
    const readContract = reader()
    const getPositions = createYearnPositionsService({
      getCatalog: async () => catalog(),
      getCurrentAccount: () => ({ address: account, lastSignerType: 'ring' }),
      getNetworkStatus: (chainId) =>
        chainId === 1 ? { on: true, connected: true } : { on: status === 'disconnected', connected: false },
      readContract
    })

    const result = await getPositions()

    expect(result.chains.map(({ status }) => status)).toEqual(['ready', status])
    expect(new Set(readContract.mock.calls.map(([chainId]) => chainId))).toEqual(new Set([1]))
  })

  it('returns formatted assets and shares without losing watch-only status', async () => {
    const vault = catalog().vaults[0]
    if (!vault) throw new Error('Fixture vault missing')
    const readContract = reader({
      [vault.asset.address.toLowerCase()]: 5_000_000n,
      [vault.address.toLowerCase()]: 1_500_000n
    })
    const getPositions = createYearnPositionsService({
      getCatalog: async () => catalog(),
      getCurrentAccount: () => ({ address: account, name: 'Treasury', lastSignerType: 'address' }),
      getNetworkStatus: () => ({ on: true, connected: true }),
      readContract
    })

    const result = await getPositions()
    const position = result.chains[0]?.positions[0]

    expect(result.account).toMatchObject({ name: 'Treasury', readOnly: true })
    expect(position).toMatchObject({
      hasPosition: true,
      assetBalanceRaw: '5000000',
      assetBalance: '5.0'
    })
    expect(position?.variants[0]).toMatchObject({ id: 'unlocked', shares: '1.5', assets: '3.0' })
  })

  it('keeps an unavailable vault withdraw-only when the account owns shares', async () => {
    const unavailable = catalog()
    const baseIndex = unavailable.vaults.findIndex(({ chainId }) => chainId === 8453)
    const baseVault = unavailable.vaults[baseIndex]
    if (!baseVault) throw new Error('Fixture vault missing')
    unavailable.vaults[baseIndex] = { ...baseVault, status: 'unavailable', statusReason: 'Retired' }
    const getPositions = createYearnPositionsService({
      getCatalog: async () => unavailable,
      getCurrentAccount: () => ({ address: account, lastSignerType: 'ring' }),
      getNetworkStatus: () => ({ on: true, connected: true }),
      readContract: reader({ [baseVault.address.toLowerCase()]: 1n })
    })

    const result = await getPositions()
    expect(result.chains[1]?.positions[0]).toMatchObject({
      vaultId: baseVault.id,
      hasPosition: true,
      status: 'withdraw-only'
    })
  })

  it('reports a partial chain without blanking successful chains', async () => {
    const readContract = reader()
    readContract.mockImplementation(async (chainId, address, data) => {
      if (chainId === 8453) throw new Error('Base RPC failed')
      if (data.startsWith(erc20.getFunction('balanceOf').selector)) {
        return encodeUint(erc20, 'balanceOf', 0n)
      }
      if (data.startsWith(yvUsdLocked.getFunction('cooldownDuration').selector)) {
        return encodeUint(yvUsdLocked, 'cooldownDuration', 100n)
      }
      if (data.startsWith(yvUsdLocked.getFunction('withdrawalWindow').selector)) {
        return encodeUint(yvUsdLocked, 'withdrawalWindow', 50n)
      }
      if (data.startsWith(yvUsdLocked.getFunction('getCooldownStatus').selector)) {
        return yvUsdLocked.encodeFunctionResult('getCooldownStatus', [0n, 0n, 0n])
      }
      return encodeUint(erc4626, 'convertToAssets', 0n)
    })
    const getPositions = createYearnPositionsService({
      getCatalog: async () => catalog(),
      getCurrentAccount: () => ({ address: account, lastSignerType: 'ring' }),
      getNetworkStatus: () => ({ on: true, connected: true }),
      readContract
    })

    const result = await getPositions()
    expect(result.chains.map(({ status }) => status)).toEqual(['ready', 'partial'])
    expect(result.chains[1]?.positions[0]?.error).toBe('Base RPC failed')
  })

  it('reports locked yvUSD cooldown timing and treats escrowed shares as a position', async () => {
    const readContract = reader()
    readContract.mockImplementation(async (_chainId, _address, data) => {
      if (data.startsWith(erc20.getFunction('balanceOf').selector)) {
        return encodeUint(erc20, 'balanceOf', 0n)
      }
      if (data.startsWith(yvUsdLocked.getFunction('cooldownDuration').selector)) {
        return encodeUint(yvUsdLocked, 'cooldownDuration', 120n)
      }
      if (data.startsWith(yvUsdLocked.getFunction('withdrawalWindow').selector)) {
        return encodeUint(yvUsdLocked, 'withdrawalWindow', 60n)
      }
      if (data.startsWith(yvUsdLocked.getFunction('getCooldownStatus').selector)) {
        return yvUsdLocked.encodeFunctionResult('getCooldownStatus', [1_100n, 1_160n, 2_000_000n])
      }
      return encodeUint(erc4626, 'convertToAssets', 0n)
    })
    const getPositions = createYearnPositionsService({
      getCatalog: async () => catalog(),
      getCurrentAccount: () => ({ address: account, lastSignerType: 'ring' }),
      getNetworkStatus: (chainId) =>
        chainId === 1 ? { on: true, connected: true } : { on: false, connected: false },
      readContract,
      now: () => 1_050_000
    })

    const position = (await getPositions()).chains[0]?.positions[0]
    expect(position?.hasPosition).toBe(true)
    expect(position?.variants.find(({ id }) => id === 'locked')?.cooldown).toMatchObject({
      status: 'cooling-down',
      sharesRaw: '2000000',
      cooldownEnd: 1100,
      windowEnd: 1160,
      cooldownDuration: 120,
      withdrawalWindow: 60
    })
  })
})
