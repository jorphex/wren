import { Interface, getAddress } from 'ethers'

import {
  createYearnWorkflowService,
  YearnWorkflowReadInterfaces,
  type YearnQueuedResult
} from '../../../../main/yearn/workflows/service'
import { YEARN_CATALOG } from '../../../../main/yearn/catalog'
import type { YearnCatalogResult, YearnVault, YearnWorkflows } from '../../../../resources/domain/yearn'

const definition = YEARN_CATALOG.find(({ id }) => id === 'base-yvusdc-h')!
const account = getAddress('0x94112434c4c3ea14a4328a5d9383a00e78d772eb')
const otherAccount = getAddress('0x1111111111111111111111111111111111111111')
const asset = {
  address: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase()),
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6
}
const vault: YearnVault = {
  ...definition,
  symbol: 'yvUSDC-H',
  asset,
  decimals: 6,
  tvlUsd: 1,
  apy: { value: 0.05, label: 'Est. APY', source: 'fixture' },
  riskLevel: 4,
  riskLabel: 'Aggressive',
  performanceFeeBps: 0,
  managementFeeBps: 0,
  inceptionTime: 1,
  yearnUrl: `https://yearn.fi/vaults/${definition.chainId}/${definition.address}`,
  status: 'available',
  variants: [
    {
      id: 'direct',
      address: definition.address,
      name: definition.name,
      symbol: 'yvUSDC-H',
      asset,
      decimals: 6,
      tvlUsd: 1,
      apy: { value: 0.05, label: 'Est. APY', source: 'fixture' }
    }
  ]
}
const catalog = (status: YearnCatalogResult['status'] = 'fresh'): YearnCatalogResult => ({
  status,
  fetchedAt: 1,
  vaults: [vault],
  errors: []
})

const yvUsdDefinition = YEARN_CATALOG.find(({ id }) => id === 'ethereum-yvusd')!
const lockedDefinition = yvUsdDefinition.companions!.find(({ id }) => id === 'locked')!
const yvUsdVault: YearnVault = {
  ...yvUsdDefinition,
  symbol: 'yvUSD',
  asset: {
    address: getAddress('0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'.toLowerCase()),
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6
  },
  decimals: 6,
  tvlUsd: 1,
  apy: { value: 0.05, label: 'Est. APY', source: 'fixture' },
  riskLevel: 2,
  riskLabel: 'Moderate',
  performanceFeeBps: 0,
  managementFeeBps: 0,
  inceptionTime: 1,
  yearnUrl: `https://yearn.fi/vaults/1/${yvUsdDefinition.address}`,
  status: 'available',
  variants: [
    {
      id: 'unlocked',
      address: yvUsdDefinition.address,
      name: 'yvUSD',
      symbol: 'yvUSD',
      asset: {
        address: getAddress('0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'.toLowerCase()),
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6
      },
      decimals: 6,
      tvlUsd: 1,
      apy: { value: 0.05, label: 'Est. APY', source: 'fixture' }
    },
    {
      id: 'locked',
      address: lockedDefinition.address,
      name: 'Locked yvUSD',
      symbol: 'styvUSD',
      asset: {
        address: yvUsdDefinition.address,
        name: 'yvUSD',
        symbol: 'yvUSD',
        decimals: 6
      },
      decimals: 6,
      tvlUsd: 1,
      apy: { value: 0.07, label: 'Est. APY', source: 'fixture' }
    }
  ]
}

const yBoldDefinition = YEARN_CATALOG.find(({ id }) => id === 'ethereum-ybold')!
const stakedDefinition = yBoldDefinition.companions!.find(({ id }) => id === 'staked')!
const yBoldAsset = {
  address: getAddress(yBoldDefinition.asset.address.toLowerCase()),
  name: 'BOLD',
  symbol: 'BOLD',
  decimals: 18
}
const yBoldVault: YearnVault = {
  ...yBoldDefinition,
  symbol: 'ysyBOLD',
  asset: yBoldAsset,
  tvlUsd: 1,
  apy: { value: 0.05, label: 'Est. APY', source: 'fixture' },
  riskLevel: 2,
  riskLabel: 'Moderate',
  performanceFeeBps: 0,
  managementFeeBps: 0,
  inceptionTime: 1,
  yearnUrl: `https://yearn.fi/vaults/1/${yBoldDefinition.address}`,
  status: 'available',
  variants: [
    {
      id: 'direct',
      address: yBoldDefinition.address,
      name: 'yBOLD',
      symbol: 'yBOLD',
      asset: yBoldAsset,
      decimals: 18,
      tvlUsd: 1,
      apy: { value: 0.04, label: 'Est. APY', source: 'fixture' }
    },
    {
      id: 'staked',
      address: stakedDefinition.address,
      name: 'Staked yBOLD',
      symbol: 'ysyBOLD',
      asset: {
        address: yBoldDefinition.address,
        name: 'yBOLD',
        symbol: 'yBOLD',
        decimals: 18
      },
      decimals: 18,
      tvlUsd: 1,
      apy: { value: 0.05, label: 'Est. APY', source: 'fixture' }
    }
  ]
}

const erc20 = YearnWorkflowReadInterfaces.erc20
const erc4626 = YearnWorkflowReadInterfaces.erc4626
const yvUsdLocked = YearnWorkflowReadInterfaces.yvUsdLocked
const erc4626Writes = new Interface([
  'function withdraw(uint256 assets,address receiver,address owner) returns (uint256)',
  'function redeem(uint256 shares,address receiver,address owner) returns (uint256)'
])
const selector = (contract: Interface, method: string) => contract.getFunction(method)!.selector
const flushMicrotasks = async () => {
  for (let index = 0; index < 32; index += 1) await Promise.resolve()
}

