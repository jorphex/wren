import fs from 'fs'
import os from 'os'
import path from 'path'

let mockDirectory
jest.mock('electron', () => ({ app: { getPath: () => mockDirectory, on: jest.fn() } }))
jest.mock('electron-log', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))

const accountId = '0x000000000000000000000000000000000000dead'
let savedMain
let exitListeners

beforeEach(async () => {
  exitListeners = new Set(process.listeners('exit'))
  mockDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-endpoint-latency-'))
  jest.resetModules()
  const { default: createState } = await import('../../../../main/store/state')
  savedMain = createState().main
  savedMain.accounts = { [accountId]: { name: 'Retained account', signer: 'hardware-fixture' } }
  savedMain.ledger.liveAccountLimit = 12
  savedMain.hardwareDerivation = 'testnet'
  savedMain.networks.ethereum[4663] = {
    ...savedMain.networks.ethereum[1],
    id: 4663,
    name: 'Robinhood',
    connection: {
      endpoints: [
        {
          id: 'rpc-1',
          on: true,
          connected: true,
          current: 'custom',
          status: 'connected',
          custom: 'https://rpc.example/private',
          latencyMs: -4180
        },
        {
          id: 'rpc-2',
          on: false,
          connected: false,
          current: 'custom',
          status: 'off',
          custom: 'https://fallback.example',
          latencyMs: 42
        }
      ]
    }
  }
})

afterEach(() => {
  process.listeners('exit').forEach((listener) => {
    if (!exitListeners.has(listener)) process.removeListener('exit', listener)
  })
  jest.clearAllTimers()
  jest.resetModules()
  fs.rmSync(mockDirectory, { recursive: true, force: true })
})

async function restart(version, latency, inMemory = false) {
  savedMain._version = version
  savedMain.networks.ethereum[4663].connection.endpoints[0].latencyMs = latency
  fs.writeFileSync(
    path.join(mockDirectory, 'config.json'),
    JSON.stringify({ main: { __: { [version]: { main: savedMain } } } })
  )
  jest.resetModules()
  if (inMemory) {
    const { default: persist } = await import('../../../../main/store/persist')
    const originalGet = persist.get.bind(persist)
    jest.spyOn(persist, 'get').mockImplementation((key) => {
      const value = originalGet(key)
      if (key === 'main')
        value.__[version].main.networks.ethereum[4663].connection.endpoints[0].latencyMs = latency
      return value
    })
  }
  const { default: createState } = await import('../../../../main/store/state')
  return createState()
}

it.each(
  [75, 76].flatMap((version) =>
    [-4180, null, undefined, 'invalid', 0, 42, NaN, Infinity, -Infinity].map((latency) => [version, latency])
  )
)(
  'loads version %s with cached latency %s and preserves configuration through restart',
  async (version, latency) => {
    const state = await restart(version, latency)
    expect(state.main._version).toBe(76)
    expect(state.main.accounts[accountId]).toMatchObject(savedMain.accounts[accountId])
    expect(state.main.ledger).toEqual(savedMain.ledger)
    expect(state.main.hardwareDerivation).toBe(savedMain.hardwareDerivation)
    expect(state.main.instanceId).toBe(savedMain.instanceId)
    expect(state.main.networks.ethereum[4663]).toEqual({
      ...savedMain.networks.ethereum[4663],
      connection: {
        endpoints: savedMain.networks.ethereum[4663].connection.endpoints.map((endpoint) => ({
          ...endpoint,
          connected: false,
          latencyMs: undefined
        }))
      }
    })
    const { default: log } = await import('electron-log')
    const invalid =
      latency !== undefined && (typeof latency !== 'number' || !Number.isFinite(latency) || latency < 0)
    expect(log.warn).toHaveBeenCalledTimes(invalid ? 1 : 0)
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('rpc.example')
    const { default: persist } = await import('../../../../main/store/persist')
    persist.set('main', state.main)
    jest.resetModules()
    const { default: reload } = await import('../../../../main/store/state')
    expect(reload().main.networks.ethereum[4663]).toEqual(state.main.networks.ethereum[4663])
    expect(reload().main.ledger).toEqual(savedMain.ledger)
    expect(reload().main.hardwareDerivation).toBe(savedMain.hardwareDerivation)
  }
)

it.each([NaN, Infinity, -Infinity])(
  'discards non-finite values before JSON serialization: %s',
  async (latency) => {
    expect(
      (await restart(76, latency, true)).main.networks.ethereum[4663].connection.endpoints[0].latencyMs
    ).toBeUndefined()
  }
)

it('still rejects invalid endpoint configuration instead of replacing the network', async () => {
  savedMain.networks.ethereum[4663].connection.endpoints[0].id = ''
  await expect(restart(76, -4180)).rejects.toThrow('Saved state is invalid after migration')
})
