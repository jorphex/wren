'use strict'

const QUALIFICATION_ACCOUNT = '0x9A91D79cB7d27d71E109F4DFD177475E1D35dD02'
const QUALIFICATION_DELEGATE = '0x6f96E6fDaA7492965aB0f9C92E978De807747901'
const QUALIFICATION_REQUEST = 'qualification-eip7702-revocation'
const QUALIFICATION_CODE_HASH = `0x${'ab'.repeat(32)}`
const QUALIFICATION_TX_HASH = `0x${'cd'.repeat(32)}`
const QUALIFICATION_LOOKALIKE = `0x1234${'b'.repeat(32)}abcd`

const baseState = () => ({
  platform: 'linux',
  version: '0.1.0',
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
      moduleOrder: ['requests', 'chains', 'balances', 'activity', 'permissions', 'signer', 'settings'],
      modules: {
        requests: { height: 0 },
        chains: { height: 0 },
        balances: { height: 0 },
        activity: { height: 0 },
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
    activity: [],
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

const addressLookalikeRequest = () => ({
  handlerId: 'qualification-address-lookalike',
  activityId: '77777777-7777-4777-8777-777777777777',
  type: 'transaction',
  account: QUALIFICATION_ACCOUNT,
  origin: 'workshop',
  payload: { id: 71, jsonrpc: '2.0', method: 'eth_sendTransaction', params: [] },
  data: {
    from: QUALIFICATION_ACCOUNT,
    to: QUALIFICATION_LOOKALIKE,
    chainId: '0x1',
    nonce: '0x7',
    type: '0x2',
    value: '0xde0b6b3a7640000',
    gasLimit: '0x5208',
    maxFeePerGas: '0x77359400',
    maxPriorityFeePerGas: '0x3b9aca00'
  },
  approvals: [],
  recognizedActions: [],
  classification: 'NATIVE_TRANSFER',
  recipientType: 'external',
  locked: true,
  simulation: {
    status: 'succeeded',
    source: 'eth_simulateV1',
    calls: [{ status: 'succeeded', source: 'eth_simulateV1' }],
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: { status: 'no-code' },
      targets: [{ status: 'no-code', account: QUALIFICATION_LOOKALIKE, callIndexes: [0] }]
    }
  },
  addressSafety: {
    assessedAt: Date.UTC(2026, 7, 12),
    fingerprint: 'a'.repeat(64),
    targets: [{ address: QUALIFICATION_LOOKALIKE, state: 'lookalike' }]
  }
})

const qualificationActivity = () => [
  {
    id: '11111111-1111-4111-8111-111111111111',
    account: QUALIFICATION_ACCOUNT.toLowerCase(),
    origin: 'workshop',
    type: 'transaction',
    outcome: 'confirmed',
    createdAt: Date.UTC(2026, 7, 12, 13, 58),
    completedAt: Date.UTC(2026, 7, 12, 14, 0),
    chainId: 1,
    transactionHash: QUALIFICATION_TX_HASH
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    account: QUALIFICATION_ACCOUNT.toLowerCase(),
    origin: 'garden',
    type: 'signTypedData',
    outcome: 'completed',
    createdAt: Date.UTC(2026, 7, 12, 12, 30),
    completedAt: Date.UTC(2026, 7, 12, 12, 31),
    chainId: 1
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    account: QUALIFICATION_ACCOUNT.toLowerCase(),
    origin: 'workshop',
    type: 'access',
    outcome: 'completed',
    createdAt: Date.UTC(2026, 7, 11, 18, 0),
    completedAt: Date.UTC(2026, 7, 11, 18, 0),
    chainId: 10
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    account: QUALIFICATION_ACCOUNT.toLowerCase(),
    origin: 'garden',
    type: 'walletCalls',
    outcome: 'failed',
    createdAt: Date.UTC(2026, 7, 10, 9, 14),
    completedAt: Date.UTC(2026, 7, 10, 9, 15),
    chainId: 1
  }
]

const lifecycleActivity = () =>
  [
    ['11111111-1111-4111-8111-111111111111', 'transaction', 'submitted'],
    ['22222222-2222-4222-8222-222222222222', 'walletCalls', 'confirming'],
    ['33333333-3333-4333-8333-333333333333', 'transaction', 'reorged'],
    ['44444444-4444-4444-8444-444444444444', 'transaction', 'replaced'],
    ['55555555-5555-4555-8555-555555555555', 'walletCalls', 'stopped'],
    ['66666666-6666-4666-8666-666666666666', 'eip7702Revoke', 'clearance-unverified'],
    ['77777777-7777-4777-8777-777777777777', 'eip7702Revoke', 'verified-clearance']
  ].map(([id, type, outcome], index) => ({
    id,
    account: QUALIFICATION_ACCOUNT.toLowerCase(),
    origin: index % 2 ? 'garden' : 'workshop',
    type,
    outcome,
    createdAt: Date.UTC(2026, 7, 12, 12, index),
    completedAt: Date.UTC(2026, 7, 12, 13, index),
    chainId: 1
  }))

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

  if (scenario.state === 'settings' || scenario.state === 'settings-local-connections') {
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
    if (scenario.state === 'settings-local-connections') {
      state.main.transactionNotifications = true
      state.main.nativePeerCredentials = {
        qualification: {
          fingerprint: 'B7mKnX3q8A2dL5pR9vT4wY6cF1hJ0sUeZgQxN2oC7iM',
          pairedAt: 1
        }
      }
    }
  }

  if (scenario.state === 'native-pairing') {
    state.view = {
      ...state.view,
      notify: 'nativeConnect',
      notifyData: {
        fingerprint: 'B7mKnX3q8A2dL5pR9vT4wY6cF1hJ0sUeZgQxN2oC7iM',
        pairingCode: '482 731',
        requestId: 'qualification-native-pairing'
      },
      notifyId: 'native:qualification-native-pairing',
      notifyOwner: 'native:qualification-native-pairing'
    }
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
    state.main.activity = qualificationActivity()
    state.main.origins = {
      workshop: { name: 'workshop.example' },
      garden: { name: 'garden.example' }
    }
    if (scenario.requestsAbsent) {
      state.panel.account.moduleOrder = state.panel.account.moduleOrder.filter((id) => id !== 'requests')
    }
    state.panel.account.modules = {
      requests: { height: 48 },
      chains: { height: 104 },
      balances: { height: 248 },
      activity: { height: 328 },
      permissions: { height: 168 },
      signer: { height: 52 },
      settings: { height: 52 }
    }
  }

  if (scenario.state === 'account-activity' || scenario.state === 'account-activity-lifecycle') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.activity =
      scenario.state === 'account-activity-lifecycle' ? lifecycleActivity() : qualificationActivity()
    state.main.origins = {
      workshop: { name: 'workshop.example' },
      garden: { name: 'garden.example' }
    }
    state.windows.panel.nav = [
      {
        view: 'expandedModule',
        data: { id: 'activity', account: QUALIFICATION_ACCOUNT, title: 'Activity' }
      }
    ]
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

  if (scenario.state === 'transaction-lookalike') {
    const request = addressLookalikeRequest()
    prepareSelectedAccount(state, request)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.origins = { workshop: { name: 'workshop.example' } }
    state.windows.panel.nav = [
      {
        view: 'requestView',
        data: {
          step: 'confirm',
          accountId: QUALIFICATION_ACCOUNT,
          requestId: request.handlerId
        }
      }
    ]
    state.windows.panel.footer.height = 132
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

const invokeReplyFor = (scenario, method) => {
  if (scenario.id === 'dash-settings-recovery-restore-confirm-full-1' && method === 'profile:inspectBackup') {
    return {
      success: true,
      backup: {
        formatVersion: 1,
        createdAt: '2026-08-12T14:00:00.000Z',
        signerCount: 3
      },
      restoreToken: '11111111-1111-4111-8111-111111111111',
      tokenExpiresAt: '2026-08-12T14:05:00.000Z'
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
  invokeReplyFor,
  rpcReplyFor
}