function setup(
  options: {
    readOnly?: boolean
    catalogStatus?: YearnCatalogResult['status']
    delayedAdmission?: boolean
    delayedReceipt?: boolean
    assetDecimals?: number
    vaultDecimals?: number
    fullBalanceRedeem?: boolean
    savedWorkflows?: YearnWorkflows
  } = {}
) {
  let workflows: YearnWorkflows = options.savedWorkflows ?? {}
  let selectedAccount = account
  let readOnly = options.readOnly === true
  let clock = 10
  let allowance = 0n
  let tokenBalance = 100_000_000n
  let shareBalance = 50_000_000n
  let maxRedeem: bigint | null = null
  let maxRedeemSequence: bigint[] = []
  let maxDeposit = 100_000_000n
  let maxWithdraw = 45_000_000n
  let catalogStatus = options.catalogStatus || 'fresh'
  let releaseAdmission: (() => void) | undefined
  let releaseReceipt: (() => void) | undefined
  const queued: Array<{
    transaction: { chainId: number; account: string; target: string; data: string }
    respond: (result: YearnQueuedResult) => void
  }> = []
  const receipts = new Map<string, unknown>()
  const getReceipt = jest.fn(async (_chainId: number, hash: string) => {
    if (options.delayedReceipt) {
      await new Promise<void>((resolve) => {
        releaseReceipt = resolve
      })
    }
    return receipts.get(hash) ?? null
  })
  const readContract = jest.fn(async (_chainId: number, target: string, data: string) => {
    if (data.startsWith(selector(erc4626, 'asset'))) {
      return erc4626.encodeFunctionResult('asset', [asset.address])
    }
    if (data.startsWith(selector(erc20, 'allowance'))) {
      return erc20.encodeFunctionResult('allowance', [allowance])
    }
    if (data.startsWith(selector(erc20, 'decimals'))) {
      const decimals =
        target.toLowerCase() === asset.address.toLowerCase()
          ? (options.assetDecimals ?? 6)
          : (options.vaultDecimals ?? 6)
      return erc20.encodeFunctionResult('decimals', [decimals])
    }
    if (data.startsWith(selector(erc4626, 'maxWithdraw'))) {
      return erc4626.encodeFunctionResult('maxWithdraw', [maxWithdraw])
    }
    if (data.startsWith(selector(erc4626, 'maxRedeem'))) {
      return erc4626.encodeFunctionResult('maxRedeem', [
        maxRedeemSequence.shift() ?? maxRedeem ?? shareBalance
      ])
    }
    if (data.startsWith(selector(erc4626, 'maxDeposit'))) {
      return erc4626.encodeFunctionResult('maxDeposit', [maxDeposit])
    }
    if (data.startsWith(selector(erc4626, 'previewRedeem'))) {
      const [shares] = erc4626.decodeFunctionData('previewRedeem', data)
      return erc4626.encodeFunctionResult('previewRedeem', [shares])
    }
    if (data.startsWith(selector(erc20, 'balanceOf'))) {
      const value = target.toLowerCase() === asset.address.toLowerCase() ? tokenBalance : shareBalance
      return erc20.encodeFunctionResult('balanceOf', [value])
    }
    throw new Error('Unexpected contract call')
  })
  const simulateContract = jest.fn(async (_chainId: number, _target: string, data: string, _from: string) => {
    const [shares] = erc4626.decodeFunctionData('redeem', data)
    const capacity = maxRedeemSequence[0] ?? maxRedeem ?? shareBalance
    if (options.fullBalanceRedeem !== true && shares > capacity) {
      throw new Error('ERC-4626 redeem exceeds maxRedeem')
    }
    return erc4626.encodeFunctionResult('redeem', [shares])
  })
  const createService = () =>
    createYearnWorkflowService({
      getCatalog: async () => catalog(catalogStatus),
      getCurrentAccount: () => ({
        id: selectedAccount,
        lastSignerType: readOnly ? 'watch' : 'ring'
      }),
      getNetworkStatus: () => ({ on: true, connected: true }),
      readContract,
      simulateContract,
      getReceipt,
      queueTransaction: async (transaction, respond) => {
        queued.push({ transaction, respond })
        if (options.delayedAdmission) {
          await new Promise<void>((resolve) => {
            releaseAdmission = resolve
          })
        }
      },
      readWorkflows: () => workflows,
      writeWorkflows: (next) => {
        workflows = next
      },
      now: () => ++clock
    })
  const service = createService()
  return {
    service,
    restartService: createService,
    queued,
    receipts,
    getReceipt,
    readContract,
    simulateContract,
    workflows: () => workflows,
    setAllowance: (value: bigint) => (allowance = value),
    setTokenBalance: (value: bigint) => (tokenBalance = value),
    setShareBalance: (value: bigint) => (shareBalance = value),
    setMaxRedeem: (value: bigint) => (maxRedeem = value),
    setMaxRedeemSequence: (values: bigint[]) => (maxRedeemSequence = [...values]),
    setMaxDeposit: (value: bigint) => (maxDeposit = value),
    setMaxWithdraw: (value: bigint) => (maxWithdraw = value),
    setCatalogStatus: (value: YearnCatalogResult['status']) => (catalogStatus = value),
    releaseAdmission: () => releaseAdmission?.(),
    releaseReceipt: () => releaseReceipt?.(),
    setSelectedAccount: (value: string) => (selectedAccount = getAddress(value)),
    setReadOnly: (value: boolean) => (readOnly = value)
  }
}

