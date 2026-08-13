/* global require */

const {
  COMPACT_TARGET_EXCEPTIONS,
  INTERFACE_SCALES,
  physicalSize,
  scenarioMatrix
} = require('../../../../scripts/qualification/ui/policy.cjs')
const {
  QUALIFICATION_ACCOUNT,
  fixtureFor,
  invokeReplyFor,
  rpcReplyFor
} = require('../../../../scripts/qualification/ui/state-fixture.cjs')

it('covers shell, token management, delegation, revocation, and onboarding at every supported scale', () => {
  const scenarios = scenarioMatrix()

  expect(INTERFACE_SCALES).toEqual([1, 1.25, 1.5])
  expect(scenarios).toHaveLength(51)
  for (const scale of INTERFACE_SCALES) {
    expect(scenarios.filter((scenario) => scenario.scale === scale).map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        `tray-empty-full-${scale}`,
        `tray-empty-short-${scale}`,
        `dash-control-center-full-${scale}`,
        `dash-control-center-short-${scale}`,
        `tray-account-home-full-${scale}`,
        `tray-account-home-short-${scale}`,
        `dash-delegation-full-${scale}`,
        `dash-delegation-short-${scale}`,
        `dash-tokens-full-${scale}`,
        `dash-tokens-short-${scale}`,
        `tray-revocation-review-full-${scale}`,
        `tray-revocation-review-short-${scale}`,
        `tray-revocation-monitor-full-${scale}`,
        `tray-revocation-monitor-short-${scale}`,
        `onboard-intro-${scale}`,
        `onboard-access-${scale}`
      ])
    )
  }

  expect(scenarios.map((scenario) => scenario.id)).toEqual(
    expect.arrayContaining([
      'dash-control-center-capped-1.5',
      'dash-delegation-capped-1.5',
      'tray-revocation-review-capped-1.5'
    ])
  )
})

