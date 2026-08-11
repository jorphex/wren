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

const qualificationAccount = (request) => ({
  id: QUALIFICATION_ACCOUNT,
  address: QUALIFICATION_ACCOUNT,
  name: 'Workshop Software Account With A Long Name',
  lastSignerType: 'ring',
  status: 'ok',
  createdAt: 1,
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
