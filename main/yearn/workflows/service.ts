import { Interface, formatUnits, getAddress, parseUnits } from 'ethers'

import {
  YearnWorkflowListResultSchema,
  YearnWorkflowSchema,
  YearnWorkflowsSchema,
  type YearnCatalogResult,
  type YearnReceiptTransfer,
  type YearnVault,
  type YearnVaultVariant,
  type YearnWorkflow,
  type YearnWorkflowIdRequest,
  type YearnWorkflowRequest,
  type YearnWorkflowStep,
  type YearnWorkflows
} from '../../../resources/domain/yearn'
import { isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { YEARN_CATALOG } from '../catalog'
import { buildYearnRevokeWorkflow, buildYearnWorkflow } from './builders'
import { assertYearnWorkflowStep } from '../../transaction/actions/yearn'
import {
  cancelYearnWorkflow,
  confirmYearnStep,
  failYearnStep,
  hasOutstandingApproval,
  queueYearnStep,
  retryYearnStep,
  submitYearnStep
} from './transitions'

const erc20 = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
])
const erc4626 = new Interface([
  'function asset() view returns (address)',
  'function maxDeposit(address receiver) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function redeem(uint256 shares,address receiver,address owner) returns (uint256)'
])
const yvUsdLocked = new Interface([
  'function getCooldownStatus(address user) view returns (uint256 cooldownEnd,uint256 windowEnd,uint256 shares)'
])

export interface YearnWorkflowAccount {
  id?: string
  address?: string
  lastSignerType?: string
  requests?: Record<string, unknown>
}

export interface YearnQueuedTransaction {
  chainId: number
  account: string
  target: string
  data: string
}

export interface YearnQueuedResult {
  hash?: string
  error?: string
}

interface YearnWorkflowServiceDependencies {
  getCatalog: () => Promise<YearnCatalogResult>
  getCurrentAccount: () => YearnWorkflowAccount | null
  getNetworkStatus: (chainId: number) => { on: boolean; connected: boolean } | null
  readContract: (chainId: number, address: string, data: string) => Promise<string>
  simulateContract: (chainId: number, address: string, data: string, from: string) => Promise<string>
  getReceipt: (chainId: number, hash: string) => Promise<unknown>
  queueTransaction: (
    transaction: YearnQueuedTransaction,
    onResult: (result: YearnQueuedResult) => void
  ) => Promise<void>
  readWorkflows: () => unknown
  writeWorkflows: (workflows: YearnWorkflows) => void
  hasQueuedTransaction?: (transaction: YearnQueuedTransaction) => boolean
  now?: () => number
}

const MAX_WORKFLOWS = 64
const MAX_UINT256 = 2n ** 256n - 1n
const terminalStatuses = new Set<YearnWorkflow['status']>(['complete', 'canceled'])

const boundedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Yearn workflow failed'
  return message.trim().slice(0, 240) || 'Yearn workflow failed'
}

const checksum = (address: string) => getAddress(address.toLowerCase())

const decodeUint = (contract: Interface, method: string, result: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('Invalid contract response')
  return contract.decodeFunctionResult(method, result)[0] as bigint
}

const decodeAddress = (contract: Interface, method: string, result: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('Invalid contract response')
  return checksum(contract.decodeFunctionResult(method, result)[0] as string)
}

const findVariant = (vault: YearnVault, id: YearnWorkflowRequest['variant']) => {
  const variant = vault.variants.find((candidate) => candidate.id === id)
  if (!variant) throw new Error(`${id} is not available for ${vault.name}`)
  return variant
}

const findDefinition = (vaultId: string, chainId: number) => {
  const definition = YEARN_CATALOG.find(({ id, chainId: idChain }) => id === vaultId && idChain === chainId)
  if (!definition) throw new Error("Vault is not in Wren's curated Yearn catalog")
  return definition
}

const routeVariantFor = (
  vault: YearnVault,
  action: YearnWorkflow['action'],
  variantId: YearnWorkflow['variant']
) =>
  vault.kind === 'yBOLD' && action === 'stake' ? findVariant(vault, 'staked') : findVariant(vault, variantId)

const accountAddress = (account: YearnWorkflowAccount | null) => {
  const address = account?.id || account?.address
  if (!address) return null
  try {
    return checksum(address)
  } catch {
    return null
  }
}

interface ParsedTransfer {
  token: string
  from: string
  to: string
  amount: bigint
}

const parsedTransferLogs = (receipt: Record<string, unknown>): ParsedTransfer[] | null => {
  const logs = receipt['logs']
  if (!Array.isArray(logs) || logs.length > 4096) return null
  const transfers: ParsedTransfer[] = []
  for (const candidate of logs) {
    if (!candidate || typeof candidate !== 'object') continue
    const log = candidate as Record<string, unknown>
    if (
      typeof log['address'] !== 'string' ||
      !Array.isArray(log['topics']) ||
      typeof log['data'] !== 'string'
    ) {
      continue
    }
    try {
      const parsed = erc20.parseLog({ topics: log['topics'] as string[], data: log['data'] })
      const amount = parsed?.args[2] as bigint
      if (parsed?.name !== 'Transfer' || amount <= 0n) continue
      transfers.push({
        token: checksum(log['address']),
        from: checksum(parsed.args[0] as string),
        to: checksum(parsed.args[1] as string),
        amount
      })
    } catch {
      continue
    }
  }
  return transfers
}