it('fixtures the separator-review surfaces at native scale and geometry', () => {
  const scenarios = scenarioMatrix({ includeReview: true })
  const lookalikeReviews = scenarios.filter(({ state }) => state === 'transaction-lookalike')
  const chooser = scenarios.find(({ state }) => state === 'account-chooser')
  const settings = scenarios.find(({ state }) => state === 'settings')
  const settingsLocalConnections = scenarios.find(({ id }) => id === 'dash-settings-local-connections-full-1')
  const settingsWalletNotifications = scenarios.find(
    ({ id }) => id === 'dash-settings-wallet-notifications-full-1'
  )
  const recovery = scenarios.find(({ id }) => id === 'dash-settings-recovery-full-1')
  const recoveryExport = scenarios.find(({ id }) => id === 'dash-settings-recovery-export-full-1')
  const recoveryRestore = scenarios.find(({ id }) => id === 'dash-settings-recovery-restore-full-1')
  const recoveryRestoreConfirm = scenarios.find(
    ({ id }) => id === 'dash-settings-recovery-restore-confirm-full-1'
  )
  const networks = scenarios.find(({ state }) => state === 'networks')
  const editor = scenarios.find(({ state }) => state === 'network-editor')
  const ledger = scenarios.find(({ state }) => state === 'account-ledger')
  const activity = scenarios.find(({ state }) => state === 'account-activity')
  const activityClear = scenarios.find(({ id }) => id === 'tray-account-activity-clear-full-1')
  const activityLifecycle = scenarios.find(({ id }) => id === 'tray-account-activity-lifecycle-full-1')
  const nativePairing = scenarios.find(({ id }) => id === 'tray-native-pairing-full-1')
  const ledgerBottom = scenarios.find(({ id }) => id === 'tray-account-ledger-bottom-full-1')
  const ledgerNoRequests = scenarios.find(({ id }) => id === 'tray-account-ledger-no-requests-full-1')
  const removalConfirm = scenarios.find(({ id }) => id === 'tray-account-removal-confirm-full-1')
  const drawer = scenarios.find(({ state }) => state === 'account-drawer')

  expect(
    [chooser, settings, networks, editor].map(({ logicalWidth, scale }) => [logicalWidth, scale])
  ).toEqual([
    [620, 1],
    [620, 1],
    [620, 1],
    [620, 1]
  ])
  expect(lookalikeReviews).toHaveLength(6)
  for (const scale of INTERFACE_SCALES) {
    expect(lookalikeReviews.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `tray-transaction-lookalike-full-${scale}`,
        `tray-transaction-lookalike-short-${scale}`
      ])
    )
  }
  expect([ledger.logicalWidth, ledger.scale]).toEqual([760, 1])
  for (const scenario of [recovery, recoveryExport, recoveryRestore, recoveryRestoreConfirm]) {
    expect(scenario).toMatchObject({
      logicalWidth: 620,
      scale: 1,
      captureScroll: 'target',
      captureScrollSelector: '#wren-settings-recovery'
    })
  }
  expect(recoveryExport.action).toEqual({ type: 'clickText', text: 'Export backup' })
  expect(recoveryRestore.action).toEqual({ type: 'clickText', text: 'Restore backup' })
  expect(recoveryRestoreConfirm.action.steps).toEqual(
    expect.arrayContaining([
      { type: 'inputLabel', label: 'Backup password', value: 'orchard-sparrow-26' },
      { type: 'clickText', text: 'Choose backup to inspect' }
    ])
  )
  expect(invokeReplyFor(recoveryRestoreConfirm, 'profile:inspectBackup')).toMatchObject({
    success: true,
    backup: { formatVersion: 1, signerCount: 3 },
    restoreToken: expect.stringMatching(/^[0-9a-f-]{36}$/u)
  })
  expect([activity.logicalWidth, activity.scale]).toEqual([760, 1])
  expect(activityClear).toMatchObject({
    action: { type: 'clickText', text: 'Clear activity' },
    ready: '[role="alertdialog"]'
  })
  expect(fixtureFor(activityLifecycle).main.activity.map(({ outcome }) => outcome)).toEqual([
    'submitted',
    'confirming',
    'reorged',
    'replaced',
    'stopped',
    'clearance-unverified',
    'verified-clearance'
  ])
  expect(settingsLocalConnections).toMatchObject({
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-local-connections'
  })
  expect(settingsWalletNotifications).toMatchObject({
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-wallet-notifications'
  })
  expect(fixtureFor(settingsLocalConnections).main).toMatchObject({
    transactionNotifications: true,
    nativePeerCredentials: {
      qualification: { fingerprint: expect.any(String), pairedAt: 1 }
    }
  })
  expect(nativePairing).toMatchObject({
    ready: '[role="dialog"][aria-labelledby="wren-notify-title"]',
    expectedInitialFocus: 'Not now'
  })
  expect(fixtureFor(nativePairing).view).toMatchObject({
    notify: 'nativeConnect',
    notifyData: { pairingCode: '482 731', requestId: 'qualification-native-pairing' }
  })
  expect(ledgerBottom).toMatchObject({
    captureScroll: 'bottom',
    captureScrollSelector: '.accountMainScroll'
  })
  expect(fixtureFor(ledgerNoRequests).panel.account.moduleOrder).not.toContain('requests')
  expect(removalConfirm).toMatchObject({
    action: { type: 'clickText', text: 'Remove account' },
    ready: '[role="alertdialog"]',
    captureScroll: 'bottom'
  })
  expect([drawer.logicalWidth, drawer.scale]).toEqual([760, 1])
  expect(fixtureFor(chooser).windows.dash.nav[0]).toEqual({
    view: 'accounts',
    data: { showAddAccounts: true }
  })
  expect(fixtureFor(settings).main.instanceId).toBeTruthy()
  expect(Object.values(fixtureFor(networks).main.networks.ethereum).some(({ isTestnet }) => isTestnet)).toBe(
    true
  )
  expect(fixtureFor(editor).main.networks.ethereum[1].connection.endpoints).toHaveLength(2)
  expect(Object.keys(fixtureFor(drawer).main.accounts)).toHaveLength(6)
  expect(fixtureFor(drawer).selected.showAccounts).toBe(true)
  const ledgerFixture = fixtureFor(ledger)
  expect(ledgerFixture.panel.account.moduleOrder).toEqual([
    'requests',
    'chains',
    'balances',
    'activity',
    'permissions',
    'signer',
    'settings'
  ])
  expect(ledgerFixture.panel.account.modules.balances.height).toBe(318)
  expect(ledgerFixture.panel.account.modules.activity.height).toBe(328)
  expect(ledgerFixture.main.activity).toHaveLength(4)
  expect(ledgerFixture.panel.account.modules.permissions.height).toBe(168)
  expect(fixtureFor(activity).windows.panel.nav[0]).toMatchObject({
    view: 'expandedModule',
    data: { id: 'activity', title: 'Activity' }
  })
})

