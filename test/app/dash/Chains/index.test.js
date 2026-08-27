import Restore from 'react-restore'

import { Settings } from '../../../../app/dash/Chains'
import { ChainHeader } from '../../../../app/dash/Chains/Chain/Components'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../../resources/Components/RingIcon', () => () => null)

const renderChains = () => {
  const store = Restore.create(
    {
      main: {
        accounts: { wallet: {} },
        origins: {},
        networks: {
          ethereum: {
            1: {
              id: 1,
              name: 'Ethereum',
              on: true,
              isTestnet: false,
              connection: { endpoints: [{ connected: true, status: 'connected' }] }
            },
            11155111: {
              id: 11155111,
              name: 'Sepolia',
              on: false,
              isTestnet: true,
              connection: { endpoints: [{ connected: true, status: 'connected' }] }
            }
          }
        },
        networksMeta: { ethereum: {} }
      }
    },
    {}
  )
  const ConnectedChains = Restore.connect(Settings, store)
  return render(<ConnectedChains data={{}} />)
}

test('keeps the compact default to active networks while All reveals disabled testnets', () => {
  renderChains()

  expect(screen.getByRole('heading', { name: 'Connected' })).toBeTruthy()
  expect(document.querySelector('.dashNetworksCount')).toBeNull()
  expect(document.querySelector('.dashNetworksCardHeader .dashNetworkScopeControls')).toBeTruthy()
  expect(document.querySelector('.dashNetworkScope')).toBeNull()
  expect(screen.getByText('Ethereum')).toBeTruthy()
  expect(screen.queryByText('Sepolia')).toBeNull()
  expect(screen.getByRole('button', { name: 'Active' }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'All' }))

  expect(screen.getByRole('heading', { name: 'Networks' })).toBeTruthy()
  expect(screen.getByText('Sepolia')).toBeTruthy()
  expect(screen.getByText('Testnets')).toBeTruthy()
})

test('moves Add into the network card and replaces primary Control destinations', () => {
  renderChains()

  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  fireEvent.click(screen.getByRole('button', { name: 'Overview Control center home.' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navDash', { view: 'chains', data: { newChain: {} } }],
    ['tray:action', 'navReplace', 'dash', []]
  ])
})

test('renders network identity without an invalid custom ARIA role', () => {
  render(
    <ChainHeader
      type='ethereum'
      id={1}
      name='Ethereum'
      isTestnet={false}
      on={true}
      showExpand={false}
      showToggle={false}
    />
  )

  const identity = screen.getByText('Ethereum')
  expect(identity.tagName).toBe('SPAN')
  expect(identity.getAttribute('role')).toBeNull()
})
