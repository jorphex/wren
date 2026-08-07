import Restore from 'react-restore'

import { act, render, screen } from '../../../componentSetup'
import { Dapps, Indicator, OriginModuleComponent } from '../../../../app/dash/Dapps'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

jest.mock(
  '../../../../resources/Components/RingIcon',
  () =>
    function MockRingIcon() {
      return <span />
    }
)

const chain = {
  id: 1,
  name: 'Ethereum',
  on: true,
  connection: { primary: { connected: true }, secondary: { connected: false } }
}
const RECENT_ORIGIN_TTL = 60 * 60 * 1000

function renderDapps(origins) {
  const store = Restore.create({
    main: {
      networks: { ethereum: { 1: chain } },
      networksMeta: { ethereum: { 1: { primaryColor: 'accent1', icon: '' } } },
      origins
    }
  })
  const ConnectedDapps = Restore.connect(Dapps, store)
  return render(<ConnectedDapps data={{}} />)
}

test('shows one global empty state when no apps are connected', () => {
  renderDapps({})

  expect(screen.getByText('No connected apps')).toBeTruthy()
  expect(screen.getByText('Open a dapp with the Wren Companion to see it here.')).toBeTruthy()
  expect(screen.getAllByAltText('')).toHaveLength(1)
})

test('renders application activity instead of the empty state', () => {
  renderDapps({
    origin: {
      chain: { id: 1 },
      name: 'example.test',
      session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
    }
  })

  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.queryByText('No connected apps')).toBeNull()
})

test('opens connected-app details once from native keyboard input', async () => {
  const { user } = renderDapps({
    origin: {
      chain: { id: 1 },
      name: 'example.test',
      session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
    }
  })
  const app = screen.getByRole('button', { name: 'Open example.test connection details' })

  app.focus()
  await user.keyboard('{Enter}')

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navDash', { view: 'dapps', data: { dappDetails: 'origin' } }]
  ])
  expect(app.disabled).toBe(true)

  act(() => jest.advanceTimersByTime(500))
  expect(screen.getByRole('button', { name: 'Open example.test connection details' }).disabled).toBe(false)
})

test('ignores duplicate connected-app activation', async () => {
  const { user } = renderDapps({
    origin: {
      chain: { id: 1 },
      name: 'example.test',
      session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
    }
  })

  await user.dblClick(screen.getByRole('button', { name: 'Open example.test connection details' }))

  expect(link.send).toHaveBeenCalledTimes(1)
})

test('clears connected-app indicator timers on unmount', () => {
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  const indicator = new Indicator({ connected: true })
  indicator.componentDidMount()

  indicator.componentWillUnmount()

  expect(clearTimeoutSpy).toHaveBeenCalledWith(indicator.activateTimer)
  expect(clearTimeoutSpy).toHaveBeenCalledWith(indicator.deactivateTimer)
  clearTimeoutSpy.mockRestore()
})

test('clears a pending connected-app navigation timer on unmount', async () => {
  const ref = { current: null }
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
  const origin = {
    id: 'origin',
    name: 'example.test',
    session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
  }
  const { unmount, user } = render(<OriginModuleComponent ref={ref} connected origin={origin} />)

  await user.click(screen.getByRole('button', { name: 'Open example.test connection details' }))
  const navigationTimer = ref.current.navigationTimer
  unmount()

  expect(clearTimeoutSpy).toHaveBeenCalledWith(navigationTimer)
  clearTimeoutSpy.mockRestore()
})

test('expires the last recently disconnected app without a store update', () => {
  const now = Date.now()
  renderDapps({
    origin: {
      chain: { id: 1 },
      name: 'recent.test',
      session: {
        startedAt: now - 120_000,
        endedAt: now - 60_000,
        lastUpdatedAt: now - RECENT_ORIGIN_TTL + 1_000,
        requests: 1
      }
    }
  })

  expect(screen.getByText('recent.test')).toBeTruthy()

  act(() => jest.advanceTimersByTime(1_002))

  expect(screen.getByText('No connected apps')).toBeTruthy()
  expect(screen.queryByText('recent.test')).toBeNull()
})
