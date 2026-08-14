import Restore from 'react-restore'

import { ChainsPreview } from '../../../../../../app/tray/Account/Chains/ChainsPreview'
import link from '../../../../../../resources/link'
import { render, screen } from '../../../../../componentSetup'

jest.mock('../../../../../../resources/link', () => ({ send: jest.fn() }))

const gas = (base, priority, samples = []) => ({
  price: {
    fees: {
      nextBaseFee: base,
      maxPriorityFeePerGas: priority
    },
    levels: { fast: base }
  },
  samples
})

const renderMonitor = ({ optimismExplorer = 'https://optimistic.etherscan.io' } = {}) => {
  const store = Restore.create(
    {
      main: {
        networks: {
          ethereum: {
            1: { id: 1, name: 'Mainnet', on: true, explorer: 'https://etherscan.io' },
            10: { id: 10, name: 'Optimism', on: true, explorer: optimismExplorer }
          }
        },
        networksMeta: {
          ethereum: {
            1: {
              gas: gas('0x3b9aca00', '0x3b9aca00', [
                { label: 'Send ETH', estimates: { low: { cost: { usd: 0.42 } } } }
              ]),
              primaryColor: 'wren-chain-ethereum'
            },
            10: {
              gas: gas('0x1dcd6500', '0x1dcd6500'),
              primaryColor: 'wren-chain-optimism'
            }
          }
        }
      }
    },
    {}
  )
  const ConnectedPreview = Restore.connect(ChainsPreview, store)
  return render(<ConnectedPreview account='0x0000000000000000000000000000000000000001' moduleId='chains' />)
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

beforeEach(() => {
  link.send.mockClear()
})

afterAll(() => {
  delete global.ResizeObserver
})

it('reveals gas suggestions and action estimates with one disclosure target', async () => {
  const { user } = renderMonitor()
  const disclosure = screen.getByRole('button', { name: 'Show gas details for Mainnet' })

  expect(screen.getByLabelText('Current gas price 2 gwei')).toBeTruthy()

  await user.click(disclosure)

  expect(disclosure.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Next base fee')).toBeTruthy()
  expect(screen.getByText('Recommended total fee')).toBeTruthy()
  expect(screen.getByText('Priority fee')).toBeTruthy()
  expect(screen.getByText('Send ETH')).toBeTruthy()
  expect(screen.getByLabelText('Estimated fees')).toBeTruthy()
})

it('keeps gas details expanded when switching networks', async () => {
  const { user } = renderMonitor()
  await user.click(screen.getByRole('button', { name: 'Show gas details for Mainnet' }))
  await user.click(screen.getByRole('button', { name: 'Next network from Mainnet' }))

  const disclosure = screen.getByRole('button', { name: 'Hide gas details for Optimism' })
  expect(disclosure.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByLabelText('Current gas price 1 gwei')).toBeTruthy()
  expect(screen.getByText('Next base fee')).toBeTruthy()
})

it('opens the selected account on the displayed network explorer', async () => {
  const { user } = renderMonitor()

  await user.click(screen.getByRole('button', { name: 'Next network from Mainnet' }))
  await user.click(screen.getByRole('button', { name: 'View Optimism account on block explorer' }))

  expect(link.send).toHaveBeenCalledWith(
    'tray:openExplorer',
    { type: 'ethereum', id: 10 },
    null,
    '0x0000000000000000000000000000000000000001'
  )
})

it('groups network navigation and explorer controls on the right of the identity', () => {
  renderMonitor()
  const controls = screen.getByRole('group', { name: 'Displayed network controls' })

  expect(screen.getByTestId('ethereum-mark').closest('.ringIcon').classList.contains('ringIconNoRing')).toBe(
    true
  )
  expect(screen.getByTestId('ethereum-mark').closest('.ringIconInner').style.color).toBe(
    'var(--wren-chain-ethereum)'
  )

  expect(controls.previousElementSibling.textContent).toContain('Mainnet')
  expect(
    Array.from(controls.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))
  ).toEqual([
    'Previous network from Mainnet',
    'Next network from Mainnet',
    'View Mainnet account on block explorer'
  ])
})

it('composes gas evidence with the selected network without a redundant label', () => {
  renderMonitor()
  const gasEvidence = screen.getByLabelText('Current gas price 2 gwei')
  const disclosure = screen.getByRole('button', { name: 'Show gas details for Mainnet' })
  const gasGroup = gasEvidence.closest('.chainMonitorGasEvidence')
  const divider = gasGroup.previousElementSibling
  const row = disclosure.parentElement

  expect(row.children).toHaveLength(5)
  expect(divider.nextElementSibling.contains(gasEvidence)).toBe(true)
  expect(gasGroup.nextElementSibling).toBe(disclosure)
  expect(screen.queryByText('Gas')).toBeNull()
})

it('keeps explorer placement stable and disabled when the displayed network has none', async () => {
  const { user } = renderMonitor({ optimismExplorer: '' })

  await user.click(screen.getByRole('button', { name: 'Next network from Mainnet' }))
  const explorer = screen.getByRole('button', { name: 'Block explorer unavailable for Optimism' })

  expect(explorer.disabled).toBe(true)
  await user.click(explorer)
  expect(link.send).not.toHaveBeenCalledWith('tray:openExplorer', expect.anything(), null, expect.anything())
})
