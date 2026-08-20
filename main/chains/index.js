// status = Network Mismatch, Not Connected, Connected, Standby, Syncing
const { Notification, powerMonitor } = require('electron')
const EventEmitter = require('events')
const { addHexPrefix } = require('@ethereumjs/util')
const { Hardfork } = require('@ethereumjs/common')
const BigNumber = require('bignumber.js')
const provider = require('eth-provider')
const log = require('electron-log')

const store = require('../store').default
const { default: BlockMonitor } = require('./blocks')
const { default: chainConfig } = require('./config')
const { default: GasMonitor } = require('../transaction/gasMonitor')
const { createGasCalculator } = require('./gas')
const { supportsFeeHistory } = require('./policy')
const { createRpcProvider, estimateL1GasCost } = require('./optimism')
const { NETWORK_PRESETS } = require('../../resources/constants')
const { chainUsesOptimismFees } = require('../../resources/utils/chains')
const { summarizeRpcEndpoint } = require('../security/rpcLogging')

const resError = (errorData, payload, res) => {
  const error =
    typeof errorData === 'string'
      ? { message: errorData, code: -32603 }
      : {
          message: errorData.message || 'Internal error',
          code: typeof errorData.code === 'number' ? errorData.code : -32603
        }

  if (typeof errorData !== 'string' && 'data' in errorData) error.data = errorData.data

  res({ id: payload.id, jsonrpc: payload.jsonrpc, error })
}

function txEstimate(gasCost, nativeUSD) {
  const usd = gasCost.shiftedBy(-18).multipliedBy(nativeUSD).toNumber()

  return {
    gasEstimate: addHexPrefix(gasCost.toString(16)),
    cost: {
      usd
    }
  }
}

class ChainConnection extends EventEmitter {
  constructor(type, chainId) {
    super()
    this.type = type
    this.chainId = chainId

    // default chain config to istanbul hardfork until a block is received
    // to update it to london
    this.chainConfig = chainConfig(parseInt(this.chainId), 'istanbul')

    this.gasCalculator = createGasCalculator(this.chainId)

    this.active = {
      id: '',
      generation: 0,
      status: 'off',
      network: '',
      type: '',
      currentTarget: '',
      connected: false
    }
    this.providerGeneration = 0

    this.observer = store.observer(() => {
      const chain = store('main.networks', type, chainId)
      if (chain) this.connect(chain)
    })
  }

  _createProvider(target, endpointId) {
    log.debug('createProvider', { chainId: this.chainId, endpointId })

    this.active.provider = provider(target, {
      name: endpointId,
      origin: 'wren'
    })
    this.active.blockMonitor = this._createBlockMonitor(this.active.provider, this.active.generation)
  }

  isActiveProvider(provider, generation) {
    return this.active.provider === provider && this.active.generation === generation
  }

  _handleConnection(endpointId, provider, generation) {
    if (!this.isActiveProvider(provider, generation)) return
    this._updateStatus(endpointId, 'connected', provider, generation)
    this.emit('connect')
  }

