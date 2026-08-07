import { act, render, screen } from '../../../../componentSetup'
import { DappDetails } from '../../../../../app/dash/Dapps/DappDetails'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

jest.mock(
  '../../../../../resources/Components/RingIcon',
  () =>
    function MockRingIcon() {
      return <span />
    }
)

let origin

class DappDetailsHarness extends DappDetails {
  store(...path) {
    const key = path.join('.')
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
  origin = { chain: { id: 1 }, name: 'example.test' }
})

test('announces the selected default network', () => {
  render(<DappDetailsHarness originId='origin' />)

  expect(screen.getByRole('button', { name: 'Ethereum' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Ethereum' }).disabled).toBe(true)
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
