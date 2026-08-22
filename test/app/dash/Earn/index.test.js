import Restore from 'react-restore'

import { act, render, screen, waitFor } from '../../../componentSetup'
import {
  Earn,
  activityPreviewLimit,
  formatPercentLabel,
  formatReceiptAmount,
  positionsMatchAccount,
  workflowsForAccount
} from '../../../../app/dash/Earn'
import {
  getYearnCatalog,
  getYearnCatalogSnapshot,
  getYearnPositions,
  getYearnWorkflows,
  revokeYearnWorkflow,
  startYearnWorkflow
} from '../../../../app/dash/Earn/api'
import link from '../../../../resources/link'

jest.mock('../../../../app/dash/Earn/api', () => ({
  getYearnCatalog: jest.fn(),
  getYearnCatalogSnapshot: jest.fn(),
  getYearnPositions: jest.fn(),
  getYearnWorkflows: jest.fn(),
  startYearnWorkflow: jest.fn(),
  resumeYearnWorkflow: jest.fn(),
  cancelYearnWorkflow: jest.fn(),
  revokeYearnWorkflow: jest.fn()
}))
jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const address = '0x0000000000000000000000000000000000000001'

it('keeps selected-account workflows visible without position data', () => {
  const workflows = [
    { id: 'selected', vaultId: 'vault-1', account: address.toUpperCase() },
    { id: 'other-vault', vaultId: 'vault-2', account: address },
    { id: 'other-account', vaultId: 'vault-1', account: '0x0000000000000000000000000000000000000002' }
  ]

  expect(workflowsForAccount(workflows, 'vault-1', address)).toEqual([workflows[0]])
  expect(workflowsForAccount(workflows, 'vault-1', '')).toEqual([])
})

it('does not repeat an unavailable percentage label', () => {
  expect(formatPercentLabel(undefined, 'Unavailable')).toBe('Unavailable')
  expect(formatPercentLabel(null, 'UNAVAILABLE')).toBe('Unavailable')
  expect(formatPercentLabel(0.07, 'Est. APY')).toBe('7% Est. APY')
})

