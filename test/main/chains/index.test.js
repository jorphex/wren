import log from 'electron-log'
import EventEmitter from 'events'
import { addHexPrefix, intToHex } from '@ethereumjs/util'

import store from '../../../main/store'
import { gweiToHex } from '../../util'

log.transports.console.level = false

const mockNotification = jest.fn()
jest.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return true
    }

    constructor(options) {
      this.options = options
    }

    show() {
      mockNotification(this.options)
    }
  },
  powerMonitor: {
    on: jest.fn()
  }
}))

class MockConnection extends EventEmitter {
  constructor(chainId) {
    super()

    this.connected = false

    this.connect = () => {
      if (!this.connected) {
        this.connected = true
        process.nextTick(() => this.emit('connect'))
      }
    }

    this.close = () => {
      if (this.connected) {
        this.connected = false
        this.emit('close')
      }
    }

    this.send = (payload) => {
      return new Promise((resolve, reject) => {
        if (payload.method === 'eth_getBlockByNumber') {
          return resolve(block)
        } else if (payload.method === 'eth_gasPrice') {
          return resolve(gasPrice)
        } else if (payload.method === 'eth_feeHistory') {
          return resolve(
            feeHistoryResponse || {
              baseFeePerGas: [gweiToHex(15), gweiToHex(8), gweiToHex(9), gweiToHex(8), gweiToHex(7)],
              gasUsedRatio: [0.11, 0.8, 0.2, 0.5],
              oldestBlock: '0x1',
              reward: Array(4).fill([gweiToHex(32), gweiToHex(32)])
            }
          )
        }

        return reject('unknown method!')
      })
    }

    this.sendAsync = (payload, cb) => {
      if (payload.method === 'eth_chainId') return cb(null, { result: addHexPrefix(chainId.toString(16)) })
      return cb('unknown method!')
    }
  }
}

let block, feeHistoryResponse, gasPrice, observer, connectionObserver
const fallbackTarget = 'https://polygon-fallback.example'

const state = {
  main: {
    currentNetwork: {
      type: 'ethereum',
      id: '11155111'
    },
    networks: {
      ethereum: {
        11155111: {
          id: 11155111,
          type: 'ethereum',
          name: 'Sepolia',
          connection: {
            endpoints: [
              {
                id: 'rpc-1',
                on: false,
                current: 'publicnode',
                status: 'loading',
                connected: false,
                type: '',
                network: '',
                custom: ''
              }
            ]
          },
          on: true
        },
        137: {
          id: 137,
          type: 'ethereum',
          name: 'Polygon',
          connection: {
            endpoints: [
              {
                id: 'rpc-1',
                on: false,
                current: 'publicnode',
                status: 'loading',
                connected: false,
                type: '',
                network: '',
                custom: ''
              },
              {
                id: 'rpc-2',
                on: false,
                current: 'custom',
                status: 'off',
                connected: false,
                type: '',
                network: '',
                custom: 'https://polygon-fallback.example'
              }
            ]
          },
          on: true
        }
      }
    },
    networksMeta: {
      ethereum: {
        11155111: {
          gas: {
            price: {
              selected: 'standard',
              levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
            }
          }
        },
        137: {
          gas: {
            price: {
              selected: 'standard',
              levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
            }
          }
        }
      }
    }
  }
}

const fallbackConnection = new MockConnection(137)
const mockEthProvider = jest.fn((target) =>
  target === fallbackTarget ? fallbackConnection : mockConnections[target].connection
)
jest.mock('eth-provider', () => (target, options) => mockEthProvider(target, options))
jest.mock('../../../main/store/state', () => () => state)
jest.mock('../../../main/accounts', () => ({ updatePendingFees: jest.fn() }))
jest.mock('../../../main/store/persist')

const mockConnections = {
  'https://ethereum-sepolia-rpc.publicnode.com': {
    id: '11155111',
    name: 'sepolia',
    connection: new MockConnection(11155111)
  },
  'https://polygon-bor-rpc.publicnode.com': {
    id: '137',
    name: 'polygon',
    connection: new MockConnection(137)
  }
}

