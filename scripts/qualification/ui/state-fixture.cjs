'use strict'

const QUALIFICATION_ACCOUNT = '0x9A91D79cB7d27d71E109F4DFD177475E1D35dD02'
const QUALIFICATION_DELEGATE = '0x6f96E6fDaA7492965aB0f9C92E978De807747901'
const QUALIFICATION_REQUEST = 'qualification-eip7702-revocation'
const QUALIFICATION_CODE_HASH = `0x${'ab'.repeat(32)}`
const QUALIFICATION_TX_HASH = `0x${'cd'.repeat(32)}`
const QUALIFICATION_LOOKALIKE = `0x1234${'b'.repeat(32)}abcd`
const QUALIFICATION_RECIPIENT = '0x2222222222222222222222222222222222222222'
const QUALIFICATION_CONTACT = '0x3333333333333333333333333333333333333333'
const QUALIFICATION_RECENT_RECIPIENT = '0x5555555555555555555555555555555555555555'
const NATIVE_CURRENCY = `0x${'0'.repeat(40)}`
const QUALIFICATION_GUARDRAIL_ORIGIN = '11111111-1111-4111-8111-111111111111'
const QUALIFICATION_NATIVE_ORIGIN = '22222222-2222-4222-8222-222222222222'
const QUALIFICATION_GUARDRAIL_TARGET = '0x4444444444444444444444444444444444444444'
const QUALIFICATION_GUARDRAIL_TOKEN = '0x5555555555555555555555555555555555555555'
const QUALIFICATION_VERIFICATION_ADDRESS = '0x6666666666666666666666666666666666666666'
const QUALIFICATION_VERIFICATION_JOB = '66666666-6666-4666-8666-666666666666'
const QUALIFICATION_VERIFICATION_TOKEN = '77777777-7777-4777-8777-777777777777'
const QUALIFICATION_VERIFICATION_RUNTIME_HASH = `0x${'67'.repeat(32)}`

const qualificationPairingCode = () => {
  const code = process.env.WREN_UI_QUALIFICATION_PAIRING_CODE
  if (!code) return '482 731'
  if (!/^\d{6}$/u.test(code)) {
    throw new Error('WREN_UI_QUALIFICATION_PAIRING_CODE must contain exactly six digits')
  }
  return `${code.slice(0, 3)} ${code.slice(3)}`
}

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
  version: '0.1.3',
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
    addressBook: {},
    colorway: 'dark',
    frames: {},
    accounts: {},
    balances: {},
    activity: [],
    rememberRecentRecipients: false,
    recentRecipientUses: [],
    signers: {},
    permissions: {},
    dappGuardrails: {},
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
      name: 'Ethereum',
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

