'use strict'

const QUALIFICATION_ACCOUNT = '0x9A91D79cB7d27d71E109F4DFD177475E1D35dD02'
const QUALIFICATION_DELEGATE = '0x6f96E6fDaA7492965aB0f9C92E978De807747901'
const QUALIFICATION_REQUEST = 'qualification-eip7702-revocation'
const QUALIFICATION_CODE_HASH = `0x${'ab'.repeat(32)}`
const QUALIFICATION_TX_HASH = `0x${'cd'.repeat(32)}`

const baseState = () => ({
  platform: 'linux',
  windows: {
    panel: { nav: [], footer: { height: 40 } },
    dash: { showing: false, nav: [], footer: { height: 40 } },
    onboard: { showing: true },
    frames: []
  },
  panel: {
    accountFilter: '',
    view: 'default',
    account: {
      moduleOrder: ['requests', 'chains', 'balances', 'permissions', 'signer', 'settings'],
      modules: {
        requests: { height: 0 },
        chains: { height: 0 },
        balances: { height: 0 },
        permissions: { height: 0 },
        signer: { height: 0 },
        settings: { height: 0 }
      }
    }
  },
  tray: { open: true, initial: false },
  selected: {
    minimized: true,
    open: false,
    current: '',
    view: 'default',
    addresses: [],
    showAccounts: false,
    hideBalances: false,
    position: { scrollTop: 0, initial: {} }
  },
  view: {
    notify: '',
    notifyData: {},
    notifyId: '',
    notifyOwner: '',
    notifyQueue: [],
    badge: '',
    clickGuard: false
  },
  main: {
    colorway: 'dark',
    frames: {},
    accounts: {},
    balances: {},
    signers: {},
    permissions: {},
    rates: {},
    networks: { ethereum: {} },
    networksMeta: { ethereum: {} },
    tokens: { custom: [], known: {} },
    mute: {
      betaDisclosure: true,
      gasFeeWarning: false,
      signerCompatibilityWarning: false,
      explorerWarning: false
    },
    shortcuts: {
      summon: {
        modifierKeys: ['Alt'],
        shortcutKey: 'Slash',
        enabled: true,
        configuring: false
      }
    },
    glideSide: 'right'
  }
})

const qualificationNetwork = () => ({
  id: 10,
  name: 'Optimism Mainnet — Community RPC',
  on: true,
  isTestnet: false,
  connection: { endpoints: [{ connected: true, status: 'connected' }] }
})

const accountHomeNetworks = () => ({
  networks: {
    1: {
      id: 1,
      name: 'Ethereum Mainnet',
      explorer: 'https://etherscan.io',
      on: true,
      isTestnet: false,
      connection: { endpoints: [{ connected: true, status: 'connected' }] }
    },
    10: qualificationNetwork()
  },
  metadata: {
    1: {
      primaryColor: 'wren-chain-ethereum',
      nativeCurrency: { symbol: 'ETH', decimals: 18, usd: 3200 },
      gas: {
        price: {
          fees: { nextBaseFee: '0x3b9aca00', maxPriorityFeePerGas: '0x3b9aca00' },
          levels: { fast: '0x77359400' }
        },
        samples: []
      }
    },
    10: {
      primaryColor: 'wren-chain-optimism',
      nativeCurrency: { symbol: 'ETH', decimals: 18, usd: 3200 },
      gas: {
        price: {
          fees: { nextBaseFee: '0x1dcd6500', maxPriorityFeePerGas: '0x1dcd6500' },
          levels: { fast: '0x3b9aca00' }
        },
        samples: []
      }
    }
  }
})

const qualificationAccount = (request) => ({
  id: QUALIFICATION_ACCOUNT,
  address: QUALIFICATION_ACCOUNT,
  name: 'Workshop Software Account With A Long Name',
  lastSignerType: 'ring',
  status: 'ok',
  createdAt: 1,
  balances: { lastUpdated: '2999-01-01T00:00:00.000Z' },
  activeRequestId: request?.handlerId,
  requests: request ? { [request.handlerId]: request } : {}
})