  async txEstimates(type, id, gasPrice, currentSymbol, provider) {
    const sampleEstimates = [
      {
        label: `Send ${currentSymbol}`,
        txExample: {
          value: '0x8e1bc9bf04000',
          data: '0x00',
          gasLimit: addHexPrefix((21000).toString(16))
        }
      },
      {
        label: 'Send Tokens',
        txExample: {
          value: '0x00',
          data: '0xa9059cbb000000000000000000000000c1af8ca40dfe1cb43b9c7a8c93df762c2d6ecfd90000000000000000000000000000000000000000000000008ac7230489e80000',
          gasLimit: addHexPrefix((65000).toString(16))
        }
      },
      {
        label: 'Dex Swap',
        txExample: {
          value: '0x38d7ea4c68000',
          data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000065e7831900000000000000000000000000000000000000000000000000000000000000020b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000038d7ea4c680000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000038d7ea4c680000000000000000000000000000000000000000000000000000b683f16dd057b6400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002b42000000000000000000000000000000000000060001f44200000000000000000000000000000000000042000000000000000000000000000000000000000000',
          gasLimit: addHexPrefix((200000).toString(16))
        }
      }
    ]

    const isTestnet = store('main.networks', type, id, 'isTestnet')
    const nativeCurrency = store('main.networksMeta', type, id, 'nativeCurrency')
    const nativeUSD = BigNumber(
      nativeCurrency && nativeCurrency.usd && !isTestnet ? nativeCurrency.usd.price : 0
    )

    let estimates

    if (chainUsesOptimismFees(id) && !isTestnet) {
      estimates = await Promise.all(
        sampleEstimates.map(async ({ label, txExample }) => {
          const tx = {
            ...txExample,
            type: 2,
            chainId: id
          }

          try {
            const l1GasCost = BigNumber((await estimateL1GasCost(createRpcProvider(provider), tx)).toString())
            const l2GasCost = BigNumber(tx.gasLimit).multipliedBy(gasPrice)
            const estimatedGas = l1GasCost.plus(l2GasCost)

            return {
              label,
              gasCost: estimatedGas
            }
          } catch {
            return {
              label,
              gasCost: BigNumber('')
            }
          }
        })
      )
    } else {
      estimates = sampleEstimates.map(({ label, txExample }) => ({
        label,
        gasCost: BigNumber(txExample.gasLimit).multipliedBy(gasPrice)
      }))
    }

    return estimates.map(({ label, gasCost }) => ({
      estimates: {
        low: txEstimate(gasCost, nativeUSD),
        high: txEstimate(gasCost, nativeUSD)
      },
      label
    }))
  }

  async feeEstimatesUSD(chainId, gasPrice, provider) {
    const type = 'ethereum'
    const currentSymbol = store('main.networksMeta', type, chainId, 'nativeCurrency', 'symbol') || 'ETH'

    return this.txEstimates(type, chainId, gasPrice, currentSymbol, provider)
  }

  _createBlockMonitor(provider, generation) {
    const monitor = new BlockMonitor(provider)
    const allowEip1559 = supportsFeeHistory(this.chainId)
    const isCurrent = () => this.isActiveProvider(provider, generation)

    monitor.on('data', async (block) => {
      if (!isCurrent()) return
      log.debug(`Updating to block ${parseInt(block.number)} for chain ${parseInt(this.chainId)}`)

      let feeMarket = null

      const gasMonitor = new GasMonitor(provider)

      if (allowEip1559 && 'baseFeePerGas' in block) {
        try {
          // only consider this an EIP-1559 block if fee market can be loaded
          const feeHistory = await gasMonitor.getFeeHistory(20, [10, 60])
          if (!isCurrent()) return
          feeMarket = this.gasCalculator.calculateGas(feeHistory)

          this.chainConfig.setHardforkByBlockNumber(block.number)

          if (!this.chainConfig.gteHardfork(Hardfork.London)) {
            // if baseFeePerGas is present in the block header, the hardfork
            // must be at least London
            this.chainConfig.setHardfork(Hardfork.London)
          }
        } catch {
          feeMarket = null
        }
      }

      try {
        if (!isCurrent()) return
        if (feeMarket) {
          const gasPrice = BigInt(feeMarket.maxBaseFeePerGas) + BigInt(feeMarket.maxPriorityFeePerGas)

          store.setGasPrices(this.type, this.chainId, { fast: addHexPrefix(gasPrice.toString(16)) })
          store.setGasDefault(this.type, this.chainId, 'fast')
        } else {
          const gas = await gasMonitor.getGasPrices()
          if (!isCurrent()) return
          const customLevel = store('main.networksMeta', this.type, this.chainId, 'gas.price.levels.custom')

          store.setGasPrices(this.type, this.chainId, {
            ...gas,
            custom: customLevel || gas.fast
          })
        }

        if (provider.connected) {
          const gasPrice = store('main.networksMeta', this.type, this.chainId, 'gas.price.levels.slow')
          const estimatedGasPrice = feeMarket
            ? BigNumber(feeMarket.nextBaseFee).plus(BigNumber(feeMarket.maxPriorityFeePerGas))
            : BigNumber(gasPrice)

          this.feeEstimatesUSD(parseInt(this.chainId), estimatedGasPrice, createRpcProvider(provider)).then(
            (samples) => {
              if (isCurrent()) {
                store.addSampleGasCosts(this.type, this.chainId, samples)
              }
            }
          )
        }

        if (!isCurrent()) return
        store.setGasFees(this.type, this.chainId, feeMarket)
        store.setBlockHeight(this.chainId, parseInt(block.number, 16))

        this.emit('update', { type: 'fees' })
      } catch (e) {
        log.error(`could not update gas prices for chain ${this.chainId}`, { feeMarket }, e)
      }
    })

    return monitor
  }