const receivedTransferAmount = (
  receipt: Record<string, unknown>,
  token: string,
  from: string,
  to: string
) => {
  const transfers = parsedTransferLogs(receipt)
  if (!transfers) return null
  let total = 0n
  let found = false
  for (const transfer of transfers) {
    if (
      transfer.token !== checksum(token) ||
      transfer.from !== checksum(from) ||
      transfer.to !== checksum(to)
    ) {
      continue
    }
    if (total > MAX_UINT256 - transfer.amount) return null
    total += transfer.amount
    found = true
  }
  return found ? total : null
}

const receiptTransferEvidence = (
  receipt: Record<string, unknown>,
  workflow: YearnWorkflow,
  vault?: YearnVault
) => {
  const transfers = parsedTransferLogs(receipt)
  if (!transfers) return { transfers: [] as YearnReceiptTransfer[], truncated: true }
  const definition = findDefinition(workflow.vaultId, workflow.chainId)
  const rootVariant = vault?.variants.find(
    ({ address }) => checksum(address) === checksum(definition.address)
  )
  const allowed = new Map<string, { symbol: string; decimals: number }>([
    [
      checksum(definition.asset.address),
      { symbol: definition.asset.symbol, decimals: definition.asset.decimals }
    ],
    [
      checksum(definition.address),
      { symbol: rootVariant?.symbol || definition.name, decimals: definition.decimals }
    ],
    ...(definition.companions || []).map((companion) => {
      const variant = vault?.variants.find(({ address }) => checksum(address) === checksum(companion.address))
      return [
        checksum(companion.address),
        { symbol: variant?.symbol || `${definition.name} ${companion.id}`, decimals: companion.decimals }
      ] as const
    })
  ])
  const account = checksum(workflow.account)
  const aggregate = new Map<string, YearnReceiptTransfer>()
  let truncated = false
  for (const transfer of transfers) {
    const metadata = allowed.get(transfer.token)
    const direction = transfer.from === account ? 'out' : transfer.to === account ? 'in' : null
    if (!metadata || !direction) continue
    const key = `${transfer.token}:${direction}`
    const existing = aggregate.get(key)
    const amount = (existing ? BigInt(existing.amountRaw) : 0n) + transfer.amount
    if (amount > MAX_UINT256) {
      truncated = true
      continue
    }
    aggregate.set(key, {
      token: transfer.token,
      direction,
      amountRaw: amount.toString(),
      ...metadata
    })
  }
  const all = [...aggregate.values()]
  if (all.length > 8) truncated = true
  return { transfers: all.slice(0, 8), truncated }
}