function setupLocked() {
  let workflows: YearnWorkflows = {}
  let cooldownShares = 0n
  const receipts = new Map<string, unknown>()
  const queued: Array<{
    transaction: { chainId: number; account: string; target: string; data: string }
    respond: (result: YearnQueuedResult) => void
  }> = []
  const readContract = jest.fn(async (_chainId: number, target: string, data: string) => {
    const root = target.toLowerCase() === yvUsdVault.address.toLowerCase()
    if (data.startsWith(selector(erc4626, 'asset'))) {
      return erc4626.encodeFunctionResult('asset', [root ? yvUsdVault.asset.address : yvUsdVault.address])
    }
    if (data.startsWith(selector(yvUsdLocked, 'getCooldownStatus'))) {
      return yvUsdLocked.encodeFunctionResult('getCooldownStatus', [0n, 0n, cooldownShares])
    }
    if (data.startsWith(selector(erc20, 'decimals'))) {
      return erc20.encodeFunctionResult('decimals', [6])
    }
    if (data.startsWith(selector(erc4626, 'maxWithdraw'))) {
      return erc4626.encodeFunctionResult('maxWithdraw', [5_000_000n])
    }
    if (data.startsWith(selector(erc4626, 'maxDeposit'))) {
      return erc4626.encodeFunctionResult('maxDeposit', [5_000_000n])
    }
    if (data.startsWith(selector(erc4626, 'maxRedeem'))) {
      return erc4626.encodeFunctionResult('maxRedeem', [2_000_000n])
    }
    if (data.startsWith(selector(erc4626, 'previewWithdraw'))) {
      const [amount] = erc4626.decodeFunctionData('previewWithdraw', data)
      return erc4626.encodeFunctionResult('previewWithdraw', [root ? amount + 100_000n : amount + 50_000n])
    }
    if (data.startsWith(selector(erc4626, 'previewDeposit'))) {
      const [amount] = erc4626.decodeFunctionData('previewDeposit', data)
      return erc4626.encodeFunctionResult('previewDeposit', [amount])
    }
    if (data.startsWith(selector(erc4626, 'previewRedeem'))) {
      const [amount] = erc4626.decodeFunctionData('previewRedeem', data)
      return erc4626.encodeFunctionResult('previewRedeem', [amount - 100_000n])
    }
    if (data.startsWith(selector(erc20, 'balanceOf'))) {
      return erc20.encodeFunctionResult('balanceOf', [2_000_000n])
    }
    if (data.startsWith(selector(erc20, 'allowance'))) {
      return erc20.encodeFunctionResult('allowance', [0n])
    }
    throw new Error('Unexpected contract call')
  })
  const service = createYearnWorkflowService({
    getCatalog: async () => ({ status: 'fresh', fetchedAt: 1, vaults: [yvUsdVault], errors: [] }),
    getCurrentAccount: () => ({ id: account, lastSignerType: 'ring' }),
    getNetworkStatus: () => ({ on: true, connected: true }),
    readContract,
    simulateContract: readContract,
    getReceipt: async (_chainId, hash) => receipts.get(hash) ?? null,
    queueTransaction: async (transaction, respond) => queued.push({ transaction, respond }),
    readWorkflows: () => workflows,
    writeWorkflows: (next) => (workflows = next),
    now: () => 10
  })
  return {
    service,
    queued,
    readContract,
    receipts,
    workflows: () => workflows,
    setCooldownShares: (value: bigint) => (cooldownShares = value)
  }
}

function setupYBold() {
  let workflows: YearnWorkflows = {}
  let allowance = 0n
  let capacity = 10n ** 20n
  const receipts = new Map<string, unknown>()
  const queued: Array<{
    transaction: { chainId: number; account: string; target: string; data: string }
    respond: (result: YearnQueuedResult) => void
  }> = []
  const readContract = jest.fn(async (_chainId: number, target: string, data: string) => {
    const root = target.toLowerCase() === yBoldDefinition.address.toLowerCase()
    if (data.startsWith(selector(erc4626, 'asset'))) {
      return erc4626.encodeFunctionResult('asset', [root ? yBoldAsset.address : yBoldDefinition.address])
    }
    if (data.startsWith(selector(erc20, 'decimals'))) {
      return erc20.encodeFunctionResult('decimals', [18])
    }
    if (data.startsWith(selector(erc20, 'balanceOf'))) {
      return erc20.encodeFunctionResult('balanceOf', [10n ** 20n])
    }
    if (data.startsWith(selector(erc20, 'allowance'))) {
      return erc20.encodeFunctionResult('allowance', [allowance])
    }
    if (data.startsWith(selector(erc4626, 'maxDeposit'))) {
      return erc4626.encodeFunctionResult('maxDeposit', [capacity])
    }
    throw new Error('Unexpected contract call')
  })
  const service = createYearnWorkflowService({
    getCatalog: async () => ({ status: 'fresh', fetchedAt: 1, vaults: [yBoldVault], errors: [] }),
    getCurrentAccount: () => ({ id: account, lastSignerType: 'ring' }),
    getNetworkStatus: () => ({ on: true, connected: true }),
    readContract,
    simulateContract: readContract,
    getReceipt: async (_chainId, hash) => receipts.get(hash) ?? null,
    queueTransaction: async (transaction, respond) => queued.push({ transaction, respond }),
    readWorkflows: () => workflows,
    writeWorkflows: (next) => (workflows = next),
    now: () => 10
  })
  return {
    service,
    queued,
    receipts,
    setAllowance: (value: bigint) => (allowance = value),
    setCapacity: (value: bigint) => (capacity = value)
  }
}

