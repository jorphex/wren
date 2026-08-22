import Restore from 'react-restore'

import { act, render, screen } from '../../../componentSetup'
import { Dapps, OriginModuleComponent } from '../../../../app/dash/Dapps'
import link from '../../../../resources/link'
import { MAX_TIMER_DELAY } from '../../../../resources/domain/connectedApps'
import { FRAME_SEND_ORIGIN } from '../../../../resources/domain/origin'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

jest.mock(
  '../../../../resources/Components/ChainIdentityMark',
  () =>
    function MockChainIdentityMark(props) {
      return <span data-chain-mark={props.chainId} />
    }
)

const chain = {
  id: 1,
  name: 'Ethereum',
  on: true,
  connection: { endpoints: [{ id: 'rpc-1', connected: true }] }
}
const RECENT_ORIGIN_TTL = 60 * 60 * 1000
const account = '0x0000000000000000000000000000000000000001'
const permission = (handlerId, origin, expiresAt = Date.now() + 60_000) => ({
  version: 1,
  handlerId,
  origin,
  provider: true,
  parentCapability: 'eth_accounts',
  caveats: [
    {
      type: 'wren:permissionScope',
      value: {
        account,
        methods: ['eth_accounts'],
        chains: ['0x1'],
        expiresAt
      }
    }
  ],
  grantedAt: Date.now()
})

function renderDapps(
  origins,
  permissions = {},
  networks = { 1: chain },
  networksMeta = { 1: { primaryColor: 'accent1', icon: '' } }
) {
  const store = Restore.create({
    main: {
      networks: { ethereum: networks },
      networksMeta: { ethereum: networksMeta },
      origins,
      permissions
    }
  })
  const ConnectedDapps = Restore.connect(Dapps, store)
  return render(<ConnectedDapps data={{}} />)
}

test('shows one global empty state when there is no app activity', () => {
  renderDapps({})

  expect(screen.getByText('No app activity')).toBeTruthy()
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
  expect(screen.getByText('Active · No account access')).toBeTruthy()
  expect(
    screen.getByText('Recent activity, account access, and default networks across all accounts.')
  ).toBeTruthy()
  expect(screen.queryByText('avg reqs/min')).toBeNull()
  expect(document.querySelector('[data-chain-mark="1"]')).toBeTruthy()
  expect(screen.queryByText('No app activity')).toBeNull()
})

test('renders application activity while metadata is unavailable', () => {
  renderDapps(
    {
      origin: {
        chain: { id: 1 },
        name: 'example.test',
        session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
      }
    },
    {},
    { 1: chain },
    {}
  )

  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText('Active · No account access')).toBeTruthy()
  expect(document.querySelector('[data-chain-mark="1"]')).toBeTruthy()
})

test('shows global account-access scope without exposing account addresses', () => {
  const secondAccount = '0x0000000000000000000000000000000000000002'
  renderDapps(
    {
      origin: {
        chain: { id: 1 },
        name: 'example.test',
        session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
      }
    },
    {
      [account]: { origin: permission('origin', 'example.test') },
      [secondAccount]: {
        origin: {
          ...permission('origin', 'example.test'),
          caveats: [
            {
              ...permission('origin', 'example.test').caveats[0],
              value: {
                ...permission('origin', 'example.test').caveats[0].value,
                account: secondAccount
              }
            }
          ]
        }
      }
    }
  )

  expect(screen.getByText('Active · Access to 2 accounts')).toBeTruthy()
  expect(screen.queryByText(account)).toBeNull()
  expect(screen.queryByText(secondAccount)).toBeNull()
})

test('opens connected-app details once from native keyboard input', async () => {
  const { user } = renderDapps({
    origin: {
      chain: { id: 1 },
      name: 'example.test',
      session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
    }
  })
  const app = screen.getByRole('button', {
    name: /^Open example\.test app details, active · no account access/
  })
  expect(app.getAttribute('aria-describedby')).toBeNull()

  app.focus()
  await user.keyboard('{Enter}')

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navDash', { view: 'dapps', data: { dappDetails: 'origin' } }]
  ])
  expect(app.disabled).toBe(true)

  expect(app.disabled).toBe(true)
})

test('ignores duplicate connected-app activation', async () => {
  const { user } = renderDapps({
    origin: {
      chain: { id: 1 },
      name: 'example.test',
      session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
    }
  })

  await user.dblClick(
    screen.getByRole('button', { name: /^Open example\.test app details, active · no account access/ })
  )

  expect(link.send).toHaveBeenCalledTimes(1)
})

test('clears its navigation guard on unmount', () => {
  const ref = { current: null }
  const origin = {
    id: 'origin',
    name: 'example.test',
    session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
  }
  const { unmount } = render(<OriginModuleComponent ref={ref} connected origin={origin} />)

  ref.current.navigationPending = true
  unmount()

  expect(ref.current).toBeNull()
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

  expect(screen.getByText('No app activity')).toBeTruthy()
  expect(screen.queryByText('recent.test')).toBeNull()
})

test('keeps an expired disconnected app visible while any account retains its permission', () => {
  const lastUpdatedAt = Date.now() - RECENT_ORIGIN_TTL - 1
  renderDapps(
    {
      origin: {
        chain: { id: 1 },
        name: 'durable.test',
        session: { startedAt: lastUpdatedAt, endedAt: lastUpdatedAt, lastUpdatedAt, requests: 1 }
      }
    },
    {
      [account]: {
        origin: permission('origin', 'durable.test')
      }
    }
  )

  expect(screen.getByText('durable.test')).toBeTruthy()
  expect(screen.getByText('Inactive · Access to 1 account')).toBeTruthy()
})

test('reschedules long permission deadlines and removes an app at the exact boundary', () => {
  const now = Date.now()
  const lastUpdatedAt = now - RECENT_ORIGIN_TTL - 1
  const expiresAt = now + MAX_TIMER_DELAY + 1_000
  renderDapps(
    {
      origin: {
        chain: { id: 1 },
        name: 'expiring.test',
        session: { startedAt: lastUpdatedAt, endedAt: lastUpdatedAt, lastUpdatedAt, requests: 1 }
      }
    },
    {
      [account]: {
        origin: permission('origin', 'expiring.test', expiresAt)
      }
    }
  )

  expect(screen.getByText('Inactive · Access to 1 account')).toBeTruthy()
  act(() => jest.advanceTimersByTime(MAX_TIMER_DELAY))
  expect(screen.getByText('expiring.test')).toBeTruthy()
  act(() => jest.advanceTimersByTime(999))
  expect(screen.getByText('expiring.test')).toBeTruthy()
  act(() => jest.advanceTimersByTime(1))
  expect(screen.getByText('No app activity')).toBeTruthy()
  expect(screen.queryByText('expiring.test')).toBeNull()
  jest.setSystemTime(now)
})

test('does not expose managed Wren Send activity as a connected app', () => {
  renderDapps(
    {
      managed: {
        chain: { id: 1 },
        name: FRAME_SEND_ORIGIN,
        session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
      }
    },
    {
      account: {
        managed: { handlerId: 'send-dapp-native', origin: FRAME_SEND_ORIGIN, provider: true }
      }
    }
  )

  expect(screen.getByText('No app activity')).toBeTruthy()
  expect(screen.queryByText(FRAME_SEND_ORIGIN)).toBeNull()
})
