import { getAddress } from 'ethers'

import {
  buildYearnRevokeWorkflow,
  buildYearnWorkflow,
  YearnWorkflowInterfaces
} from '../../../../main/yearn/workflows/builders'
import {
  YEARN_CATALOG,
  YEARN_YBOLD_STAKED_ADDRESS,
  YEARN_YBOLD_ZAP_ADDRESS,
  YEARN_YVUSD_LOCKED_ADDRESS,
  YEARN_YVUSD_ZAP_ADDRESS
} from '../../../../main/yearn/catalog'
import type { YearnVault } from '../../../../resources/domain/yearn'

const account = '0x94112434c4C3EA14a4328A5D9383a00e78d772eb'
let id = 0
const createId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`

const vault = (catalogId: string): YearnVault => {
  const definition = YEARN_CATALOG.find(({ id }) => id === catalogId)
  if (!definition) throw new Error('Missing fixture definition')
  const asset = {
    address:
      definition.kind === 'yBOLD'
        ? '0x6440f144b7e50D6a8439336510312d2F54beB01D'
        : '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: definition.kind === 'yBOLD' ? 'BOLD' : 'USD Coin',
    symbol: definition.kind === 'yBOLD' ? 'BOLD' : 'USDC',
    decimals: definition.kind === 'yBOLD' ? 18 : 6
  }
  const variant = (variantId: 'direct' | 'unlocked' | 'locked' | 'staked', address: string) => ({
    id: variantId,
    address,
    name: `${definition.name} ${variantId}`,
    symbol: variantId === 'staked' ? 'ysyBOLD' : variantId === 'locked' ? 'styvUSD' : 'yvTOKEN',
    asset,
    decimals: 18,
    tvlUsd: 1,
    apy: { value: 0.05, label: 'Est. APY' as const, source: 'fixture' }
  })
  const variants = [variant(definition.kind === 'yvUSD' ? 'unlocked' : 'direct', definition.address)]
  for (const companion of definition.companions || []) variants.push(variant(companion.id, companion.address))
  return {
    ...definition,
    symbol: variants[0].symbol,
    asset,
    decimals: 18,
    tvlUsd: 1,
    apy: variants[0].apy,
    riskLevel: 2,
    riskLabel: 'Moderate',
    performanceFeeBps: 0,
    managementFeeBps: 0,
    inceptionTime: 1,
    yearnUrl: `https://yearn.fi/vaults/${definition.chainId}/${definition.address}`,
    status: 'available',
    variants
  }
}

beforeEach(() => {
  id = 0
})

it('builds a direct exact-approval deposit to the allowlisted vault', () => {
  const subject = vault('base-yvusdc-h')
  const result = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'deposit',
    variant: 'direct',
    amountRaw: 12_500_000n,
    displayAmount: '12.5',
    max: false,
    allowance: 0n,
    createId
  })

  expect(result.policyVersion).toBe(1)
  expect(result.steps.map(({ kind }) => kind)).toEqual(['approve', 'deposit'])
  expect(result.steps[0].target).toBe(getAddress(subject.asset.address))
  expect(YearnWorkflowInterfaces.erc20.decodeFunctionData('approve', result.steps[0].data)).toEqual([
    getAddress(subject.address),
    12_500_000n
  ])
  expect(YearnWorkflowInterfaces.erc4626.decodeFunctionData('deposit', result.steps[1].data)).toEqual([
    12_500_000n,
    getAddress(account)
  ])
})

it('resets a mismatched allowance before setting the exact amount', () => {
  const result = buildYearnWorkflow({
    vault: vault('base-yvusdc-h'),
    account,
    action: 'deposit',
    variant: 'direct',
    amountRaw: 5n,
    displayAmount: '5',
    max: false,
    allowance: 9n,
    createId
  })

  expect(result.steps.map(({ kind }) => kind)).toEqual(['revoke', 'approve', 'deposit'])
  expect(YearnWorkflowInterfaces.erc20.decodeFunctionData('approve', result.steps[0].data)[1]).toBe(0n)
  expect(YearnWorkflowInterfaces.erc20.decodeFunctionData('approve', result.steps[1].data)[1]).toBe(5n)
})

it('uses redeem for Max and withdraw for an exact direct asset amount', () => {
  const subject = vault('ethereum-yvusds-1')
  const exact = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'withdraw',
    variant: 'direct',
    amountRaw: 8n,
    displayAmount: '8',
    max: false,
    allowance: 0n,
    createId
  })
  const max = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'withdraw',
    variant: 'direct',
    amountRaw: 11n,
    displayAmount: 'Max',
    max: true,
    allowance: 0n,
    createId
  })

  expect(exact.steps[0].kind).toBe('withdraw')
  expect(YearnWorkflowInterfaces.erc4626.parseTransaction({ data: exact.steps[0].data })?.name).toBe(
    'withdraw'
  )
  expect(max.steps[0].kind).toBe('redeem')
  expect(max.steps[0].label).toBe(`Withdraw maximum from ${subject.name}`)
  expect(YearnWorkflowInterfaces.erc4626.parseTransaction({ data: max.steps[0].data })?.name).toBe('redeem')
})