const depositRequest = {
  vaultId: vault.id,
  action: 'deposit' as const,
  variant: 'direct' as const,
  amount: '12.5',
  max: false
}

it('keeps saved Katana workflows out of Earn without changing their records', async () => {
  const initial = setup()
  const workflow = await initial.service.start(depositRequest)
  initial.queued[0].respond({ hash: `0x${'a'.repeat(64)}` })
  const retired = {
    ...initial.workflows()[workflow.id],
    chainId: 747474 as const,
    vaultId: 'katana-yvvbusdc'
  }
  const { service, getReceipt, queued, workflows } = setup({ savedWorkflows: { [retired.id]: retired } })

  await expect(service.list()).resolves.toEqual({ workflows: [] })
  await expect(
    service.start({ ...depositRequest, vaultId: retired.vaultId, action: 'withdraw' })
  ).rejects.toThrow("Vault is not in Wren's curated Yearn catalog")
  await expect(service.resume({ id: retired.id })).rejects.toThrow('Yearn workflow was not found')
  await expect(service.revoke({ id: retired.id })).rejects.toThrow('Yearn workflow was not found')
  expect(getReceipt).not.toHaveBeenCalled()
  expect(queued).toHaveLength(0)

  const active = await service.start(depositRequest)
  await expect(service.list()).resolves.toEqual({ workflows: [active] })
  expect(workflows()[retired.id]).toEqual(retired)
})

it('queues an exact approval and advances only after a matching successful receipt', async () => {
  const subject = setup()
  const started = await subject.service.start(depositRequest)

  expect(started.status).toBe('active')
  expect(started.steps.map(({ kind, status }) => [kind, status])).toEqual([
    ['approve', 'awaiting-review'],
    ['deposit', 'pending']
  ])
  expect(subject.queued).toHaveLength(1)
  subject.queued[0].respond({ hash: `0x${'ab'.repeat(32)}` })
  expect(subject.workflows()[started.id].status).toBe('waiting-confirmation')

  subject.receipts.set(`0x${'ab'.repeat(32)}`, {
    transactionHash: `0x${'ab'.repeat(32)}`,
    status: '0x1'
  })
  const listed = await subject.service.list()
  const approved = listed.workflows.find(({ id }) => id === started.id)!
  expect(approved.steps.map(({ status }) => status)).toEqual(['confirmed', 'ready'])

  subject.setAllowance(12_500_000n)
  const resumed = await subject.service.resume({ id: started.id })
  expect(resumed.steps[1].status).toBe('awaiting-review')
  expect(subject.queued[1].transaction.target).toBe(getAddress(vault.address.toLowerCase()))
  expect(
    subject.readContract.mock.calls.filter(([, , data]) => data.startsWith(selector(erc4626, 'asset')))
  ).toHaveLength(3)
})

it('keeps polling from detaching a request while provider admission is in progress', async () => {
  const subject = setup({ delayedAdmission: true })
  const starting = subject.service.start(depositRequest)
  await flushMicrotasks()
  expect(subject.queued).toHaveLength(1)

  const [duringAdmission] = (await subject.service.list()).workflows
  expect(duringAdmission.status).toBe('active')
  expect(duringAdmission.steps[0].status).toBe('awaiting-review')

  subject.releaseAdmission()
  await expect(starting).resolves.toMatchObject({ status: 'active' })
})

it('keeps an admitted current-process request attached while the provider callback is pending', async () => {
  const subject = setup()
  const started = await subject.service.start(depositRequest)

  const [listed] = (await subject.service.list()).workflows
  expect(listed).toMatchObject({ id: started.id, status: 'active' })
  expect(listed.steps[0].status).toBe('awaiting-review')
})

it('uses executable on-chain capacity for a Max direct withdrawal', async () => {
  const subject = setup()
  subject.setShareBalance(77n)
  subject.setMaxRedeem(72n)
  const started = await subject.service.start({
    vaultId: vault.id,
    action: 'withdraw',
    variant: 'direct',
    amount: '0',
    max: true
  })

  expect(started.amountRaw).toBe('72')
  expect(started.displayAmount).toBe('0.000072')
  expect(started.symbol).toBe('USDC')
  expect(started.steps).toHaveLength(1)
  expect(started.steps[0].kind).toBe('redeem')
  expect(erc4626Writes.decodeFunctionData('redeem', started.steps[0].data)[0]).toBe(72n)
})

it('redeems the complete share balance when maxRedeem rounds below an executable full exit', async () => {
  const subject = setup({ fullBalanceRedeem: true })
  subject.setShareBalance(919_866n)
  subject.setMaxRedeem(919_865n)
  const started = await subject.service.start({
    vaultId: vault.id,
    action: 'withdraw',
    variant: 'direct',
    amount: '0',
    max: true
  })

  expect(started.amountRaw).toBe('919866')
  expect(started.steps[0].kind).toBe('redeem')
  expect(erc4626Writes.decodeFunctionData('redeem', started.steps[0].data)[0]).toBe(919_866n)
  expect(subject.simulateContract).toHaveBeenCalledTimes(2)
})

