'use strict'

const QUALIFICATION_ACCOUNT = '0x9A91D79cB7d27d71E109F4DFD177475E1D35dD02'
const QUALIFICATION_DELEGATE = '0x6f96E6fDaA7492965aB0f9C92E978De807747901'
const QUALIFICATION_REQUEST = 'qualification-eip7702-revocation'
const QUALIFICATION_CODE_HASH = `0x${'ab'.repeat(32)}`
const QUALIFICATION_TX_HASH = `0x${'cd'.repeat(32)}`
const QUALIFICATION_LOOKALIKE = `0x1234${'b'.repeat(32)}abcd`
const NATIVE_CURRENCY = `0x${'0'.repeat(40)}`

const activePermission = (handlerId, origin) => ({
  version: 1,
  handlerId,
  origin,
  provider: true,
  parentCapability: 'eth_accounts',
  caveats: [
    {
      type: 'wren:permissionScope',
      value: {
        account: QUALIFICATION_ACCOUNT,
        methods: ['eth_accounts'],
        chains: ['0x1'],
        expiresAt: 4_102_444_800_000
      }
    }
  ],
  grantedAt: 1_700_000_000_000
})

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
    10: qualificationNetwork(),
    123456: {
      id: 123456,
      name: 'Workshop Chain',
      explorer: 'https://explorer.example',
      on: true,
      isTestnet: false,
      connection: { endpoints: [{ connected: true, status: 'connected' }] }
    }
  },
  metadata: {
    1: {
      primaryColor: 'wren-chain-ethereum',
      nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18, usd: { price: 3200 } },
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
      nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18, usd: { price: 3200 } },
      gas: {
        price: {
          fees: { nextBaseFee: '0x1dcd6500', maxPriorityFeePerGas: '0x1dcd6500' },
          levels: { fast: '0x3b9aca00' }
        },
        samples: []
      }
    },
    123456: {
      primaryColor: 'accent6',
      nativeCurrency: { symbol: 'WRK', name: 'Workshop token', decimals: 18, usd: { price: 1 } },
      gas: {
        price: {
          fees: { nextBaseFee: '0x3b9aca00', maxPriorityFeePerGas: '0x3b9aca00' },
          levels: { fast: '0x77359400' }
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

const monitoredTransactionRequest = (status) => {
  const request = addressLookalikeRequest()
  request.handlerId = `qualification-transaction-${status}`
  request.status = status
  request.mode = 'monitor'
  request.notice = status === 'confirmed' ? 'Confirmed' : 'Confirming'
  request.tx = {
    hash: QUALIFICATION_TX_HASH,
    confirmations: status === 'confirmed' ? 13 : 4,
    receipt: {
      status: '0x1',
      blockNumber: '0x123456',
      blockHash: `0x${'ef'.repeat(32)}`,
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00'
    }
  }
  request.completed = status === 'confirmed' ? Date.UTC(2026, 7, 12, 14, 0) : undefined
  delete request.addressSafety
  return request
}

const safetyUnavailableRequest = () => {
  const request = addressLookalikeRequest()
  request.handlerId = 'qualification-safety-unavailable'
  request.status = 'error'
  request.notice = 'Delegation recheck unavailable'
  request.retainedPreBroadcastError = { reason: 'final-safety-check' }
  request.recoverableError = { code: 'account-code-evidence-unavailable' }
  delete request.addressSafety
  return request
}

const responsiveTransactionRequest = (variant) => {
  const request = addressLookalikeRequest()
  request.handlerId = `qualification-responsive-${variant}`
  request.activityId = `88888888-8888-4888-8888-${variant.padEnd(12, '0').slice(0, 12)}`
  request.classification = 'CONTRACT_CALL'
  request.data.to = QUALIFICATION_DELEGATE
  request.data.data =
    variant === 'method-unknown'
      ? '0x12345678'
      : '0xa9059cbb0000000000000000000000006f96e6fdaa7492965ab0f9c92e978de807747901000000000000000000000000000000000000000000000000000000000000002a'
  request.payload.params = [request.data]
  request.recognizedActions = []
  request.simulation = {
    status: 'succeeded',
    source: 'eth_simulateV1',
    advancedChecks: { status: 'complete' },
    effects: [],
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: {
        status: 'no-code',
        account: QUALIFICATION_ACCOUNT.toLowerCase(),
        codeHash: `0x${'00'.repeat(32)}`,
        role: 'sender'
      },
      targets: [
        {
          status: 'contract',
          account: QUALIFICATION_DELEGATE.toLowerCase(),
          codeHash: QUALIFICATION_CODE_HASH,
          role: 'target',
          callIndexes: [0]
        }
      ]
    }
  }
  delete request.addressSafety

  if (variant === 'advanced-pending') {
    request.simulation.advancedChecks.status = 'pending'
  } else if (variant === 'advanced-partial') {
    request.simulation.advancedChecks.status = 'partly-unavailable'
    request.simulation.nativeBalanceChanges = {
      status: 'unavailable',
      source: 'debug_traceCall',
      reason: 'RPC method unavailable'
    }
    request.simulation.proxyImplementationCheck = {
      status: 'unavailable',
      source: 'debug_traceCall',
      standard: 'ERC-1967',
      slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      reason: 'RPC method unavailable'
    }
  } else if (
    variant === 'method-verified' ||
    variant === 'method-standard' ||
    variant === 'method-retained'
  ) {
    request.decodedData = {
      contractAddress: QUALIFICATION_DELEGATE.toLowerCase(),
      contractName: 'Workshop Token',
      source: variant === 'method-standard' ? 'Standard ERC-20 ABI' : 'Sourcify',
      confidence: variant === 'method-standard' ? 'standard-abi' : 'verified-abi',
      retained: variant === 'method-retained',
      method: 'transfer',
      args: [
        { name: 'to', type: 'address', value: QUALIFICATION_DELEGATE.toLowerCase() },
        { name: 'amount', type: 'uint256', value: '42' }
      ]
    }
  } else if (variant === 'method-selector') {
    request.suggestedData = {
      method: 'transfer',
      signature: 'transfer(address,uint256)',
      source: 'bundled-selector-directory'
    }
  }

  if (variant.startsWith('trezor-')) {
    request.status = 'pending'
    request.notice = 'See Signer'
    request.signingProgress = {
      phase: 'waiting-for-signer',
      signerType: 'trezor',
      signerName: 'Trezor',
      startedAt:
        Date.now() - (variant === 'trezor-delayed' ? 11_000 : variant === 'trezor-slow' ? 6_000 : 500)
    }
  }

  return request
}

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

  if (scenario.state === 'accounts-icons') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'accounts', data: {} }]
    }
    const signerTypes = ['ledger', 'trezor', 'lattice', 'seed', 'ring']
    const signerNames = {
      ledger: 'Ledger',
      trezor: 'Trezor',
      lattice: 'GridPlus',
      seed: 'Seed phrase',
      ring: 'Imported keys'
    }
    state.main.signers = Object.fromEntries(
      signerTypes.map((type, index) => [
        `qualification-${type}`,
        {
          id: `qualification-${type}`,
          name: signerNames[type],
          type,
          status: 'ready',
          addresses: [],
          createdAt: signerTypes.length - index
        }
      ])
    )
    const watchAddress = `0x${'7'.repeat(40)}`
    state.main.accounts = {
      [watchAddress]: {
        ...qualificationAccount(),
        id: watchAddress,
        address: watchAddress,
        name: 'Watch account',
        lastSignerType: 'address'
      }
    }
  }

  if (scenario.state === 'trezor-pin') {
    const signerId = 'qualification-trezor-pin'
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'accounts', data: {} }],
      hardwarePrompt: { signerId, restoreHidden: false }
    }
    state.main.signers = {
      [signerId]: {
        id: signerId,
        name: 'Trezor',
        type: 'trezor',
        model: 'Trezor',
        status: 'need pin',
        addresses: []
      }
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
      },
      123456: {
        id: 123456,
        name: 'Workshop Chain',
        explorer: 'https://explorer.example',
        on: true,
        isTestnet: false,
        connection: { endpoints: [{ connected: true, status: 'connected' }] }
      }
    }
    state.main.networksMeta.ethereum = {
      1: { primaryColor: 'accent1', nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 } },
      10: { primaryColor: 'accent4', nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 } },
      11155111: {
        primaryColor: 'accent2',
        nativeCurrency: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18 }
      },
      123456: {
        primaryColor: 'accent6',
        nativeCurrency: { symbol: 'WRK', name: 'Workshop token', decimals: 18 }
      }
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
              status: 'connected',
              latencyMs: 84
            },
            {
              id: 'backup',
              current: 'custom',
              custom: 'https://secondary.ethereum.rpc.workshop.example/v1',
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
        address: NATIVE_CURRENCY,
        balance: '1250000000000000000',
        decimals: 18,
        name: 'Ether',
        native: true,
        symbol: 'ETH'
      },
      {
        chainId: 10,
        address: NATIVE_CURRENCY,
        balance: '500000000000000000',
        decimals: 18,
        name: 'Ether',
        native: true,
        symbol: 'ETH'
      },
      {
        chainId: 123456,
        address: '0x0000000000000000000000000000000000001234',
        balance: '42000000000000000000',
        decimals: 18,
        name: 'Workshop token',
        symbol: 'WRK'
      }
    ]
    if (scenario.balanceArtwork) {
      state.main.balances[QUALIFICATION_ACCOUNT].push({
        chainId: 1,
        address: '0xc56413869c6cdf96496f2b1ef801fedbdfa7ddb0',
        balance: '250000000000000000',
        decimals: 18,
        name: 'Yearn WETH',
        symbol: 'yvWETH-1'
      })
    }
    state.main.permissions[QUALIFICATION_ACCOUNT] = {
      workshop: activePermission('workshop', 'workshop.example')
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
      balances: { height: scenario.balanceArtwork ? 396 : 318 },
      activity: { height: 328 },
      permissions: { height: 168 },
      signer: { height: 52 },
      settings: { height: 52 }
    }
  }

  if (scenario.state === 'account-requests-summary') {
    prepareSelectedAccount(state)
    state.main.accounts[QUALIFICATION_ACCOUNT].requests = {
      review: { handlerId: 'review', status: 'pending' },
      submitted: { handlerId: 'submitted', status: 'verifying' },
      included: { handlerId: 'included', status: 'confirming' },
      receipt: { handlerId: 'receipt', status: 'confirmed' }
    }
    state.panel.account.moduleOrder = ['requests']
    state.panel.account.modules.requests.height = 48
  }

  if (scenario.state === 'account-requests-list') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.origins = {
      workshop: { name: 'workshop.example' },
      garden: { name: 'garden.example' }
    }
    const now = Date.now()
    const oldest = monitoredTransactionRequest('confirmed')
    Object.assign(oldest, {
      handlerId: 'qualification-request-oldest',
      origin: 'garden',
      created: now - 180_000,
      queueIndex: 1
    })
    const middle = monitoredTransactionRequest('confirming')
    Object.assign(middle, {
      handlerId: 'qualification-request-middle',
      created: now - 120_000,
      queueIndex: 2
    })
    const latest = monitoredTransactionRequest('confirming')
    Object.assign(latest, {
      handlerId: 'qualification-request-latest',
      created: now - 60_000,
      queueIndex: 3
    })
    state.main.accounts[QUALIFICATION_ACCOUNT].requests = {
      oldest,
      middle,
      latest
    }
    state.main.accounts[QUALIFICATION_ACCOUNT].activeRequestId = undefined
    state.windows.panel.nav = [
      {
        view: 'expandedModule',
        data: { id: 'requests', account: QUALIFICATION_ACCOUNT, title: 'Requests' }
      }
    ]
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

  if (
    scenario.state === 'transaction-safety-unavailable' ||
    scenario.state === 'transaction-confirming' ||
    scenario.state === 'transaction-confirmed'
  ) {
    const request =
      scenario.state === 'transaction-safety-unavailable'
        ? safetyUnavailableRequest()
        : monitoredTransactionRequest(scenario.state === 'transaction-confirmed' ? 'confirmed' : 'confirming')
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
    state.windows.panel.footer.height = scenario.state === 'transaction-safety-unavailable' ? 114 : 230
  }

  if (scenario.state === 'transaction-responsive') {
    const request = responsiveTransactionRequest(scenario.variant)
    prepareSelectedAccount(state, request)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.origins = { workshop: { name: 'workshop.example' } }
    state.windows.panel.nav = [
      {
        view: 'requestView',
        data: {
          step: scenario.viewData ? 'viewData' : 'confirm',
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
