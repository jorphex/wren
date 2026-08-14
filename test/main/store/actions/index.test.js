import BigNumber from 'bignumber.js'
import log from 'electron-log'
import { addHexPrefix } from '@ethereumjs/util'

import {
  addNetwork as addNetworkAction,
  removeBalance as removeBalanceAction,
  setBalances as setBalancesAction,
  removeBalances as removeBalancesAction,
  addCustomTokens as addCustomTokensAction,
  removeCustomTokens as removeTokensAction,
  addKnownTokens as addKnownTokensAction,
  removeKnownTokens as removeKnownTokensAction,
  setScanning as setScanningAction,
  initOrigin as initOriginAction,
  clearOrigins as clearOriginsAction,
  removeOrigin as removeOriginAction,
  addOriginRequest as addOriginRequestAction,
  switchOriginChain as switchOriginChainAction,
  removeNetwork as removeNetworkAction,
  updateNetwork as updateNetworkAction,
  activateNetwork as activateNetworkAction,
  setBlockHeight as setBlockHeightAction,
  updateAccount as updateAccountAction,
  navClearReq as clearNavRequestAction,
  navClearSigner as clearNavSignerAction,
  showHardwarePrompt as showHardwarePromptAction,
  clearHardwarePrompt as clearHardwarePromptAction,
  dismissHardwarePrompt as dismissHardwarePromptAction,
  notify as notifyAction,
  showWalletCallsStatus as showWalletCallsStatusAction,
  updateTypedDataRequest as updateTypedDataAction,
  setGlideSide as setGlideSideAction,
  setInterfaceScale as setInterfaceScaleAction,
  setInterfaceScaleEffective as setInterfaceScaleEffectiveAction,
  showAccountActivity as showAccountActivityAction
} from '../../../../main/store/actions'
import { toTokenId } from '../../../../resources/domain/balance'
import * as storeActions from '../../../../main/store/actions'
import { FRAME_SEND_ORIGIN } from '../../../../resources/domain/origin'