const makeVault = (id, chainId, chainName, kind = 'direct') => ({
  id,
  chainId,
  chainName,
  address,
  kind,
  name: id === 'ethereum-yvusd' ? 'yvUSD' : `${chainName} Vault`,
  symbol: 'yvUSDC',
  description: 'A curated Yearn vault.',
  asset: { address, name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  decimals: 6,
  tvlUsd: 1_500_000,
  apy: { value: 0.0512, label: 'Est. APY', source: 'estimated' },
  riskLevel: 1,
  riskLabel: 'Conservative',
  performanceFeeBps: 1000,
  managementFeeBps: 0,
  inceptionTime: 1_700_000_000,
  yearnUrl: `https://yearn.fi/vaults/${chainId}/${address}`,
  status: 'available',
  variants:
    kind === 'yvUSD'
      ? [
          {
            id: 'unlocked',
            address,
            name: 'yvUSD',
            symbol: 'yvUSD',
            asset: { address, name: 'USD Coin', symbol: 'USDC', decimals: 6 },
            decimals: 6,
            tvlUsd: 1_000_000,
            apy: { value: 0.05, label: 'Est. APY', source: 'estimated' }
          },
          {
            id: 'locked',
            address: '0x0000000000000000000000000000000000000002',
            name: 'Locked yvUSD',
            symbol: 'Locked yvUSD',
            asset: { address, name: 'yvUSD', symbol: 'yvUSD', decimals: 6 },
            decimals: 6,
            tvlUsd: 500_000,
            apy: { value: 0.07, label: 'Est. APY', source: 'estimated' }
          }
        ]
      : [
          {
            id: 'direct',
            address,
            name: 'Vault',
            symbol: 'yvUSDC',
            asset: { address, name: 'USD Coin', symbol: 'USDC', decimals: 6 },
            decimals: 6,
            tvlUsd: 1_500_000,
            apy: { value: 0.0512, label: 'Est. APY', source: 'estimated' }
          }
        ]
})

const vaults = [
  makeVault('ethereum-yvusd', 1, 'Ethereum', 'yvUSD'),
  makeVault('base-yvusdc-h', 8453, 'Base'),
  makeVault('katana-yvvbusdc', 747474, 'Katana'),
  {
    ...makeVault('ethereum-ybold', 1, 'Ethereum', 'yBOLD'),
    name: 'Staked yBOLD',
    asset: { address, name: 'BOLD', symbol: 'BOLD', decimals: 18 },
    variants: [
      {
        ...makeVault('ethereum-ybold', 1, 'Ethereum').variants[0],
        id: 'direct',
        name: 'yBOLD',
        symbol: 'yBOLD'
      },
      {
        ...makeVault('ethereum-ybold', 1, 'Ethereum').variants[0],
        id: 'staked',
        name: 'Staked yBOLD',
        symbol: 'ysyBOLD'
      }
    ]
  }
]
const position = {
  vaultId: 'ethereum-yvusd',
  chainId: 1,
  status: 'available',
  hasPosition: true,
  assetBalanceRaw: '5000000',
  assetBalance: '5.0',
  variants: [
    {
      id: 'unlocked',
      address,
      symbol: 'yvUSD',
      decimals: 6,
      sharesRaw: '1500000',
      shares: '1.5',
      assetSymbol: 'USDC',
      assetDecimals: 6,
      assetsRaw: '1500000',
      assets: '1.5'
    }
  ]
}

const directPosition = {
  vaultId: 'base-yvusdc-h',
  chainId: 8453,
  status: 'available',
  hasPosition: true,
  assetBalanceRaw: '5000000',
  assetBalance: '5.0',
  variants: [
    {
      id: 'direct',
      address,
      symbol: 'yvUSDC',
      decimals: 6,
      sharesRaw: '1500000',
      shares: '1.5',
      assetSymbol: 'USDC',
      assetDecimals: 6,
      assetsRaw: '1500000',
      assets: '1.5'
    }
  ]
}

const lockedPosition = {
  ...position,
  variants: [
    ...position.variants,
    {
      id: 'locked',
      address: '0x0000000000000000000000000000000000000002',
      symbol: 'styvUSD',
      decimals: 6,
      sharesRaw: '2000000',
      shares: '2.0',
      assetSymbol: 'yvUSD',
      assetDecimals: 6,
      assetsRaw: '1900000',
      assets: '1.9',
      cooldown: {
        status: 'none',
        sharesRaw: '0',
        shares: '0.0',
        cooldownEnd: 0,
        windowEnd: 0,
        cooldownDuration: 1_209_600,
        withdrawalWindow: 432_000
      }
    }
  ]
}

const makeWorkflow = () => ({
  policyVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  account: address,
  vaultId: 'ethereum-yvusd',
  chainId: 1,
  action: 'deposit',
  variant: 'unlocked',
  amountRaw: '1250000',
  displayAmount: '1.25',
  symbol: 'USDC',
  max: false,
  maxLossBps: 0,
  status: 'complete',
  steps: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'deposit',
      label: 'Deposit into yvUSD',
      target: address,
      data: '0x12345678',
      amountRaw: '1250000',
      status: 'confirmed',
      txHash: `0x${'ab'.repeat(32)}`
    }
  ],
  currentStep: 0,
  createdAt: 1,
  updatedAt: 2
})

const makeReadyWorkflow = () => ({
  ...makeWorkflow(),
  status: 'ready',
  steps: [
    {
      ...makeWorkflow().steps[0],
      status: 'ready',
      txHash: undefined
    }
  ]
})

const makePositions = (readOnly = false) => ({
  account: { address, name: 'Treasury', readOnly },
  chains: [
    { chainId: 1, status: 'ready', positions: [position] },
    { chainId: 8453, status: 'disabled', reason: 'Enable this chain in Wren', positions: [] },
    { chainId: 747474, status: 'ready', positions: [] }
  ]
})

const store = Restore.create(
  {
    selected: { current: address, hideBalances: false },
    main: {
      networks: {
        ethereum: {
          1: { on: true, connection: { endpoints: [{ id: 'rpc-1', connected: true }] } },
          8453: { on: false, connection: { endpoints: [{ id: 'rpc-1', connected: false }] } },
          747474: { on: true, connection: { endpoints: [{ id: 'rpc-1', connected: true }] } }
        }
      }
    }
  },
  {}
)
const ConnectedEarn = Restore.connect(Earn, store)

const setHideBalances = (hideBalances) => {
  const state = JSON.parse(JSON.stringify(store()))
  state.selected.hideBalances = hideBalances
  act(() => store.api.replaceState(state))
}

beforeEach(() => {
  setHideBalances(false)
  const catalog = { status: 'fresh', fetchedAt: 1234, vaults, errors: [] }
  getYearnCatalog.mockResolvedValue(catalog)
  getYearnCatalogSnapshot.mockResolvedValue(catalog)
  getYearnPositions.mockResolvedValue(makePositions())
  getYearnWorkflows.mockResolvedValue({ workflows: [] })
  startYearnWorkflow.mockReset()
  revokeYearnWorkflow.mockReset()
  link.send.mockClear()
})