it('does not retain a workflow when initial withdrawal capacity changes before queueing', async () => {
  const subject = setup()
  subject.setMaxRedeemSequence([72n, 71n])

  await expect(
    subject.service.start({
      vaultId: vault.id,
      action: 'withdraw',
      variant: 'direct',
      amount: '0.000072',
      max: true
    })
  ).rejects.toThrow('withdrawal capacity changed')

  expect(subject.workflows()).toEqual({})
  expect(subject.queued).toHaveLength(0)
})

it('quotes locked yvUSD exits across the locked and unlocked vaults', async () => {
  const exact = setupLocked()
  const exactWorkflow = await exact.service.start({
    vaultId: yvUsdVault.id,
    action: 'withdraw',
    variant: 'locked',
    amount: '1',
    max: false
  })
  expect(exactWorkflow.steps.map(({ kind, amountRaw }) => [kind, amountRaw])).toEqual([
    ['withdraw', '1100000'],
    ['withdraw', '1000000']
  ])
  expect(erc4626Writes.decodeFunctionData('withdraw', exactWorkflow.steps[0].data)[0]).toBe(1_100_000n)
  expect(erc4626Writes.decodeFunctionData('withdraw', exactWorkflow.steps[1].data)[0]).toBe(1_000_000n)

  const max = setupLocked()
  const maxWorkflow = await max.service.start({
    vaultId: yvUsdVault.id,
    action: 'withdraw',
    variant: 'locked',
    amount: '0',
    max: true
  })
  expect(maxWorkflow.amountRaw).toBe('1800000')
  expect(maxWorkflow.steps.map(({ kind, amountRaw }) => [kind, amountRaw])).toEqual([
    ['redeem', '2000000'],
    ['redeem', '1900000']
  ])
})

it('converts an exact locked yvUSD cooldown amount into locked shares', async () => {
  const subject = setupLocked()
  const workflow = await subject.service.start({
    vaultId: yvUsdVault.id,
    action: 'start-cooldown',
    variant: 'locked',
    amount: '1',
    max: false
  })

  expect(workflow.amountRaw).toBe('1000000')
  expect(workflow.steps).toHaveLength(1)
  expect(workflow.steps[0]).toMatchObject({ kind: 'start-cooldown', amountRaw: '1150000' })
})

it('requires known on-chain cooldown state before starting or canceling', async () => {
  const active = setupLocked()
  active.setCooldownShares(10n)
  await expect(
    active.service.start({
      vaultId: yvUsdVault.id,
      action: 'start-cooldown',
      variant: 'locked',
      amount: '1',
      max: false
    })
  ).rejects.toThrow('Cancel the existing')

  const inactive = setupLocked()
  await expect(
    inactive.service.start({
      vaultId: yvUsdVault.id,
      action: 'cancel-cooldown',
      variant: 'locked',
      amount: '0',
      max: false
    })
  ).rejects.toThrow('no active cooldown')
})

it('checks both root and locked capacity before a locked yvUSD deposit', async () => {
  const subject = setupLocked()
  const workflow = await subject.service.start({
    vaultId: yvUsdVault.id,
    action: 'deposit',
    variant: 'locked',
    amount: '1',
    max: false
  })

  expect(workflow.steps.map(({ kind }) => kind)).toEqual(['approve', 'deposit'])
  const capacityTargets = subject.readContract.mock.calls
    .filter(([, , data]) => data.startsWith(selector(erc4626, 'maxDeposit')))
    .map(([, target]) => target.toLowerCase())
  expect(capacityTargets).toEqual([yvUsdVault.address.toLowerCase(), lockedDefinition.address.toLowerCase()])
})

it('binds the second locked Max redeem to yvUSD proven by the first receipt', async () => {
  const subject = setupLocked()
  const workflow = await subject.service.start({
    vaultId: yvUsdVault.id,
    action: 'withdraw',
    variant: 'locked',
    amount: '0',
    max: true
  })
  const hash = `0x${'34'.repeat(32)}`
  const received = 1_850_000n
  const transfer = erc20.encodeEventLog(erc20.getEvent('Transfer')!, [
    lockedDefinition.address,
    account,
    received
  ])
  subject.queued[0].respond({ hash })
  subject.receipts.set(hash, {
    transactionHash: hash,
    status: '0x1',
    logs: [{ address: yvUsdVault.address, ...transfer }]
  })

  const [confirmed] = (await subject.service.list()).workflows
  expect(confirmed).toMatchObject({ status: 'ready', currentStep: 1 })
  expect(confirmed.steps[1].amountRaw).toBe(received.toString())
  expect(erc4626Writes.decodeFunctionData('redeem', confirmed.steps[1].data)[0]).toBe(received)
  expect(subject.workflows()[workflow.id].steps[1].amountRaw).toBe(received.toString())
})

it('stops safely at unlocked yvUSD when a locked Max receipt has no transfer evidence', async () => {
  const subject = setupLocked()
  const workflow = await subject.service.start({
    vaultId: yvUsdVault.id,
    action: 'withdraw',
    variant: 'locked',
    amount: '0',
    max: true
  })
  const hash = `0x${'56'.repeat(32)}`
  subject.queued[0].respond({ hash })
  subject.receipts.set(hash, { transactionHash: hash, status: '0x1', logs: [] })

  const [stopped] = (await subject.service.list()).workflows
  expect(stopped).toMatchObject({ status: 'canceled', currentStep: 1 })
  expect(stopped.error).toMatch(/manage the yvUSD position separately/)
  expect(subject.queued).toHaveLength(1)
  expect(subject.workflows()[workflow.id].status).toBe('canceled')
})