beforeAll(() => {
  log.transports.console.level = false
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

const owner = '0xa8be0f701d0f37088600164e71bffc0ad652c251'

describe('#clearActivity', () => {
  it('clears displayed history and its privacy-preserving outbound-address memory together', () => {
    const updates = []
    const update = (path, reducer) => updates.push([path, reducer({ retained: true })])

    storeActions.clearActivity(update)

    expect(updates).toEqual([
      ['main.activity', []],
      ['main.outboundAddressMemory', {}]
    ])
  })
})

describe('#showAccountActivity', () => {
  it('selects and opens the target account before routing to the exact activity entry', () => {
    const state = {
      'selected.current': 'other',
      'selected.minimized': true,
      'selected.open': false,
      'panel.view': 'accountChooser',
      'windows.panel.nav': [
        { view: 'expandedModule', data: { id: 'activity', account: 'other' } },
        { view: 'default', data: {} }
      ],
      'windows.panel.showing': false
    }
    const update = (...args) => {
      const path = args.slice(0, -1).join('.')
      state[path] = args.at(-1)(state[path])
    }

    showAccountActivityAction(update, owner, '00000000-0000-4000-8000-000000000001')

    expect(state).toMatchObject({
      'selected.current': owner,
      'selected.minimized': false,
      'selected.open': true,
      'panel.view': 'default',
      'windows.panel.showing': true
    })
    expect(state['windows.panel.nav'][0]).toEqual({
      view: 'expandedModule',
      data: {
        id: 'activity',
        account: owner,
        title: 'Activity',
        activityId: '00000000-0000-4000-8000-000000000001'
      }
    })
    expect(state['windows.panel.nav'].filter(({ data }) => data.id === 'activity')).toHaveLength(1)
  })
})

describe('#toggleAccess', () => {
  const address = '0x1111111111111111111111111111111111111111'

  const toggleAccess = (permissions, handlerId, provider) => {
    let result
    storeActions.toggleAccess(
      (...args) => {
        expect(args.slice(0, 2)).toEqual(['main.permissions', address])
        result = args[2](permissions)
      },
      address,
      handlerId,
      provider
    )
    return result
  }

  it('immutably removes an existing permission when access is revoked', () => {
    const permissions = { first: { origin: 'alpha.example', provider: true } }

    const result = toggleAccess(permissions, 'first', false)

    expect(result).toEqual({})
    expect(permissions.first.provider).toBe(true)
  })

  it('does not restore access or alter missing permission state', () => {
    const permissions = { first: { origin: 'alpha.example', provider: true } }

    expect(toggleAccess(permissions, 'first', true)).toBe(permissions)
    expect(toggleAccess(permissions, 'missing', true)).toBe(permissions)
    expect(toggleAccess(undefined, 'missing', true)).toEqual({})
  })
})

describe('#clearPermissions', () => {
  it('removes external permissions while preserving managed Wren Send access', () => {
    const address = '0x1111111111111111111111111111111111111111'
    const permissions = {
      managed: { origin: FRAME_SEND_ORIGIN, provider: true },
      external: { origin: 'https://alpha.example', provider: true }
    }
    let result

    storeActions.clearPermissions((...args) => {
      expect(args.slice(0, 2)).toEqual(['main.permissions', address])
      result = args[2](permissions)
    }, address)

    expect(result).toEqual({ managed: permissions.managed })
    expect(permissions).toHaveProperty('external')
  })
})

it('does not expose the retired Pylon migration actions', () => {
  expect(storeActions).not.toHaveProperty('mutePylonMigrationNotice')
  expect(storeActions).not.toHaveProperty('migrateToPylonConnections')
})

it('retries only a failed installed dapp from a clean attempt budget', () => {
  const failed = { id: 'failed', status: 'failed', openWhenReady: false, checkStatusRetryCount: 4 }
  const ready = { id: 'ready', status: 'ready', openWhenReady: false, checkStatusRetryCount: 0 }
  let result

  storeActions.retryDapp((path, update) => {
    expect(path).toBe('main.dapps')
    result = update({ failed, ready })
  }, 'failed')

  expect(result.failed).toEqual({
    ...failed,
    status: 'initial',
    openWhenReady: true,
    checkStatusRetryCount: 0
  })
  expect(result.ready).toBe(ready)
})

describe('ordered RPC endpoint actions', () => {
  const first = {
    id: 'rpc-1',
    on: true,
    connected: true,
    current: 'custom',
    status: 'connected',
    custom: 'https://one.example'
  }
  const second = {
    id: 'rpc-2',
    on: true,
    connected: false,
    current: 'custom',
    status: 'standby',
    custom: 'https://two.example'
  }

  const run = (action, endpoints, ...args) => {
    let result
    action(
      (...updateArgs) => {
        expect(updateArgs.slice(0, -1)).toEqual(['main.networks', 'ethereum', 1, 'connection.endpoints'])
        result = updateArgs.at(-1)(endpoints)
      },
      'ethereum',
      1,
      ...args
    )
    return result
  }

  it('moves an endpoint by one position and clears stale live state', () => {
    expect(run(storeActions.moveEndpoint, [first, second], 'rpc-2', -1)).toEqual([
      expect.objectContaining({ id: 'rpc-2', connected: false, status: 'loading' }),
      expect.objectContaining({ id: 'rpc-1', connected: false, status: 'loading' })
    ])
  })

  it('caps additions at five and assigns an unused stable id', () => {
    const endpoints = [1, 2, 4, 5].map((suffix) => ({ ...first, id: `rpc-${suffix}` }))
    expect(run(storeActions.addEndpoint, endpoints)).toEqual([
      ...endpoints,
      expect.objectContaining({ id: 'rpc-3', on: false, status: 'off' })
    ])

    const five = [...endpoints, { ...first, id: 'rpc-3' }]
    expect(run(storeActions.addEndpoint, five)).toBe(five)
  })

  it('updates a disabled endpoint URL without enabling network traffic', () => {
    const disabled = { ...second, on: false, connected: false, status: 'off' }

    expect(run(storeActions.setEndpointUrl, [first, disabled], 'rpc-2', 'https://new.example')).toEqual([
      first,
      expect.objectContaining({
        id: 'rpc-2',
        custom: 'https://new.example',
        on: false,
        connected: false,
        status: 'off'
      })
    ])
  })

  it('does not remove the first endpoint', () => {
    expect(run(storeActions.removeEndpoint, [first, second], 'rpc-1')).toEqual([first, second])
    expect(run(storeActions.removeEndpoint, [first, second], 'rpc-2')).toEqual([first])
  })
})

describe('#setGlideSide', () => {
  it('persists only supported display edges', () => {
    const update = jest.fn()

    setGlideSideAction(update, 'left')
    setGlideSideAction(update, 'top')

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('main.glideSide', expect.any(Function))
    expect(update.mock.calls[0][1]()).toBe('left')
  })
})

describe('#setInterfaceScale', () => {
  it('persists only supported requested scales', () => {
    const update = jest.fn()

    setInterfaceScaleAction(update, 1.25)
    setInterfaceScaleAction(update, 2)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('main.interfaceScale', expect.any(Function))
    expect(update.mock.calls[0][1]()).toBe(1.25)
  })

  it('publishes only supported effective scales to transient state', () => {
    const update = jest.fn()

    setInterfaceScaleEffectiveAction(update, 1.5)
    setInterfaceScaleEffectiveAction(update, 0.5)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('view.interfaceScaleEffective', expect.any(Function))
    expect(update.mock.calls[0][1]()).toBe(1.5)
  })
})

describe('#notify', () => {
  it('uses serializable empty notification state when dismissed', () => {
    const updates = []
    const update = (path, value) => updates.push([path, value({ notify: '', notifyData: {} })])

    notifyAction(update)

    expect(updates).toEqual([
      [
        'view',
        expect.objectContaining({
          notify: '',
          notifyData: {},
          notifyId: '',
          notifyOwner: '',
          notifyQueue: []
        })
      ]
    ])
  })
})

const testTokens = {
  zrx: {
    chainId: 1,
    address: '0xe41d2489571d322189246dafa5ebde1f4699f498',
    symbol: 'ZRX',
    decimals: 18
  },
  badger: {
    chainId: 42161,
    address: '0xbfa641051ba0a0ad1b0acf549a89536a0d76472e',
    symbol: 'BADGER',
    decimals: 18
  }
}

describe('#addNetwork', () => {
  const polygonNetwork = {
    id: 137,
    name: 'Polygon',
    type: 'ethereum',
    layer: 'sidechain',
    explorer: 'https://polygonscan.com',
    symbol: 'MATIC'
  }

  let networks, networksMeta

  const updaterFn = (node, update) => {
    if (node !== 'main') throw new Error(`attempted to update wrong node: ${node}`)
    update({ networks, networksMeta })
  }

  const addNetwork = (network) => addNetworkAction(updaterFn, network)

  beforeEach(() => {
    networks = { ethereum: {} }
    networksMeta = { ethereum: {} }
  })

  it('adds a network with the correct id', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].id).toBe(137)
  })

  it('adds a network with the correct id if the id is a number represented as a string', () => {
    addNetwork({ ...polygonNetwork, id: '137' })

    expect(networks.ethereum['137'].id).toBe(137)
  })

  it('adds a network with the correct name', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].name).toBe('Polygon')
  })

  it('adds a network with the correct symbol', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].symbol).toBe('MATIC')
  })

  it('adds a network with the correct explorer', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].explorer).toBe('https://polygonscan.com')
  })

  it('adds a network that is on by default', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].on).toBe(true)
  })

  it('adds a network with the correct primary RPC', () => {
    polygonNetwork.primaryRpc = 'https://polygon-rpc.com'

    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].primaryRpc).toBeUndefined()
    expect(networks.ethereum['137'].connection.endpoints[0].custom).toBe('https://polygon-rpc.com')
  })

  it('adds a network with the correct secondary RPC', () => {
    polygonNetwork.secondaryRpc = 'https://rpc-mainnet.matic.network'

    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].secondaryRpc).toBeUndefined()
    expect(networks.ethereum['137'].connection.endpoints[1].custom).toBe('https://rpc-mainnet.matic.network')
  })

  it('adds a network with the correct default connection presets', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].connection.presets).toEqual({ local: 'direct' })
  })

  it('adds a network with one dormant endpoint when no RPC URL is supplied', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].connection.endpoints).toEqual([
      {
        id: 'rpc-1',
        on: false,
        current: 'custom',
        status: 'off',
        connected: false,
        type: '',
        network: '',
        custom: ''
      }
    ])
  })

  it('adds a network with the correct default gas settings', () => {
    addNetwork(polygonNetwork)

    expect(networks.ethereum['137'].gas).toEqual({
      price: {
        selected: 'standard',
        levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
      }
    })
  })

  it('adds a network with the correct default metadata', () => {
    addNetwork(polygonNetwork)

    expect(networksMeta.ethereum['137']).toEqual({
      blockHeight: 0,
      name: 'Polygon',
      icon: '',
      nativeCurrency: {
        symbol: 'MATIC',
        name: '',
        icon: '',
        decimals: 18
      },
      gas: {
        price: {
          selected: 'standard',
          levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
        }
      }
    })
  })

  it('preserves configured native currency decimals', () => {
    addNetwork({ ...polygonNetwork, nativeCurrencyDecimals: 6 })

    expect(networksMeta.ethereum['137'].nativeCurrency.decimals).toBe(6)
  })

  it('does not add the network if id is not a parseable number', () => {
    addNetwork({ ...polygonNetwork, id: 'test' })

    expect(Object.keys(networks.ethereum)).toHaveLength(0)
    expect(Object.keys(networksMeta.ethereum)).toHaveLength(0)
  })

  it('does not add the network if name is not defined', () => {
    addNetwork({ ...polygonNetwork, name: undefined })

    expect(Object.keys(networks.ethereum)).toHaveLength(0)
    expect(Object.keys(networksMeta.ethereum)).toHaveLength(0)
  })

  it('does not add the network if explorer is not defined', () => {
    addNetwork({ ...polygonNetwork, explorer: undefined })

    expect(Object.keys(networks.ethereum)).toHaveLength(0)
    expect(Object.keys(networksMeta.ethereum)).toHaveLength(0)
  })

  it('does not add the network if symbol is not defined', () => {
    addNetwork({ ...polygonNetwork, symbol: undefined })

    expect(Object.keys(networks.ethereum)).toHaveLength(0)
    expect(Object.keys(networksMeta.ethereum)).toHaveLength(0)
  })

  it('does not add the network if type is not a string', () => {
    addNetwork({ ...polygonNetwork, type: 2 })

    expect(Object.keys(networks.ethereum)).toHaveLength(0)
    expect(Object.keys(networksMeta.ethereum)).toHaveLength(0)
  })

  it('does not add the network if type is not "ethereum"', () => {
    addNetwork({ ...polygonNetwork, type: 'solana' })

    expect(Object.keys(networks.ethereum)).toHaveLength(0)
    expect(Object.keys(networksMeta.ethereum)).toHaveLength(0)
  })

  it('does not add the network if the networks already exists', () => {
    networks.ethereum['137'] = { ...polygonNetwork }

    addNetwork({
      id: 137,
      type: 'ethereum',
      name: 'Matic v1',
      explorer: 'https://rpc-mainnet.maticvigil.com',
      symbol: 'MATIC'
    })

    expect(networks.ethereum['137'].name).toBe('Polygon')
    expect(networks.ethereum['137'].explorer).toBe('https://polygonscan.com')
  })
})

