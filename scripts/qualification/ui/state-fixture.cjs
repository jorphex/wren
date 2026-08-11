'use strict'

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

const fixtureFor = (scenario) => {
  const state = baseState()
  state.main.interfaceScale = scenario.scale
  state.view.interfaceScaleEffective = scenario.scale
  return state
}

module.exports = { baseState, fixtureFor }
