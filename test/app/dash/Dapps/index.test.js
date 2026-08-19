import Restore from 'react-restore'

import { act, render, screen } from '../../../componentSetup'
import { Dapps, OriginModuleComponent } from '../../../../app/dash/Dapps'
import link from '../../../../resources/link'
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
const permission = (handlerId, origin) => ({
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
        expiresAt: Date.now() + 60_000
      }
    }
  ],
  grantedAt: Date.now()
})

function renderDapps(origins, permissions = {}, networks = { 1: chain }) {
  const store = Restore.create({
    main: {
      networks: { ethereum: networks },
      networksMeta: { ethereum: { 1: { primaryColor: 'accent1', icon: '' } } },
      origins,
      permissions
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
  expect(screen.getByText('Connected')).toBeTruthy()
  expect(screen.getByText('avg reqs/min')).toBeTruthy()
  expect(document.querySelector('[data-chain-mark="1"]')).toBeTruthy()
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
  const app = screen.getByRole('button', {
    name: /^Open example\.test connection details, connected/
  })
  expect(document.getElementById(app.getAttribute('aria-describedby')).textContent).toMatch(/avg reqs\/min/)

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
    screen.getByRole('button', { name: /^Open example\.test connection details, connected/ })
  )

  expect(link.send).toHaveBeenCalledTimes(1)
})

test('clears connected request-rate updates on unmount', () => {
  const ref = { current: null }
  const clearIntervalSpy = jest.spyOn(global, 'clearInterval')
  const origin = {
    id: 'origin',
    name: 'example.test',
    session: { startedAt: 100, lastUpdatedAt: 100, requests: 1 }
  }
  const { unmount } = render(<OriginModuleComponent ref={ref} connected origin={origin} />)

  const requestUpdates = ref.current.requestUpdates
  unmount()

  expect(clearIntervalSpy).toHaveBeenCalledWith(requestUpdates)
  clearIntervalSpy.mockRestore()
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
        permission: permission('permission', 'durable.test')
      }
    }
  )

  expect(screen.getByText('durable.test')).toBeTruthy()
  expect(screen.getByText('Access granted')).toBeTruthy()
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

  expect(screen.getByText('No connected apps')).toBeTruthy()
  expect(screen.queryByText(FRAME_SEND_ORIGIN)).toBeNull()
})