let chains

beforeAll(async () => {
  jest.useRealTimers()

  // need to import this after mocks are set up
  chains = (await import('../../../main/chains')).default
})

beforeEach(() => {
  block = {}
  feeHistoryResponse = undefined
  mockNotification.mockClear()

  connectionObserver = store.observer(() => {
    Object.values(mockConnections).forEach((chain) => {
      const primary = store(`main.networks.ethereum.${chain.id}.connection.endpoints.0`)

      if (primary.on) {
        chain.connection.connect()
      }
    })
  })

  Object.values(mockConnections).forEach((chain) => {
    store.setGasPrices('ethereum', chain.id, {})
    store.setGasFees('ethereum', chain.id, {})
  })
})

afterEach((done) => {
  if (observer) {
    observer.remove()
  }

  if (connectionObserver) {
    connectionObserver.remove()
  }

  const activeConnection = Object.values(mockConnections).find((conn) => conn.connection.connected)

  if (!activeConnection) return done()

  chains.once('close', ({ id }) => {
    if (id === activeConnection.id) {
      done()
    } else {
      done.fail('connection error')
    }
  })

  store.toggleEndpoint('ethereum', activeConnection.id, 'rpc-1', false)
})

afterAll((done) => {
  Object.values(chains.connections).forEach((byChainId) => {
    Object.values(byChainId).forEach((connection) => connection.close(false, true))
  })
  setTimeout(done, 10)
})

describe('#send', () => {
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_testFrame' }

  it('returns one internal error and stops when no target chain is supplied', () => {
    const res = jest.fn()

    expect(() => chains.send(payload, res)).not.toThrow()

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      error: { message: 'Target chain did not exist for send', code: -32603 }
    })
  })

  it('returns one chain-disconnected error when the target has no connection', () => {
    const res = jest.fn()

    chains.send(payload, res, { type: 'ethereum', id: 999 })

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      error: { message: 'Wren is not connected to ethereum chain 999', code: 4901 }
    })
  })

  it('returns one chain-disconnected error when no provider is active', () => {
    const res = jest.fn()

    chains.send(payload, res, { type: 'ethereum', id: 137 })

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      error: { message: 'Wren is not connected to chain 137', code: 4901 }
    })
  })

  it('preserves an upstream error code, message, and data', () => {
    const chain = chains.connections.ethereum[137]
    const active = chain.active
    const error = { message: 'execution reverted', code: -32042, data: { reason: 'denied' } }
    chain.active = {
      connected: true,
      provider: { sendAsync: (_request, cb) => cb(error) }
    }
    const res = jest.fn()

    try {
      chains.send(payload, res, { type: 'ethereum', id: 137 })
    } finally {
      chain.active = active
    }

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({ id: payload.id, jsonrpc: payload.jsonrpc, error })
  })
})

it('identifies Wren when creating an upstream RPC provider', (done) => {
  mockEthProvider.mockClear()
  chains.once('connect', () => {
    expect(mockEthProvider).toHaveBeenCalledWith('https://polygon-bor-rpc.publicnode.com', {
      name: 'rpc-1',
      origin: 'wren'
    })
    done()
  })

  store.toggleEndpoint('ethereum', '137', 'rpc-1', true)
})

