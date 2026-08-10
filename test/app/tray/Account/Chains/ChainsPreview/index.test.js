import Restore from 'react-restore'

import { ChainsPreview } from '../../../../../../app/tray/Account/Chains/ChainsPreview'
import { render, screen } from '../../../../../componentSetup'

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

const renderMonitor = () => {
  const store = Restore.create(
    {
      main: {
        networks: {
          ethereum: {
            1: { id: 1, name: 'Mainnet', on: true },
            10: { id: 10, name: 'Optimism', on: true }
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
  return render(<ConnectedPreview moduleId='chains' />)
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

it('reveals gas suggestions and action estimates with one disclosure target', async () => {
  const { user } = renderMonitor()
  const disclosure = screen.getByRole('button', { name: 'Mainnet: 2 gwei. Show gas details.' })

  await user.click(disclosure)

  expect(disclosure.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Next base fee')).toBeTruthy()
  expect(screen.getByText('Recommended total fee')).toBeTruthy()
  expect(screen.getByText('Priority fee')).toBeTruthy()
  expect(screen.getByText('Send ETH')).toBeTruthy()
  expect(screen.getByLabelText('Estimated fees')).toBeTruthy()
})

it('collapses the disclosure when switching networks', async () => {
  const { user } = renderMonitor()
  await user.click(screen.getByRole('button', { name: 'Mainnet: 2 gwei. Show gas details.' }))
  await user.click(screen.getByRole('button', { name: 'Next network' }))

  expect(screen.getByRole('button', { name: 'Optimism: 1 gwei. Show gas details.' })).toBeTruthy()
  expect(screen.queryByText('Next base fee')).toBeNull()
})