describe('#setBalances', () => {
  const updaterFn = (node, address, update) => {
    expect(node).toBe('main.balances')
    expect(address).toBe(owner)

    balances = update(balances)
  }

  const setBalances = (updatedBalances) => setBalancesAction(updaterFn, owner, updatedBalances)

  let balances

  beforeEach(() => {
    balances = [
      {
        ...testTokens.badger,
        balance: addHexPrefix(new BigNumber(30.5).toString(16))
      }
    ]
  })

  it('adds a new balance', () => {
    setBalances([
      {
        ...testTokens.zrx,
        balance: addHexPrefix(new BigNumber(7983.2332).toString(16))
      }
    ])

    expect(balances).toEqual([
      {
        ...testTokens.badger,
        balance: addHexPrefix(new BigNumber(30.5).toString(16))
      },
      {
        ...testTokens.zrx,
        balance: addHexPrefix(new BigNumber(7983.2332).toString(16))
      }
    ])
  })

  it('updates an existing balance to a positive amount', () => {
    setBalances([
      {
        ...testTokens.badger,
        balance: addHexPrefix(new BigNumber(41.9).toString(16))
      }
    ])

    expect(balances).toEqual([
      {
        ...testTokens.badger,
        balance: addHexPrefix(new BigNumber(41.9).toString(16))
      }
    ])
  })

  it('updates an existing balance to zero', () => {
    setBalances([
      {
        ...testTokens.badger,
        balance: '0x0'
      }
    ])

    expect(balances).toEqual([
      {
        ...testTokens.badger,
        balance: '0x0'
      }
    ])
  })

  it('collapses checksum-case variants into one updated token balance', () => {
    const checksummedAddress = testTokens.badger.address
    const uppercaseAddress = `0x${checksummedAddress.slice(2).toUpperCase()}`
    balances.push({ ...balances[0], address: uppercaseAddress })

    setBalances([
      {
        ...testTokens.badger,
        address: checksummedAddress.toLowerCase(),
        balance: '0x2a'
      }
    ])

    expect(balances).toEqual([
      {
        ...testTokens.badger,
        address: checksummedAddress.toLowerCase(),
        balance: '0x2a'
      }
    ])
  })
})

describe('#removeBalance', () => {
  let balances = {
    [owner]: [
      {
        ...testTokens.zrx,
        balance: addHexPrefix(BigNumber('798.564').toString(16))
      },
      {
        ...testTokens.badger,
        balance: addHexPrefix(BigNumber('15.543').toString(16))
      }
    ],
    '0xd0e3872f5fa8ecb49f1911f605c0da90689a484e': [
      {
        ...testTokens.zrx,
        balance: addHexPrefix(BigNumber('8201.343').toString(16))
      },
      {
        ...testTokens.badger,
        balance: addHexPrefix(BigNumber('101.988').toString(16))
      }
    ]
  }

  const updaterFn = (node, update) => {
    expect(node).toBe('main.balances')

    balances = update(balances)
  }

  const removeBalance = (key) => removeBalanceAction(updaterFn, 1, key)

  it('removes a balance from all accounts', () => {
    removeBalance(testTokens.zrx.address)

    expect(balances[owner]).not.toContainEqual(expect.objectContaining({ address: testTokens.zrx.address }))
    expect(balances[owner]).toHaveLength(1)
    expect(balances['0xd0e3872f5fa8ecb49f1911f605c0da90689a484e']).not.toContainEqual(
      expect.objectContaining({ address: testTokens.zrx.address })
    )
    expect(balances['0xd0e3872f5fa8ecb49f1911f605c0da90689a484e']).toHaveLength(1)
  })
})