  update(endpointId, provider, generation) {
    if (provider && !this.isActiveProvider(provider, generation)) return
    const network = store('main.networks', this.type, this.chainId)

    if (!network) {
      // since we poll to re-connect there may be a timing issue where we try
      // to update a network after it's been removed, so double-check here
      return
    }

    const { status, connected, type, network: endpointNetwork, latencyMs } = this.active
    const details = { status, connected, type, network: endpointNetwork, latencyMs }
    log.info(`Updating endpoint ${endpointId} for chain ${this.chainId}`, details)
    store.setEndpoint(this.type, this.chainId, endpointId, details)
  }

  getNetwork(provider, isCurrent, cb) {
    provider.sendAsync({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }, (err, response) => {
      if (!isCurrent()) return
      try {
        response.result =
          !err && response && !response.error ? parseInt(response.result, 'hex').toString() : ''
        cb(err, response)
      } catch (e) {
        cb(e)
      }
    })
  }

  getNodeType(provider, cb) {
    provider.sendAsync({ jsonrpc: '2.0', method: 'web3_clientVersion', params: [], id: 1 }, cb)
  }

  _updateStatus(endpointId, status, provider, generation) {
    if (provider && !this.isActiveProvider(provider, generation)) return
    log.debug('Chains.updateStatus', { endpointId, status })

    this.active.status = status
    this.update(endpointId)

    this.emit('update', { type: 'status', status })
  }

  resetConnection(status = 'off', target = '', endpointId = this.active.id) {
    log.debug('resetConnection', { endpointId, status, endpoint: summarizeRpcEndpoint(target) })

    const previous = this.active
    this.active = {
      id: endpointId || '',
      generation: ++this.providerGeneration,
      provider: null,
      blockMonitor: null,
      connected: false,
      type: '',
      network: '',
      currentTarget: target,
      status,
      latencyMs: undefined
    }
    this.killProvider(previous.provider)
    this.stopBlockMonitor(previous.blockMonitor)
  }

  killProvider(provider) {
    log.debug('killProvider', { configured: !!provider })

    if (provider) {
      provider.removeAllListeners()
      provider.close()
    }
  }

  stopBlockMonitor(monitor = this.active.blockMonitor) {
    log.debug('stopBlockMonitor', { chainId: this.chainId, endpointId: this.active.id })

    if (monitor) {
      monitor.stop()
      monitor.removeAllListeners()
      if (this.active.blockMonitor === monitor) this.active.blockMonitor = null
    }
  }

  connect(chain) {
    const endpoints = chain.connection.endpoints || []
    const enabled = endpoints.filter((endpoint) => endpoint.on)

    if (!chain.on || enabled.length === 0) {
      const wasActive = Boolean(this.active.provider || this.active.connected)
      this.close(false)
      endpoints.forEach((endpoint) => {
        if (endpoint.connected || endpoint.status !== 'off' || endpoint.latencyMs !== undefined) {
          store.setEndpoint(this.type, this.chainId, endpoint.id, {
            connected: false,
            status: 'off',
            latencyMs: undefined
          })
        }
      })
      if (wasActive) this.emit('close')
      return
    }

    const current = enabled.find((endpoint) => endpoint.id === this.active.id)
    const target = current && this.endpointTarget(current)
    const currentIndex = enabled.findIndex((endpoint) => endpoint.id === this.active.id)
    const failedStatuses = ['disconnected', 'error', 'chain mismatch']
    const earlierEndpointsFailed = enabled
      .slice(0, currentIndex)
      .every((endpoint) => failedStatuses.includes(endpoint.status))
    if (this.active.provider && current && target === this.active.currentTarget && earlierEndpointsFailed) {
      return
    }

    this.connectEndpoint(enabled, 0)
  }