it('fixtures the transaction handoff, request summary, and Trezor PIN review surfaces', () => {
  const scenarios = scenarioMatrix({ includeReview: true })
  const byId = (id) => scenarios.find((scenario) => scenario.id === id)

  const summary = byId('tray-account-requests-summary-full-1')
  const summaryRequests = fixtureFor(summary).main.accounts[QUALIFICATION_ACCOUNT].requests
  expect(Object.values(summaryRequests).map(({ status }) => status)).toEqual([
    'pending',
    'verifying',
    'confirming',
    'confirmed'
  ])

  const list = fixtureFor(byId('tray-account-requests-list-full-1'))
  expect(list.windows.panel.nav[0]).toMatchObject({
    view: 'expandedModule',
    data: { id: 'requests', title: 'Requests' }
  })
  expect(
    Object.values(list.main.accounts[QUALIFICATION_ACCOUNT].requests).map(({ queueIndex }) => queueIndex)
  ).toEqual([1, 2, 3])

  const safety = fixtureFor(byId('tray-transaction-safety-unavailable-short-1'))
  const safetyRequest = Object.values(safety.main.accounts[QUALIFICATION_ACCOUNT].requests)[0]
  expect(safetyRequest).toMatchObject({
    status: 'error',
    notice: 'Delegation recheck unavailable',
    recoverableError: { code: 'account-code-evidence-unavailable' }
  })

  const confirming = fixtureFor(byId('tray-transaction-confirming-full-1'))
  expect(Object.values(confirming.main.accounts[QUALIFICATION_ACCOUNT].requests)[0]).toMatchObject({
    status: 'confirming',
    tx: { confirmations: 4 }
  })

  const trezor = fixtureFor(byId('dash-trezor-pin-full-1'))
  expect(trezor.windows.dash.nav[0]).toEqual({
    view: 'expandedSigner',
    data: { signer: 'qualification-trezor-pin' }
  })
  expect(trezor.main.signers['qualification-trezor-pin']).toMatchObject({
    type: 'trezor',
    status: 'need pin'
  })
})

it('qualifies the decorative Control Center Wren and selected-chain explorer geometry', () => {
  const scenarios = scenarioMatrix()
  const controlCenters = scenarios.filter(
    ({ state, logicalWidth }) => state === 'control-center' && logicalWidth === 620
  )
  const capped = scenarios.find(({ id }) => id === 'dash-control-center-capped-1.5')
  const accountHomes = scenarios.filter(({ state }) => state === 'account-home')

  expect(controlCenters).toHaveLength(6)
  expect(controlCenters.every(({ layoutExpectations }) => layoutExpectations[0].kind === 'size')).toBe(true)
  expect(capped.layoutExpectations).toEqual([{ kind: 'hidden', selector: '.dashHomeWren' }])
  expect(accountHomes).toHaveLength(6)
  expect(accountHomes.every(({ requiredControls }) => requiredControls.length === 4)).toBe(true)

  const state = fixtureFor(accountHomes[0])
  expect(state.panel.account.moduleOrder).toEqual(['chains'])
  expect(state.main.networks.ethereum[1]).toMatchObject({
    name: 'Ethereum Mainnet',
    explorer: 'https://etherscan.io'
  })
})

it('keeps the custom-token action present in full and short dashboard geometry', () => {
  const scenarios = scenarioMatrix().filter(({ state }) => state === 'tokens')

  expect(scenarios).toHaveLength(6)
  for (const scenario of scenarios) {
    const state = fixtureFor(scenario)
    expect(state.windows.dash.nav).toEqual([{ view: 'tokens', data: {} }])
    expect(state.main.tokens).toEqual({ custom: [], known: {} })
    expect(scenario.requiredControls).toEqual(['Add New Token'])
  }
})

it('keeps physical bounds and renderer zoom aligned to a stable logical viewport', () => {
  expect(physicalSize({ logicalWidth: 760, logicalHeight: 900, scale: 1 })).toEqual({
    width: 760,
    height: 900
  })
  expect(physicalSize({ logicalWidth: 760, logicalHeight: 900, scale: 1.5 })).toEqual({
    width: 1140,
    height: 1350
  })
})

it('documents each compact target exception with a lower bound and reason', () => {
  expect(COMPACT_TARGET_EXCEPTIONS.length).toBeGreaterThan(0)
  for (const exception of COMPACT_TARGET_EXCEPTIONS) {
    expect(exception.selector).toMatch(/^\./u)
    expect(exception.minimum).toBeGreaterThanOrEqual(24)
    expect(exception.minimum).toBeLessThan(44)
    expect(exception.reason.length).toBeGreaterThan(20)
  }
})

it('injects requested and effective scale without live accounts, networks, or signers', () => {
  const scenario = scenarioMatrix().find(({ scale }) => scale === 1.25)
  const state = fixtureFor(scenario)

  expect(state.main.interfaceScale).toBe(1.25)
  expect(state.view.interfaceScaleEffective).toBe(1.25)
  expect(state.main.accounts).toEqual({})
  expect(state.main.networks.ethereum).toEqual({})
  expect(state.main.signers).toEqual({})
})

