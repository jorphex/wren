import { render, screen } from '../../../../../componentSetup'
import { AddTokenRequest } from '../../../../../../app/tray/Account/Requests/AddTokenRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true })),
  send: jest.fn()
}))

beforeEach(() => {
  link.invoke.mockClear()
  link.send.mockReset()
})

it('emphasizes the proposed token contract identity', async () => {
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
  expect(screen.getByText('Token identity supplied by the site. Check the contract address.')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Copy proposed token contract' }))
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: address })
})