describe('#addCustomTokens', () => {
  let tokens = [],
    balances = {}

  const updaterFn = (node, update) => {
    if (node === 'main.tokens.custom') {
      tokens = update(tokens)
    }

    if (node === 'main.balances') {
      balances = update(balances)
    }
  }

  const addTokens = (tokensToAdd) => addCustomTokensAction(updaterFn, tokensToAdd)

  it('adds a token', () => {
    tokens = [testTokens.zrx]

    addTokens([testTokens.badger])

    expect(tokens).toStrictEqual([testTokens.zrx, testTokens.badger])
  })

  it('overwrites a token', () => {
    tokens = [testTokens.zrx, testTokens.badger]

    const updatedBadgerToken = {
      ...testTokens.badger,
      symbol: 'BAD'
    }

    addTokens([updatedBadgerToken])

    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual(testTokens.zrx)
    expect(tokens[1].symbol).toBe('BAD')
  })

  it('updates an existing balance for a custom token', () => {
    const account = '0xd0e3872f5fa8ecb49f1911f605c0da90689a484e'

    balances = {
      [account]: [
        {
          address: testTokens.badger.address,
          chainId: testTokens.badger.chainId,
          symbol: 'BDG',
          name: 'Old Badger',
          logoURI: 'http://logo.io'
        }
      ]
    }

    const updatedBadgerToken = {
      ...testTokens.badger,
      symbol: 'BADGER',
      name: 'Badger Token'
    }

    addTokens([updatedBadgerToken])

    expect(balances[account]).toStrictEqual([
      {
        address: testTokens.badger.address,
        chainId: testTokens.badger.chainId,
        symbol: 'BADGER',
        name: 'Badger Token',
        logoURI: 'http://logo.io'
      }
    ])
  })

  it('updates frozen production-shaped balances without mutating them', () => {
    const account = '0xd0e3872f5fa8ecb49f1911f605c0da90689a484e'
    const originalBalance = Object.freeze({
      address: testTokens.badger.address,
      chainId: testTokens.badger.chainId,
      symbol: 'BDG',
      name: 'Old Badger',
      logoURI: 'http://logo.io'
    })
    const originalAccountBalances = Object.freeze([originalBalance])
    const originalBalances = Object.freeze({ [account]: originalAccountBalances })
    balances = originalBalances

    addTokens([{ ...testTokens.badger, symbol: 'BADGER', name: 'Badger Token' }])

    expect(balances).not.toBe(originalBalances)
    expect(balances[account]).not.toBe(originalAccountBalances)
    expect(balances[account][0]).not.toBe(originalBalance)
    expect(originalBalance).toEqual({
      address: testTokens.badger.address,
      chainId: testTokens.badger.chainId,
      symbol: 'BDG',
      name: 'Old Badger',
      logoURI: 'http://logo.io'
    })
    expect(balances[account][0]).toEqual({
      address: testTokens.badger.address,
      chainId: testTokens.badger.chainId,
      symbol: 'BADGER',
      name: 'Badger Token',
      logoURI: 'http://logo.io'
    })
  })
})

describe('#removeCustomTokens', () => {
  let customTokens = [],
    knownTokens = {}

  const updaterFn = (node, update) => {
    if (node === 'main.tokens.custom') {
      customTokens = update(customTokens)
    } else if (node === 'main.tokens.known') {
      knownTokens = update(knownTokens)
    }
  }

  const removeTokens = (tokensToRemove) => removeTokensAction(updaterFn, tokensToRemove)

  it('removes a token', () => {
    customTokens = [testTokens.zrx, testTokens.badger]

    const tokenToRemove = { ...testTokens.zrx }

    removeTokens([tokenToRemove])

    expect(customTokens).toStrictEqual([testTokens.badger])
  })

  it('does not modify tokens if they cannot be found', () => {
    customTokens = [testTokens.zrx, testTokens.badger]

    const tokenToRemove = {
      chainId: 1,
      address: '0x383518188c0c6d7730d91b2c03a03c837814a899',
      symbol: 'OHM'
    }

    removeTokens([tokenToRemove])

    expect(customTokens).toStrictEqual([testTokens.zrx, testTokens.badger])
  })

  it('does not remove a token with the same address but different chain id', () => {
    const tokenToRemove = {
      ...testTokens.badger,
      chainId: 1
    }

    customTokens = [testTokens.zrx, testTokens.badger, tokenToRemove]

    removeTokens([tokenToRemove])

    expect(customTokens).toStrictEqual([testTokens.zrx, testTokens.badger])
  })

  it('does not remove a token with the same chain id but different address', () => {
    const tokenToRemove = {
      ...testTokens.zrx,
      address: '0xa7a82dd06901f29ab14af63faf3358ad101724a8'
    }

    customTokens = [testTokens.zrx, testTokens.badger, tokenToRemove]

    removeTokens([tokenToRemove])

    expect(customTokens).toStrictEqual([testTokens.zrx, testTokens.badger])
  })

  it('removes the token from the list of known tokens for an address', () => {
    const address = '0xa7a82dd06901f29ab14af63faf3358ad101724a8'

    knownTokens = {
      [address]: [{ ...testTokens.zrx }]
    }

    removeTokens([{ ...testTokens.zrx }])

    expect(knownTokens).toStrictEqual({ [address]: [] })
  })
})

describe('#addKnownTokens', () => {
  let tokens = []
  const account = '0xfaff9f426e8071e03eebbfefe9e7bf4b37565ab9'

  const updaterFn = (node, address, update) => {
    expect(node).toBe('main.tokens.known')
    expect(address).toBe(account)

    tokens = update(tokens)
  }

  const addTokens = (tokensToAdd) => addKnownTokensAction(updaterFn, account, tokensToAdd)

  it('adds a token', () => {
    tokens = [testTokens.zrx]

    addTokens([testTokens.badger])

    expect(tokens).toStrictEqual([testTokens.zrx, testTokens.badger])
  })

  it('overwrites a token', () => {
    tokens = [testTokens.zrx, testTokens.badger]

    const updatedBadgerToken = {
      ...testTokens.badger,
      symbol: 'BAD'
    }

    addTokens([updatedBadgerToken])

    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual(testTokens.zrx)
    expect(tokens[1].symbol).toBe('BAD')
  })
})

describe('#setScanning', () => {
  let isScanning

  beforeAll(() => {
    isScanning = false
  })

  const updaterFn = (node, address, update) => {
    expect(node).toBe('main.scanning')
    expect(address).toBe(owner)

    isScanning = update()
  }

  const setScanning = (scanning) => setScanningAction(updaterFn, owner, scanning)

  it('immediately sets the state to scanning', () => {
    setScanning(true)

    expect(isScanning).toBe(true)
  })

  it('sets the state back to not scanning after 1 second', () => {
    setScanning(false)

    expect(isScanning).toBe(true)

    jest.advanceTimersByTime(1000)

    expect(isScanning).toBe(false)
  })
})

describe('#initOrigin', () => {
  let origins
  const creationDate = new Date('2022-05-24')

  const updaterFn = (node, update) => {
    expect(node).toBe('main.origins')
    origins = update()
  }

  const initOrigin = (id, origin) => initOriginAction(updaterFn, id, origin)

  beforeEach(() => {
    origins = {}
    jest.setSystemTime(creationDate)
  })

  it('creates a new origin', () => {
    const origin = { name: 'frame.test', chain: { id: 137, type: 'ethereum' } }

    initOrigin('91f6971d-ba85-52d7-a27e-6af206eb2433', origin)

    expect(origins['91f6971d-ba85-52d7-a27e-6af206eb2433']).toEqual({
      name: 'frame.test',
      chain: {
        id: 137,
        type: 'ethereum'
      },
      session: {
        requests: 1,
        startedAt: creationDate.getTime(),
        lastUpdatedAt: creationDate.getTime()
      }
    })
  })
})

