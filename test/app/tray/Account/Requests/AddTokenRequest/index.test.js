import { render, screen } from '../../../../../componentSetup'
import { AddTokenRequest } from '../../../../../../app/tray/Account/Requests/AddTokenRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({ send: jest.fn() }))

beforeEach(() => link.send.mockReset())

it('emphasizes token contract identity and the separate editor confirmation', async () => {
  const address = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const { user } = render(
    <AddTokenRequest
      chainData={{ chainName: 'Ethereum' }}
      originName='example.test'
      req={{
        handlerId: 'token-request',
        type: 'addToken',
        token: { address, chainId: 1, decimals: 6, name: 'USD Coin', symbol: 'USDC' }
      }}
    />
  )

  expect(screen.getByText('Add USDC to your token list?')).toBeTruthy()
  expect(screen.getByText('USD Coin · USDC')).toBeTruthy()
  expect(screen.getByText('Ethereum · 1')).toBeTruthy()
  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText('Nothing is added until you confirm it in the token editor.')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Copy proposed token contract' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)
})
