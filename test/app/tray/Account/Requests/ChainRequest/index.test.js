import { screen, render } from '../../../../../componentSetup'
import { ChainRequest } from '../../../../../../app/tray/Account/Requests/ChainRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true })),
  send: jest.fn()
}))

beforeEach(() => {
  link.invoke.mockClear()
  link.send.mockReset()
})

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
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', {
    secret: false,
    value: 'https://optimism.example/rpc'
  })
})

it('shows the requesting site and both networks without implying account access', () => {
  render(
    <ChainRequest
      originName='https://basescan.org'
      chainData={{ sourceChainName: 'Ethereum', destinationChainName: 'Base' }}
      req={{
        handlerId: 'switch-request',
        type: 'switchChain',
        sourceChainId: 1,
        chain: { type: 'ethereum', id: 8453 }
      }}
    />
  )

  expect(screen.getByText('Switch to Base?')).toBeTruthy()
  expect(screen.getByText('https://basescan.org')).toBeTruthy()
  expect(screen.getByText('Ethereum')).toBeTruthy()
  expect(screen.getByText('Base')).toBeTruthy()
  expect(screen.getByText('8453')).toBeTruthy()
  expect(screen.getByText(/does not share your account/i)).toBeTruthy()
  expect(screen.getByText(/must still ask before Wren shares your address/i)).toBeTruthy()
})

it('uses neutral network fallbacks instead of rendering undefined identifiers', () => {
  const { rerender } = render(
    <ChainRequest req={{ handlerId: 'switch-request', type: 'switchChain', chain: { type: 'ethereum' } }} />
  )

  expect(screen.getByText('Switch to Unknown network?')).toBeTruthy()
  expect(screen.getAllByText('Unknown network')).toHaveLength(2)
  expect(screen.getByText('Not supplied')).toBeTruthy()
  expect(document.body.textContent).not.toContain('undefined')

  rerender(<ChainRequest req={{ handlerId: 'add-request', type: 'addChain', chain: { type: 'ethereum' } }} />)
  expect(screen.getByText('Add Unknown network to Wren?')).toBeTruthy()
  expect(document.body.textContent).not.toContain('undefined')
})
