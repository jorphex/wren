import log from 'electron-log'
import EventEmitter from 'events'
import { addHexPrefix, intToHex } from '@ethereumjs/util'

import store from '../../../main/store'
import { gweiToHex } from '../../util'

log.transports.console.level = false

jest.mock('electron', () => ({
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
            primary: {
              on: false,
              current: 'pylon',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            },
            secondary: {
              on: false,
              current: 'custom',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          },
          on: true
        },
        137: {
          id: 137,
          type: 'ethereum',
          name: 'Polygon',
          connection: {
            primary: {
              on: false,
              current: 'pylon',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            },
            secondary: {
              on: false,
              current: 'custom',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
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

jest.mock('eth-provider', () => (target) => mockConnections[target].connection)
jest.mock('../../../main/store/state', () => () => state)
jest.mock('../../../main/accounts', () => ({ updatePendingFees: jest.fn() }))
jest.mock('../../../main/store/persist')

const mockConnections = {
  'wss://evm.pylon.link/sepolia': {
    id: '11155111',
    name: 'sepolia',
    connection: new MockConnection(5)
  },
  'wss://evm.pylon.link/polygon': {
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

  connectionObserver = store.observer(() => {
    Object.values(mockConnections).forEach((chain) => {
      const primary = store(`main.networks.ethereum.${chain.id}.connection.primary`)

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

  store.toggleConnection('ethereum', activeConnection.id, 'primary', false)
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
    const primary = chain.primary
    const error = { message: 'execution reverted', code: -32042, data: { reason: 'denied' } }
    chain.primary = {
      connected: true,
      provider: { sendAsync: (_request, cb) => cb(error) }
    }
    const res = jest.fn()

    try {
      chains.send(payload, res, { type: 'ethereum', id: 137 })
    } finally {
      chain.primary = primary
    }

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({ id: payload.id, jsonrpc: payload.jsonrpc, error })
  })
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

    store.toggleConnection('ethereum', chain.id, 'primary', true)
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

    store.toggleConnection('ethereum', chain.id, 'primary', true)
  })
})

it('falls back to legacy gas pricing when fee history is malformed', (done) => {
  const chain = mockConnections['wss://evm.pylon.link/sepolia']
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

  store.toggleConnection('ethereum', chain.id, 'primary', true)
})