it('creates a standby provider only after the active endpoint loses connectivity', (done) => {
  mockEthProvider.mockClear()

  chains.once('connect', ({ id }) => {
    if (id !== '137') return done(new Error('connected the wrong chain'))

    try {
      expect(mockEthProvider).toHaveBeenCalledTimes(1)
      expect(mockEthProvider).toHaveBeenLastCalledWith(
        'https://polygon-bor-rpc.publicnode.com',
        expect.any(Object)
      )
    } catch (error) {
      return done(error)
    }

    chains.once('failover', ({ id: failedChainId }, { from, to }) => {
      try {
        expect(failedChainId).toBe('137')
        expect({ from, to }).toEqual({ from: 'rpc-1', to: 'rpc-2' })
        expect(mockEthProvider).toHaveBeenCalledTimes(2)
        expect(mockEthProvider).toHaveBeenLastCalledWith(fallbackTarget, expect.any(Object))
        expect(mockNotification).toHaveBeenCalledWith({
          title: 'Connection switched',
          body: 'Wren lost connection to RPC 1 on Polygon and switched to RPC 2. Manage endpoint order and availability in the network editor.'
        })
      } catch (error) {
        return done(error)
      }

      chains.once('connect', ({ id: fallbackChainId }) => {
        if (fallbackChainId !== '137') return done(new Error('fallback connected the wrong chain'))

        chains.once('close', ({ id: closedChainId }) => {
          try {
            expect(closedChainId).toBe('137')
            done()
          } catch (error) {
            done(error)
          }
        })
        store.toggleEndpoint('ethereum', '137', 'rpc-1', false)
        store.toggleEndpoint('ethereum', '137', 'rpc-2', false)
      })
    })

    mockConnections['https://polygon-bor-rpc.publicnode.com'].connection.close()
    process.nextTick(() => fallbackConnection.connect())
  })

  store.toggleEndpoint('ethereum', '137', 'rpc-1', true)
  store.toggleEndpoint('ethereum', '137', 'rpc-2', true)
})

Object.values(mockConnections).forEach((chain) => {
  it(`sets legacy gas prices on a new non-London block on ${chain.name}`, (done) => {
    gasPrice = gweiToHex(6)
    block = {
      number: addHexPrefix((8897988 - 20).toString(16))
    }

    observer = store.observer(() => {
      const gas = store(`main.networksMeta.ethereum.${chain.id}.gas.price.levels`)

      if (gas.fast) {
        expect(gas.fast).toBe(gweiToHex(6))

        done()
      }
    })

    store.toggleEndpoint('ethereum', chain.id, 'rpc-1', true)
  })

  it(`sets fee market prices on a new London block on ${chain.name}`, (done) => {
    block = {
      number: addHexPrefix((12965200).toString(16)),
      baseFeePerGas: gweiToHex(9)
    }

    const expectedBaseFee = 7e9 * 1.125 * 1.125
    const expectedPriorityFee = 32e9

    observer = store.observer(() => {
      const gas = store(`main.networksMeta.ethereum.${chain.id}.gas.price`)

      if (gas.fees.maxBaseFeePerGas) {
        expect(gas.fees.maxBaseFeePerGas).toBe(intToHex(expectedBaseFee))
        expect(gas.fees.maxPriorityFeePerGas).toBe(intToHex(expectedPriorityFee))
        expect(gas.fees.maxFeePerGas).toBe(intToHex(expectedBaseFee + expectedPriorityFee))

        expect(gas.selected).toBe('fast')
        expect(gas.levels.fast).toBe(intToHex(expectedBaseFee + expectedPriorityFee))

        done()
      }
    })

    store.toggleEndpoint('ethereum', chain.id, 'rpc-1', true)
  })
})

it('falls back to legacy gas pricing when fee history is malformed', (done) => {
  const chain = mockConnections['https://ethereum-sepolia-rpc.publicnode.com']
  gasPrice = gweiToHex(6)
  block = {
    number: addHexPrefix((12965200).toString(16)),
    baseFeePerGas: gweiToHex(9)
  }
  feeHistoryResponse = {
    baseFeePerGas: ['0x01', '0x2'],
    gasUsedRatio: [0.5],
    oldestBlock: '0x1',
    reward: [[gweiToHex(1), gweiToHex(1)]]
  }

  observer = store.observer(() => {
    const gas = store(`main.networksMeta.ethereum.${chain.id}.gas.price`)

    if (gas.levels.fast === gasPrice) {
      expect(gas.fees).toBeNull()
      done()
    }
  })

  store.toggleEndpoint('ethereum', chain.id, 'rpc-1', true)
})
