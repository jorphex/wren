import { act, render, screen } from '../../../../componentSetup'
import { DappDetails } from '../../../../../app/dash/Dapps/DappDetails'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn(), rpc: jest.fn() }))

jest.mock(
  '../../../../../resources/Components/ChainIdentityMark',
  () =>
    function MockChainIdentityMark(props) {
      return <span data-chain-mark={props.chainId} />
    }
)

let permissions
let origin

class DappDetailsHarness extends DappDetails {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.permissions') return permissions
    if (path[0] === 'main.permissions' && path[1]) return permissions[path[1]]
    if (key === 'main.origins.origin') return origin
    if (key === 'main.networks.ethereum') return { 1: { on: true }, 137: { on: true } }
    if (key === 'main.networks.ethereum.1.on') return true
    if (key === 'main.networks.ethereum.137.on') return true
    if (key === 'main.networks.ethereum.1') return { id: 1, name: 'Ethereum', on: true }
    if (key === 'main.networks.ethereum.137') return { id: 137, name: 'Polygon', on: true }
    if (key === 'main.networksMeta.ethereum.1') return { primaryColor: 'accent1' }
    if (key === 'main.networksMeta.ethereum.137') return { primaryColor: 'accent7' }
  }
}

beforeEach(() => {
  permissions = {}
  link.rpc.mockReset()
  link.send.mockClear()
  origin = { chain: { id: 1 }, name: 'example.test' }
})

test('announces the selected default network', () => {
  render(<DappDetailsHarness originId='origin' />)

  expect(screen.getByText('Account access')).toBeTruthy()
  expect(screen.getByText('No active account access')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Ethereum' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Ethereum' }).disabled).toBe(true)
  expect(document.querySelector('[data-chain-mark="1"]')).toBeTruthy()
})

test('switches an app network once and releases the pending guard', async () => {
  const { user } = render(<DappDetailsHarness originId='origin' />)
  const polygon = screen.getByRole('button', { name: 'Polygon' })

  await user.dblClick(polygon)

  expect(link.send.mock.calls).toEqual([['tray:action', 'switchOriginChain', 'origin', 137, 'ethereum']])
  expect(polygon.disabled).toBe(true)

  act(() => jest.advanceTimersByTime(500))
  expect(screen.getByRole('button', { name: 'Polygon' }).disabled).toBe(false)
})

test('clears a pending network-switch timer on unmount', async () => {
  const ref = { current: null }
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  const { unmount, user } = render(<DappDetailsHarness ref={ref} originId='origin' />)

  await user.click(screen.getByRole('button', { name: 'Polygon' }))
  const switchTimer = ref.current.switchTimer
  unmount()

  expect(clearTimeoutSpy).toHaveBeenCalledWith(switchTimer)
  clearTimeoutSpy.mockRestore()
})

test('renders a safe status when a connected app disappears', () => {
  origin = undefined
  render(<DappDetailsHarness originId='origin' />)

  expect(screen.getByRole('status').textContent).toBe('This connected app is no longer available.')
})

test('does not dispatch a chain change after the connected app becomes stale', async () => {
  const { user } = render(<DappDetailsHarness originId='origin' />)
  const polygon = screen.getByRole('button', { name: 'Polygon' })
  origin = undefined

  await user.click(polygon)

  expect(link.send).not.toHaveBeenCalled()
  expect(polygon.disabled).toBe(false)
})

test('opens permissions on the exact account after selecting it', async () => {
  const account = '0x1111111111111111111111111111111111111111'
  permissions[account] = {
    origin: {
      handlerId: 'origin',
      origin: 'example.test',
      version: 1,
      provider: true,
      parentCapability: 'eth_accounts',
      caveats: [{ type: 'wren:permissionScope', value: { expiresAt: Date.now() + 60000 } }]
    }
  }
  let finish
  link.rpc.mockImplementation((method, address, callback) => {
    finish = callback
  })
  const { user } = render(<DappDetailsHarness originId='origin' />)
  await user.click(screen.getByRole('button', { name: /Manage access/ }))
  expect(link.rpc).toHaveBeenCalledWith('setSigner', account, expect.any(Function))
  expect(link.send).not.toHaveBeenCalled()
  act(() => finish(null))
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'expandedModule',
    data: { id: 'permissions', account, title: 'Apps with access' }
  })
})