export function createYearnWorkflowService({
  getCatalog,
  getCurrentAccount,
  getNetworkStatus,
  readContract,
  simulateContract,
  getReceipt,
  queueTransaction,
  readWorkflows,
  writeWorkflows,
  hasQueuedTransaction = () => false,
  now = Date.now
}: YearnWorkflowServiceDependencies) {
  const busy = new Set<string>()
  const admitted = new Set<string>()

  const load = (): YearnWorkflows => {
    const parsed = YearnWorkflowsSchema.safeParse(readWorkflows())
    return parsed.success ? parsed.data : {}
  }

  const persist = (next: YearnWorkflows) => {
    const ordered = Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt)
    const active = ordered.filter(({ status }) => !terminalStatuses.has(status))
    const recoveries = ordered.filter(
      ({ status, cleanupRecovery }) => terminalStatuses.has(status) && cleanupRecovery
    )
    const required = [...active, ...recoveries]
    if (required.length > MAX_WORKFLOWS) {
      throw new Error('Close an existing Yearn workflow before creating another')
    }
    const retained = [
      ...required,
      ...ordered
        .filter(({ status, cleanupRecovery }) => terminalStatuses.has(status) && !cleanupRecovery)
        .slice(0, MAX_WORKFLOWS - required.length)
    ]
    writeWorkflows(Object.fromEntries(retained.map((workflow) => [workflow.id, workflow])))
  }

  const save = (workflow: YearnWorkflow) => {
    const parsed = YearnWorkflowSchema.parse(workflow)
    persist({ ...load(), [parsed.id]: parsed })
    return parsed
  }

  const discard = (id: string) => {
    const workflows = load()
    if (!workflows[id]) return
    const { [id]: _discarded, ...remaining } = workflows
    persist(remaining)
  }

  const requireWorkflow = (id: string) => {
    const workflow = load()[id]
    if (!workflow) throw new Error('Yearn workflow was not found')
    return workflow
  }

  const requireSelectedOwner = (workflow: YearnWorkflow) => {
    const account = getCurrentAccount()
    const selected = accountAddress(account)
    if (!selected || selected !== checksum(workflow.account)) {
      throw new Error('Select the account that owns this Yearn workflow')
    }
    return account
  }

  const readUint = async (chainId: number, address: string, method: string, args: unknown[]) => {
    const contract = [
      'maxDeposit',
      'maxWithdraw',
      'maxRedeem',
      'previewDeposit',
      'previewWithdraw',
      'previewRedeem'
    ].includes(method)
      ? erc4626
      : erc20
    const result = await readContract(chainId, address, contract.encodeFunctionData(method, args))
    return decodeUint(contract, method, result)
  }

  const readAsset = async (chainId: number, address: string) => {
    const result = await readContract(chainId, address, erc4626.encodeFunctionData('asset'))
    return decodeAddress(erc4626, 'asset', result)
  }

  const canRedeem = async (chainId: number, address: string, shares: bigint, account: string) => {
    try {
      const result = await simulateContract(
        chainId,
        address,
        erc4626.encodeFunctionData('redeem', [shares, account, account]),
        account
      )
      decodeUint(erc4626, 'redeem', result)
      return true
    } catch {
      return false
    }
  }

  const readDecimals = (chainId: number, address: string) =>
    readUint(chainId, address, 'decimals', []).then((value) => {
      const decimals = Number(value)
      if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
        throw new Error('Token returned invalid decimals')
      }
      return decimals
    })

  const readCooldownShares = async (chainId: number, address: string, account: string) => {
    const result = await readContract(
      chainId,
      address,
      yvUsdLocked.encodeFunctionData('getCooldownStatus', [account])
    )
    if (!/^0x[0-9a-fA-F]{192}$/.test(result)) throw new Error('Invalid cooldown response')
    return yvUsdLocked.decodeFunctionResult('getCooldownStatus', result)[2] as bigint
  }

  const assertProductRoute = async (vault: YearnVault, variant: YearnVaultVariant) => {
    const definition = findDefinition(vault.id, vault.chainId)
    if (
      checksum(vault.address) !== checksum(definition.address) ||
      checksum(vault.asset.address) !== checksum(definition.asset.address) ||
      vault.asset.decimals !== definition.asset.decimals ||
      vault.decimals !== definition.decimals
    ) {
      throw new Error("Yearn metadata does not match Wren's curated policy")
    }
    const rootVariant = vault.variants.find(
      ({ address }) => checksum(address) === checksum(definition.address)
    )
    if (
      !rootVariant ||
      rootVariant.decimals !== definition.decimals ||
      checksum(rootVariant.asset.address) !== checksum(definition.asset.address) ||
      rootVariant.asset.decimals !== definition.asset.decimals
    ) {
      throw new Error("Yearn vault metadata does not match Wren's curated policy")
    }
    const rootAsset = await readAsset(vault.chainId, vault.address)
    if (rootAsset !== checksum(definition.asset.address))
      throw new Error('Vault asset does not match Yearn metadata')
    const [assetDecimals, vaultDecimals] = await Promise.all([
      readDecimals(vault.chainId, definition.asset.address),
      readDecimals(vault.chainId, definition.address)
    ])
    if (assetDecimals !== definition.asset.decimals || vaultDecimals !== definition.decimals) {
      throw new Error("On-chain decimals do not match Wren's curated Yearn policy")
    }
    if (variant.address.toLowerCase() === vault.address.toLowerCase()) return
    const companion = definition.companions?.find(({ id }) => id === variant.id)
    if (
      !companion ||
      checksum(variant.address) !== checksum(companion.address) ||
      variant.decimals !== companion.decimals ||
      checksum(variant.asset.address) !== checksum(definition.address) ||
      variant.asset.decimals !== definition.decimals
    ) {
      throw new Error("Yearn companion metadata does not match Wren's curated policy")
    }
    const companionAsset = await readAsset(vault.chainId, variant.address)
    if (companionAsset !== checksum(vault.address)) {
      throw new Error('Yearn companion vault does not match its allowlisted product')
    }
    if ((await readDecimals(vault.chainId, variant.address)) !== companion.decimals) {
      throw new Error("Companion decimals do not match Wren's curated Yearn policy")
    }
  }

  const resolveAmount = async (
    request: YearnWorkflowRequest,
    vault: YearnVault,
    variant: YearnVaultVariant,
    account: string
  ) => {
    if (request.action === 'cancel-cooldown') {
      const cooldownShares = await readCooldownShares(vault.chainId, variant.address, account)
      if (cooldownShares <= 0n) throw new Error('Locked yvUSD has no active cooldown to cancel')
      return { amount: 0n, displayAmount: '0' }
    }
    if (vault.kind === 'yvUSD' && request.variant === 'locked') {
      if (request.action === 'withdraw') {
        if (request.max) {
          const lockedShares = await readUint(vault.chainId, variant.address, 'maxRedeem', [account])
          if (lockedShares <= 0n) throw new Error('Locked yvUSD is not in its withdrawal window')
          const unlockedShares = await readUint(vault.chainId, variant.address, 'previewRedeem', [
            lockedShares
          ])
          const underlyingAssets = await readUint(vault.chainId, vault.address, 'previewRedeem', [
            unlockedShares
          ])
          if (underlyingAssets <= 0n) throw new Error('Locked yvUSD withdrawal quote is unavailable')
          return {
            amount: underlyingAssets,
            operationAmount: lockedShares,
            secondaryAmount: unlockedShares,
            displayAmount: formatUnits(underlyingAssets, vault.asset.decimals)
          }
        }
        let underlyingAssets: bigint
        try {
          underlyingAssets = parseUnits(request.amount, vault.asset.decimals)
        } catch {
          throw new Error(`Enter a valid ${vault.asset.symbol} amount`)
        }
        if (underlyingAssets <= 0n) throw new Error(`${vault.asset.symbol} amount must be greater than zero`)
        const unlockedShares = await readUint(vault.chainId, vault.address, 'previewWithdraw', [
          underlyingAssets
        ])
        const available = await readUint(vault.chainId, variant.address, 'maxWithdraw', [account])
        if (unlockedShares > available) {
          throw new Error('Amount exceeds locked yvUSD available in the current withdrawal window')
        }
        return {
          amount: underlyingAssets,
          operationAmount: unlockedShares,
          secondaryAmount: underlyingAssets,
          displayAmount: request.amount
        }
      }
      if (request.action === 'start-cooldown') {
        const cooldownShares = await readCooldownShares(vault.chainId, variant.address, account)
        if (cooldownShares > 0n) {
          throw new Error('Cancel the existing locked yvUSD cooldown before starting another')
        }
        const lockedBalance = await readUint(vault.chainId, variant.address, 'balanceOf', [account])
        if (request.max) {
          if (lockedBalance <= 0n) throw new Error('No locked yvUSD is available to cool down')
          return {
            amount: lockedBalance,
            operationAmount: lockedBalance,
            displayAmount: formatUnits(lockedBalance, variant.decimals)
          }
        }
        let underlyingAssets: bigint
        try {
          underlyingAssets = parseUnits(request.amount, vault.asset.decimals)
        } catch {
          throw new Error(`Enter a valid ${vault.asset.symbol} amount`)
        }
        const unlockedShares = await readUint(vault.chainId, vault.address, 'previewWithdraw', [
          underlyingAssets
        ])
        const lockedShares = await readUint(vault.chainId, variant.address, 'previewWithdraw', [
          unlockedShares
        ])
        if (lockedShares <= 0n || lockedShares > lockedBalance) {
          throw new Error('Amount exceeds the locked yvUSD balance')
        }
        return {
          amount: underlyingAssets,
          operationAmount: lockedShares,
          displayAmount: request.amount
        }
      }
    }
    if (request.action === 'withdraw' && request.max && ['direct', 'unlocked'].includes(request.variant)) {
      const balance = await readUint(vault.chainId, variant.address, 'balanceOf', [account])
      if (balance <= 0n) throw new Error(`No ${variant.symbol} is currently available to withdraw`)
      const shares = (await canRedeem(vault.chainId, variant.address, balance, account))
        ? balance
        : await readUint(vault.chainId, variant.address, 'maxRedeem', [account])
      if (shares <= 0n) throw new Error(`No ${variant.symbol} is currently available to withdraw`)
      const assets = await readUint(vault.chainId, variant.address, 'previewRedeem', [shares])
      if (assets <= 0n) throw new Error(`${variant.asset.symbol} withdrawal quote is unavailable`)
      return {
        amount: shares,
        displayAmount: formatUnits(assets, variant.asset.decimals)
      }
    }

    const token =
      request.action === 'deposit'
        ? vault.asset
        : request.action === 'withdraw' && !request.max && ['direct', 'unlocked'].includes(request.variant)
          ? variant.asset
          : { ...variant, address: variant.address }
    let amount: bigint
    try {
      amount = request.max
        ? await readUint(vault.chainId, token.address, 'balanceOf', [account])
        : parseUnits(request.amount, token.decimals)
    } catch {
      throw new Error(`Enter a valid ${token.symbol} amount`)
    }
    if (amount <= 0n) throw new Error(`${token.symbol} amount must be greater than zero`)

    if (request.action === 'deposit' || request.action === 'stake') {
      const balance = await readUint(vault.chainId, token.address, 'balanceOf', [account])
      if (amount > balance) throw new Error(`Insufficient ${token.symbol} balance`)
    } else if (
      request.action === 'withdraw' &&
      !request.max &&
      ['direct', 'unlocked'].includes(request.variant)
    ) {
      const available = await readUint(vault.chainId, variant.address, 'maxWithdraw', [account])
      if (amount > available) throw new Error(`Amount exceeds the available ${token.symbol} withdrawal`)
    } else {
      const shares = await readUint(vault.chainId, variant.address, 'balanceOf', [account])
      if (amount > shares) throw new Error(`Amount exceeds the available ${variant.symbol} balance`)
    }
    return {
      amount,
      displayAmount: request.max ? formatUnits(amount, token.decimals) : request.amount
    }
  }

  const prepare = async (request: YearnWorkflowRequest) => {
    const account = getCurrentAccount()
    const address = accountAddress(account)
    if (!address) throw new Error('Select an account before using Earn')
    if (isWatchOnlyAccountType(account?.lastSignerType)) {
      throw new Error('Watch-only accounts cannot create Earn transactions')
    }

    const catalog = await getCatalog()
    const vault = catalog.vaults.find(({ id }) => id === request.vaultId)
    if (!vault) throw new Error("Vault is not in Wren's curated Yearn catalog")
    const isExit = ['withdraw', 'start-cooldown', 'cancel-cooldown'].includes(request.action)
    if (!isExit && (catalog.status !== 'fresh' || vault.status !== 'available')) {
      throw new Error('Fresh eligible Yearn data is required before depositing')
    }
    const network = getNetworkStatus(vault.chainId)
    if (!network?.on) throw new Error(`Enable ${vault.chainName} before using this vault`)
    if (!network.connected) throw new Error(`${vault.chainName} is not connected`)

    const variant = findVariant(vault, request.variant)
    const routeVariant = routeVariantFor(vault, request.action, request.variant)
    await assertProductRoute(vault, routeVariant)
    const { amount, operationAmount, secondaryAmount, displayAmount } = await resolveAmount(
      request,
      vault,
      variant,
      address
    )
    if (request.action === 'deposit') {
      const rootCapacity = await readUint(vault.chainId, vault.address, 'maxDeposit', [address])
      if (amount > rootCapacity) throw new Error(`${vault.name} cannot currently accept this deposit`)
      if (routeVariant.address.toLowerCase() !== vault.address.toLowerCase()) {
        const rootShares = await readUint(vault.chainId, vault.address, 'previewDeposit', [amount])
        const companionCapacity = await readUint(vault.chainId, routeVariant.address, 'maxDeposit', [address])
        if (rootShares <= 0n || rootShares > companionCapacity) {
          throw new Error(`${routeVariant.name} cannot currently accept this deposit`)
        }
      }
    }
    const provisional = buildYearnWorkflow({
      vault,
      account: address,
      action: request.action,
      variant: request.variant,
      amountRaw: amount,
      displayAmount,
      max: request.max,
      allowance: 0n,
      ...(operationAmount !== undefined && { operationAmountRaw: operationAmount }),
      ...(secondaryAmount !== undefined && { secondaryAmountRaw: secondaryAmount }),
      now: now()
    })
    const approval = provisional.steps.find(({ kind }) => kind === 'approve')
    const allowance =
      approval?.approvalToken && approval.approvalSpender
        ? await readUint(vault.chainId, approval.approvalToken, 'allowance', [
            address,
            approval.approvalSpender
          ])
        : 0n
    return buildYearnWorkflow({
      vault,
      account: address,
      action: request.action,
      variant: request.variant,
      amountRaw: amount,
      displayAmount,
      max: request.max,
      allowance,
      ...(operationAmount !== undefined && { operationAmountRaw: operationAmount }),
      ...(secondaryAmount !== undefined && { secondaryAmountRaw: secondaryAmount }),
      now: now()
    })
  }

  const assertQueueEligibility = async (
    workflow: YearnWorkflow,
    current: YearnWorkflowStep,
    catalog: YearnCatalogResult,
    vault: YearnVault,
    routeVariant: YearnVaultVariant
  ) => {
    if (['deposit', 'stake'].includes(workflow.action)) {
      if (catalog.status !== 'fresh' || vault.status !== 'available') {
        throw new Error('Fresh eligible Yearn data is required before depositing')
      }
    }

    if (current.kind === 'deposit') {
      const amount = BigInt(workflow.amountRaw)
      const balance = await readUint(workflow.chainId, vault.asset.address, 'balanceOf', [workflow.account])
      if (amount > balance) throw new Error(`Insufficient ${vault.asset.symbol} balance`)
      const rootCapacity = await readUint(workflow.chainId, vault.address, 'maxDeposit', [workflow.account])
      if (amount > rootCapacity) throw new Error(`${vault.name} cannot currently accept this deposit`)
      if (checksum(routeVariant.address) !== checksum(vault.address)) {
        const rootShares = await readUint(workflow.chainId, vault.address, 'previewDeposit', [amount])
        const companionCapacity = await readUint(workflow.chainId, routeVariant.address, 'maxDeposit', [
          workflow.account
        ])
        if (rootShares <= 0n || rootShares > companionCapacity) {
          throw new Error(`${routeVariant.name} cannot currently accept this deposit`)
        }
      }
    }

    if (current.kind === 'stake') {
      const balance = await readUint(workflow.chainId, vault.address, 'balanceOf', [workflow.account])
      if (BigInt(current.amountRaw) > balance) throw new Error(`Insufficient ${vault.name} balance`)
      const capacity = await readUint(workflow.chainId, routeVariant.address, 'maxDeposit', [
        workflow.account
      ])
      if (BigInt(current.amountRaw) > capacity) {
        throw new Error(`${routeVariant.name} cannot currently accept this stake`)
      }
    }

    if (
      current.kind === 'redeem' &&
      vault.kind === 'yBOLD' &&
      checksum(current.target) !== checksum(routeVariant.address)
    ) {
      const balance = await readUint(workflow.chainId, routeVariant.address, 'balanceOf', [workflow.account])
      if (BigInt(current.amountRaw) > balance) {
        throw new Error(`Amount exceeds the available ${routeVariant.symbol} balance`)
      }
    }

    const directMaxRedeem =
      workflow.action === 'withdraw' &&
      workflow.max &&
      current.kind === 'redeem' &&
      ['direct', 'unlocked'].includes(workflow.variant) &&
      checksum(current.target) === checksum(routeVariant.address)
    if (directMaxRedeem) {
      const amount = BigInt(current.amountRaw)
      const balance = await readUint(workflow.chainId, current.target, 'balanceOf', [workflow.account])
      if (
        amount > balance ||
        (amount === balance && !(await canRedeem(workflow.chainId, current.target, amount, workflow.account)))
      ) {
        throw new Error('Yearn withdrawal capacity changed; prepare the withdrawal again')
      }
      if (amount < balance) {
        const available = await readUint(workflow.chainId, current.target, 'maxRedeem', [workflow.account])
        if (amount > available) {
          throw new Error('Yearn withdrawal capacity changed; prepare the withdrawal again')
        }
      }
    } else if (
      ['withdraw', 'redeem'].includes(current.kind) &&
      [vault.address, routeVariant.address].some((address) => checksum(address) === checksum(current.target))
    ) {
      const method = current.kind === 'withdraw' ? 'maxWithdraw' : 'maxRedeem'
      const available = await readUint(workflow.chainId, current.target, method, [workflow.account])
      if (BigInt(current.amountRaw) > available) {
        throw new Error('Yearn withdrawal capacity changed; prepare the withdrawal again')
      }
    }

    if (current.kind === 'start-cooldown') {
      const shares = await readCooldownShares(workflow.chainId, current.target, workflow.account)
      if (shares > 0n) throw new Error('Cancel the existing locked yvUSD cooldown before starting another')
    }
    if (current.kind === 'cancel-cooldown') {
      const shares = await readCooldownShares(workflow.chainId, current.target, workflow.account)
      if (shares <= 0n) throw new Error('Locked yvUSD has no active cooldown to cancel')
    }
  }

  const handleQueuedResult = (id: string, result: YearnQueuedResult) => {
    admitted.delete(id)
    try {
      const workflow = requireWorkflow(id)
      if (result.error) {
        save(failYearnStep(workflow, result.error, now()))
        return
      }
      if (!result.hash) {
        save(failYearnStep(workflow, 'Transaction returned no hash', now()))
        return
      }
      save(submitYearnStep(workflow, result.hash, now()))
    } catch {
      // The request pipeline has already recorded the authoritative result.
    }
  }

  const queueLocked = async (id: string) => {
    let workflow = requireWorkflow(id)
    if (workflow.status === 'error') workflow = save(retryYearnStep(workflow, now()))
    const current = workflow.steps[workflow.currentStep]
    if (!current) throw new Error('Yearn workflow has no current step')

    const account = requireSelectedOwner(workflow)
    if (isWatchOnlyAccountType(account?.lastSignerType)) {
      throw new Error('Watch-only accounts cannot resume Earn transactions')
    }
    const network = getNetworkStatus(workflow.chainId)
    if (!network?.on || !network.connected) throw new Error('The workflow chain is not connected')

    let vault: YearnVault | undefined
    if (workflow.action === 'revoke') {
      assertYearnWorkflowStep(workflow, current)
    } else {
      const catalog = await getCatalog()
      vault = catalog.vaults.find(({ id }) => id === workflow.vaultId)
      if (!vault) throw new Error("The workflow vault is no longer in Wren's curated catalog")
      const routeVariant = routeVariantFor(vault, workflow.action, workflow.variant)
      await assertProductRoute(vault, routeVariant)
      assertYearnWorkflowStep(workflow, current, vault)
      await assertQueueEligibility(workflow, current, catalog, vault, routeVariant)
    }

    const lastConfirmedApproval = [...workflow.steps]
      .slice(0, workflow.currentStep)
      .reverse()
      .find(({ kind, status }) => ['approve', 'revoke'].includes(kind) && status === 'confirmed')
    if (lastConfirmedApproval?.approvalToken && lastConfirmedApproval.approvalSpender) {
      const allowance = await readUint(workflow.chainId, lastConfirmedApproval.approvalToken, 'allowance', [
        workflow.account,
        lastConfirmedApproval.approvalSpender
      ])
      const expected = lastConfirmedApproval.kind === 'approve' ? BigInt(workflow.amountRaw) : 0n
      if (allowance !== expected) {
        throw new Error('Token allowance changed; restart this Yearn workflow')
      }
    }

    workflow = save(queueYearnStep(workflow, now()))
    try {
      await queueTransaction(
        {
          chainId: workflow.chainId,
          account: workflow.account,
          target: current.target,
          data: current.data
        },
        (result) => handleQueuedResult(id, result)
      )
      const admittedWorkflow = requireWorkflow(id)
      if (
        admittedWorkflow.status === 'active' &&
        admittedWorkflow.steps[admittedWorkflow.currentStep]?.status === 'awaiting-review'
      ) {
        admitted.add(id)
      }
    } catch (error) {
      const latest = requireWorkflow(id)
      workflow = latest.status === 'error' ? latest : save(failYearnStep(latest, boundedError(error), now()))
    }
    return requireWorkflow(id)
  }

  const queue = async (id: string) => {
    if (busy.has(id)) throw new Error('Yearn workflow is already being updated')
    busy.add(id)
    try {
      return await queueLocked(id)
    } finally {
      busy.delete(id)
    }
  }

  const syncOne = async (workflow: YearnWorkflow) => {
    const current = workflow.steps[workflow.currentStep]
    if (workflow.status !== 'waiting-confirmation' || current?.status !== 'submitted' || !current.txHash) {
      return workflow
    }
    try {
      const receipt = await getReceipt(workflow.chainId, current.txHash)
      if (receipt === null || receipt === undefined) return workflow
      if (!receipt || typeof receipt !== 'object') throw new Error('Transaction receipt was malformed')
      const candidate = receipt as Record<string, unknown>
      if (
        typeof candidate['transactionHash'] !== 'string' ||
        candidate['transactionHash'].toLowerCase() !== current.txHash.toLowerCase()
      ) {
        throw new Error('Transaction receipt did not match the Yearn step')
      }
      if (candidate['status'] === '0x1') {
        let confirmed = confirmYearnStep(workflow, now())
        const evidence = receiptTransferEvidence(candidate, workflow)
        if (evidence.transfers.length > 0 || evidence.truncated) {
          const steps = confirmed.steps.map((step, index) =>
            index === workflow.currentStep
              ? {
                  ...step,
                  ...(evidence.transfers.length > 0 && { receiptTransfers: evidence.transfers }),
                  ...(evidence.truncated && { receiptTransfersTruncated: true })
                }
              : step
          )
          confirmed = YearnWorkflowSchema.parse({ ...confirmed, steps, updatedAt: now() })
        }
        if (workflow.action === 'revoke') {
          if (!current.approvalToken || !current.approvalSpender) {
            throw new Error('Approval cleanup scope was missing')
          }
          const remaining = await readUint(workflow.chainId, current.approvalToken, 'allowance', [
            workflow.account,
            current.approvalSpender
          ])
          if (remaining !== 0n) {
            const error = 'Approval transaction confirmed, but the token allowance remains nonzero'
            confirmed = save(
              YearnWorkflowSchema.parse({ ...confirmed, status: 'canceled', error, updatedAt: now() })
            )
            if (confirmed.parentWorkflowId) {
              const parent = load()[confirmed.parentWorkflowId]
              if (parent && parent.status !== 'complete') {
                save(YearnWorkflowSchema.parse({ ...parent, status: 'canceled', error, updatedAt: now() }))
              }
            }
            return confirmed
          }
        }
        const next = confirmed.steps[confirmed.currentStep]
        const receiptBoundLockedMaxExit =
          workflow.action === 'withdraw' &&
          workflow.variant === 'locked' &&
          workflow.max &&
          workflow.currentStep === 0 &&
          current.kind === 'redeem' &&
          next?.kind === 'redeem'
        if (receiptBoundLockedMaxExit && next) {
          const received = receivedTransferAmount(candidate, next.target, current.target, workflow.account)
          if (received === null) {
            confirmed = YearnWorkflowSchema.parse({
              ...confirmed,
              status: 'canceled',
              error:
                'Locked yvUSD was unlocked, but its receipt did not prove the amount; manage the yvUSD position separately',
              updatedAt: now()
            })
          } else {
            const steps = confirmed.steps.map((step, index) =>
              index === confirmed.currentStep
                ? {
                    ...step,
                    amountRaw: received.toString(),
                    data: erc4626.encodeFunctionData('redeem', [received, workflow.account, workflow.account])
                  }
                : step
            )
            confirmed = YearnWorkflowSchema.parse({ ...confirmed, steps, updatedAt: now() })
          }
        }
        confirmed = save(confirmed)
        if (confirmed.status === 'complete' && confirmed.action === 'revoke' && confirmed.parentWorkflowId) {
          const parent = load()[confirmed.parentWorkflowId]
          if (parent && parent.status !== 'complete') {
            save(
              YearnWorkflowSchema.parse({ ...parent, status: 'canceled', error: undefined, updatedAt: now() })
            )
          }
        }
        return confirmed
      }
      if (candidate['status'] === '0x0') return save(failYearnStep(workflow, 'Transaction reverted', now()))
      throw new Error('Transaction receipt had an invalid status')
    } catch (error) {
      return save(YearnWorkflowSchema.parse({ ...workflow, error: boundedError(error), updatedAt: now() }))
    }
  }

  const list = async () => {
    const selected = accountAddress(getCurrentAccount())
    const ids = Object.values(load())
      .filter(({ account }) => selected && checksum(account) === selected)
      .map(({ id }) => id)
    await Promise.all(
      ids.map(async (id) => {
        if (busy.has(id)) return
        busy.add(id)
        try {
          let workflow = requireWorkflow(id)
          const step = workflow.steps[workflow.currentStep]
          if (
            workflow.status === 'active' &&
            step?.status === 'awaiting-review' &&
            !admitted.has(id) &&
            !hasQueuedTransaction({
              chainId: workflow.chainId,
              account: workflow.account,
              target: step.target,
              data: step.data
            })
          ) {
            const error =
              'Request outcome is unknown after restart; verify the account on-chain before starting again'
            const steps = workflow.steps.map((candidate, index) =>
              index === workflow.currentStep ? { ...candidate, status: 'error' as const, error } : candidate
            )
            workflow = save(
              YearnWorkflowSchema.parse({
                ...workflow,
                steps,
                status: 'canceled',
                ...(workflow.action === 'revoke' && { cleanupRecovery: 'unknown-outcome' }),
                error,
                updatedAt: now()
              })
            )
          }
          await syncOne(workflow)
        } finally {
          busy.delete(id)
        }
      })
    )
    return YearnWorkflowListResultSchema.parse({
      workflows: Object.values(load())
        .filter(({ account }) => selected && checksum(account) === selected)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }

  const start = async (request: YearnWorkflowRequest) => {
    const workflow = save(await prepare(request))
    try {
      return await queue(workflow.id)
    } catch (error) {
      const current = load()[workflow.id]
      if (
        current?.status === 'ready' &&
        current.steps.every(({ status }) => ['pending', 'ready'].includes(status))
      ) {
        discard(workflow.id)
      }
      throw error
    }
  }

  const resume = async ({ id }: YearnWorkflowIdRequest) => {
    if (busy.has(id)) throw new Error('Yearn workflow is already being updated')
    busy.add(id)
    try {
      const workflow = requireWorkflow(id)
      if (terminalStatuses.has(workflow.status)) throw new Error('This Yearn workflow cannot be resumed')
      await syncOne(workflow)
      return await queueLocked(id)
    } finally {
      busy.delete(id)
    }
  }

  const cancel = ({ id }: YearnWorkflowIdRequest) => {
    if (busy.has(id)) throw new Error('Yearn workflow is already being updated')
    const workflow = requireWorkflow(id)
    requireSelectedOwner(workflow)
    if (workflow.action === 'revoke') {
      throw new Error('Approval cleanup must be completed or retried')
    }
    return save(cancelYearnWorkflow(workflow, now()))
  }

  const revoke = async ({ id }: YearnWorkflowIdRequest) => {
    if (busy.has(id)) throw new Error('Yearn workflow is already being updated')
    busy.add(id)
    let cleanup: YearnWorkflow
    try {
      const parent = requireWorkflow(id)
      const account = requireSelectedOwner(parent)
      if (isWatchOnlyAccountType(account?.lastSignerType)) {
        throw new Error('Watch-only accounts cannot revoke Earn approvals')
      }
      if (parent.action === 'revoke') {
        if (parent.status !== 'canceled' || !parent.cleanupRecovery) {
          throw new Error('Approval cleanup must be completed or retried')
        }
        const current = parent.steps[parent.currentStep]
        if (
          parent.amountRaw !== '0' ||
          current?.kind !== 'revoke' ||
          current.amountRaw !== '0' ||
          !current.approvalToken ||
          !current.approvalSpender
        ) {
          throw new Error('Approval cleanup scope was missing')
        }
        assertYearnWorkflowStep(parent, current)
        const allowance = await readUint(parent.chainId, current.approvalToken, 'allowance', [
          parent.account,
          current.approvalSpender
        ])
        if (allowance === 0n) {
          return save(
            YearnWorkflowSchema.parse({
              ...parent,
              cleanupRecovery: undefined,
              error: 'Approval is already zero; no new transaction was queued',
              updatedAt: now()
            })
          )
        }
        if (parent.cleanupRecovery === 'unknown-outcome') {
          return save(
            YearnWorkflowSchema.parse({
              ...parent,
              cleanupRecovery: 'allowance-nonzero',
              error:
                'Allowance remains nonzero; verify no prior request is pending before choosing Revoke again',
              updatedAt: now()
            })
          )
        }
        const steps = parent.steps.map((step, index) =>
          index === parent.currentStep
            ? { ...step, status: 'ready' as const, error: undefined, txHash: undefined }
            : step
        )
        save(
          YearnWorkflowSchema.parse({
            ...parent,
            steps,
            status: 'ready',
            cleanupRecovery: undefined,
            error: undefined,
            updatedAt: now()
          })
        )
        return await queueLocked(parent.id)
      }
      if (!['ready', 'error', 'canceled'].includes(parent.status)) {
        throw new Error('Wait for the current Yearn request before revoking its approval')
      }
      const existingCleanup = Object.values(load()).find(
        ({ parentWorkflowId, status }) => parentWorkflowId === parent.id && !terminalStatuses.has(status)
      )
      if (existingCleanup) throw new Error('Approval cleanup is already in progress')
      if (!hasOutstandingApproval(parent)) throw new Error('This workflow has no approval to revoke')
      const approval = [...parent.steps]
        .reverse()
        .find(({ kind, status }) => kind === 'approve' && status === 'confirmed')
      if (!approval) throw new Error('This workflow has no approval to revoke')
      cleanup = buildYearnRevokeWorkflow(parent, approval, now())
      const canceledParent = YearnWorkflowSchema.parse({
        ...parent,
        status: 'canceled',
        error: 'Approval cleanup in progress',
        updatedAt: now()
      })
      persist({ ...load(), [canceledParent.id]: canceledParent, [cleanup.id]: cleanup })
    } finally {
      busy.delete(id)
    }
    return queue(cleanup.id)
  }

  return { start, list, resume, cancel, revoke }
}

export const YearnWorkflowReadInterfaces = { erc20, erc4626, yvUsdLocked }