it('rejects unsafe account, balance, and deposit data while allowing stale exits', async () => {
  await expect(setup({ readOnly: true }).service.start(depositRequest)).rejects.toThrow('Watch-only')

  const insufficient = setup()
  insufficient.setTokenBalance(1n)
  await expect(insufficient.service.start(depositRequest)).rejects.toThrow('Insufficient')

  await expect(setup({ catalogStatus: 'stale' }).service.start(depositRequest)).rejects.toThrow(
    'Fresh eligible'
  )
  await expect(
    setup({ catalogStatus: 'stale' }).service.start({
      vaultId: vault.id,
      action: 'stake',
      variant: 'direct',
      amount: '1',
      max: false
    })
  ).rejects.toThrow('Fresh eligible')
  await expect(
    setup({ catalogStatus: 'stale' }).service.start({
      vaultId: vault.id,
      action: 'withdraw',
      variant: 'direct',
      amount: '1',
      max: false
    })
  ).resolves.toMatchObject({ action: 'withdraw', status: 'active' })
})

it('rejects on-chain decimal mismatches before building calldata', async () => {
  await expect(setup({ assetDecimals: 18 }).service.start(depositRequest)).rejects.toThrow(
    'On-chain decimals'
  )
  await expect(setup({ vaultDecimals: 18 }).service.start(depositRequest)).rejects.toThrow(
    'On-chain decimals'
  )
})

it('rechecks eligibility and capacity after approval before admitting a deposit', async () => {
  const stale = setup()
  const staleWorkflow = await stale.service.start(depositRequest)
  const approvalHash = `0x${'71'.repeat(32)}`
  stale.queued[0].respond({ hash: approvalHash })
  stale.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await stale.service.list()
  stale.setAllowance(12_500_000n)
  stale.setCatalogStatus('stale')
  await expect(stale.service.resume({ id: staleWorkflow.id })).rejects.toThrow('Fresh eligible')
  expect(stale.queued).toHaveLength(1)

  const capped = setup()
  const cappedWorkflow = await capped.service.start(depositRequest)
  const cappedHash = `0x${'72'.repeat(32)}`
  capped.queued[0].respond({ hash: cappedHash })
  capped.receipts.set(cappedHash, { transactionHash: cappedHash, status: '0x1', logs: [] })
  await capped.service.list()
  capped.setAllowance(12_500_000n)
  capped.setMaxDeposit(12_499_999n)
  await expect(capped.service.resume({ id: cappedWorkflow.id })).rejects.toThrow('cannot currently accept')
  expect(capped.queued).toHaveLength(1)

  const spent = setup()
  const spentWorkflow = await spent.service.start(depositRequest)
  const spentHash = `0x${'74'.repeat(32)}`
  spent.queued[0].respond({ hash: spentHash })
  spent.receipts.set(spentHash, { transactionHash: spentHash, status: '0x1', logs: [] })
  await spent.service.list()
  spent.setAllowance(12_500_000n)
  spent.setTokenBalance(1n)
  await expect(spent.service.resume({ id: spentWorkflow.id })).rejects.toThrow('Insufficient USDC')
  expect(spent.queued).toHaveLength(1)
})

it('rechecks staking-wrapper capacity after approving yBOLD', async () => {
  const subject = setupYBold()
  const workflow = await subject.service.start({
    vaultId: yBoldVault.id,
    action: 'stake',
    variant: 'direct',
    amount: '1',
    max: false
  })
  const approvalHash = `0x${'77'.repeat(32)}`
  subject.queued[0].respond({ hash: approvalHash })
  subject.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await subject.service.list()
  subject.setAllowance(10n ** 18n)
  subject.setCapacity(10n ** 18n - 1n)

  await expect(subject.service.resume({ id: workflow.id })).rejects.toThrow(
    'cannot currently accept this stake'
  )
  expect(subject.queued).toHaveLength(1)
})

it('keeps a submitted workflow pending across transient or malformed receipt responses', async () => {
  const subject = setup()
  subject.setAllowance(12_500_000n)
  await subject.service.start(depositRequest)
  const hash = `0x${'cd'.repeat(32)}`
  subject.queued[0].respond({ hash })
  subject.receipts.set(hash, { transactionHash: `0x${'ef'.repeat(32)}`, status: '0x1' })

  const [workflow] = (await subject.service.list()).workflows
  expect(workflow.status).toBe('waiting-confirmation')
  expect(workflow.error).toMatch(/did not match/)
})

it('serializes receipt synchronization against resume', async () => {
  const subject = setup({ delayedReceipt: true })
  subject.setAllowance(12_500_000n)
  const workflow = await subject.service.start(depositRequest)
  const hash = `0x${'73'.repeat(32)}`
  subject.queued[0].respond({ hash })
  subject.receipts.set(hash, { transactionHash: hash, status: '0x1', logs: [] })

  const syncing = subject.service.list()
  await flushMicrotasks()
  await expect(subject.service.resume({ id: workflow.id })).rejects.toThrow('already being updated')
  subject.releaseReceipt()
  await expect(syncing).resolves.toMatchObject({ workflows: [{ status: 'complete' }] })
})