it('renders a saved catalog before positions, live metrics, or workflows finish loading', async () => {
  let resolveCatalog
  let resolvePositions
  let resolveWorkflows
  const freshCatalog = { status: 'fresh', fetchedAt: 1234, vaults, errors: [] }
  getYearnCatalogSnapshot.mockResolvedValue({
    ...freshCatalog,
    status: 'stale',
    fetchedAt: 1000
  })
  getYearnCatalog.mockReturnValue(
    new Promise((resolve) => {
      resolveCatalog = resolve
    })
  )
  getYearnPositions.mockReturnValue(
    new Promise((resolve) => {
      resolvePositions = resolve
    })
  )
  getYearnWorkflows.mockReturnValue(
    new Promise((resolve) => {
      resolveWorkflows = resolve
    })
  )

  render(<ConnectedEarn />)

  expect(await screen.findByRole('heading', { name: 'Ethereum' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'View yvUSD on Ethereum' })).toBeTruthy()
  expect(screen.getByText('Loading account positions…')).toBeTruthy()
  expect(screen.getByText(/Showing cached Yearn data/)).toBeTruthy()

  await act(async () => resolvePositions(makePositions()))
  expect(await screen.findByRole('button', { name: 'Manage yvUSD position' })).toBeTruthy()
  expect(screen.queryByText('Loading account positions…')).toBeNull()
  expect(screen.getByText(/Showing cached Yearn data/)).toBeTruthy()

  await act(async () => resolveCatalog(freshCatalog))
  await waitFor(() => expect(screen.queryByText(/Showing cached Yearn data/)).toBeNull())
  await act(async () => resolveWorkflows({ workflows: [] }))
}, 1500)

it('formats receipt base units without floating-point conversion', () => {
  expect(formatReceiptAmount('1200000', 6)).toBe('1.2')
  expect(formatReceiptAmount('1234567890123456789', 18)).toBe('~1.234567')
  expect(formatReceiptAmount('42', 0)).toBe('42')
})

it('fits activity cards within the remaining viewport budget', () => {
  expect(
    activityPreviewLimit({
      cardHeights: [100, 100, 100],
      total: 5,
      budget: 265,
      headingHeight: 20,
      moreHeight: 45
    })
  ).toBe(2)
  expect(
    activityPreviewLimit({
      cardHeights: [100, 100, 100],
      total: 5,
      budget: 164,
      headingHeight: 20,
      moreHeight: 45
    })
  ).toBe(0)
})

it('fails closed while positions belong to the previously selected account', () => {
  const positions = makePositions()
  expect(positionsMatchAccount(positions, address.toUpperCase())).toBe(true)
  expect(positionsMatchAccount(positions, '0x00000000000000000000000000000000000000aa')).toBe(false)
  expect(positionsMatchAccount(positions, '')).toBe(false)
})

it('shows account positions in a distinct section before the chain-separated vault catalog', async () => {
  render(<ConnectedEarn />)

  const ethereumHeading = await screen.findByRole('heading', { name: 'Ethereum' })
  expect(screen.getByRole('img', { name: 'Yearn' })).toBeTruthy()
  expect(screen.getByText('A selected set of vaults, grouped by network.')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Base' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Katana' })).toBeTruthy()
  const positionHeading = screen.getByRole('heading', { name: 'Your positions' })
  const position = screen.getByRole('button', { name: 'Manage yvUSD position' })
  const firstVault = screen.getByRole('button', { name: 'View yvUSD on Ethereum' })
  expect(positionHeading.closest('.earnPositionsOverview')).toBeTruthy()
  expect(position.closest('.earnPositionsOverview')).toBeTruthy()
  expect(position.closest('.earnChain')).toBeNull()
  expect(
    positionHeading.compareDocumentPosition(ethereumHeading) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(positionHeading.compareDocumentPosition(firstVault) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Opportunities' })).toBeNull()
  expect(screen.getAllByRole('img', { name: 'yvUSDC asset' }).length).toBeGreaterThan(0)
})

it('shows a direct vault position as a balance without exposing the internal variant name', async () => {
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 8453 ? { ...chain, status: 'ready', positions: [directPosition] } : chain
    )
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Base' })

  const card = screen.getByRole('button', { name: 'Manage Base Vault position' })
  expect(card.textContent.toLowerCase()).not.toContain('direct')

  await user.click(card)
  expect(document.querySelector('.earnOwned').textContent.toLowerCase()).not.toContain('direct')
  expect(screen.getByText('1.5 USDC')).toBeTruthy()
})

