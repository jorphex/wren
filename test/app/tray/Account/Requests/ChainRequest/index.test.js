import { screen, render } from '../../../../../componentSetup'
import { ChainRequest } from '../../../../../../app/tray/Account/Requests/ChainRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({ send: jest.fn() }))

beforeEach(() => link.send.mockReset())

it('shows the proposed network evidence and copies exact endpoints', async () => {
  const { user } = render(
    <ChainRequest
      originName='example.test'
      req={{
        handlerId: 'add-request',
        type: 'addChain',
        chain: {
          type: 'ethereum',
          id: 10,
          name: 'Optimism',
          symbol: 'ETH',
          nativeCurrencyDecimals: 18,
          rpcUrls: ['https://optimism.example/rpc'],
          explorer: 'https://explorer.optimism.example'
        }
      }}
    />
  )

  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText('Add Optimism to Wren?')).toBeTruthy()
  expect(screen.getByText('10')).toBeTruthy()
  expect(screen.getByText('ETH · 18 decimals')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Copy proposed RPC endpoint' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', 'https://optimism.example/rpc')
})