it('stores bounded account transfer evidence from successful receipts', async () => {
  const subject = setup()
  subject.setAllowance(12_500_000n)
  await subject.service.start(depositRequest)
  const hash = `0x${'74'.repeat(32)}`
  const assetOut = erc20.encodeEventLog(erc20.getEvent('Transfer')!, [account, vault.address, 12_500_000n])
  const sharesIn = erc20.encodeEventLog(erc20.getEvent('Transfer')!, [
    '0x0000000000000000000000000000000000000000',
    account,
    12_000_000n
  ])
  subject.queued[0].respond({ hash })
  subject.receipts.set(hash, {
    transactionHash: hash,
    status: '0x1',
    logs: [
      { address: asset.address, ...assetOut },
      { address: vault.address, ...sharesIn },
      { address: otherAccount, ...sharesIn }
    ]
  })

  const [confirmed] = (await subject.service.list()).workflows
  expect(confirmed.steps[0].receiptTransfers).toEqual([
    {
      token: asset.address,
      direction: 'out',
      amountRaw: '12500000',
      symbol: 'USDC',
      decimals: 6
    },
    {
      token: getAddress(vault.address.toLowerCase()),
      direction: 'in',
      amountRaw: '12000000',
      symbol: vault.name,
      decimals: 6
    }
  ])
  expect(confirmed.steps[0].receiptTransfersTruncated).toBeUndefined()
})

it('persists rejection for retry and cleans up a confirmed approval before canceling its parent', async () => {
  const subject = setup()
  const rejected = await subject.service.start(depositRequest)
  subject.queued[0].respond({ error: 'User rejected the request' })
  expect(subject.workflows()[rejected.id]).toMatchObject({ status: 'error' })
  await expect(subject.service.resume({ id: rejected.id })).resolves.toMatchObject({ status: 'active' })

  const hash = `0x${'11'.repeat(32)}`
  subject.queued[1].respond({ hash })
  subject.receipts.set(hash, { transactionHash: hash, status: '0x1' })
  await subject.service.list()
  expect(() => subject.service.cancel({ id: rejected.id })).toThrow('Revoke')

  const cleanup = await subject.service.revoke({ id: rejected.id })
  expect(cleanup.action).toBe('revoke')
  const revokeHash = `0x${'22'.repeat(32)}`
  subject.queued[2].respond({ hash: revokeHash })
  subject.receipts.set(revokeHash, { transactionHash: revokeHash, status: '0x1' })
  await subject.service.list()
  expect(subject.workflows()[rejected.id].status).toBe('canceled')
})

it('does not close or revoke a workflow while its request remains independently signable', async () => {
  const subject = setup()
  const workflow = await subject.service.start(depositRequest)
  expect(() => subject.service.cancel({ id: workflow.id })).toThrow('awaiting review')

  const approvalHash = `0x${'75'.repeat(32)}`
  subject.queued[0].respond({ hash: approvalHash })
  subject.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await subject.service.list()
  subject.setAllowance(12_500_000n)
  await subject.service.resume({ id: workflow.id })

  await expect(subject.service.revoke({ id: workflow.id })).rejects.toThrow('Wait for the current')
  expect(() => subject.service.cancel({ id: workflow.id })).toThrow('awaiting review')
  expect(subject.queued).toHaveLength(2)
})

it('keeps approval cleanup available when current catalog data degrades', async () => {
  const subject = setup()
  const workflow = await subject.service.start(depositRequest)
  const approvalHash = `0x${'76'.repeat(32)}`
  subject.queued[0].respond({ hash: approvalHash })
  subject.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await subject.service.list()
  subject.setAllowance(12_500_000n)
  await subject.service.resume({ id: workflow.id })
  subject.queued[1].respond({ error: 'User rejected the deposit' })
  subject.setCatalogStatus('unavailable')

  const cleanup = await subject.service.revoke({ id: workflow.id })
  expect(cleanup).toMatchObject({ action: 'revoke', status: 'active' })
  expect(subject.queued[2].transaction.target).toBe(asset.address)
  expect(subject.workflows()[workflow.id]).toMatchObject({
    status: 'canceled',
    error: 'Approval cleanup in progress'
  })
})

it('does not clear the parent when a confirmed cleanup leaves allowance nonzero', async () => {
  const subject = setup()
  const workflow = await subject.service.start(depositRequest)
  const approvalHash = `0x${'78'.repeat(32)}`
  subject.queued[0].respond({ hash: approvalHash })
  subject.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await subject.service.list()
  subject.setAllowance(12_500_000n)
  const cleanup = await subject.service.revoke({ id: workflow.id })
  const revokeHash = `0x${'79'.repeat(32)}`
  subject.queued[1].respond({ hash: revokeHash })
  subject.receipts.set(revokeHash, { transactionHash: revokeHash, status: '0x1', logs: [] })

  await subject.service.list()
  expect(subject.workflows()[cleanup.id]).toMatchObject({
    status: 'canceled',
    error: expect.stringContaining('allowance remains nonzero')
  })
  expect(subject.workflows()[workflow.id]).toMatchObject({
    status: 'canceled',
    error: expect.stringContaining('allowance remains nonzero')
  })
})

it('rejects exact direct withdrawals above maxWithdraw', async () => {
  const subject = setup()
  subject.setMaxWithdraw(999_999n)
  await expect(
    subject.service.start({
      vaultId: vault.id,
      action: 'withdraw',
      variant: 'direct',
      amount: '1',
      max: false
    })
  ).rejects.toThrow('exceeds')
})