describe('#clearOrigins', () => {
  let origins

  const updaterFn = (node, update) => {
    expect(node).toBe('main.origins')
    origins = update()
  }

  const clearOrigins = () => clearOriginsAction(updaterFn)

  beforeEach(() => {
    origins = {
      '91f6971d-ba85-52d7-a27e-6af206eb2433': {},
      '8073729a-5e59-53b7-9e69-5d9bcff94087': {},
      'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {}
    }
  })

  it('should clear all existing origins', () => {
    clearOrigins(origins)

    expect(origins).toEqual({})
  })
})

describe('#removeOrigin', () => {
  let origins

  const updaterFn = (node, update) => {
    if (node === 'main.origins') origins = update(origins)
  }

  const removeOrigin = (originId) => removeOriginAction(updaterFn, originId)

  beforeEach(() => {
    origins = {
      '91f6971d-ba85-52d7-a27e-6af206eb2433': {},
      '8073729a-5e59-53b7-9e69-5d9bcff94087': {},
      'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {}
    }
  })

  it('should remove the specified origin', () => {
    removeOrigin('8073729a-5e59-53b7-9e69-5d9bcff94087')

    expect(origins).toEqual({
      '91f6971d-ba85-52d7-a27e-6af206eb2433': {},
      'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {}
    })
  })
})

describe('#addOriginRequest', () => {
  let origins

  const creationTime = new Date('2022-05-24').getTime()
  const updateTime = creationTime + 1000 * 60 * 60 * 24 * 2 // 2 days
  const endTime = creationTime + 1000 * 60 * 60 * 24 * 1 // 1 day

  const updaterFn = (node, id, update) => {
    expect(node).toBe('main.origins')
    origins[id] = update(origins[id])
  }

  const addOriginRequest = (id) => addOriginRequestAction(updaterFn, id)

  beforeEach(() => {
    jest.setSystemTime(updateTime)

    origins = {
      activeOrigin: {
        chain: { id: 10, type: 'ethereum' },
        session: {
          requests: 3,
          startedAt: creationTime,
          lastUpdatedAt: creationTime
        }
      },
      staleOrigin: {
        chain: { id: 42161, type: 'ethereum' },
        session: {
          requests: 14,
          startedAt: creationTime,
          endedAt: endTime,
          lastUpdatedAt: endTime
        }
      }
    }
  })

  it('updates the timestamp for an existing session', () => {
    addOriginRequest('activeOrigin')

    expect(origins.activeOrigin.session.startedAt).toBe(creationTime)
    expect(origins.activeOrigin.session.lastUpdatedAt).toBe(updateTime)
  })

  it('increments the request count for an existing session', () => {
    origins.activeOrigin.session.requests = 3

    addOriginRequest('activeOrigin')

    expect(origins.activeOrigin.session.requests).toBe(4)
  })

  it('handles a request for a previously ended session', () => {
    addOriginRequest('staleOrigin')

    expect(origins.staleOrigin.session.startedAt).toBe(updateTime)
    expect(origins.staleOrigin.session.endedAt).toBe(undefined)
    expect(origins.staleOrigin.session.lastUpdatedAt).toBe(updateTime)
  })

  it('resets the request count when starting a new session', () => {
    addOriginRequest('staleOrigin')

    expect(origins.staleOrigin.session.requests).toBe(1)
  })
})

describe('#switchOriginChain', () => {
  let origins = {}

  const updaterFn = (node, origin, update) => {
    const nodePath = [node, origin].join('.')
    expect(nodePath).toBe('main.origins.91f6971d-ba85-52d7-a27e-6af206eb2433')

    origins[origin] = update(origins[origin])
  }

  beforeEach(() => {
    origins = {
      '91f6971d-ba85-52d7-a27e-6af206eb2433': {
        chain: { id: 1, type: 'ethereum' }
      }
    }
  })

  const switchChain = (chainId, type) =>
    switchOriginChainAction(updaterFn, '91f6971d-ba85-52d7-a27e-6af206eb2433', chainId, type)

  it('should switch the chain for an origin', () => {
    switchChain(50, 'ethereum')

    expect(origins['91f6971d-ba85-52d7-a27e-6af206eb2433'].chain).toStrictEqual({ id: 50, type: 'ethereum' })
  })

  it('does not create a malformed record for a stale origin', () => {
    delete origins['91f6971d-ba85-52d7-a27e-6af206eb2433']

    switchChain(50, 'ethereum')

    expect(origins['91f6971d-ba85-52d7-a27e-6af206eb2433']).toBeUndefined()
  })

  it('keeps the existing record when the selected chain is unchanged', () => {
    const existing = origins['91f6971d-ba85-52d7-a27e-6af206eb2433']

    switchChain(1, 'ethereum')

    expect(origins['91f6971d-ba85-52d7-a27e-6af206eb2433']).toBe(existing)
  })

  it.each([0, -1, 1.5, Number.NaN])('ignores an invalid chain id: %s', (invalidChainId) => {
    const update = jest.fn()

    switchOriginChainAction(update, '91f6971d-ba85-52d7-a27e-6af206eb2433', invalidChainId, 'ethereum')

    expect(update).not.toHaveBeenCalled()
  })
})

describe('#removeNetwork', () => {
  let main

  const updaterFn = (node, update) => {
    expect(node).toBe('main')
    main = update(main)
  }

  beforeEach(() => {
    main = {
      origins: {
        '91f6971d-ba85-52d7-a27e-6af206eb2433': {
          chain: { id: 1, type: 'ethereum' }
        },
        '8073729a-5e59-53b7-9e69-5d9bcff94087': {
          chain: { id: 4, type: 'ethereum' }
        },
        'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {
          chain: { id: 50, type: 'cosmos' }
        },
        '695112ec-43e2-52a8-8f69-5c36837d6d13': {
          chain: { id: 4, type: 'ethereum' }
        }
      },
      networks: {
        ethereum: {
          1: {},
          4: {},
          137: {}
        },
        cosmos: {
          50: {}
        }
      },
      networksMeta: {
        ethereum: {
          1: {},
          4: {},
          137: {}
        },
        cosmos: {
          50: {}
        }
      }
    }
  })

  const removeNetwork = (networkId, networkType = 'ethereum') =>
    removeNetworkAction(updaterFn, { id: networkId, type: networkType })

  it('should delete the network and meta', () => {
    removeNetwork(4)

    expect(main.networks.ethereum).toStrictEqual({ 1: {}, 137: {} })
    expect(main.networksMeta.ethereum).toStrictEqual({ 1: {}, 137: {} })
  })

  it('should switch the chain for origins using the deleted network to mainnet', () => {
    removeNetwork(4)

    expect(main.origins).toStrictEqual({
      '91f6971d-ba85-52d7-a27e-6af206eb2433': {
        chain: { id: 1, type: 'ethereum' }
      },
      '8073729a-5e59-53b7-9e69-5d9bcff94087': {
        chain: { id: 1, type: 'ethereum' }
      },
      'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {
        chain: { id: 50, type: 'cosmos' }
      },
      '695112ec-43e2-52a8-8f69-5c36837d6d13': {
        chain: { id: 1, type: 'ethereum' }
      }
    })
  })

  describe('when passed the last network of a given type', () => {
    it('should not delete the last network of a given type', () => {
      removeNetwork(50, 'cosmos')

      expect(main.networks.cosmos[50]).toStrictEqual({})
      expect(main.networksMeta.cosmos[50]).toStrictEqual({})
    })

    it('should not update its origins', () => {
      removeNetwork(50, 'cosmos')

      expect(main.origins).toStrictEqual({
        '91f6971d-ba85-52d7-a27e-6af206eb2433': {
          chain: { id: 1, type: 'ethereum' }
        },
        '8073729a-5e59-53b7-9e69-5d9bcff94087': {
          chain: { id: 4, type: 'ethereum' }
        },
        'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {
          chain: { id: 50, type: 'cosmos' }
        },
        '695112ec-43e2-52a8-8f69-5c36837d6d13': {
          chain: { id: 4, type: 'ethereum' }
        }
      })
    })
  })
})

