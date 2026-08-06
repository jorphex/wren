import Restore from 'react-restore'

import { act, render, screen } from '../../../componentSetup'
import { Dapps } from '../../../../app/dash/Dapps'

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