it('opens a persistent deposit form with available balance and visible Max behavior', async () => {
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 8453 ? { ...chain, status: 'ready', positions: [directPosition] } : chain
    )
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Base' })

  await user.click(screen.getByRole('button', { name: 'Manage Base Vault position' }))

  const deposit = screen.getByRole('button', { name: 'Deposit' })
  const withdraw = screen.getByRole('button', { name: 'Withdraw' })
  const amount = screen.getByRole('textbox', { name: 'Amount in USDC' })
  expect(deposit.getAttribute('aria-pressed')).toBe('true')
  expect(withdraw.getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByText('Available to deposit: 5 USDC')).toBeTruthy()
  expect(screen.queryByText(/^Position:/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Close Earn action' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Max' }))
  expect(amount.value).toBe('5.0')
  expect(screen.getByRole('button', { name: 'Max' }).getAttribute('aria-pressed')).toBe('true')

  await user.click(screen.getByRole('button', { name: 'Max' }))
  expect(amount.value).toBe('')
  await user.click(withdraw)
  expect(screen.getByText('Available to withdraw: 1.5 USDC')).toBeTruthy()
  expect(withdraw.getAttribute('aria-pressed')).toBe('true')
})

it('filters by chain without mixing vaults', async () => {
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  await user.click(screen.getByRole('tab', { name: 'Base' }))

  expect(screen.getByRole('heading', { name: 'Base' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Ethereum' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Katana' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Your positions' })).toBeNull()
})

it('supports arrow-key navigation across chain tabs', async () => {
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  const all = screen.getByRole('tab', { name: 'All' })
  all.focus()

  await user.keyboard('{ArrowRight}')

  expect(screen.getByRole('tab', { name: 'Ethereum' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByRole('heading', { name: 'Base' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Ethereum' }))
})

it('opens product details and keeps watch-only transactions disabled', async () => {
  getYearnPositions.mockResolvedValue(makePositions(true))
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))

  expect(screen.getByRole('heading', { name: 'Choose how to earn' })).toBeTruthy()
  expect(screen.getByText('Est. APY')).toBeTruthy()
  expect(screen.getByText(/14-day cooldown/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Deposit' }).disabled).toBe(true)
  expect(screen.getByText(/Watch-only accounts/)).toBeTruthy()
  expect(screen.queryByText(/Performance fee/)).toBeNull()
  expect(screen.queryByText(/Yearn data updated/)).toBeNull()
  expect(screen.getByRole('button', { name: 'View vault contract (external)' })).toBeTruthy()
  const disclosure = screen.getByText(
    'APY is variable and not guaranteed. Yearn vaults involve smart-contract and strategy risk.'
  )
  expect(
    disclosure.compareDocumentPosition(screen.getByRole('button', { name: /^Flexible/ })) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    disclosure.compareDocumentPosition(document.querySelector('.earnActions')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    disclosure.compareDocumentPosition(
      screen.getByRole('button', { name: 'View vault contract (external)' })
    ) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

it('keeps the watch-only capability notice visible through a transient positions failure', async () => {
  getYearnPositions
    .mockResolvedValueOnce(makePositions(true))
    .mockRejectedValueOnce(new Error('positions unavailable'))
  const { user, rerender } = render(<ConnectedEarn data={{}} />)

  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await screen.findByText('Account positions could not be refreshed.')).toBeTruthy()

  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }} />)

  await screen.findByRole('heading', { name: 'Choose how to earn' })
  expect(screen.getByText('Account positions could not be refreshed.')).toBeTruthy()
  expect(screen.getByText(/Watch-only accounts/)).toBeTruthy()
})

it('uses APY as the metric label when null APY is already labeled unavailable', async () => {
  const unavailableVault = {
    ...vaults[0],
    apy: { value: null, label: 'UNAVAILABLE', source: 'unavailable' },
    variants: vaults[0].variants.map((variant) => ({
      ...variant,
      apy: { value: null, label: 'UNAVAILABLE', source: 'unavailable' }
    }))
  }
  const catalog = { status: 'fresh', fetchedAt: 1234, vaults: [unavailableVault], errors: [] }
  getYearnCatalog.mockResolvedValue(catalog)
  getYearnCatalogSnapshot.mockResolvedValue(catalog)

  render(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }} />)

  await screen.findByRole('heading', { name: 'Choose how to earn' })
  expect(document.querySelector('.earnMetricLabel').textContent).toBe('APY')
  expect(document.querySelector('.earnMetricValue').textContent).toBe('Unavailable')
  expect(document.body.textContent).not.toMatch(/Unavailable\s+UNAVAILABLE/iu)
})

it('moves focus through vault details and restores the invoking controls', async () => {
  const { user, rerender } = render(<ConnectedEarn data={{}} />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  const vaultButton = screen.getByRole('button', { name: 'View yvUSD on Ethereum' })

  await user.click(vaultButton)
  expect(document.activeElement).toBe(document.querySelector('.earnDetails'))
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
    view: 'earn',
    data: { vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }
  })
  expect(screen.queryByRole('button', { name: '<- All vaults' })).toBeNull()

  const depositButton = screen.getByRole('button', { name: 'Deposit' })
  expect(screen.queryByRole('button', { name: 'Close Earn action' })).toBeNull()
  await user.click(depositButton)
  expect(document.activeElement).toBe(document.querySelector('.earnActionForm'))

  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }} />)
  rerender(<ConnectedEarn data={{}} />)
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))
  )
})