  endpointTarget(endpoint) {
    const presets = { ...NETWORK_PRESETS.ethereum.default, ...NETWORK_PRESETS.ethereum[this.chainId] }
    return endpoint.current === 'custom' ? endpoint.custom : presets[endpoint.current]
  }

  connectEndpoint(endpoints, index, failoverFrom = '') {
    const endpoint = endpoints[index]
    if (!endpoint) {
      this.resetConnection('disconnected')
      this.emit('close')
      return
    }

    const target = this.endpointTarget(endpoint)
    if (!target) {
      store.setEndpoint(this.type, this.chainId, endpoint.id, {
        connected: false,
        status: 'disconnected',
        latencyMs: undefined
      })
      this.connectEndpoint(endpoints, index + 1, failoverFrom || endpoint.id)
      return
    }

    this.resetConnection('loading', target, endpoint.id)
    endpoints.slice(index + 1).forEach((standby) =>
      store.setEndpoint(this.type, this.chainId, standby.id, {
        connected: false,
        status: 'standby',
        latencyMs: undefined
      })
    )

    const startedAt = Date.now()
    this._createProvider(target, endpoint.id)
    const activeProvider = this.active.provider
    const generation = this.active.generation
    const isCurrent = () => this.isActiveProvider(activeProvider, generation)
    this.update(endpoint.id, activeProvider, generation)

    const failover = (status) => {
      if (!isCurrent()) return
      store.setEndpoint(this.type, this.chainId, endpoint.id, {
        connected: false,
        status,
        latencyMs: undefined
      })
      const failedProvider = this.active.provider
      const failedMonitor = this.active.blockMonitor
      this.active.provider = null
      this.active.connected = false
      this.active.generation = ++this.providerGeneration
      this.killProvider(failedProvider)
      this.stopBlockMonitor(failedMonitor)
      this.connectEndpoint(endpoints, index + 1, failoverFrom || endpoint.id)
    }

    activeProvider.on('connect', () => {
      if (!isCurrent()) return
      this.getNetwork(activeProvider, isCurrent, (err, response) => {
        if (!isCurrent()) return
        if (err) return failover('error')
        this.active.network = response && !response.error ? response.result : ''
        if (!this.active.network || this.active.network !== this.chainId) return failover('chain mismatch')

        this.active.connected = true
        this.active.type = ''
        this.active.latencyMs = Date.now() - startedAt
        if (failoverFrom) {
          this.emit('failover', { from: failoverFrom, to: endpoint.id, chainId: this.chainId })
        }
        this._handleConnection(endpoint.id, activeProvider, generation)
      })
    })
    activeProvider.on('close', () => failover('disconnected'))
    activeProvider.on('status', (status) => {
      if (!isCurrent()) return
      if (['disconnected', 'error'].includes(status)) return failover(status)
      if (this.active.status !== status && status !== 'connected') {
        this._updateStatus(endpoint.id, status, activeProvider, generation)
      }
    })
    activeProvider.on('data', (data) => {
      if (isCurrent()) this.emit('data', data)
    })
    activeProvider.on('error', (err) => {
      if (isCurrent()) this.emit('error', err)
    })
  }

  close(update = true, removeObserver = false) {
    log.verbose(`closing chain ${this.chainId}`, { update, removeObserver })

    if (removeObserver && this.observer) this.observer.remove()

    const previous = this.active
    const endpointId = previous.id
    this.active = {
      id: endpointId || '',
      generation: ++this.providerGeneration,
      provider: null,
      blockMonitor: null,
      connected: false,
      type: '',
      network: '',
      currentTarget: '',
      status: update ? 'loading' : 'off',
      latencyMs: undefined
    }
    this.killProvider(previous.provider)
    this.stopBlockMonitor(previous.blockMonitor)

    if (update && endpointId) {
      this.update(endpointId)
    }
  }

  send(payload, res) {
    if (this.active.provider && this.active.connected) {
      const activeProvider = this.active.provider
      const generation = this.active.generation
      this.active.provider.sendAsync(payload, (err, result) => {
        if (!this.isActiveProvider(activeProvider, generation)) {
          return resError(
            { message: `Wren is not connected to chain ${this.chainId}`, code: 4901 },
            payload,
            res
          )
        }
        if (err) return resError(err, payload, res)
        res(result)
      })
    } else {
      resError({ message: `Wren is not connected to chain ${this.chainId}`, code: 4901 }, payload, res)
    }
  }
}

