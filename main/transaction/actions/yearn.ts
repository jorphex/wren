import { Interface, getAddress } from 'ethers'

import { YEARN_CATALOG } from '../../yearn/catalog'
import type { YearnVault, YearnWorkflow, YearnWorkflowStep } from '../../../resources/domain/yearn'
import type { Action } from '.'

export type ActionType =
  | 'yearn:approve'
  | 'yearn:deposit'
  | 'yearn:withdraw'
  | 'yearn:stake'
  | 'yearn:start-cooldown'
  | 'yearn:cancel-cooldown'

export interface YearnActionData {
  protocol: 'Yearn'
  vaultId: string
  vaultName: string
  chainId: number
  action: 'approve' | 'deposit' | 'withdraw' | 'stake' | 'start-cooldown' | 'cancel-cooldown'
  amountRaw?: string
  amountType?: 'assets' | 'shares'
  receiver?: string
  owner?: string
  token?: string
  spender?: string
  maxLossBps?: 0
  symbol?: string
  outputSymbol?: string
  decimals?: number
  yearnUrl: string
}

interface RecognitionContext {
  contractAddress: string
  chainId: number
  account?: string
  value?: string
  vaults?: YearnVault[]
}

const approve = new Interface(['function approve(address spender,uint256 amount) returns (bool)'])
const erc4626 = new Interface([
  'function deposit(uint256 assets,address receiver) returns (uint256)',
  'function withdraw(uint256 assets,address receiver,address owner) returns (uint256)',
  'function redeem(uint256 shares,address receiver,address owner) returns (uint256)'
])
const yvUsdZap = new Interface([
  'function zapIn(uint256 assets,address receiver) returns (uint256)',
  'function zapOut(uint256 shares,address receiver) returns (uint256)'
])
const yvUsdLocked = new Interface(['function startCooldown(uint256 shares)', 'function cancelCooldown()'])
const yBoldZap = new Interface([
  'function zapIn(uint256 assets,address receiver) returns (uint256)',
  'function zapOut(uint256 shares,address receiver,uint256 maxLoss) returns (uint256)'
])

const sameAddress = (left: unknown, right: unknown) =>
  typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()

const accountMatches = (candidate: unknown, account?: string) =>
  Boolean(account && sameAddress(candidate, account))

const hasNoNativeValue = (value?: string) => !value || /^0x0*$/.test(value)

const definitionForTarget = (chainId: number, address: string) =>
  YEARN_CATALOG.find(
    (vault) =>
      vault.chainId === chainId &&
      [
        vault.address,
        ...(vault.companions || []).map(({ address }) => address),
        ...(vault.periphery || [])
      ].some((candidate) => sameAddress(candidate, address))
  )

const hydratedVault = (definition: (typeof YEARN_CATALOG)[number], vaults: YearnVault[] = []) =>
  vaults.find(({ id, chainId }) => id === definition.id && chainId === definition.chainId)

const tokenMetadata = (
  definition: (typeof YEARN_CATALOG)[number],
  vault: YearnVault | undefined,
  address: string
) => {
  if (sameAddress(definition.asset.address, address)) {
    return {
      symbol: definition.asset.symbol,
      decimals: definition.asset.decimals,
      token: getAddress(address)
    }
  }
  if (sameAddress(definition.address, address)) {
    const variant = vault?.variants.find(({ address: candidate }) => sameAddress(candidate, address))
    return {
      symbol: variant?.symbol || definition.name,
      decimals: definition.decimals,
      token: getAddress(address)
    }
  }
  const companion = definition.companions?.find(({ address: candidate }) => sameAddress(candidate, address))
  if (!companion) return {}
  const variant = vault?.variants.find(({ address: candidate }) => sameAddress(candidate, address))
  return {
    symbol: variant?.symbol || `${definition.name} ${companion.id}`,
    decimals: companion.decimals,
    token: getAddress(address)
  }
}

const outputTokenMetadata = (
  definition: (typeof YEARN_CATALOG)[number],
  vault: YearnVault | undefined,
  address: string
) => {
  const symbol = tokenMetadata(definition, vault, address).symbol
  return symbol ? { outputSymbol: symbol } : {}
}

const isExpectedApproval = (definition: (typeof YEARN_CATALOG)[number], token: string, spender: string) => {
  if (sameAddress(spender, definition.address)) return sameAddress(token, definition.asset.address)

  const companion = definition.companions?.find(({ address }) => sameAddress(address, spender))
  if (companion) return sameAddress(token, definition.address)

  if (!definition.periphery?.some((address) => sameAddress(address, spender))) return false
  if (definition.kind === 'yvUSD') return sameAddress(token, definition.asset.address)
  if (definition.kind === 'yBOLD') {
    const staked = definition.companions?.find(({ id }) => id === 'staked')
    return sameAddress(token, definition.asset.address) || sameAddress(token, staked?.address)
  }
  return false
}