it('rejects deposits above the current on-chain capacity', async () => {
  const subject = setup()
  subject.setMaxDeposit(12_499_999n)
  await expect(subject.service.start(depositRequest)).rejects.toThrow('cannot currently accept')
  expect(subject.queued).toHaveLength(0)
})

it('fails closed instead of retrying an awaiting-review request with an unknown restart outcome', async () => {
  const subject = setup()
  const started = await subject.service.start(depositRequest)
  const restarted = subject.restartService()

  const [recovered] = (await restarted.list()).workflows
  expect(recovered).toMatchObject({
    id: started.id,
    status: 'canceled',
    error: expect.stringContaining('outcome is unknown')
  })
  expect(recovered.steps[0]).toMatchObject({
    status: 'error',
    error: expect.stringContaining('verify the account on-chain')
  })

  await expect(restarted.resume({ id: started.id })).rejects.toThrow('cannot be resumed')
  expect(subject.queued).toHaveLength(1)
})

it('exposes and mutates workflows only for the selected owner', async () => {
  const subject = setup()
  const started = await subject.service.start(depositRequest)
  subject.setSelectedAccount(otherAccount)

  expect((await subject.service.list()).workflows).toEqual([])
  expect(subject.workflows()[started.id].status).toBe('active')
  expect(() => subject.service.cancel({ id: started.id })).toThrow('owns this Yearn workflow')
  await expect(subject.service.revoke({ id: started.id })).rejects.toThrow('owns this Yearn workflow')
})

it('does not resume a persisted workflow through a watch-only account', async () => {
  const subject = setup()
  const started = await subject.service.start(depositRequest)
  subject.setReadOnly(true)

  await expect(subject.service.resume({ id: started.id })).rejects.toThrow('Watch-only')
  expect(subject.queued).toHaveLength(1)
})

it('refuses to evict an active workflow when the persistence bound is full', async () => {
  const subject = setup()
  for (let index = 0; index < 64; index += 1) {
    await subject.service.start({ ...depositRequest, amount: String(index + 1) })
  }

  await expect(subject.service.start({ ...depositRequest, amount: '65' })).rejects.toThrow(
    'Close an existing Yearn workflow'
  )
  expect(Object.keys(subject.workflows())).toHaveLength(64)
  expect(subject.queued).toHaveLength(64)
})

it('keeps approval cleanup executable when adding it evicts its terminal parent at the bound', async () => {
  const subject = setup()
  const parent = await subject.service.start(depositRequest)
  const approvalHash = `0x${'81'.repeat(32)}`
  subject.queued[0].respond({ hash: approvalHash })
  subject.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await subject.service.list()
  subject.setAllowance(12_500_000n)

  for (let index = 0; index < 63; index += 1) {
    await subject.service.start({ ...depositRequest, amount: String(index + 1) })
  }

  const cleanup = await subject.service.revoke({ id: parent.id })

  expect(subject.workflows()[parent.id]).toBeUndefined()
  expect(subject.workflows()[cleanup.id]).toMatchObject({ action: 'revoke', status: 'active' })
  expect(subject.queued).toHaveLength(65)
  expect(subject.queued[64].transaction.target).toBe(asset.address)

  const restarted = subject.restartService()
  const afterRestart = (await restarted.list()).workflows.find(({ id }) => id === cleanup.id)!
  expect(afterRestart).toMatchObject({
    status: 'canceled',
    cleanupRecovery: 'unknown-outcome',
    error: expect.stringContaining('outcome is unknown')
  })

  for (let index = 0; index < 63; index += 1) {
    await restarted.start({ ...depositRequest, amount: String(index + 1) })
  }
  await expect(restarted.start({ ...depositRequest, amount: '64' })).rejects.toThrow(
    'Close an existing Yearn workflow'
  )
  expect(subject.workflows()[cleanup.id]).toMatchObject({ cleanupRecovery: 'unknown-outcome' })

  const rechecked = await restarted.revoke({ id: cleanup.id })
  expect(rechecked).toMatchObject({
    status: 'canceled',
    cleanupRecovery: 'allowance-nonzero',
    error: expect.stringContaining('verify no prior request is pending')
  })
  expect(subject.queued).toHaveLength(128)

  const retried = await restarted.revoke({ id: cleanup.id })
  expect(retried).toMatchObject({ action: 'revoke', status: 'active' })
  expect(retried.cleanupRecovery).toBeUndefined()
  expect(subject.queued).toHaveLength(129)
  expect(subject.queued[128].transaction.target).toBe(asset.address)
})

it('closes an unknown cleanup without queueing when its allowance is already zero', async () => {
  const subject = setup()
  const parent = await subject.service.start(depositRequest)
  const approvalHash = `0x${'82'.repeat(32)}`
  subject.queued[0].respond({ hash: approvalHash })
  subject.receipts.set(approvalHash, { transactionHash: approvalHash, status: '0x1', logs: [] })
  await subject.service.list()
  subject.setAllowance(12_500_000n)
  const cleanup = await subject.service.revoke({ id: parent.id })
  const restarted = subject.restartService()
  await restarted.list()
  subject.setAllowance(0n)

  const rechecked = await restarted.revoke({ id: cleanup.id })

  expect(rechecked).toMatchObject({
    status: 'canceled',
    error: 'Approval is already zero; no new transaction was queued'
  })
  expect(rechecked.cleanupRecovery).toBeUndefined()
  expect(subject.queued).toHaveLength(2)
})