const revocationRequest = (monitoring) => ({
  type: 'eip7702Revoke',
  version: '1',
  handlerId: QUALIFICATION_REQUEST,
  account: QUALIFICATION_ACCOUNT,
  chainId: '0xa',
  origin: 'wren',
  mode: monitoring ? 'monitor' : 'normal',
  payload: {
    id: 1,
    jsonrpc: '2.0',
    method: 'wren_revokeEip7702Delegation',
    params: [QUALIFICATION_ACCOUNT, '0xa']
  },
  evidence: {
    source: 'eth_getCode',
    authority: QUALIFICATION_ACCOUNT.toLowerCase(),
    delegate: QUALIFICATION_DELEGATE,
    codeHash: QUALIFICATION_CODE_HASH,
    latestNonce: '0x123456789abcdef',
    pendingNonce: '0x123456789abcdef'
  },
  fees: {
    gasLimit: '0xb3b0',
    maxFeePerGas: '0x4a817c800',
    maxPriorityFeePerGas: '0x77359400',
    maxFee: '0x344bc31318000'
  },
  feesUpdatedByUser: false,
  operationVersion: 0,
  ...(monitoring
    ? {
        status: 'verifying',
        notice: 'Submission status unclear',
        submission: { status: 'unconfirmed', detail: 'The configured RPC returned no usable result.' },
        tx: { hash: QUALIFICATION_TX_HASH, confirmations: 0 }
      }
    : {})
})

const prepareSelectedAccount = (state, request) => {
  state.selected = {
    ...state.selected,
    minimized: false,
    open: true,
    current: QUALIFICATION_ACCOUNT,
    addresses: [QUALIFICATION_ACCOUNT]
  }
  state.main.accounts = { [QUALIFICATION_ACCOUNT]: qualificationAccount(request) }
  state.main.networks.ethereum = { 10: qualificationNetwork() }
  state.main.networksMeta.ethereum = {
    10: { nativeCurrency: { symbol: 'ETH', decimals: 18, usd: 3200 } }
  }
}