const action = (
  id: ActionType,
  definition: (typeof YEARN_CATALOG)[number],
  data: Omit<YearnActionData, 'protocol' | 'vaultId' | 'vaultName' | 'chainId' | 'yearnUrl'>,
  vault?: YearnVault
): Action<YearnActionData> => ({
  id,
  data: {
    protocol: 'Yearn',
    vaultId: definition.id,
    vaultName: vault?.name || definition.name,
    chainId: definition.chainId,
    yearnUrl: `https://yearn.fi/vaults/${definition.chainId}/${definition.address}`,
    ...data
  }
})

const parse = (contract: Interface, calldata: string) => {
  try {
    return contract.parseTransaction({ data: calldata })
  } catch {
    return null
  }
}

export function recognizeYearnAction(
  calldata: string,
  context: RecognitionContext
): Action<YearnActionData> | undefined {
  if (!hasNoNativeValue(context.value)) return undefined
  const target = context.contractAddress
  const approval = parse(approve, calldata)
  if (approval?.name === 'approve') {
    const spender = approval.args[0] as string
    const definition = definitionForTarget(context.chainId, spender)
    if (!definition) return undefined
    const vault = hydratedVault(definition, context.vaults)
    if (!isExpectedApproval(definition, target, spender)) return undefined
    return action(
      'yearn:approve',
      definition,
      {
        action: 'approve',
        amountRaw: (approval.args[1] as bigint).toString(),
        amountType: 'assets',
        token: getAddress(target.toLowerCase()),
        spender: getAddress(spender.toLowerCase()),
        ...tokenMetadata(definition, vault, target)
      },
      vault
    )
  }

  const definition = definitionForTarget(context.chainId, target)
  if (!definition || !context.account) return undefined
  const vault = hydratedVault(definition, context.vaults)
  const isRoot = sameAddress(target, definition.address)
  const companion = definition.companions?.find(({ address }) => sameAddress(address, target))
  const isPeriphery = definition.periphery?.some((address) => sameAddress(address, target))

  if (isRoot || companion) {
    const standard = parse(erc4626, calldata)
    if (standard?.name === 'deposit' && accountMatches(standard.args[1], context.account)) {
      return action(
        companion?.id === 'staked' ? 'yearn:stake' : 'yearn:deposit',
        definition,
        {
          action: companion?.id === 'staked' ? 'stake' : 'deposit',
          amountRaw: (standard.args[0] as bigint).toString(),
          amountType: 'assets',
          receiver: getAddress((standard.args[1] as string).toLowerCase()),
          ...outputTokenMetadata(definition, vault, target),
          ...(companion
            ? tokenMetadata(definition, vault, definition.address)
            : tokenMetadata(definition, vault, definition.asset.address))
        },
        vault
      )
    }
    if (
      ['withdraw', 'redeem'].includes(standard?.name || '') &&
      accountMatches(standard?.args[1], context.account) &&
      accountMatches(standard?.args[2], context.account)
    ) {
      return action(
        'yearn:withdraw',
        definition,
        {
          action: 'withdraw',
          amountRaw: (standard?.args[0] as bigint).toString(),
          amountType: standard?.name === 'withdraw' ? 'assets' : 'shares',
          receiver: getAddress((standard?.args[1] as string).toLowerCase()),
          owner: getAddress((standard?.args[2] as string).toLowerCase()),
          ...tokenMetadata(
            definition,
            vault,
            standard?.name === 'withdraw'
              ? companion
                ? definition.address
                : definition.asset.address
              : target
          )
        },
        vault
      )
    }
  }

  if (companion?.id === 'locked') {
    const locked = parse(yvUsdLocked, calldata)
    if (locked?.name === 'startCooldown') {
      return action(
        'yearn:start-cooldown',
        definition,
        {
          action: 'start-cooldown',
          amountRaw: (locked.args[0] as bigint).toString(),
          amountType: 'shares',
          ...tokenMetadata(definition, vault, target)
        },
        vault
      )
    }
    if (locked?.name === 'cancelCooldown') {
      return action('yearn:cancel-cooldown', definition, { action: 'cancel-cooldown' }, vault)
    }
  }

  if (isPeriphery && definition.kind === 'yvUSD') {
    const zap = parse(yvUsdZap, calldata)
    if (zap?.name === 'zapIn' && accountMatches(zap.args[1], context.account)) {
      return action(
        'yearn:deposit',
        definition,
        {
          action: 'deposit',
          amountRaw: (zap.args[0] as bigint).toString(),
          amountType: 'assets',
          receiver: getAddress((zap.args[1] as string).toLowerCase()),
          ...outputTokenMetadata(
            definition,
            vault,
            definition.companions?.find(({ id }) => id === 'locked')?.address || ''
          ),
          ...tokenMetadata(definition, vault, definition.asset.address)
        },
        vault
      )
    }
    if (zap?.name === 'zapOut' && accountMatches(zap.args[1], context.account)) {
      return action(
        'yearn:withdraw',
        definition,
        {
          action: 'withdraw',
          amountRaw: (zap.args[0] as bigint).toString(),
          amountType: 'shares',
          receiver: getAddress((zap.args[1] as string).toLowerCase()),
          ...tokenMetadata(
            definition,
            vault,
            definition.companions?.find(({ id }) => id === 'locked')?.address || ''
          )
        },
        vault
      )
    }
  }

  if (isPeriphery && definition.kind === 'yBOLD') {
    const zap = parse(yBoldZap, calldata)
    if (zap?.name === 'zapIn' && accountMatches(zap.args[1], context.account)) {
      return action(
        'yearn:deposit',
        definition,
        {
          action: 'deposit',
          amountRaw: (zap.args[0] as bigint).toString(),
          amountType: 'assets',
          receiver: getAddress((zap.args[1] as string).toLowerCase()),
          ...outputTokenMetadata(
            definition,
            vault,
            definition.companions?.find(({ id }) => id === 'staked')?.address || ''
          ),
          ...tokenMetadata(definition, vault, definition.asset.address)
        },
        vault
      )
    }
    if (
      zap?.name === 'zapOut' &&
      accountMatches(zap.args[1], context.account) &&
      (zap.args[2] as bigint) === 0n
    ) {
      return action(
        'yearn:withdraw',
        definition,
        {
          action: 'withdraw',
          amountRaw: (zap.args[0] as bigint).toString(),
          amountType: 'shares',
          receiver: getAddress((zap.args[1] as string).toLowerCase()),
          maxLossBps: 0,
          ...tokenMetadata(
            definition,
            vault,
            definition.companions?.find(({ id }) => id === 'staked')?.address || ''
          )
        },
        vault
      )
    }
  }

  return undefined
}