class Chains extends EventEmitter {
  constructor() {
    super()
    this.connections = {}
    this.lastFailoverNotice = new Map()

    const notifyFailover = (type, chainId, { from, to }) => {
      const key = `${type}:${chainId}`
      const now = Date.now()
      if (now - (this.lastFailoverNotice.get(key) || 0) < 30000) return
      this.lastFailoverNotice.set(key, now)

      const chain = store('main.networks', type, chainId)
      const endpoints = chain?.connection?.endpoints || []
      const fromIndex = endpoints.findIndex((endpoint) => endpoint.id === from)
      const toIndex = endpoints.findIndex((endpoint) => endpoint.id === to)
      if (fromIndex < 0 || toIndex < 0 || !Notification?.isSupported?.()) return

      new Notification({
        title: 'Connection switched',
        body: `Wren lost connection to RPC ${fromIndex + 1} on ${chain.name} and switched to RPC ${toIndex + 1}. Manage endpoint order and availability in the network editor.`
      }).show()
    }

    const removeConnection = (chainId, type = 'ethereum') => {
      if (type in this.connections && chainId in this.connections[type]) {
        this.connections[type][chainId].removeAllListeners()
        this.connections[type][chainId].close(false, true)
        delete this.connections[type][chainId]
      }
    }

    const updateConnections = () => {
      const networks = store('main.networks')

      Object.keys(this.connections).forEach((type) => {
        Object.keys(this.connections[type]).forEach((chainId) => {
          if (!networks[type][chainId]) {
            removeConnection(chainId, type)
          }
        })
      })

      Object.keys(networks).forEach((type) => {
        this.connections[type] = this.connections[type] || {}
        Object.keys(networks[type]).forEach((chainId) => {
          const chainConfig = networks[type][chainId]
          if (chainConfig.on && !this.connections[type][chainId]) {
            this.connections[type][chainId] = new ChainConnection(type, chainId)

            this.connections[type][chainId].on('connect', (...args) => {
              this.emit('connect', { type, id: chainId }, ...args)
            })

            this.connections[type][chainId].on('close', (...args) => {
              this.emit('close', { type, id: chainId }, ...args)
            })

            this.connections[type][chainId].on('data', (...args) => {
              this.emit('data', { type, id: chainId }, ...args)
            })

            this.connections[type][chainId].on('update', (...args) => {
              this.emit('update', { type, id: parseInt(chainId) }, ...args)
            })

            this.connections[type][chainId].on('error', (...args) => {
              this.emit('error', { type, id: chainId }, ...args)
            })

            this.connections[type][chainId].on('failover', (event) => {
              notifyFailover(type, chainId, event)
              this.emit('failover', { type, id: chainId }, event)
            })
          } else if (!chainConfig.on && this.connections[type][chainId]) {
            this.connections[type][chainId].removeAllListeners()
            this.connections[type][chainId].close(true, true)
            delete this.connections[type][chainId]
          }
        })
      })
    }

    powerMonitor.on('resume', () => {
      const activeConnections = Object.keys(this.connections)
        .map((type) => Object.keys(this.connections[type]).map((chainId) => `${type}:${chainId}`))
        .flat()

      log.info('System resuming, resetting active connections', { chains: activeConnections })

      activeConnections.forEach((id) => {
        const [type, chainId] = id.split(':')
        removeConnection(chainId, type)
      })

      updateConnections()
    })

    store.observer(updateConnections, 'chains:connections')
  }

  send(payload, res, targetChain) {
    if (!targetChain) {
      return resError({ message: `Target chain did not exist for send`, code: -32603 }, payload, res)
    }

    const { type, id } = targetChain
    if (!this.connections[type] || !this.connections[type][id]) {
      return resError({ message: `Wren is not connected to ${type} chain ${id}`, code: 4901 }, payload, res)
    }

    this.connections[type][id].send(payload, res)
  }
}

module.exports = new Chains()