const accountAccessRequest = () => ({
  handlerId: 'qualification-account-access',
  type: 'access',
  account: QUALIFICATION_ACCOUNT,
  origin: 'workshop',
  payload: { id: 70, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }
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

const RPC_WARNING_FIXTURES = Object.freeze({
  'gas-estimate': {
    type: 'approveGasLimit',
    title: 'estimated to fail',
    message: 'execution reverted: ERC20 transfer amount exceeds balance',
    confirmLabel: 'Proceed'
  },
  revert: {
    type: 'approveSimulationOverride',
    title: 'RPC Reports Revert',
    message: 'Your configured RPC reports that this transaction will revert.',
    confirmLabel: 'Sign Anyway'
  },
  'execution-failed': {
    type: 'approveSimulationOverride',
    title: 'Execution Check Failed',
    message: 'Wren could not determine whether this transaction will execute successfully.',
    confirmLabel: 'Sign Anyway'
  },
  'execution-unavailable': {
    type: 'approveSimulationOverride',
    title: 'Execution Check Unavailable',
    message: 'Your configured RPC does not provide a usable transaction execution check.',
    confirmLabel: 'Sign Anyway'
  },
  'broad-token-approval': {
    type: 'approveBroadTokenAuthority',
    title: 'Broad Token Approval',
    message:
      'Your configured RPC reports broad ERC-20 spending authority. This may grant maximum token spending. Review RPC-reported effects before proceeding.',
    confirmLabel: 'Approve Anyway'
  },
  'existing-token-allowance': {
    type: 'approveExistingTokenAllowanceChange',
    title: 'Existing Token Allowance',
    message:
      'Your configured RPC reports a different nonzero allowance for this owner and spender. ERC-20 recommends setting the allowance to zero before assigning another nonzero value to reduce an approval-race risk.',
    confirmLabel: 'Change Anyway'
  },
  'delegated-account': {
    type: 'approveDelegatedAccountExecution',
    title: 'Delegated Account',
    message: `This account delegates execution to ${QUALIFICATION_DELEGATE}. Calls to this account run the delegate’s code in this account’s context. Sending this transaction does not by itself run that code.`,
    confirmLabel: 'Sign With Delegated Account'
  },
  'proxy-implementation': {
    type: 'approveProxyImplementationChange',
    title: 'Proxy Implementation Change',
    message:
      'Your configured RPC reports that 1 ERC-1967 proxy implementation slot will be different after this transaction. This may change the code a proxy runs and control of its assets. Check each proxy and implementation value before proceeding.',
    confirmLabel: 'Proceed Anyway'
  }
})

const queuedTransactionRequest = (handlerId, queueIndex, origin = 'workshop') => {
  const request = addressLookalikeRequest()
  request.handlerId = handlerId
  request.activityId = `88888888-8888-4888-8888-${String(queueIndex).padStart(12, '0')}`
  request.queueIndex = queueIndex
  request.created = Date.now() - (4 - queueIndex) * 60_000
  request.origin = origin
  delete request.addressSafety
  return request
}

const walletCallsFundingRequest = () => ({
  handlerId: 'qualification-wallet-calls-funding',
  activityId: '88888888-8888-4888-8888-888888888888',
  type: 'walletCalls',
  account: QUALIFICATION_ACCOUNT,
  origin: 'workshop',
  payload: { id: 72, jsonrpc: '2.0', method: 'wallet_sendCalls', params: [] },
  version: '2.0.0',
  batchId: 'qualification-batch',
  chainId: '0xa',
  atomic: false,
  calls: [
    {
      to: '0x3333333333333333333333333333333333333333',
      data: '0x',
      value: '0xde0b6b3a7640000'
    }
  ],
  preparation: {
    status: 'succeeded',
    calls: [
      {
        transaction: {
          from: QUALIFICATION_ACCOUNT,
          to: '0x3333333333333333333333333333333333333333',
          chainId: '0xa',
          nonce: '0x7',
          type: '0x2',
          data: '0x',
          value: '0xde0b6b3a7640000',
          gasLimit: '0x5208',
          maxFeePerGas: '0x77359400',
          maxPriorityFeePerGas: '0x3b9aca00',
          gasFeesSource: 'Frame'
        },
        maxFee: '0x2632e314a000'
      }
    ],
    maxFee: '0x2632e314a000'
  },
  simulation: {
    status: 'succeeded',
    source: 'eth_simulateV1',
    calls: [{ status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x5208' }],
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: { status: 'no-code' },
      targets: [{ account: '0x3333333333333333333333333333333333333333', status: 'no-code' }]
    }
  },
  status: 'error',
  notice: 'The selected account cannot cover this wallet-call batch and its maximum fees.',
  recoverableError: {
    code: 'wallet-call-funding-insufficient',
    message: 'The selected account cannot cover this wallet-call batch and its maximum fees.',
    data: {
      available: '0x2386f26fc10000',
      required: '0xde0dce69bc24000',
      missing: '0xdbd55f42c014000',
      value: '0xde0b6b3a7640000',
      maximumFee: '0x2632f45e4000'
    }
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

const qualificationYearnCatalog = () => {
  const asset = '0x1111111111111111111111111111111111111111'
  const vault = '0x1212121212121212121212121212121212121212'
  const locked = '0x1313131313131313131313131313131313131313'
  const apy = (value) => ({ value, label: 'Est. APY', source: 'qualification' })
  return {
    status: 'fresh',
    fetchedAt: 1_787_097_600_000,
    errors: [],
    vaults: [
      {
        id: 'ethereum-yvusd',
        chainId: 1,
        chainName: 'Ethereum',
        address: vault,
        kind: 'yvUSD',
        name: 'yvUSD',
        symbol: 'yvUSD',
        description: 'Earn with flexible or time-locked yvUSD.',
        asset: { address: asset, name: 'USD Coin', symbol: 'USDC', decimals: 6 },
        decimals: 6,
        tvlUsd: 1_500_000,
        apy: apy(0.0512),
        riskLevel: 1,
        riskLabel: 'Conservative',
        performanceFeeBps: 1000,
        managementFeeBps: 0,
        inceptionTime: 1_700_000_000,
        yearnUrl: 'https://yearn.fi/vaults/1/0x1212121212121212121212121212121212121212',
        status: 'available',
        variants: [
          {
            id: 'unlocked',
            address: vault,
            name: 'yvUSD',
            symbol: 'yvUSD',
            asset: { address: asset, name: 'USD Coin', symbol: 'USDC', decimals: 6 },
            decimals: 6,
            tvlUsd: 1_000_000,
            apy: apy(0.05)
          },
          {
            id: 'locked',
            address: locked,
            name: 'Locked yvUSD',
            symbol: 'styvUSD',
            asset: { address: vault, name: 'yvUSD', symbol: 'yvUSD', decimals: 6 },
            decimals: 6,
            tvlUsd: 500_000,
            apy: apy(0.07)
          }
        ]
      }
    ]
  }
}

const qualificationYearnPositions = () => ({
  account: { address: QUALIFICATION_ACCOUNT, name: 'Workshop account', readOnly: false },
  chains: [
    {
      chainId: 1,
      status: 'ready',
      positions: [
        {
          vaultId: 'ethereum-yvusd',
          chainId: 1,
          status: 'available',
          hasPosition: true,
          assetBalanceRaw: '5000000',
          assetBalance: '5.0',
          variants: [
            {
              id: 'unlocked',
              address: '0x1212121212121212121212121212121212121212',
              symbol: 'yvUSD',
              decimals: 6,
              sharesRaw: '1500000',
              shares: '1.5',
              assetSymbol: 'USDC',
              assetDecimals: 6,
              assetsRaw: '1500000',
              assets: '1.5'
            },
            {
              id: 'locked',
              address: '0x1313131313131313131313131313131313131313',
              symbol: 'styvUSD',
              decimals: 6,
              sharesRaw: '2000000',
              shares: '2.0',
              assetSymbol: 'yvUSD',
              assetDecimals: 6,
              assetsRaw: '1900000',
              assets: '1.9',
              cooldown: {
                status: 'none',
                sharesRaw: '0',
                shares: '0.0',
                cooldownEnd: 0,
                windowEnd: 0,
                cooldownDuration: 1_209_600,
                withdrawalWindow: 432_000
              }
            }
          ]
        }
      ]
    },
    { chainId: 8453, status: 'disabled', reason: 'Enable Base in Wren.', positions: [] },
    { chainId: 747474, status: 'disabled', reason: 'Enable Katana in Wren.', positions: [] }
  ]
})

const fixtureFor = (scenario) => {
  const state = baseState()
  if (scenario.glideSide === 'left' || scenario.glideSide === 'right') {
    state.main.glideSide = scenario.glideSide
  }
  if (scenario.workspaceOpen) {
    state.windows.dash.showing = true
  }
  state.main.interfaceScale = scenario.scale
  state.view.interfaceScaleEffective = scenario.scale

  if (scenario.state === 'update-available' || scenario.state === 'update-ready') {
    state.view.badge = {
      type: scenario.state === 'update-available' ? 'updateAvailable' : 'updateReady',
      version: '0.1.3'
    }
  }

  if (scenario.state === 'delegation') {
    prepareSelectedAccount(state)
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'accounts', data: {} }]
    }
  }

  if (scenario.state === 'tokens' || scenario.state === 'tokens-list') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'tokens', data: {} }]
    }
    if (scenario.state === 'tokens-list') {
      state.main.tokens.custom = [
        {
          address: '0xc56413869c6cdf96496f2b1ef801fedbdfa7ddb0',
          artworkKey: 'ethereum-yvweth-1',
          chainId: 1,
          decimals: 18,
          name: 'Yearn Wrapped Ether',
          symbol: 'yvWETH-1'
        }
      ]
    }
  }

  if (scenario.state === 'inspector') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'inspector', data: {} }]
    }
  }

  if (scenario.state === 'deployment') {
    prepareSelectedAccount(state)
    const signerId = 'qualification-deployment-signer'
    state.main.accounts[QUALIFICATION_ACCOUNT].signer = signerId
    state.main.signers = {
      [signerId]: {
        id: signerId,
        name: 'Qualification signer',
        type: 'ring',
        status: 'ready',
        addresses: [QUALIFICATION_ACCOUNT]
      }
    }
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'contracts', data: { mode: 'deploy' } }]
    }
  }

  if (scenario.state === 'contract-verification') {
    const { networks, metadata } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: 'contracts',
          data:
            scenario.variant === 'confirmed'
              ? {
                  mode: 'verify',
                  operationId: '88888888-8888-4888-8888-888888888888',
                  chainId: 10,
                  address: QUALIFICATION_VERIFICATION_ADDRESS
                }
              : scenario.variant === 'result'
                ? { mode: 'verify', verificationId: QUALIFICATION_VERIFICATION_JOB }
                : { mode: 'verify' }
        }
      ]
    }
  }

  if (['earn-yvusd', 'earn-loading'].includes(scenario.state)) {
    prepareSelectedAccount(state)
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: 'earn',
          data:
            scenario.state === 'earn-loading' ? {} : { vaultId: 'ethereum-yvusd', variant: scenario.variant }
        }
      ]
    }
    state.main.networks.ethereum = {
      1: {
        id: 1,
        name: 'Ethereum',
        on: true,
        isTestnet: false,
        connection: { endpoints: [{ connected: true, status: 'connected' }] }
      }
    }
    state.main.networksMeta.ethereum = {
      1: {
        primaryColor: 'wren-chain-ethereum',
        nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 }
      }
    }
  }

  if (
    scenario.state === 'address-book-list' ||
    scenario.state === 'address-book-editor' ||
    scenario.state === 'send-composer' ||
    scenario.state === 'send-asset-picker' ||
    scenario.state === 'send-sweep-selection' ||
    scenario.state === 'send-recipient-picker' ||
    scenario.state === 'send-confirmed' ||
    scenario.state === 'send-max-review' ||
    scenario.state === 'send-sweep-review'
  ) {
    const verifiedAt = Date.UTC(2026, 7, 18)
    state.main.addressBook = {
      [QUALIFICATION_CONTACT.toLowerCase()]: {
        address: QUALIFICATION_CONTACT,
        name: 'Operations multisig with a deliberately long label',
        note: 'Quarterly treasury recipient',
        provenance: {
          status: 'verified-out-of-band',
          verifiedAt,
          note: 'Compared with the deployment record on a separate device'
        },
        createdAt: 1,
        updatedAt: verifiedAt
      },
      [QUALIFICATION_RECIPIENT.toLowerCase()]: {
        address: QUALIFICATION_RECIPIENT,
        name: 'Garden Friend',
        note: '',
        provenance: { status: 'saved' },
        createdAt: 1,
        updatedAt: 1
      }
    }
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: scenario.state.startsWith('send-') ? 'send' : 'addressBook',
          data:
            scenario.state === 'address-book-editor'
              ? { screen: 'edit', address: QUALIFICATION_CONTACT }
              : scenario.state === 'send-recipient-picker'
                ? { step: 'contactPicker', title: 'Choose a recipient' }
                : scenario.state === 'send-asset-picker'
                  ? { step: 'assetPicker', title: 'Choose an asset' }
                  : {}
        }
      ]
    }
  }

  if (
    [
      'send-composer',
      'send-asset-picker',
      'send-sweep-selection',
      'send-recipient-picker',
      'send-confirmed',
      'send-max-review',
      'send-sweep-review'
    ].includes(scenario.state)
  ) {
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
        address: '0x3333333333333333333333333333333333333333',
        balance: '100000000',
        decimals: 6,
        name: 'USD Coin',
        symbol: 'USDC'
      }
    ]
    state.main.rates = {}
    if (scenario.state === 'send-recipient-picker') {
      state.selected.hideBalances = true
      state.main.rememberRecentRecipients = true
      state.main.recentRecipientUses = [
        {
          operationId: '33333333-3333-4333-8333-333333333333',
          address: QUALIFICATION_RECENT_RECIPIENT,
          confirmedAt: Date.now() - 1_000
        },
        {
          operationId: '44444444-4444-4444-8444-444444444444',
          address: QUALIFICATION_ACCOUNT.toLowerCase(),
          confirmedAt: Date.now() - 2_000
        }
      ]
    }
  }

  if (scenario.state === 'add-token-selector') {
    const { networks, metadata } = accountHomeNetworks()
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'tokens', data: { notify: 'addToken' } }]
    }
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
  }

  if (scenario.state === 'add-token-details') {
    const { networks, metadata } = accountHomeNetworks()
    const address = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: 'tokens',
          data: {
            notify: 'addToken',
            notifyData: {
              address,
              chain: { id: 1, name: 'Ethereum', color: 'wren-chain-ethereum' },
              tokenData: {
                address,
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6,
                logoURI: '',
                totalSupply: '1000000000000'
              }
            }
          }
        }
      ]
    }
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
  }

  if (scenario.state === 'account-chooser') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'accounts', data: { showAddAccounts: true } }]
    }
  }

  const accountSetupTypes = {
    'account-add-watch': 'nonsigning',
    'account-add-seed': 'seed',
    'account-add-trezor': 'trezor',
    'account-create-phrase': 'create-seed',
    'account-create-private-key': 'create-keyring'
  }
  if (accountSetupTypes[scenario.state]) {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: 'accounts',
          data: {
            showAddAccounts: true,
            newAccountType: accountSetupTypes[scenario.state]
          }
        }
      ]
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
      nav: [{ view: 'expandedSigner', data: { signer: signerId } }],
      hardwarePrompt: { signerId, dismissible: true, restoreHidden: false }
    }
    state.main.signers = {
      [signerId]: {
        id: signerId,
        name: 'Trezor Signer',
        type: 'trezor',
        model: 'Trezor',
        status: 'need pin',
        addresses: []
      }
    }
  }

  if (scenario.state === 'signer-seed-locked' || scenario.state === 'signer-ring-locked') {
    const type = scenario.state === 'signer-seed-locked' ? 'seed' : 'ring'
    const signerId = `qualification-${type}-locked`
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [{ view: 'expandedSigner', data: { signer: signerId } }]
    }
    state.main.signers = {
      [signerId]: {
        id: signerId,
        name: type === 'seed' ? 'Seed phrase signer' : 'Private key signer',
        type,
        status: 'locked',
        addresses: [
          '0x00000000000000000000000000000000000000aa',
          '0x00000000000000000000000000000000000000bb'
        ],
        createdAt: 1
      }
    }
  }

  if (scenario.state === 'account-startup') {
    const startupAccounts = [
      [QUALIFICATION_ACCOUNT, 'Primary Account', 'ring'],
      [`0x${'6'.repeat(40)}`, 'Trezor Account', 'trezor'],
      [`0x${'7'.repeat(40)}`, 'Watch Account', 'address']
    ]
    state.main.accounts = Object.fromEntries(
      startupAccounts.map(([address, name, lastSignerType], index) => [
        address,
        {
          id: address,
          address,
          name,
          lastSignerType,
          status: 'ok',
          created: `new:${index + 1}`,
          createdAt: index + 1,
          balances: { lastUpdated: '2999-01-01T00:00:00.000Z' },
          requests: {}
        }
      ])
    )
  }

  if (
    scenario.state === 'settings' ||
    scenario.state === 'settings-local-connections' ||
    scenario.state === 'settings-recent-recipients'
  ) {
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
    if (scenario.state === 'settings-recent-recipients') {
      state.main.rememberRecentRecipients = true
      state.main.recentRecipientUses = [
        {
          operationId: '33333333-3333-4333-8333-333333333333',
          address: QUALIFICATION_RECENT_RECIPIENT,
          confirmedAt: Date.now() - 1_000
        }
      ]
    }
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
        pairingCode: qualificationPairingCode(),
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
        name: 'Ethereum',
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

  if (scenario.state === 'connected-apps') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: 'dapps',
          data: scenario.variant === 'details' ? { dappDetails: 'workshop' } : {}
        }
      ]
    }
    state.main.networks.ethereum = {
      1: {
        id: 1,
        name: 'Ethereum',
        on: true,
        isTestnet: false,
        connection: { endpoints: [{ connected: true, status: 'connected' }] }
      },
      10: {
        id: 10,
        name: 'Optimism Mainnet',
        on: true,
        isTestnet: false,
        connection: { endpoints: [{ connected: true, status: 'connected' }] }
      }
    }
    state.main.networksMeta.ethereum = {
      1: { primaryColor: 'accent1', nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 } },
      10: { primaryColor: 'accent4', nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18 } }
    }
    state.main.origins = {
      workshop: {
        chain: { id: 1 },
        name: 'workshop.example',
        session: { startedAt: Date.now() - 60_000, lastUpdatedAt: Date.now(), requests: 12 }
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
        name: 'Ethereum',
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

  if (scenario.state === 'network-add') {
    state.windows.dash = {
      ...state.windows.dash,
      showing: true,
      nav: [
        {
          view: 'chains',
          data: {
            newChain: {
              id: 8453,
              name: 'Base Mainnet',
              symbol: 'ETH',
              explorer: 'https://basescan.org',
              isTestnet: false,
              type: 'ethereum',
              rpcUrls: ['https://mainnet.base.org'],
              nativeCurrencyName: 'Ether',
              nativeCurrencyDecimals: 18
            }
          }
        }
      ]
    }
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
  }

  if (scenario.state === 'account-home') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.panel.account.moduleOrder = ['chains']
    state.panel.account.modules.chains.height = scenario.logicalWidth <= 540 ? 108 : 56
  }

  if (scenario.state === 'account-ledger' || scenario.state === 'account-balances') {
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
      chains: { height: scenario.logicalWidth <= 540 ? 108 : 56 },
      balances: { height: scenario.balanceArtwork ? 396 : 318 },
      activity: { height: 332 },
      permissions: { height: 92 },
      signer: { height: 52 },
      settings: { height: 52 }
    }
    if (scenario.state === 'account-balances') {
      state.windows.panel.nav = [
        {
          view: 'expandedModule',
          data: { id: 'balances', account: QUALIFICATION_ACCOUNT, title: 'Balances' }
        }
      ]
    }
  }

  if (scenario.state === 'account-permissions') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.permissions[QUALIFICATION_ACCOUNT] = {
      [QUALIFICATION_GUARDRAIL_ORIGIN]: activePermission(
        QUALIFICATION_GUARDRAIL_ORIGIN,
        'https://treasury.workshop.example'
      ),
      [QUALIFICATION_NATIVE_ORIGIN]: activePermission(QUALIFICATION_NATIVE_ORIGIN, 'Local treasury app')
    }
    state.main.origins = {
      [QUALIFICATION_GUARDRAIL_ORIGIN]: {
        name: 'https://treasury.workshop.example',
        provenance: 'direct',
        sessionOnly: false,
        chain: { id: 1, type: 'ethereum' },
        session: { requests: 12, startedAt: 1, lastUpdatedAt: 2 }
      },
      [QUALIFICATION_NATIVE_ORIGIN]: {
        name: 'Local treasury app',
        provenance: 'native',
        sourceId: 'B7mKnX3q8A2dL5pR9vT4wY6cF1hJ0sUeZgQxN2oC7iM',
        sessionOnly: false,
        chain: { id: 1, type: 'ethereum' },
        session: { requests: 4, startedAt: 1, lastUpdatedAt: 2 }
      }
    }
    state.main.dappGuardrails[QUALIFICATION_ACCOUNT.toLowerCase()] = {
      [QUALIFICATION_GUARDRAIL_ORIGIN]: {
        '0x1': {
          version: 1,
          account: QUALIFICATION_ACCOUNT.toLowerCase(),
          originId: QUALIFICATION_GUARDRAIL_ORIGIN,
          chainId: '0x1',
          mode: 'block',
          targets: [QUALIFICATION_GUARDRAIL_TARGET],
          spenders: [],
          nativeValueCeiling: '0x1158e460913d0000',
          tokenCeilings: [{ token: QUALIFICATION_GUARDRAIL_TOKEN, amount: '0x3e8' }],
          expiresAt: Date.UTC(2030, 0, 1),
          createdAt: 1,
          updatedAt: 2,
          revision: 1
        }
      }
    }
    state.windows.panel.nav = [
      {
        view: 'expandedModule',
        data: { id: 'permissions', account: QUALIFICATION_ACCOUNT, title: 'Connected apps' }
      }
    ]
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

  if (scenario.state === 'account-signing-queue' || scenario.state === 'transaction-signing-queue-review') {
    prepareSelectedAccount(state)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.origins = {
      workshop: { name: 'workshop.example' },
      garden: { name: 'garden.example' }
    }
    const first = queuedTransactionRequest('qualification-queue-first', 1, 'workshop')
    const second = queuedTransactionRequest('qualification-queue-second', 2, 'garden')
    const third = queuedTransactionRequest('qualification-queue-third', 3, 'workshop')
    state.main.accounts[QUALIFICATION_ACCOUNT].requests = {
      [first.handlerId]: first,
      [second.handlerId]: second,
      [third.handlerId]: third
    }
    state.main.accounts[QUALIFICATION_ACCOUNT].activeRequestId = first.handlerId
    state.windows.panel.nav = [
      scenario.state === 'account-signing-queue'
        ? {
            view: 'expandedModule',
            data: { id: 'requests', account: QUALIFICATION_ACCOUNT, title: 'Requests' }
          }
        : {
            view: 'requestView',
            data: {
              step: 'confirm',
              accountId: QUALIFICATION_ACCOUNT,
              requestId: first.handlerId
            }
          }
    ]
    state.windows.panel.footer.height = scenario.state === 'transaction-signing-queue-review' ? 113 : 132
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
    const verifiedAt = Date.UTC(2026, 7, 18)
    state.main.addressBook = {
      [QUALIFICATION_DELEGATE.toLowerCase()]: {
        address: QUALIFICATION_DELEGATE,
        name: 'Community Delegation Contract With A Long Verified Label',
        note: '',
        provenance: {
          status: 'verified-out-of-band',
          verifiedAt,
          note: 'Compared with the deployment record on a separate device'
        },
        createdAt: 1,
        updatedAt: verifiedAt
      }
    }
    state.main.origins = { wren: { name: 'Wren' } }
  }

  if (scenario.state === 'account-access-review') {
    const request = accountAccessRequest()
    prepareSelectedAccount(state, request)
    state.main.origins = { workshop: { name: 'basescan.org' } }
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
    state.windows.panel.footer.height = 114
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

  if (scenario.state === 'transaction-deployment') {
    const request = addressLookalikeRequest()
    const initcodeHash = '0x5e3ce470a8506d55e59815db7232a08774174ae0c7fdb2fbc81a49e4e242b0d6'
    request.handlerId = 'qualification-deployment-review'
    request.origin = 'qualification-wren-deploy'
    request.classification = 'CONTRACT_DEPLOY'
    request.data = {
      from: QUALIFICATION_ACCOUNT,
      chainId: '0x1',
      data: '0x60006000',
      nonce: '0x5',
      type: '0x2',
      value: '0x0',
      gasLimit: '0x186a0',
      maxFeePerGas: '0x77359400',
      maxPriorityFeePerGas: '0x3b9aca00'
    }
    request.deployment = {
      version: 1,
      inspectionId: '0123456789abcdef0123456789abcdef',
      account: QUALIFICATION_ACCOUNT.toLowerCase(),
      chainId: '0x1',
      initcodeHash,
      initcodeBytes: 4,
      value: '0x0',
      preparedAt: Date.UTC(2026, 7, 20, 12, 0, 0),
      expiresAt: Date.UTC(2026, 7, 20, 12, 1, 0),
      pendingNonce: '0x5',
      provisionalAddress: '0x3333333333333333333333333333333333333333'
    }
    delete request.addressSafety
    delete request.recipientType
    prepareSelectedAccount(state, request)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.origins = {
      'qualification-wren-deploy': { name: 'http://deploy.wren.localhost:8421' }
    }
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
    state.windows.panel.footer.height = 114
  }

  if (scenario.state === 'transaction-rpc-warning') {
    const request = addressLookalikeRequest()
    const warning = RPC_WARNING_FIXTURES[scenario.variant]
    if (!warning) throw new Error(`Unknown RPC warning qualification variant: ${scenario.variant}`)
    request.handlerId = `qualification-rpc-warning-${scenario.variant}`
    request.approvals = [
      {
        type: warning.type,
        approved: false,
        data: {
          title: warning.title,
          message: warning.message,
          confirmLabel: warning.confirmLabel,
          ...(warning.type === 'approveGasLimit' ? { gasLimit: '0x00' } : {})
        }
      }
    ]
    delete request.addressSafety
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
    state.windows.panel.footer.height = 200
  }

  if (scenario.state === 'transaction-deployment-confirmed') {
    const request = monitoredTransactionRequest('confirmed')
    request.handlerId = 'qualification-deployment-confirmed'
    request.activityId = '88888888-8888-4888-8888-888888888888'
    request.origin = 'ae9af752-884b-5edc-a215-5d472486a6b9'
    request.classification = 'CONTRACT_DEPLOY'
    request.data = {
      from: QUALIFICATION_ACCOUNT,
      chainId: '0x1',
      data: '0x60006000',
      nonce: '0x7',
      type: '0x2',
      value: '0x0',
      gasLimit: '0x186a0',
      maxFeePerGas: '0x77359400',
      maxPriorityFeePerGas: '0x3b9aca00'
    }
    request.payload.params = [request.data]
    delete request.recipient
    delete request.recipientType
    request.deployment = {
      version: 1,
      inspectionId: '0123456789abcdef0123456789abcdef',
      account: QUALIFICATION_ACCOUNT.toLowerCase(),
      chainId: '0x1',
      initcodeHash: '0x5e3ce470a8506d55e59815db7232a08774174ae0c7fdb2fbc81a49e4e242b0d6',
      initcodeBytes: 4,
      value: '0x0',
      preparedAt: Date.UTC(2026, 7, 20, 12, 0, 0),
      expiresAt: Date.UTC(2026, 7, 20, 12, 1, 0)
    }
    request.tx.receipt.contractAddress = QUALIFICATION_VERIFICATION_ADDRESS
    prepareSelectedAccount(state, request)
    const { metadata, networks } = accountHomeNetworks()
    state.main.networks.ethereum = networks
    state.main.networksMeta.ethereum = metadata
    state.main.origins = {
      [request.origin]: { name: 'http://deploy.wren.localhost:8421' }
    }
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
    state.windows.panel.footer.height = 250
  }

  if (scenario.state === 'wallet-calls-funding') {
    const request = walletCallsFundingRequest()
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
    state.windows.panel.footer.height = scenario.id.includes('-qr-') ? 430 : 270
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
  if (scenario.state === 'account-create-phrase' && method === 'reserveGeneratedWallet') {
    return { sessionId: '1'.repeat(32) }
  }
  if (scenario.state === 'account-create-phrase' && method === 'beginGeneratedWallet') {
    return {
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      challenge: [2, 6, 10],
      kind: 'phrase',
      secret: 'test test test test test test test test test test test junk',
      sessionId: '1'.repeat(32),
      expiresAt: Date.now() + 600_000
    }
  }
  if (scenario.state === 'account-create-private-key' && method === 'reserveGeneratedWallet') {
    return { sessionId: '2'.repeat(32) }
  }
  if (scenario.state === 'account-create-private-key' && method === 'beginGeneratedWallet') {
    return {
      address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
      challenge: 'private-key',
      kind: 'private-key',
      secret: `0x${'1'.padStart(64, '0')}`,
      sessionId: '2'.repeat(32),
      expiresAt: Date.now() + 600_000
    }
  }
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

const invokeReplyFor = (scenario, method, args = []) => {
  if (scenario.state === 'earn-loading' && method === 'yearn:getCatalog') {
    const catalog = qualificationYearnCatalog()
    if (args[0]?.cacheOnly) {
      return {
        ...catalog,
        status: 'unavailable',
        fetchedAt: null,
        errors: [{ chainId: 1, message: 'Yearn data is loading' }],
        vaults: catalog.vaults.map((vault) => ({
          ...vault,
          status: 'unavailable',
          statusReason: 'Loading current Yearn data',
          tvlUsd: 0,
          apy: { value: null, label: 'Unavailable', source: 'unavailable' },
          riskLevel: null,
          riskLabel: 'Unrated',
          variants: vault.variants.map((variant) => ({
            ...variant,
            tvlUsd: 0,
            apy: { value: null, label: 'Unavailable', source: 'unavailable' }
          }))
        }))
      }
    }
    return catalog
  }
  if (scenario.state === 'earn-yvusd' && method === 'yearn:getCatalog') {
    return qualificationYearnCatalog()
  }
  if (scenario.state === 'earn-yvusd' && method === 'yearn:getPositions') {
    return qualificationYearnPositions()
  }
  if (scenario.state === 'earn-yvusd' && method === 'yearn:getWorkflows') {
    return { workflows: [] }
  }
  if (scenario.state.startsWith('settings') && method === 'signers:protectionStatus') {
    return {
      success: true,
      status: {
        available: true,
        backend: 'qualification-keychain',
        enabled: false,
        protectedFiles: 0,
        signerFiles: 0,
        state: 'disabled'
      }
    }
  }
  if (scenario.state === 'inspector' && method === 'inspector:inspect') {
    return {
      success: true,
      inspection: {
        kind: 'transaction',
        source: 'direct',
        normalized: {
          chainId: '0x1',
          data: '0x12345678'
        },
        decode: {
          status: 'unknown',
          source: 'bundled-standard-abi',
          selector: '0x12345678',
          reason: 'No bundled ABI matched this selector.'
        },
        evidence: [
          { kind: 'calldata', status: 'available', source: 'local' },
          { kind: 'simulation', status: 'available', source: 'configured-rpc' }
        ],
        missingContext: [],
        simulation: {
          status: 'succeeded',
          source: 'eth_call',
          effects: [],
          nativeBalanceChanges: { status: 'succeeded', changes: [] },
          callTrace: { calls: [], truncated: false }
        }
      }
    }
  }
  if (scenario.state === 'deployment' && method === 'deployment:prepare') {
    return {
      success: true,
      inspection: {
        id: '0123456789abcdef0123456789abcdef',
        preparedAt: Date.UTC(2026, 7, 20, 12, 0, 0),
        expiresAt: Date.UTC(2026, 7, 20, 12, 1, 0),
        account: QUALIFICATION_ACCOUNT.toLowerCase(),
        chainId: '0xa',
        initcode: {
          bytes: 4,
          hash: '0x5e3ce470a8506d55e59815db7232a08774174ae0c7fdb2fbc81a49e4e242b0d6'
        },
        value: '0x2386f26fc10000',
        gasEstimate: {
          status: 'succeeded',
          source: 'configured-rpc',
          method: 'eth_estimateGas',
          value: '0x186a0',
          padded: true
        },
        simulation: {
          status: 'succeeded',
          source: 'configured-rpc',
          method: 'eth_call',
          advancedChecks: 'partly-unavailable'
        },
        pendingNonce: {
          status: 'succeeded',
          source: 'configured-rpc',
          method: 'eth_getTransactionCount',
          nonce: '0x5',
          provisionalAddress: '0x3333333333333333333333333333333333333333',
          provisional: true
        }
      }
    }
  }
  if (method === 'contractVerification:inspectArtifact') {
    return {
      success: true,
      artifact: {
        token: QUALIFICATION_VERIFICATION_TOKEN,
        summary: {
          format: 'foundry-build-info',
          language: 'Solidity',
          compilerStatus: 'included',
          compilerVersion: '0.8.28',
          sourceCount: 4,
          contractCandidates: ['src/CommunityVault.sol:CommunityVault'],
          localRuntimeMatch: true,
          selectionRequired: false,
          selectedContractIdentifier: 'src/CommunityVault.sol:CommunityVault'
        }
      }
    }
  }
  if (method === 'contractVerification:list') return { success: true, jobs: [] }
  if (method === 'contractVerification:openResult') return { success: true }
  if (method === 'contractVerification:credentialStatus') {
    return {
      success: true,
      credential: { available: true, configured: false, backend: 'secret_service' }
    }
  }
  if (method === 'contractVerification:prepare') {
    return {
      success: true,
      prepared: {
        acknowledgementToken: '99999999-9999-4999-8999-999999999999',
        target: {
          address: QUALIFICATION_VERIFICATION_ADDRESS,
          chainId: 10,
          runtimeCodeHash: QUALIFICATION_VERIFICATION_RUNTIME_HASH
        },
        language: 'Solidity',
        compilerVersion: '0.8.28',
        contractIdentifier: 'src/CommunityVault.sol:CommunityVault',
        sourceCount: 4,
        localRuntimeMatch: 'matched',
        deploymentSettlement: 'not-applicable'
      }
    }
  }
  if (method === 'contractVerification:get') {
    return {
      success: true,
      job: {
        id: QUALIFICATION_VERIFICATION_JOB,
        target: {
          address: QUALIFICATION_VERIFICATION_ADDRESS,
          chainId: 10,
          runtimeCodeHash: QUALIFICATION_VERIFICATION_RUNTIME_HASH
        },
        language: 'Solidity',
        compilerVersion: '0.8.28',
        contractIdentifier: 'src/CommunityVault.sol:CommunityVault',
        sourceHash: '68'.repeat(32),
        submissionHash: '69'.repeat(32),
        status: 'partial',
        destinations: [
          { destination: 'sourcify', status: 'published' },
          {
            destination: 'etherscan-forwarded',
            status: 'unavailable',
            reasonCode: 'destination-unavailable'
          },
          { destination: 'blockscout-forwarded', status: 'verified' },
          { destination: 'routescan-forwarded', status: 'not-submitted' },
          { destination: 'etherscan-direct', status: 'not-submitted' }
        ],
        createdAt: Date.UTC(2026, 7, 20, 12, 0, 0),
        updatedAt: Date.UTC(2026, 7, 20, 12, 1, 0)
      }
    }
  }
  if (scenario.state.startsWith('send-') && method === 'send:resolveRecipient') {
    return { success: true, address: QUALIFICATION_RECIPIENT, name: '' }
  }
  if (scenario.state === 'send-max-review' && method === 'send:maxAmount') {
    return {
      success: true,
      amount: '1240000000000000000',
      quoteId: 'qualification-max-quote',
      expiresAt: Date.UTC(2030, 0, 1),
      reserve: {
        feeModel: 'eip1559',
        gasLimit: '21000',
        maxFeePerGas: '2000000000',
        maxPriorityFeePerGas: '1000000000',
        executionFee: '42000000000000',
        l1Fee: '900000000',
        total: '42000900000000'
      }
    }
  }
  if (scenario.state === 'send-sweep-review' && method === 'send:quoteSweep') {
    return {
      success: true,
      quote: {
        quoteId: 'qualification-sweep-quote',
        expiresAt: Date.UTC(2030, 0, 1),
        account: QUALIFICATION_ACCOUNT,
        chainId: 10,
        recipient: QUALIFICATION_RECIPIENT,
        assets: [{ address: '0x3333333333333333333333333333333333333333', balance: '100000000' }],
        native: { selected: false, balance: '0', value: '0' },
        maximumFee: '987654321',
        calls: [
          {
            to: '0x3333333333333333333333333333333333333333',
            data: '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222',
            value: '0x0'
          }
        ],
        execution: 'sequential-non-atomic'
      }
    }
  }
  if (scenario.state === 'send-confirmed' && method === 'send:queue') {
    return { success: true, handlerId: 'qualification-send-request' }
  }
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