const fixtureFor = (scenario) => {
  const state = baseState()
  state.main.interfaceScale = scenario.scale
  state.view.interfaceScaleEffective = scenario.scale

  if (scenario.state === 'delegation') {
    prepareSelectedAccount(state)
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'accounts', data: {} }]
    }
  }

  if (scenario.state === 'tokens') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'tokens', data: {} }]
    }
  }

  if (scenario.state === 'account-chooser') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'accounts', data: { showAddAccounts: true } }]
    }
  }

  if (scenario.state === 'settings') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'settings', data: {} }]
    }
    Object.assign(state.main, {
      accountCloseLock: false,
      autohide: false,
      extensionCredentials: {},
      instanceId: '11111111-1111-4111-8111-111111111111',
      interfaceScale: scenario.scale,
      latticeSettings: {
        accountLimit: 5,
        derivation: 'standard',
        endpointCustom: '',
        endpointMode: 'default'
      },
      launch: false,
      ledger: { derivation: 'live', liveAccountLimit: 5 },
      reveal: false,
      showLocalNameWithENS: false,
      trezor: { derivation: 'standard' }
    })
  }

  if (scenario.state === 'networks') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'chains', data: {} }]
    }
    state.main.networks.ethereum = {
      1: {
        id: 1,
        name: 'Ethereum Mainnet',
        explorer: 'https://etherscan.io',
        on: true,
        isTestnet: false,
        connection: { endpoints: [{ connected: true, status: 'connected' }] }
      },
      10: qualificationNetwork(),
      11155111: {
        id: 11155111,
        name: 'Sepolia',
        explorer: 'https://sepolia.etherscan.io',
        on: false,
        isTestnet: true,
        connection: { endpoints: [{ connected: true, status: 'connected' }] }
      }
    }
    state.main.networksMeta.ethereum = {
      1: { nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 } },
      10: { nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 } },
      11155111: { nativeCurrency: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18 } }
    }
  }

  if (scenario.state === 'network-editor') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'chains', data: { selectedChain: { id: 1, type: 'ethereum' } } }]
    }
    state.main.networks.ethereum = {
      1: {
        id: 1,
        name: 'Ethereum Mainnet',
        explorer: 'https://etherscan.io',
        on: true,
        isTestnet: false,
        connection: {
          endpoints: [
            {
              id: 'publicnode',
              current: 'publicnode',
              on: true,
              connected: true,
              status: 'connected'
            },
            {
              id: 'backup',
              current: 'custom',
              custom: 'https://rpc.example',
              on: false,
              connected: false,
              status: 'off'
            }
          ]
        }
      }
    }
    state.main.networksMeta.ethereum = {
      1: {
        icon: '',
        nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18, icon: '' }
      }
    }
  }

  if (scenario.state === 'account-home') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.panel.account.moduleOrder = ['chains']
    state.panel.account.modules.chains.height = 105
  }

  if (scenario.state === 'account-ledger') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.balances[QUALIFICATION_ACCOUNT] = [
      {
        chainId: 1,
        address: null,
        balance: '1250000000000000000',
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH'
      },
      {
        chainId: 10,
        address: null,
        balance: '500000000000000000',
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH'
      }
    ]
    state.main.permissions[QUALIFICATION_ACCOUNT] = {
      workshop: { origin: 'workshop.example', provider: true }
    }
    if (scenario.requestsAbsent) {
      state.panel.account.moduleOrder = state.panel.account.moduleOrder.filter((id) => id !== 'requests')
    }
    state.panel.account.modules = {
      requests: { height: 48 },
      chains: { height: 104 },
      balances: { height: 248 },
      permissions: { height: 168 },
      signer: { height: 52 },
      settings: { height: 52 }
    }
  }

  if (scenario.state === 'account-drawer') {
    prepareSelectedAccount(state)
    const accountTypes = ['ring', 'ledger', 'trezor', 'lattice', 'address', 'ring']
    const accountNames = [
      'Primary account',
      'Hardware account',
      'Treasury signer',
      'Lattice vault',
      'Watch account',
      'Operations account'
    ]
    const accounts = Object.fromEntries(
      accountNames.map((name, index) => {
        const address = `0x${String(index + 1).padStart(40, '0')}`
        return [
          address,
          {
            ...qualificationAccount(),
            id: address,
            address,
            name,
            lastSignerType: accountTypes[index],
            created: `${accountNames.length - index}:0`,
            createdAt: index + 1
          }
        ]
      })
    )
    const addresses = Object.keys(accounts)
    state.main.accounts = accounts
    state.selected = {
      ...state.selected,
      current: addresses[0],
      addresses,
      showAccounts: true
    }
  }

  if (scenario.state === 'revocation-review' || scenario.state === 'revocation-monitor') {
    const request = revocationRequest(scenario.state === 'revocation-monitor')
    prepareSelectedAccount(state, request)
    state.windows.panel.nav = [
      {
        view: 'requestView',
        data: {
          step: 'confirm',
          accountId: QUALIFICATION_ACCOUNT,
          requestId: QUALIFICATION_REQUEST
        }
      }
    ]
    state.windows.panel.footer.height = 114
    state.main.addressBook = {
      [QUALIFICATION_DELEGATE.toLowerCase()]: {
        address: QUALIFICATION_DELEGATE,
        name: 'Community Delegation Contract With A Long Verified Label',
        note: '',
        createdAt: 1,
        updatedAt: 1
      }
    }
    state.main.origins = { wren: { name: 'Wren' } }
  }

  return state
}

const rpcReplyFor = (scenario, method) => {
  if (scenario.state === 'delegation' && method === 'getAccountExecutionState') {
    return {
      status: 'delegated',
      account: QUALIFICATION_ACCOUNT,
      chainId: 10,
      source: 'eth_getCode',
      delegate: QUALIFICATION_DELEGATE,
      codeHash: QUALIFICATION_CODE_HASH
    }
  }
  if (scenario.state === 'delegation' && method === 'getEip7702RevocationEligibility') {
    return {
      status: 'eligible',
      account: QUALIFICATION_ACCOUNT,
      chainId: 10,
      source: 'eth_getCode',
      delegate: QUALIFICATION_DELEGATE,
      codeHash: QUALIFICATION_CODE_HASH
    }
  }
}

module.exports = {
  QUALIFICATION_ACCOUNT,
  QUALIFICATION_CODE_HASH,
  QUALIFICATION_DELEGATE,
  QUALIFICATION_REQUEST,
  baseState,
  fixtureFor,
  rpcReplyFor
}