const definitionForWorkflow = (workflow: YearnWorkflow) => {
  const definition = YEARN_CATALOG.find(
    ({ id, chainId }) => id === workflow.vaultId && chainId === workflow.chainId
  )
  if (!definition) throw new Error('Yearn workflow is not in the curated catalog')
  return definition
}

const expectedApprovalToken = (workflow: YearnWorkflow) => {
  const definition = definitionForWorkflow(workflow)
  if (workflow.action === 'deposit') return definition.asset.address
  if (workflow.action === 'stake') return definition.address
  if (workflow.action === 'withdraw' && ['locked', 'staked'].includes(workflow.variant)) {
    const companion = definition.companions?.find(({ id }) => id === workflow.variant)
    if (!companion) throw new Error('Yearn workflow variant is unavailable')
    return companion.address
  }
  throw new Error('Yearn workflow has an unexpected approval')
}

export function assertYearnWorkflowStep(
  workflow: YearnWorkflow,
  step: YearnWorkflowStep,
  vault?: YearnVault
) {
  const recognized = recognizeYearnAction(step.data, {
    contractAddress: step.target,
    chainId: workflow.chainId,
    account: workflow.account,
    value: '0x0',
    ...(vault && { vaults: [vault] })
  })
  if (!recognized?.data || recognized.data.vaultId !== workflow.vaultId) {
    throw new Error('Persisted Yearn transaction no longer matches the curated vault')
  }
  const expectedIds: Record<YearnWorkflowStep['kind'], ActionType> = {
    approve: 'yearn:approve',
    revoke: 'yearn:approve',
    deposit: 'yearn:deposit',
    withdraw: 'yearn:withdraw',
    redeem: 'yearn:withdraw',
    stake: 'yearn:stake',
    'start-cooldown': 'yearn:start-cooldown',
    'cancel-cooldown': 'yearn:cancel-cooldown'
  }
  if (recognized.id !== expectedIds[step.kind]) throw new Error('Persisted Yearn action type changed')

  const expectedAmount = step.amountRaw
  if (step.kind !== 'cancel-cooldown' && recognized.data.amountRaw !== expectedAmount) {
    throw new Error('Persisted Yearn amount changed')
  }
  if (step.kind === 'revoke' && (step.amountRaw !== '0' || recognized.data.amountRaw !== '0')) {
    throw new Error('Persisted Yearn revoke must set allowance to zero')
  }
  if (['approve', 'revoke'].includes(step.kind)) {
    const token =
      workflow.action === 'revoke' && workflow.parentWorkflowId
        ? recognized.data.token
        : expectedApprovalToken(workflow)
    if (
      !token ||
      !sameAddress(step.target, token) ||
      !sameAddress(step.approvalToken, token) ||
      !sameAddress(step.approvalSpender, recognized.data.spender)
    ) {
      throw new Error('Persisted Yearn approval scope changed')
    }
  }
  return recognized
}

export const YearnRecognitionInterfaces = { approve, erc4626, yvUsdZap, yvUsdLocked, yBoldZap }