describe('#updateNetwork', () => {
  let main

  const updaterFn = (node, update) => {
    expect(node).toBe('main')
    main = update(main)
  }

  beforeEach(() => {
    main = {
      origins: {
        '91f6971d-ba85-52d7-a27e-6af206eb2433': {
          chain: { id: 1, type: 'ethereum' }
        },
        '8073729a-5e59-53b7-9e69-5d9bcff94087': {
          chain: { id: 4, type: 'ethereum' }
        },
        'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {
          chain: { id: 50, type: 'ethereum' }
        },
        '695112ec-43e2-52a8-8f69-5c36837d6d13': {
          chain: { id: 4, type: 'ethereum' }
        }
      },
      networks: {
        ethereum: {
          1: {},
          4: {},
          137: {}
        },
        cosmos: {
          50: {}
        }
      },
      networksMeta: {
        ethereum: {
          1: {},
          4: {},
          137: {}
        },
        cosmos: {
          50: {}
        }
      }
    }
  })

  const updateNetwork = (existingNetwork, newNetwork) =>
    updateNetworkAction(updaterFn, existingNetwork, newNetwork)

  it('should update the network', () => {
    updateNetwork(
      { id: '0x4', type: 'ethereum', name: '', explorer: '', symbol: '' },
      { id: '0x42', type: 'ethereum', name: 'test', explorer: 'explorer.test', symbol: 'TEST' }
    )

    expect(main.networks.ethereum).toStrictEqual({
      1: {},
      66: { id: 66, type: 'ethereum', name: 'test', explorer: 'explorer.test', symbol: 'TEST' },
      137: {}
    })
  })

  it('should trim string properties', () => {
    updateNetwork(
      { id: '0x4', type: 'ethereum', name: '', explorer: '', symbol: '' },
      { id: '0x42', type: 'ethereum', name: 'test     ', explorer: '   explorer.test    ', symbol: 'TEST  ' }
    )

    expect(main.networks.ethereum).toStrictEqual({
      1: {},
      66: { id: 66, type: 'ethereum', name: 'test', explorer: 'explorer.test', symbol: 'TEST' },
      137: {}
    })
  })

  it('should update the chainId for origins using the updated network', () => {
    updateNetwork(
      { id: '0x4', type: 'ethereum', name: '', explorer: '', symbol: '' },
      { id: '0x42', type: 'ethereum', name: 'test', explorer: 'explorer.test', symbol: 'TEST' }
    )

    expect(main.origins).toStrictEqual({
      '91f6971d-ba85-52d7-a27e-6af206eb2433': {
        chain: expect.objectContaining({ id: 1, type: 'ethereum' })
      },
      '8073729a-5e59-53b7-9e69-5d9bcff94087': {
        chain: expect.objectContaining({ id: 66, type: 'ethereum' })
      },
      'd7acc008-6411-5486-bb2d-0c0cfcddbb92': {
        chain: expect.objectContaining({ id: 50, type: 'ethereum' })
      },
      '695112ec-43e2-52a8-8f69-5c36837d6d13': {
        chain: expect.objectContaining({ id: 66, type: 'ethereum' })
      }
    })
  })

  it('should correctly update the networksMeta', () => {
    const icon = 'http://icon.com'
    const nativeCurrencyIcon = 'http://icon2.com'
    const nativeCurrencyName = 'TEST_NAME'
    const symbol = 'TEST'
    updateNetwork(
      { id: '0x4', type: 'ethereum', name: '', explorer: '', symbol: '' },
      {
        id: '0x4',
        type: 'ethereum',
        name: 'test',
        explorer: 'explorer.test',
        symbol,
        nativeCurrencyName,
        nativeCurrencyIcon,
        icon
      }
    )

    expect(main.networksMeta.ethereum[4]).toStrictEqual({
      icon,
      nativeCurrency: { symbol, name: nativeCurrencyName, icon: nativeCurrencyIcon, decimals: 18 },
      symbol
    })
  })

  it('should update native currency decimals', () => {
    updateNetwork(
      { id: '0x4', type: 'ethereum', name: '', explorer: '', symbol: '' },
      {
        id: '0x4',
        type: 'ethereum',
        name: 'test',
        explorer: 'explorer.test',
        symbol: 'TEST',
        nativeCurrencyName: 'Test',
        nativeCurrencyIcon: '',
        nativeCurrencyDecimals: 6,
        icon: ''
      }
    )

    expect(main.networksMeta.ethereum[4].nativeCurrency.decimals).toBe(6)
  })
})

describe('#activateNetwork', () => {
  let main = {
    networks: {
      ethereum: {
        137: {
          on: false
        }
      }
    },
    origins: {
      'frame.test': {
        chain: {
          id: 137
        }
      }
    }
  }

  const updaterFn = (node, ...args) => {
    if (node === 'main') {
      const update = args[0]
      update(main)
    }

    if (node === 'main.networks') {
      const [type, chainId, on, update] = args
      main.networks[type][chainId][on] = update()
    }
  }

  const activateNetwork = (type, chainId, active) => activateNetworkAction(updaterFn, type, chainId, active)

  it('activates the given chain', () => {
    main.networks.ethereum[137].on = false

    activateNetwork('ethereum', 137, true)

    expect(main.networks.ethereum[137].on).toBe(true)
  })

  it('switches the chain for origins from the deactivated chain to mainnet', () => {
    main.origins['frame.test'].chain.id = 137

    activateNetwork('ethereum', 137, false)

    expect(main.origins['frame.test'].chain.id).toBe(1)
  })
})

