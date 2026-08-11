jest.mock('electron-log', () => ({ info: console.log, error: jest.fn() }))
jest.mock('electron', () => ({ app: { on: jest.fn(), getPath: jest.fn() } }))
jest.mock('fs')

let mockLatestVersion = 0
let mockInterfaceScale = 2

jest.mock('../../../../main/store/migrate', () => {
  return {
    latest: mockLatestVersion,
    apply: (state) => {
      return mockLatestVersion === 2
        ? { ...state, main: { ...state.main, _version: 2, instanceId: 'test-brand-new-frame' } }
        : { ...state }
    }
  }
})

jest.mock('../../../../main/store/persist', () => {
  const get = (path) => {
    if (path === 'main')
      // simulate state that has already been migrated to version 2
      return {
        __: {
          1: {
            main: {
              _version: 1,
              instanceId: 'test-frame'
            }
          },
          2: {
            main: {
              _version: 2,
              instanceId: 'test-brand-new-frame',
              interfaceScale: mockInterfaceScale,
              privacy: { errorReporting: true },
              accounts: {
                '0x000000000000000000000000000000000000dead': {
                  name: 'Legacy account',
                  legacyMarker: 'preserved',
                  balances: { lastUpdated: 123 }
                }
              }
            }
          }
        }
      }
  }

  return { get }
})

afterEach(() => {
  mockInterfaceScale = 2
  // ensure modules are reloaded before each test
  jest.resetModules()
})

it('rejects state containing a snapshot newer than this Wren build supports', async () => {
  mockLatestVersion = 1

  await expect(import('../../../../main/store/state')).rejects.toThrow(
    'Saved state version 2 is newer than Wren supports'
  )
})

it('loads values from the current version of the state', async () => {
  // load state migrated to version 2 and make sure version 2 value is the one that's read
  mockLatestVersion = 2

  const { default: state } = await import('../../../../main/store/state')

  expect(state().main.instanceId).toBe('test-brand-new-frame')
  expect(state().main.interfaceScale).toBe(1)
  expect(state().view.interfaceScaleEffective).toBe(1)
})

it('restores a supported requested interface scale', async () => {
  mockLatestVersion = 2
  mockInterfaceScale = 1.5

  const { default: state } = await import('../../../../main/store/state')

  expect(state().main.interfaceScale).toBe(1.5)
})

it('uses PublicNode for every built-in network with a public preset', async () => {
  mockLatestVersion = 2

  const { default: state } = await import('../../../../main/store/state')
  const networks = state().main.networks.ethereum
  const publicNodeChains = Object.values(networks)
    .filter((network) => network.connection.endpoints[0].current === 'publicnode')
    .map((network) => network.id)
    .sort((left, right) => left - right)

  expect(publicNodeChains).toEqual([1, 10, 137, 8453, 42161, 84532, 11155111, 11155420])
  for (const chainId of [1, 10, 137, 8453, 42161, 84532, 11155111, 11155420]) {
    expect(networks[chainId].connection.endpoints[0].current).toBe('publicnode')
  }
  expect(JSON.stringify(state().main.networksMeta)).not.toContain('frame.nyc3.cdn.digitaloceanspaces.com')
  expect(state().main.mute).not.toHaveProperty('migrateToPylon')
  expect(state().panel.account.moduleOrder).toEqual([
    'requests',
    'chains',
    'balances',
    'permissions',
    'signer',
    'settings'
  ])
})

it('does not restore the removed upstream error-reporting preference', async () => {
  mockLatestVersion = 2

  const { default: state } = await import('../../../../main/store/state')

  expect(state().main).not.toHaveProperty('privacy')
})

it('preserves legacy account fields while clearing session balance timestamps', async () => {
  mockLatestVersion = 2

  const { default: state } = await import('../../../../main/store/state')
  const account = state().main.accounts['0x000000000000000000000000000000000000dead']

  expect(account).toMatchObject({ name: 'Legacy account', legacyMarker: 'preserved' })
  expect(account.balances).toEqual({ lastUpdated: undefined })
})

it('preserves an older version of the state after creating a newer state entry', async () => {
  mockLatestVersion = 2

  jest.dontMock('../../../../main/store/persist')
  const { default: fs } = await import('fs')
  const { default: persist } = await import('../../../../main/store/persist')
  const { default: state } = await import('../../../../main/store/state')

  persist.set('main', state().main)

  const writtenState = JSON.parse(fs.__getWrittenData())

  expect(writtenState.main.__['1'].main.instanceId).toBe('test-frame')
  expect(writtenState.main.__['2'].main.instanceId).toBe('test-brand-new-frame')
}, 500)
