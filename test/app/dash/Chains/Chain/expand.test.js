import Restore from 'react-restore'

import store from '../../../../../main/store'
import link from '../../../../../resources/link'
import { fireEvent, render, screen } from '../../../../componentSetup'
import ChainComponent from '../../../../../app/dash/Chains/Chain'

jest.mock('../../../../../main/store/persist')
jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock(
  '../../../../../resources/Components/RingIcon',
  () =>
    function RingIconMock({ color }) {
      return <span data-color={color} data-testid='chain-icon' />
    }
)

const Chain = Restore.connect(ChainComponent, store)
const connection = {
  endpoints: [
    {
      id: 'rpc-1',
      on: true,
      connected: true,
      current: 'custom',
      custom: 'https://rpc.example',
      status: 'connected'
    },
    {
      id: 'rpc-2',
      on: true,
      connected: false,
      current: 'custom',
      custom: 'https://fallback.example',
      status: 'connected'
    }
  ]
}
const chain = {
  id: 1337,
  type: 'ethereum',
  name: 'Leetnet',
  explorer: 'https://explorer.example',
  symbol: 'ETH',
  nativeCurrencyName: 'Ether',
  nativeCurrencyDecimals: 18,
  isTestnet: true,
  primaryColor: 'accent2',
  connection,
  on: true
}

beforeAll(() => {
  store.addNetwork({
    id: 1337,
    type: 'ethereum',
    name: 'Leetnet',
    explorer: 'https://explorer.example',
    symbol: 'ETH',
    nativeCurrencyName: 'Ether',
    nativeCurrencyDecimals: 18,
    primaryColor: 'accent2',
    on: true
  })
})

afterAll(() => store.removeNetwork({ type: 'ethereum', id: 1337 }))

beforeEach(() => link.send.mockClear())

test('renders directly editable network and RPC fields', () => {
  render(<Chain view='expanded' {...chain} />)

  expect(screen.getByRole('heading', { name: 'Edit Leetnet' })).toBeTruthy()
  expect(screen.getByLabelText('Network name').value).toBe('Leetnet')
  expect(screen.getByLabelText('Chain ID').readOnly).toBe(true)
  expect(screen.getByLabelText('RPC URL 1').value).toBe('https://rpc.example')
  expect(screen.getByLabelText('RPC URL 2').value).toBe('https://fallback.example')
  expect(screen.getAllByText('Connected')).toHaveLength(2)
})

test('commits a valid primary RPC when focus leaves the input', () => {
  render(<Chain view='expanded' {...chain} />)
  const rpc = screen.getByLabelText('RPC URL 1')

  fireEvent.change(rpc, { target: { value: ' https://new-rpc.example ' } })
  fireEvent.blur(rpc)

  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'setEndpointUrl',
    'ethereum',
    1337,
    'rpc-1',
    'https://new-rpc.example'
  )
})

test('does not enable a disabled endpoint when its URL changes', () => {
  const disabledConnection = {
    endpoints: connection.endpoints.map((endpoint) =>
      endpoint.id === 'rpc-2' ? { ...endpoint, on: false, connected: false, status: 'off' } : endpoint
    )
  }
  render(<Chain view='expanded' {...chain} connection={disabledConnection} />)
  const rpc = screen.getByLabelText('RPC URL 2')

  fireEvent.change(rpc, { target: { value: 'https://quiet.example' } })
  fireEvent.blur(rpc)

  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'setEndpointUrl',
    'ethereum',
    1337,
    'rpc-2',
    'https://quiet.example'
  )
  expect(screen.getByRole('switch', { name: 'Enable RPC endpoint 2' })).toBeTruthy()
  expect(screen.queryByText('Checking connection…')).toBeNull()
})

test('applies endpoint availability, ordering, and removal directly', async () => {
  const { user } = render(<Chain view='expanded' {...chain} />)

  await user.click(screen.getByRole('switch', { name: 'Disable RPC endpoint 2' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'toggleEndpoint', 'ethereum', 1337, 'rpc-2', false)

  await user.click(screen.getByRole('button', { name: 'Move RPC endpoint 2 up' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'moveEndpoint', 'ethereum', 1337, 'rpc-2', -1)
})

test('removes a fallback endpoint without entering a management mode', async () => {
  const { user } = render(<Chain view='expanded' {...chain} />)

  await user.click(screen.getByRole('button', { name: 'Remove RPC endpoint 2' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'removeEndpoint', 'ethereum', 1337, 'rpc-2')
  expect(screen.queryByLabelText('RPC URL 2')).toBeNull()
})

test('keeps an invalid RPC local and marks the field', () => {
  render(<Chain view='expanded' {...chain} />)
  const rpc = screen.getByLabelText('RPC URL 1')

  fireEvent.change(rpc, { target: { value: 'not-a-url' } })
  fireEvent.blur(rpc)

  expect(screen.getByText('Can’t connect')).toBeTruthy()
  expect(rpc.getAttribute('aria-invalid')).toBe('true')
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'setEndpointUrl', expect.anything())
})

test('marks an empty fallback endpoint invalid without changing persisted state', () => {
  render(<Chain view='expanded' {...chain} />)
  const fallback = screen.getByLabelText('RPC URL 2')

  fireEvent.change(fallback, { target: { value: '' } })
  fireEvent.blur(fallback)

  expect(fallback.getAttribute('aria-invalid')).toBe('true')
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'setEndpointUrl', expect.anything())
})

test('saves identity, currency decimals, and enabled state together', async () => {
  const { user } = render(<Chain view='expanded' {...chain} />)

  await user.clear(screen.getByLabelText('Network name'))
  await user.type(screen.getByLabelText('Network name'), 'Updated')
  await user.clear(screen.getByLabelText('Decimals'))
  await user.type(screen.getByLabelText('Decimals'), '6')
  await user.click(screen.getByRole('switch', { name: 'Use this network' }))
  link.send.mockClear()
  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'updateNetwork',
    expect.objectContaining({ id: 1337, type: 'ethereum' }),
    expect.objectContaining({ name: 'Updated', nativeCurrencyDecimals: 6 })
  )
  expect(link.send).toHaveBeenCalledWith('tray:action', 'activateNetwork', 'ethereum', 1337, false)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
})

test('opens the existing removal confirmation', async () => {
  const { user } = render(<Chain view='expanded' {...chain} />)
  await user.click(screen.getByRole('button', { name: 'Remove network' }))

  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'navDash',
    expect.objectContaining({ view: 'notify' })
  )
})

test('forwards the testnet identity flag through the preview', () => {
  render(
    <Chain
      view='preview'
      id={11155111}
      type='ethereum'
      name='Sepolia'
      symbol='sepETH'
      explorer='https://sepolia.etherscan.io'
      isTestnet={true}
      on={false}
    />
  )

  expect(screen.getByTestId('chain-icon').getAttribute('data-color')).toBe('var(--wren-chain-testnet)')
})