describe('#setBlockHeight', () => {
  let main

  const updaterFn = (node, update) => {
    expect(node).toBe('main.networksMeta.ethereum')
    main.networksMeta.ethereum = update(main.networksMeta.ethereum)
  }

  beforeEach(() => {
    main = {
      networksMeta: {
        ethereum: {
          1: {
            blockHeight: 0
          },
          4: {
            blockHeight: 0
          },
          137: {
            blockHeight: 0
          }
        }
      }
    }
  })

  const setBlockHeight = (chainId, blockHeight) => setBlockHeightAction(updaterFn, chainId, blockHeight)

  it('should update the block height for the expected chain', () => {
    setBlockHeight(4, 500)

    expect(main.networksMeta.ethereum).toStrictEqual({
      1: { blockHeight: 0 },
      4: { blockHeight: 500 },
      137: { blockHeight: 0 }
    })
  })
})

describe('#updateAccount', () => {
  let main

  const updaterFn = (node, id, update) => {
    if (node === 'main.accounts') {
      main.accounts[id] = update(main.accounts[id])
    }

    if (node === 'main.accountsMeta') {
      main.accountsMeta[id] = update(main.accountsMeta[id])
    }
  }

  beforeEach(() => {
    jest.setSystemTime(new Date('2022-11-17T11:01:58.135Z'))

    main = {
      accounts: {
        1: {
          id: '1',
          name: 'cool account',
          lastSignerType: 'ledger',
          balances: {}
        }
      },
      accountsMeta: {
        'e42ee170-4601-5428-bac5-d8d92fe049e8': {
          name: 'cool account',
          lastUpdated: 1568682918135
        }
      }
    }
  })

  const setAccount = (id, updatedAccount) => updateAccountAction(updaterFn, { ...updatedAccount, id })

  it('should update the account', () => {
    setAccount('1', { name: 'cool account', lastSignerType: 'seed', status: 'ok' })

    expect(main.accounts).toStrictEqual({
      1: { id: '1', name: 'cool account', lastSignerType: 'seed', status: 'ok', balances: {} }
    })
  })

  it('should not update account balances', () => {
    setAccount('1', { name: 'cool account', lastSignerType: 'seed', status: 'ok', balances: 'ignored' })

    expect(main.accounts).toStrictEqual({
      1: { id: '1', name: 'cool account', lastSignerType: 'seed', status: 'ok', balances: {} }
    })
  })

  it('should create a new account', () => {
    setAccount('2', { name: 'new cool account', lastSignerType: 'seed', status: 'ok' })

    expect(main.accounts).toStrictEqual({
      1: { id: '1', name: 'cool account', lastSignerType: 'ledger', balances: {} },
      2: { id: '2', name: 'new cool account', lastSignerType: 'seed', status: 'ok', balances: {} }
    })
  })

  it('should update existing accountMeta with the expected data', () => {
    setAccount('1', { name: 'not so cool account', lastSignerType: 'seed', status: 'ok' })

    expect(main.accountsMeta).toStrictEqual({
      'e42ee170-4601-5428-bac5-d8d92fe049e8': { name: 'not so cool account', lastUpdated: 1668682918135 }
    })
  })

  it('should create new accountMeta with the expected data', () => {
    setAccount('2', { name: 'not so cool account', lastSignerType: 'seed', status: 'ok' })

    expect(main.accountsMeta).toStrictEqual({
      'e42ee170-4601-5428-bac5-d8d92fe049e8': { name: 'cool account', lastUpdated: 1568682918135 },
      '0d6c930e-3495-56cc-993f-8da3a6150003': { name: 'not so cool account', lastUpdated: 1668682918135 }
    })
  })

  it(`should not create a new value for a default label`, () => {
    setAccount('2', { name: 'hot account', lastSignerType: 'seed', status: 'ok' })

    expect(main.accountsMeta).toStrictEqual({
      'e42ee170-4601-5428-bac5-d8d92fe049e8': { name: 'cool account', lastUpdated: 1568682918135 }
    })
  })

  it(`should not update an existing value with a default label`, () => {
    setAccount('1', { name: 'hot account', lastSignerType: 'seed', status: 'ok' })

    expect(main.accountsMeta).toStrictEqual({
      'e42ee170-4601-5428-bac5-d8d92fe049e8': { name: 'cool account', lastUpdated: 1568682918135 }
    })
  })
})

describe('#removeBalances', () => {
  let balances

  const updaterFn = (node, address, update) => {
    expect(node).toBe('main.balances')
    expect(address).toBe(owner)

    balances = update(balances)
  }

  const removeBalances = (setToRemove) => removeBalancesAction(updaterFn, owner, setToRemove)

  beforeEach(() => {
    balances = Object.values(testTokens).map((token) => ({
      ...token,
      balance: addHexPrefix(new BigNumber(120).toString(16))
    }))
  })

  it('should remove all tokens from the removal set from an accounts balance', () => {
    const removalSet = new Set(Object.values(testTokens).map(toTokenId))
    removeBalances(removalSet)
    expect(balances.length).toBe(0)
  })

  it('should only remove tokens from the removal set from an accounts balance', () => {
    const removalSet = new Set()
    removalSet.add(toTokenId(testTokens.badger))
    removeBalances(removalSet)
    expect(balances.length).toBe(1)
  })
})

describe('#removeKnownTokens', () => {
  let knownTokens

  const updaterFn = (node, address, update) => {
    expect(node).toBe('main.tokens.known')
    expect(address).toBe(owner)

    knownTokens = update(knownTokens)
  }

  const removeKnownTokens = (setToRemove) => removeKnownTokensAction(updaterFn, owner, setToRemove)

  beforeEach(() => {
    knownTokens = Object.values(testTokens)
  })

  it('should remove all tokens from the removal set from an accounts known tokens', () => {
    const removalSet = new Set(Object.values(testTokens).map(toTokenId))
    removeKnownTokens(removalSet)
    expect(knownTokens.length).toBe(0)
  })

  it('should only remove tokens from the removal set from an accounts known tokens', () => {
    const removalSet = new Set([toTokenId(testTokens.badger)])
    removeKnownTokens(removalSet)
    expect(knownTokens.length).toBe(1)
  })
})

describe('#navClearSigner', () => {
  let nav

  const updaterFn = (node, update) => {
    expect(node).toBe('windows.dash.nav')

    nav = update(nav)
  }

  const clearSigner = clearNavSignerAction.bind(null, updaterFn)

  beforeEach(() => {
    nav = []
  })

  it('should remove a specific signer from the nav', () => {
    nav = [
      {
        view: 'expandedSigner',
        data: {
          signer: '1a'
        }
      },
      {
        view: 'expandedSigner',
        data: {
          signer: '2b'
        }
      }
    ]

    const [req1, _req2] = nav

    clearSigner('2b')

    expect(nav).toStrictEqual([req1])
  })
})