it('uses only the pinned yvUSD contracts for locked product flows', () => {
  const subject = vault('ethereum-yvusd')
  const deposit = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'deposit',
    variant: 'locked',
    amountRaw: 10n,
    displayAmount: '0.00001',
    max: false,
    allowance: 0n,
    createId
  })
  const cooldown = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'start-cooldown',
    variant: 'locked',
    amountRaw: 20n,
    displayAmount: '20',
    max: true,
    allowance: 0n,
    createId
  })
  const cancel = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'cancel-cooldown',
    variant: 'locked',
    amountRaw: 0n,
    displayAmount: '0',
    max: false,
    allowance: 0n,
    createId
  })

  expect(deposit.steps[1].target).toBe(getAddress(YEARN_YVUSD_ZAP_ADDRESS))
  expect(cooldown.steps[0].target).toBe(getAddress(YEARN_YVUSD_LOCKED_ADDRESS))
  expect(cancel.steps[0].target).toBe(getAddress(YEARN_YVUSD_LOCKED_ADDRESS))
})

it('exits locked yvUSD through the current direct locked and unlocked vault path', () => {
  const subject = vault('ethereum-yvusd')
  const exact = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'withdraw',
    variant: 'locked',
    amountRaw: 1_000_000n,
    operationAmountRaw: 900_000n,
    secondaryAmountRaw: 1_000_000n,
    displayAmount: '1',
    max: false,
    allowance: 0n,
    createId
  })
  const max = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'withdraw',
    variant: 'locked',
    amountRaw: 1_100_000n,
    operationAmountRaw: 800_000n,
    secondaryAmountRaw: 950_000n,
    displayAmount: 'Max',
    max: true,
    allowance: 0n,
    createId
  })

  expect(exact.steps.map(({ kind, target }) => [kind, target])).toEqual([
    ['withdraw', getAddress(YEARN_YVUSD_LOCKED_ADDRESS)],
    ['withdraw', getAddress(subject.address)]
  ])
  expect(max.steps.map(({ kind, target }) => [kind, target])).toEqual([
    ['redeem', getAddress(YEARN_YVUSD_LOCKED_ADDRESS)],
    ['redeem', getAddress(subject.address)]
  ])
  expect(exact.steps.some(({ kind }) => kind === 'approve')).toBe(false)
  expect(YearnWorkflowInterfaces.erc4626.decodeFunctionData('withdraw', exact.steps[0].data)[0]).toBe(
    900_000n
  )
  expect(YearnWorkflowInterfaces.erc4626.decodeFunctionData('withdraw', exact.steps[1].data)[0]).toBe(
    1_000_000n
  )
})

it('forces yBOLD deposits and exits through the staked product with zero maxLoss', () => {
  const subject = vault('ethereum-ybold')
  const deposit = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'deposit',
    variant: 'staked',
    amountRaw: 10n,
    displayAmount: '10',
    max: false,
    allowance: 0n,
    createId
  })
  const exit = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'withdraw',
    variant: 'staked',
    amountRaw: 7n,
    displayAmount: '7',
    max: true,
    allowance: 0n,
    createId
  })

  expect(deposit.steps[1].target).toBe(getAddress(YEARN_YBOLD_ZAP_ADDRESS))
  expect(exit.steps[1].target).toBe(getAddress(YEARN_YBOLD_ZAP_ADDRESS))
  expect(YearnWorkflowInterfaces.yBoldZap.decodeFunctionData('zapOut', exit.steps[1].data)).toEqual([
    7n,
    getAddress(account),
    0n
  ])
})

it('stakes existing yBOLD directly into the pinned staked vault', () => {
  const subject = vault('ethereum-ybold')
  const result = buildYearnWorkflow({
    vault: subject,
    account,
    action: 'stake',
    variant: 'direct',
    amountRaw: 4n,
    displayAmount: '4',
    max: true,
    allowance: 0n,
    createId
  })

  expect(result.steps[1].target).toBe(getAddress(YEARN_YBOLD_STAKED_ADDRESS))
  expect(YearnWorkflowInterfaces.erc4626.decodeFunctionData('deposit', result.steps[1].data)).toEqual([
    4n,
    getAddress(account)
  ])
})

it('rejects unsupported product and variant combinations', () => {
  expect(() =>
    buildYearnWorkflow({
      vault: vault('base-yvusdc-h'),
      account,
      action: 'deposit',
      variant: 'locked',
      amountRaw: 1n,
      displayAmount: '1',
      max: false,
      allowance: 0n,
      createId
    })
  ).toThrow('locked is not available')
})

it('builds a zero-allowance cleanup workflow tied to its parent', () => {
  const parent = buildYearnWorkflow({
    vault: vault('base-yvusdc-h'),
    account,
    action: 'deposit',
    variant: 'direct',
    amountRaw: 1n,
    displayAmount: '0.000001',
    max: false,
    allowance: 0n,
    createId
  })
  const revoke = buildYearnRevokeWorkflow(parent, parent.steps[0], 10, createId)

  expect(revoke.parentWorkflowId).toBe(parent.id)
  expect(revoke.policyVersion).toBe(1)
  expect(revoke.action).toBe('revoke')
  expect(YearnWorkflowInterfaces.erc20.decodeFunctionData('approve', revoke.steps[0].data)[1]).toBe(0n)
})