it('uses selected locked yvUSD metrics and labels root risk explicitly', async () => {
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))
  await user.click(screen.getByRole('button', { name: /^Locked/ }))

  expect(screen.getByText('7%')).toBeTruthy()
  expect(screen.getByText('$500,000.0')).toBeTruthy()
  expect(screen.getByText('Underlying vault risk')).toBeTruthy()
  expect(link.send).toHaveBeenCalledWith(
    'nav:update',
    'dash',
    {
      view: 'earn',
      data: { vaultId: 'ethereum-yvusd', variant: 'locked', screen: 'vault' }
    },
    false
  )
})

it('uses the selected variant APY label in the detail metric', async () => {
  const labeledVaults = vaults.map((vault) =>
    vault.id === 'ethereum-yvusd'
      ? {
          ...vault,
          variants: vault.variants.map((variant) =>
            variant.id === 'locked'
              ? { ...variant, apy: { ...variant.apy, label: '7-day average APY' } }
              : variant
          )
        }
      : vault
  )
  const catalog = { status: 'fresh', fetchedAt: 1234, vaults: labeledVaults, errors: [] }
  getYearnCatalog.mockResolvedValue(catalog)
  getYearnCatalogSnapshot.mockResolvedValue(catalog)

  render(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'locked', screen: 'vault' }} />)

  await screen.findByRole('heading', { name: 'Choose how to earn' })
  expect(document.querySelector('.earnMetricLabel').textContent).toBe('7-day average APY')
})

it('conceals every account-derived Earn amount while keeping public metrics visible', async () => {
  const workflow = {
    ...makeWorkflow(),
    steps: [
      {
        ...makeWorkflow().steps[0],
        receiptTransfers: [
          {
            token: address,
            direction: 'in',
            amountRaw: '1200000',
            symbol: 'yvUSD',
            decimals: 6
          }
        ]
      }
    ]
  }
  const privacyPosition = {
    ...lockedPosition,
    variants: lockedPosition.variants.map((variant) =>
      variant.id === 'locked'
        ? {
            ...variant,
            cooldown: { ...variant.cooldown, sharesRaw: '2000000', shares: '2.0' }
          }
        : variant
    )
  }
  setHideBalances(true)
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 1 ? { ...chain, positions: [privacyPosition] } : chain
    )
  })
  getYearnWorkflows.mockResolvedValue({ workflows: [workflow] })
  const { user, rerender } = render(<ConnectedEarn data={{}} />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  const vaultCard = screen.getByRole('button', { name: 'View yvUSD on Ethereum' })
  const positionCard = screen.getByRole('button', { name: 'Manage yvUSD position' })
  expect(vaultCard.textContent).toContain('5.12%')
  expect(vaultCard.textContent).toContain('TVL')
  expect(vaultCard.textContent).toContain('•••• USDC available')
  expect(positionCard.textContent).toContain('•••• USDC')
  expect(document.body.textContent).not.toContain('1.5 USDC')
  expect(document.body.textContent).not.toContain('1.9 yvUSD')
  expect(document.body.textContent).not.toContain('2 styvUSD')
  expect(document.body.textContent).not.toContain('5 USDC')

  await user.click(positionCard)
  expect(document.querySelector('.earnOwned').textContent).toContain('•••• USDC')
  expect(screen.getByText('Available to deposit: •••• USDC')).toBeTruthy()
  expect(document.querySelector('.earnWorkflowAmount').textContent).toContain('•••• USDC')
  expect(screen.getByTitle(address).textContent).toMatch(/Received.*••••.*yvUSD/)

  await user.click(screen.getByRole('button', { name: 'Max' }))
  expect(screen.getByRole('textbox', { name: 'Amount in USDC' }).value).toBe('')
  expect(screen.getByRole('button', { name: 'Max' }).getAttribute('aria-pressed')).toBe('true')

  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'activity' }} />)
  await screen.findByRole('heading', { name: 'Earn activity' })
  expect(document.querySelector('.earnWorkflowAmount').textContent).toContain('•••• USDC')
  expect(screen.getByTitle(address).textContent).toMatch(/Received.*••••.*yvUSD/)
  expect(document.body.textContent).not.toContain('1.25 USDC')
  expect(document.body.textContent).not.toContain('1.2 yvUSD')
})