describe('hardware signer prompt', () => {
  const updateDash = (state) => (_node, update) => {
    state.dash = update(state.dash)
  }

  it('opens over the existing dashboard without replacing its navigation', () => {
    const state = {
      dash: { showing: false, nav: [{ view: 'accounts', data: {} }] }
    }

    showHardwarePromptAction(updateDash(state), 'trezor-1')

    expect(state.dash).toEqual({
      showing: true,
      nav: [{ view: 'accounts', data: {} }],
      hardwarePrompt: { signerId: 'trezor-1', dismissible: false, restoreHidden: true }
    })
  })

  it('restores a previously hidden dashboard after authentication', () => {
    const state = {
      dash: {
        showing: true,
        nav: [{ view: 'accounts', data: {} }],
        hardwarePrompt: { signerId: 'trezor-1', restoreHidden: true }
      }
    }

    clearHardwarePromptAction(updateDash(state), 'trezor-1')

    expect(state.dash).toEqual({ showing: false, nav: [{ view: 'accounts', data: {} }] })
  })

  it('keeps an already-open dashboard visible and ignores another signer id', () => {
    const state = {
      dash: {
        showing: true,
        nav: [{ view: 'settings', data: {} }],
        hardwarePrompt: { signerId: 'trezor-1', restoreHidden: false }
      }
    }

    clearHardwarePromptAction(updateDash(state), 'trezor-2')
    expect(state.dash.hardwarePrompt.signerId).toBe('trezor-1')

    clearHardwarePromptAction(updateDash(state), 'trezor-1')
    expect(state.dash).toEqual({ showing: true, nav: [{ view: 'settings', data: {} }] })
  })
})

describe('#dismissHardwarePrompt', () => {
  it('clears the matching prompt without hiding the Control Panel', () => {
    const state = {
      dash: {
        showing: false,
        nav: [{ view: 'accounts', data: {} }],
        hardwarePrompt: { signerId: 'trezor-1', dismissible: true, restoreHidden: true }
      }
    }

    dismissHardwarePromptAction((_node, update) => {
      state.dash = update(state.dash)
    }, 'trezor-1')

    expect(state.dash).toEqual({ showing: true, nav: [{ view: 'accounts', data: {} }] })
  })
})

describe('#navClearReq', () => {
  let nav

  const updaterFn = (node, update) => {
    expect(node).toBe('windows.panel.nav')

    nav = update(nav)
  }

  const clearRequest = clearNavRequestAction.bind(null, updaterFn)

  beforeEach(() => {
    nav = []
  })

  it('should remove a specific request from the nav', () => {
    const accountId = '0xaccount-a'
    nav = [
      {
        view: 'requestView',
        data: {
          accountId,
          requestId: '1a'
        }
      },
      {
        view: 'requestView',
        data: {
          accountId,
          requestId: '2b'
        }
      },
      {
        view: 'expandedModule',
        data: {
          account: accountId,
          id: 'requests'
        }
      }
    ]

    const [req1, , inbox] = nav

    clearRequest(accountId, '2b')

    expect(nav).toStrictEqual([req1, inbox])
  })

  it('should remove the request inbox when not requested', () => {
    const accountId = '0xaccount-a'
    nav = [
      {
        view: 'requestView',
        data: {
          accountId,
          requestId: '1c'
        }
      },
      {
        view: 'expandedModule',
        data: {
          account: accountId,
          id: 'requests'
        }
      }
    ]

    clearRequest(accountId, '1c', false)

    expect(nav).toStrictEqual([])
  })

  it('keeps the same handler identity and inbox for another account', () => {
    nav = [
      { view: 'requestView', data: { accountId: '0xaccount-a', requestId: 'shared' } },
      { view: 'expandedModule', data: { account: '0xaccount-a', id: 'requests' } },
      { view: 'requestView', data: { accountId: '0xaccount-b', requestId: 'shared' } },
      { view: 'expandedModule', data: { account: '0xaccount-b', id: 'requests' } }
    ]

    clearRequest('0xaccount-a', 'shared', false)

    expect(nav).toStrictEqual([
      { view: 'requestView', data: { accountId: '0xaccount-b', requestId: 'shared' } },
      { view: 'expandedModule', data: { account: '0xaccount-b', id: 'requests' } }
    ])
  })
})

describe('#showWalletCallsStatus', () => {
  it('opens the account and replaces only prior status crumbs', () => {
    const existingRequest = { view: 'requestView', data: { requestId: 'request-id' } }
    let nav = [
      { view: 'walletCallsStatus', data: { status: { id: 'old-id' } } },
      existingRequest,
      { view: 'walletCallsStatus', data: { status: { id: 'older-id' } } }
    ]
    const values = {}
    const update = (...args) => {
      const updater = args.pop()
      const path = args.join('.')
      if (path === 'windows.panel.nav') nav = updater(nav)
      else values[path] = updater(values[path])
    }
    const data = {
      originName: 'example.test',
      status: { version: '2.0.0', id: 'new-id', chainId: '0x1', status: 100, atomic: false }
    }

    showWalletCallsStatusAction(update, owner, data)

    expect(nav).toEqual([{ view: 'walletCallsStatus', data: { ...data, accountId: owner } }, existingRequest])
    expect(values).toMatchObject({
      'selected.current': owner,
      'selected.minimized': false,
      'selected.open': true,
      'panel.view': 'default',
      'windows.panel.showing': true
    })
  })
})

describe('#updateTypedDataRequest', () => {
  let requests
  const request = '79928538-c971-4cf0-8498-fa4e8017398b'

  const updaterFn = (node, account, leaf, update) => {
    expect(node).toBe('main.accounts')
    expect(account).toBe(owner)
    expect(leaf).toBe('requests')

    requests = update(requests)
  }

  const updateSignatureMessage = (reqId, newData) => updateTypedDataAction(updaterFn, owner, reqId, newData)

  beforeEach(() => {
    requests = {
      [request]: {
        handlerId: '79928538-c971-4cf0-8498-fa4e8017398b',
        type: 'signTypedData',
        typedMessage: {
          data: {
            oldAttribute: true
          }
        }
      },
      some_other_id: {
        handlerId: 'wow_such_valid_handerId'
      }
    }
  })

  it('should add a new property to a request ', () => {
    expect(requests[request].doesNotExistYet).toBeUndefined()
    updateSignatureMessage(request, {
      doesNotExistYet: true
    })

    expect(requests[request].doesNotExistYet).toBeTruthy()
  })

  it('should not change any properties which are not altered in an update', () => {
    updateSignatureMessage(request, {
      doesNotExistYet: true
    })

    expect(requests[request].typedMessage.data.oldAttribute).toBeTruthy()
  })
})