it('injects a selected software account and controlled revocation eligibility', () => {
  const scenario = scenarioMatrix().find(({ state, scale }) => state === 'delegation' && scale === 1.25)
  const state = fixtureFor(scenario)

  expect(state.windows.dash.nav).toEqual([{ view: 'accounts', data: {} }])
  expect(state.selected.current).toMatch(/^0x[0-9A-Fa-f]{40}$/u)
  expect(state.main.accounts[state.selected.current]).toMatchObject({
    lastSignerType: 'ring',
    status: 'ok'
  })
  expect(state.main.networks.ethereum[10].connection.endpoints[0].connected).toBe(true)
  expect(rpcReplyFor(scenario, 'getAccountExecutionState')).toMatchObject({
    status: 'delegated',
    account: state.selected.current,
    chainId: 10
  })
  expect(rpcReplyFor(scenario, 'getEip7702RevocationEligibility')).toMatchObject({
    status: 'eligible',
    account: state.selected.current,
    chainId: 10
  })
  expect(rpcReplyFor(scenario, 'requestEip7702Revocation')).toBeUndefined()
})

it.each(['revocation-review', 'revocation-monitor'])(
  'injects a long-evidence %s request without signing material',
  (requestState) => {
    const scenario = scenarioMatrix().find(({ state, scale }) => state === requestState && scale === 1)
    const state = fixtureFor(scenario)
    const { accountId, requestId } = state.windows.panel.nav[0].data
    const request = state.main.accounts[accountId].requests[requestId]

    expect(request).toMatchObject({
      type: 'eip7702Revoke',
      version: '1',
      chainId: '0xa',
      payload: {
        id: 1,
        jsonrpc: '2.0',
        method: 'wren_revokeEip7702Delegation',
        params: [accountId, '0xa']
      },
      evidence: {
        source: 'eth_getCode',
        authority: accountId.toLowerCase(),
        delegate: expect.stringMatching(/^0x[0-9A-Fa-f]{40}$/u),
        codeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
        latestNonce: '0x123456789abcdef',
        pendingNonce: '0x123456789abcdef'
      },
      fees: {
        gasLimit: expect.stringMatching(/^0x/u),
        maxFeePerGas: expect.stringMatching(/^0x/u),
        maxPriorityFeePerGas: expect.stringMatching(/^0x/u),
        maxFee: '0x344bc31318000'
      },
      feesUpdatedByUser: false,
      operationVersion: 0
    })
    expect(request).not.toHaveProperty('raw')
    expect(request).not.toHaveProperty('authorization')
    expect(request).not.toHaveProperty('signature')
    expect(requestState === 'revocation-monitor' ? request.submission?.status : undefined).toBe(
      requestState === 'revocation-monitor' ? 'unconfirmed' : undefined
    )
  }
)

it('requires review actions and the safe initial focus for ambiguous monitoring', () => {
  const review = scenarioMatrix().find(({ state, scale }) => state === 'revocation-review' && scale === 1)
  const monitor = scenarioMatrix().find(({ state, scale }) => state === 'revocation-monitor' && scale === 1)

  expect(review.requiredControls).toEqual(['Cancel', 'Revoke delegation', 'Adjust'])
  expect(review.requiredText).toEqual(
    expect.arrayContaining(['Current delegation evidence', 'Maximum execution fee', 'Transaction nonce'])
  )
  expect(monitor).toMatchObject({
    action: { type: 'clickText', text: 'Stop monitoring' },
    expectedInitialFocus: 'Keep monitoring',
    requiredControls: ['Keep monitoring', 'Stop monitoring and continue requests']
  })
})

it('forces the dashboard and tray capped-width fallback layouts at 150%', () => {
  const scenarios = scenarioMatrix()
  const dashboard = scenarios.find(({ id }) => id === 'dash-delegation-capped-1.5')
  const tray = scenarios.find(({ id }) => id === 'tray-revocation-review-capped-1.5')

  expect(dashboard).toMatchObject({
    scale: 1.5,
    logicalWidth: 530,
    logicalHeight: 744,
    layoutExpectations: expect.arrayContaining([
      { kind: 'stacked', selector: '.delegationRevocationSelectors > label' },
      {
        kind: 'full-width',
        selector: '.delegationRevocationEligible > button',
        container: '.delegationRevocationEligible'
      }
    ])
  })
  expect(tray).toMatchObject({
    scale: 1.5,
    logicalWidth: 600,
    logicalHeight: 744,
    layoutExpectations: [
      {
        kind: 'full-width',
        selector: '.eip7702RevokeFeeRow > button',
        container: '.eip7702RevokeFeeRow'
      }
    ]
  })
})