it('explains an inactive locked withdrawal cooldown in user-facing terms', async () => {
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 1 ? { ...chain, positions: [lockedPosition] } : chain
    )
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  await user.click(screen.getByRole('button', { name: 'Manage yvUSD position' }))

  expect(screen.getByText('Locked withdrawal timing')).toBeTruthy()
  expect(screen.getByText(/No cooldown is active/)).toBeTruthy()
  expect(screen.queryByText(/Locked yvUSD: none/)).toBeNull()
})

it('describes approvals only for routes that can request them', async () => {
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'Manage yvUSD position' }))

  expect(screen.getByText(/requests only the exact amount/i)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Withdraw' }))
  expect(screen.getByText(/does not request a token approval/i)).toBeTruthy()
  expect(screen.queryByText(/requests only the exact amount/i)).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Deposit' }))
  expect(screen.getByText(/requests only the exact amount/i)).toBeTruthy()
})

it('describes staking as staking rather than a withdrawal', async () => {
  const yBoldPosition = {
    ...directPosition,
    vaultId: 'ethereum-ybold',
    chainId: 1,
    variants: [{ ...directPosition.variants[0], symbol: 'yBOLD' }]
  }
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 1 ? { ...chain, positions: [position, yBoldPosition] } : chain
    )
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  await user.click(screen.getByRole('button', { name: 'Manage Staked yBOLD position' }))
  await user.click(screen.getByRole('button', { name: 'Stake existing yBOLD' }))

  expect(screen.getByText('Stake existing yBOLD and receive ysyBOLD.')).toBeTruthy()
  expect(screen.getByText('Available to stake: 1.5 yBOLD')).toBeTruthy()
  expect(screen.queryByText(/Withdraw directly/)).toBeNull()
})

it('resets the persistent action to deposit when the selected account changes', () => {
  const component = new Earn({})
  const nextAddress = '0x0000000000000000000000000000000000000002'
  component.accountKey = address
  component.state = { ...component.state, form: { action: 'deposit' } }
  component.store = jest.fn((path) => {
    if (path === 'selected.current') return nextAddress
    return {}
  })
  component.storeKey = component.currentStoreKey()
  component.setState = jest.fn()
  component.loadPositions = jest.fn()

  component.componentDidUpdate({})

  expect(component.setState).toHaveBeenCalledWith({
    form: {
      action: 'deposit',
      variant: '',
      amount: '',
      max: false,
      busy: false,
      error: ''
    },
    error: ''
  })
})

it('refreshes its store identity when an RPC endpoint connection changes', () => {
  const component = new Earn({})
  const endpoints = [
    { on: true, connected: true, current: 'public', custom: '' },
    { on: true, connected: false, current: 'fallback', custom: '' }
  ]
  component.store = jest.fn((path, id) => {
    if (path === 'selected.current') return address
    if (path === 'main.networks.ethereum' && id === 1) {
      return { on: true, connection: { endpoints } }
    }
    return {}
  })

  const initialKey = component.currentStoreKey()
  endpoints[0].connected = false
  endpoints[1].connected = true

  expect(component.currentStoreKey()).not.toBe(initialKey)
})

