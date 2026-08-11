import Restore from 'react-restore'

import store from '../../../../../main/store'
import link from '../../../../../resources/link'
import { render, screen } from '../../../../componentSetup'
import ChainComponent from '../../../../../app/dash/Chains/Chain'

jest.mock('../../../../../main/store/persist')
jest.mock('../../../../../resources/link', () => ({
  send: jest.fn(),
  invoke: jest.fn().mockResolvedValue({ success: true })
}))

const Chain = Restore.connect(ChainComponent, store)

const polygon = {
  id: 31337,
  type: 'ethereum',
  name: 'Polygon',
  symbol: 'POL',
  explorer: 'https://polygonscan.com',
  rpcUrls: ['https://polygon.example/rpc'],
  nativeCurrencyName: 'Polygon Ecosystem Token',
  nativeCurrencyDecimals: 18
}

beforeEach(() => {
  link.send.mockClear()
  link.invoke.mockClear()
  link.invoke.mockResolvedValue({ success: true })
})

test('renders the quiet network fields without legacy metadata controls', () => {
  render(<Chain view='setup' {...polygon} />)

  expect(screen.getByRole('heading', { name: 'Add Polygon' })).toBeTruthy()
  expect(screen.getByLabelText('Network name').value).toBe('Polygon')
  expect(screen.getByLabelText('Chain ID').value).toBe('31337')
  expect(screen.getByLabelText('Native currency').value).toBe('POL')
  expect(screen.getByLabelText('Decimals').value).toBe('18')
  expect(screen.getByLabelText('RPC URL 1').value).toBe('https://polygon.example/rpc')
  expect(screen.getByLabelText('Block explorer').value).toBe('https://polygonscan.com')
  expect(screen.queryByLabelText('RPC URL 2')).toBeNull()
  expect(screen.queryByText('Chain Color')).toBeNull()
})

test('attributes a dapp proposal without passing its origin through approval IPC', async () => {
  const requestReference = {
    account: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
    handlerId: 'e194a121-a42a-4c2f-a8e4-d90b102b2440',
    origin: 'https://uniswap.org'
  }
  const { user } = render(<Chain view='setup' {...polygon} requestReference={requestReference} />)

  expect(screen.getByText('Requested by uniswap.org')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add network' }))

  expect(link.invoke).toHaveBeenCalledWith(
    'tray:addChain',
    expect.objectContaining({ id: 31337, rpcUrls: ['https://polygon.example/rpc'] }),
    { account: requestReference.account, handlerId: requestReference.handlerId }
  )
})

test('rejects a pending dapp proposal when the editor is canceled', async () => {
  const requestReference = {
    account: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
    handlerId: 'e194a121-a42a-4c2f-a8e4-d90b102b2440',
    origin: 'https://uniswap.org'
  }
  const { user } = render(<Chain view='setup' {...polygon} requestReference={requestReference} />)

  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:rejectRequest', { account: requestReference.account, handlerId: requestReference.handlerId }],
    ['tray:action', 'backDash']
  ])
})

test('keeps proposed fallback endpoints visible and carries the reviewed values', async () => {
  const { user } = render(
    <Chain
      view='setup'
      {...polygon}
      rpcUrls={['https://polygon.example/rpc', 'https://polygon.example/fallback']}
    />
  )

  expect(screen.getByLabelText('RPC URL 2').value).toBe('https://polygon.example/fallback')
  await user.click(screen.getByRole('button', { name: 'Add network' }))

  expect(link.invoke).toHaveBeenCalledWith(
    'tray:addChain',
    expect.objectContaining({
      rpcUrls: ['https://polygon.example/rpc', 'https://polygon.example/fallback']
    })
  )
})

test('caps direct endpoint entry at five rows', async () => {
  const { user } = render(<Chain view='setup' {...polygon} />)
  const addRpc = screen.getByRole('button', { name: 'Add RPC' })

  await user.click(addRpc)
  await user.click(addRpc)
  await user.click(addRpc)
  await user.click(addRpc)

  expect(screen.getByLabelText('RPC URL 5')).toBeTruthy()
  expect(screen.queryByLabelText('RPC URL 6')).toBeNull()
  expect(addRpc.disabled).toBe(true)
  expect(screen.getByText('Maximum of 5 RPC endpoints')).toBeTruthy()
})

test('lets the user edit proposal details before approval', async () => {
  const { user } = render(<Chain view='setup' {...polygon} />)
  const rpc = screen.getByLabelText('RPC URL 1')
  const decimals = screen.getByLabelText('Decimals')

  await user.clear(rpc)
  await user.type(rpc, 'https://polygon.example/new')
  await user.clear(decimals)
  await user.type(decimals, '6')
  await user.click(screen.getByRole('button', { name: 'Add network' }))

  expect(link.invoke).toHaveBeenCalledWith(
    'tray:addChain',
    expect.objectContaining({ rpcUrls: ['https://polygon.example/new'], nativeCurrencyDecimals: 6 })
  )
})

test('keeps invalid forms quiet and unavailable', async () => {
  const { user } = render(<Chain view='setup' {...polygon} id='' rpcUrls={['']} />)
  const add = screen.getByRole('button', { name: 'Add network' })

  expect(add.disabled).toBe(true)
  expect(screen.queryByText('Enter the required details')).toBeNull()
  await user.click(add)
  expect(link.invoke).not.toHaveBeenCalled()
})

test('shows RPC feedback in the field label after focus leaves', async () => {
  const { user } = render(<Chain view='setup' {...polygon} />)
  const rpc = screen.getByLabelText('RPC URL 1')

  await user.clear(rpc)
  await user.type(rpc, 'not-a-url')
  await user.tab()

  expect(screen.getByText('Can’t connect')).toBeTruthy()
  expect(rpc.getAttribute('aria-invalid')).toBe('true')
})

test('requires HTTPS for a dapp proposal', async () => {
  const requestReference = {
    account: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
    handlerId: 'e194a121-a42a-4c2f-a8e4-d90b102b2440'
  }
  const { user } = render(
    <Chain
      view='setup'
      {...polygon}
      rpcUrls={['http://localhost:8545']}
      requestReference={requestReference}
    />
  )

  await user.click(screen.getByLabelText('RPC URL 1'))
  await user.tab()

  expect(screen.getByText('Use an HTTPS RPC URL')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add network' }).disabled).toBe(true)
})

test('uses calm failure copy when verification fails', async () => {
  link.invoke.mockResolvedValueOnce({ success: false, error: 'RPC chain mismatch' })
  const { user } = render(<Chain view='setup' {...polygon} />)

  await user.click(screen.getByRole('button', { name: 'Add network' }))

  expect(await screen.findByText('Couldn’t add network')).toBeTruthy()
  expect(screen.queryByText('RPC chain mismatch')).toBeNull()
  expect(link.send).not.toHaveBeenCalled()
})

test('changes the test-network setting', async () => {
  const { user } = render(<Chain view='setup' {...polygon} />)
  const toggle = screen.getByRole('switch', { name: 'Test network' })

  await user.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('true')
})