it('keeps persisted workflow mutations disabled for a watch-only account', async () => {
  getYearnPositions.mockResolvedValue(makePositions(true))
  const approvalWorkflow = {
    ...makeReadyWorkflow(),
    id: '00000000-0000-4000-8000-000000000004',
    status: 'canceled',
    error: 'Approval transaction confirmed, but the token allowance remains nonzero',
    currentStep: 1,
    steps: [
      {
        ...makeReadyWorkflow().steps[0],
        kind: 'approve',
        status: 'confirmed',
        approvalToken: address,
        approvalSpender: address
      },
      { ...makeReadyWorkflow().steps[0], id: '00000000-0000-4000-8000-000000000003', status: 'error' }
    ]
  }
  getYearnWorkflows.mockResolvedValue({ workflows: [makeReadyWorkflow(), approvalWorkflow] })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))

  expect(screen.getByRole('button', { name: 'Resume' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Revoke approval' }).disabled).toBe(true)
})

it('does not present unexecuted steps as ready after a workflow was canceled', async () => {
  getYearnWorkflows.mockResolvedValue({
    workflows: [{ ...makeReadyWorkflow(), status: 'canceled' }]
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))

  const step = screen.getByText('Deposit into yvUSD').closest('li')
  expect(step.textContent.toLowerCase()).toContain('canceled')
  expect(step.textContent.toLowerCase()).not.toContain('ready')
})

it('bounds recent activity and opens the complete history without nested scrolling', async () => {
  const workflows = Array.from({ length: 5 }, (_, index) => ({
    ...makeWorkflow(),
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    displayAmount: String(index + 1),
    updatedAt: index + 1,
    steps: [
      {
        ...makeWorkflow().steps[0],
        id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`
      }
    ]
  }))
  getYearnWorkflows.mockResolvedValue({ workflows })
  const { user, rerender } = render(<ConnectedEarn data={{}} />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))

  expect(document.querySelectorAll('.earnWorkflowsPreview .earnWorkflow')).toHaveLength(3)
  expect(document.querySelector('.earnDetailsFooter')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'View 2 more' }))

  expect(screen.getByRole('heading', { name: 'Earn activity' })).toBeTruthy()
  expect(document.querySelectorAll('.earnWorkflowsExpanded .earnWorkflow')).toHaveLength(5)
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
    view: 'earn',
    data: { vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'activity' }
  })
  expect(screen.queryByRole('button', { name: '<- Vault details' })).toBeNull()

  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'activity' }} />)
  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }} />)
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View 2 more' }))
  )
})

it('restores activity-back focus to vault details when there is no more-activity button', async () => {
  getYearnWorkflows.mockResolvedValue({ workflows: [makeWorkflow()] })
  const { rerender } = render(
    <ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'activity' }} />
  )
  await screen.findByRole('heading', { name: 'Earn activity' })
  expect(document.querySelector('.earnMoreButton')).toBeNull()

  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }} />)

  await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.earnDetails')))
})

it('announces a total catalog failure', async () => {
  getYearnCatalogSnapshot.mockRejectedValue(new Error('snapshot unavailable'))
  getYearnCatalog.mockRejectedValue(new Error('catalog unavailable'))

  render(<ConnectedEarn />)

  expect((await screen.findByRole('alert')).textContent).toBe(
    'Current Yearn vault data could not be refreshed.'
  )
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
})

it('shows one account-position failure without repeating chain or signer notices', async () => {
  getYearnPositions.mockRejectedValue(new Error('positions unavailable'))
  const { rerender } = render(<ConnectedEarn data={{}} />)

  await screen.findByRole('heading', { name: 'Ethereum' })
  expect(screen.getAllByText('Account positions could not be refreshed.')).toHaveLength(1)
  expect(screen.queryByText('Position data is unavailable.')).toBeNull()

  rerender(<ConnectedEarn data={{ vaultId: 'ethereum-yvusd', variant: 'unlocked', screen: 'vault' }} />)
  await screen.findByRole('heading', { name: 'Choose how to earn' })
  expect(screen.getAllByText('Account positions could not be refreshed.')).toHaveLength(1)
  expect(screen.queryByText('Select a signing account to transact.')).toBeNull()
})

it('requires a separate recheck before offering to retry an unknown approval cleanup', async () => {
  const cleanup = {
    ...makeWorkflow(),
    action: 'revoke',
    status: 'canceled',
    cleanupRecovery: 'unknown-outcome',
    error: 'Request outcome is unknown after restart; verify the account on-chain before starting again',
    steps: [
      {
        ...makeWorkflow().steps[0],
        kind: 'revoke',
        status: 'error',
        approvalToken: address,
        approvalSpender: address
      }
    ]
  }
  const rechecked = {
    ...cleanup,
    cleanupRecovery: 'allowance-nonzero',
    error: 'Allowance remains nonzero; verify no prior request is pending before choosing Revoke again'
  }
  revokeYearnWorkflow
    .mockResolvedValueOnce(rechecked)
    .mockResolvedValueOnce({ ...rechecked, status: 'active', cleanupRecovery: undefined, error: undefined })
  getYearnWorkflows.mockResolvedValue({ workflows: [cleanup] })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))

  await user.click(screen.getByRole('button', { name: 'Recheck approval' }))
  expect(revokeYearnWorkflow).toHaveBeenCalledWith(cleanup.id)

  await user.click(await screen.findByRole('button', { name: 'Revoke again' }))
  expect(revokeYearnWorkflow).toHaveBeenCalledTimes(2)
})

it('opens chain settings explicitly instead of activating a chain', async () => {
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Base' })

  await user.click(screen.getByRole('button', { name: 'Manage networks' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view: 'chains', data: {} })
})

it('refreshes catalog and positions as one user action', async () => {
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })

  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(getYearnCatalog).toHaveBeenLastCalledWith(true))
  expect(getYearnPositions).toHaveBeenCalledTimes(2)
})

it('builds a locked yvUSD deposit intent from explicit variant and amount choices', async () => {
  startYearnWorkflow.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000001',
    account: address,
    vaultId: 'ethereum-yvusd',
    chainId: 1,
    action: 'deposit',
    variant: 'locked',
    amountRaw: '1250000',
    displayAmount: '1.25',
    symbol: 'USDC',
    max: false,
    maxLossBps: 0,
    status: 'active',
    steps: [],
    currentStep: 0,
    createdAt: 1,
    updatedAt: 1
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))
  await user.click(screen.getByRole('button', { name: /^Locked/ }))
  await user.click(screen.getByRole('button', { name: 'Deposit' }))
  await user.type(screen.getByRole('textbox', { name: 'Amount in USDC' }), '1.25')
  await user.click(screen.getByRole('button', { name: 'Review Deposit' }))

  expect(startYearnWorkflow).toHaveBeenCalledWith({
    vaultId: 'ethereum-yvusd',
    action: 'deposit',
    variant: 'locked',
    amount: '1.25',
    max: false
  })
})

it('builds a locked yvUSD cooldown intent from the on-chain position state', async () => {
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 1 ? { ...chain, positions: [lockedPosition] } : chain
    )
  })
  startYearnWorkflow.mockResolvedValue(makeWorkflow())
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'Manage yvUSD position' }))
  await user.click(screen.getByRole('button', { name: 'Start locked cooldown' }))
  await user.click(screen.getByRole('button', { name: 'Max' }))
  await user.click(screen.getByRole('button', { name: 'Review Start cooldown' }))

  expect(startYearnWorkflow).toHaveBeenCalledWith({
    vaultId: 'ethereum-yvusd',
    action: 'start-cooldown',
    variant: 'locked',
    amount: '1.9',
    max: true
  })
})

it('shows cooldown-held locked shares in the withdrawal form', async () => {
  const coolingPosition = {
    ...lockedPosition,
    variants: lockedPosition.variants.map((variant) =>
      variant.id === 'locked'
        ? {
            ...variant,
            sharesRaw: '0',
            shares: '0.0',
            assetsRaw: '0',
            assets: '0.0',
            cooldown: {
              ...variant.cooldown,
              status: 'withdrawal-window',
              sharesRaw: '2000000',
              shares: '2.0'
            }
          }
        : variant
    )
  }
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 1 ? { ...chain, positions: [coolingPosition] } : chain
    )
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'Manage yvUSD position' }))
  await user.click(screen.getByRole('button', { name: /^Locked/ }))
  await user.click(screen.getByRole('button', { name: 'Withdraw' }))

  expect(screen.getByText('Shares in withdrawal window: 2 styvUSD')).toBeTruthy()
  expect(screen.queryByText('Position: 0 yvUSD')).toBeNull()
})

it('disables cooldown actions when the on-chain cooldown read failed', async () => {
  const unreadableCooldown = {
    ...lockedPosition,
    variants: lockedPosition.variants.map((variant) =>
      variant.id === 'locked' ? { ...variant, cooldown: null } : variant
    )
  }
  getYearnPositions.mockResolvedValue({
    ...makePositions(),
    chains: makePositions().chains.map((chain) =>
      chain.chainId === 1 ? { ...chain, positions: [unreadableCooldown] } : chain
    )
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'Manage yvUSD position' }))

  expect(screen.getByRole('button', { name: 'Start locked cooldown' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Cancel cooldown' }).disabled).toBe(true)
})

it('links confirmed workflow steps to the matching chain explorer', async () => {
  const workflow = {
    ...makeWorkflow(),
    steps: [
      {
        ...makeWorkflow().steps[0],
        receiptTransfers: [
          {
            token: address,
            direction: 'in',
            amountRaw: '1200000',
            symbol: 'yvUSD',
            decimals: 6
          }
        ]
      }
    ]
  }
  getYearnWorkflows.mockResolvedValue({ workflows: [workflow] })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'View yvUSD on Ethereum' }))
  expect(screen.getByTitle(address).textContent).toMatch(/Received.*1\.2.*yvUSD/)
  await user.click(screen.getByRole('button', { name: 'View transaction' }))

  expect(link.send).toHaveBeenCalledWith(
    'tray:openExplorer',
    { type: 'ethereum', id: 1 },
    workflow.steps[0].txHash
  )
})

it('disables stale deposits while preserving exits from an existing position', async () => {
  getYearnCatalog.mockResolvedValue({
    status: 'stale',
    fetchedAt: 1234,
    vaults: vaults.map((vault) =>
      vault.id === 'ethereum-yvusd'
        ? { ...vault, status: 'unavailable', statusReason: 'No longer eligible' }
        : vault
    ),
    errors: [{ message: 'Kong unavailable' }]
  })
  const { user } = render(<ConnectedEarn />)
  await screen.findByRole('heading', { name: 'Ethereum' })
  await user.click(screen.getByRole('button', { name: 'Manage yvUSD position' }))

  expect(screen.getByRole('button', { name: 'Deposit' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Withdraw' }).disabled).toBe(false)
  expect(screen.getByText(/Existing positions remain withdrawable/)).toBeTruthy()
})
