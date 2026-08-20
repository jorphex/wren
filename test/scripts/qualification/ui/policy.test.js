/* global process, require */

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
  expect(scenarios).toHaveLength(72)
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
        `onboard-access-${scale}`,
        `onboard-networks-${scale}`,
        `onboard-context-${scale}`,
        `onboard-accounts-${scale}`,
        `onboard-companion-${scale}`,
        `onboard-dapp-network-${scale}`,
        `onboard-ready-${scale}`
      ])
    )
  }

  expect(scenarios.map((scenario) => scenario.id)).toEqual(
    expect.arrayContaining([
      'dash-control-center-capped-1.5',
      'dash-delegation-capped-1.5',
      'tray-revocation-review-capped-1.5',
      'tray-account-access-review-full-1',
      'tray-account-access-review-short-1'
    ])
  )
})

it('qualifies compact account-access actions at the real tray width', () => {
  const scenarios = scenarioMatrix().filter(({ state }) => state === 'account-access-review')

  expect(scenarios).toHaveLength(2)
  for (const scenario of scenarios) {
    expect(scenario.logicalWidth).toBe(620)
    expect(scenario.requiredControls).toEqual(['Decline', 'Allow access'])
    expect(fixtureFor(scenario).main.accounts[QUALIFICATION_ACCOUNT].requests).toHaveProperty(
      'qualification-account-access'
    )
  }
})

it('seats every RPC warning shelf at the viewport bottom with its exact reserved height', () => {
  const warnings = scenarioMatrix({ includeReview: true }).filter(
    ({ state, action }) => state === 'transaction-rpc-warning' && !action
  )

  expect(warnings).toHaveLength(16)
  for (const warning of warnings) {
    expect(warning.layoutExpectations).toContainEqual({
      kind: 'viewport-bottom',
      selector: '.requestNoticeApproval'
    })
    expect(fixtureFor(warning).windows.panel.footer.height).toBe(200)
  }
})

it('visually qualifies the primary RPC warning hover state', () => {
  const warning = scenarioMatrix({ includeReview: true }).find(
    ({ id }) => id === 'tray-rpc-warning-revert-hover-full-1'
  )
  expect(warning).toMatchObject({
    state: 'transaction-rpc-warning',
    variant: 'revert',
    action: { type: 'hoverText', text: 'Sign Anyway' }
  })
})

it('qualifies the warning-to-sign transition without empty-frame animations', () => {
  const warning = scenarioMatrix({ includeReview: true }).find(
    ({ id }) => id === 'tray-rpc-warning-revert-confirmed-full-1'
  )
  expect(warning).toMatchObject({
    ready: '.requestApproveTransaction',
    action: {
      type: 'confirmRequestWarning',
      text: 'Sign Anyway',
      requestId: 'qualification-rpc-warning-revert'
    },
    requiredText: expect.arrayContaining(['Decline', 'Sign transaction'])
  })
  expect(warning.layoutExpectations).toEqual(
    expect.arrayContaining([
      {
        kind: 'computed-style',
        selector: '.footerModule',
        property: 'transitionDuration',
        value: '0s'
      },
      {
        kind: 'computed-style',
        selector: '.requestApproveTransaction',
        property: 'animationName',
        value: 'none'
      }
    ])
  )
})

it('fixtures the separator-review surfaces at native scale and geometry', () => {
  const scenarios = scenarioMatrix({ includeReview: true })
  const lookalikeReviews = scenarios.filter(({ state }) => state === 'transaction-lookalike')
  const addressQrReviews = scenarios.filter(({ id }) => id.startsWith('tray-account-address-qr-'))
  const chooser = scenarios.find(({ state }) => state === 'account-chooser')
  const accountSetupStates = ['account-add-watch', 'account-add-seed', 'account-add-trezor']
  const accountSetups = accountSetupStates.map((state) =>
    scenarios.find((scenario) => scenario.state === state)
  )
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
  const overflowingNetworkEditor = scenarios.find(({ id }) => id === 'dash-network-add-overflow-short-1')
  const ledger = scenarios.find(({ state }) => state === 'account-ledger')
  const startup = scenarios.find(({ state }) => state === 'account-startup')
  const balances = scenarios.find(({ state }) => state === 'account-balances')
  const switchedGas = scenarios.find(({ id }) => id === 'tray-account-gas-expanded-switched-full-1')
  const chainFallback = scenarios.find(({ id }) => id === 'tray-account-chain-fallback-narrow-1')
  const inspectors = scenarios.filter(({ state }) => state === 'inspector')
  const inspectorForms = inspectors.filter(({ id }) => id.startsWith('dash-inspector-form-'))
  const inspectorResults = inspectors.filter(({ id }) => !id.startsWith('dash-inspector-form-'))
  const earnYvusd = scenarios.filter(({ state }) => state === 'earn-yvusd')
  const earnLoading = scenarios.find(({ state }) => state === 'earn-loading')
  expect(earnYvusd).toHaveLength(4)
  expect(earnYvusd.map(({ variant }) => variant)).toEqual(['unlocked', 'unlocked', 'locked', 'locked'])
  expect(invokeReplyFor(earnYvusd[0], 'yearn:getCatalog')).toMatchObject({
    status: 'fresh',
    vaults: [{ id: 'ethereum-yvusd', kind: 'yvUSD' }]
  })
  expect(invokeReplyFor(earnYvusd[0], 'yearn:getPositions')).toMatchObject({
    account: { address: QUALIFICATION_ACCOUNT, readOnly: false },
    chains: expect.arrayContaining([expect.objectContaining({ chainId: 1, status: 'ready' })])
  })
  expect(invokeReplyFor(earnYvusd[0], 'yearn:getWorkflows')).toEqual({ workflows: [] })
  expect(earnLoading).toMatchObject({
    ready: '.earnPositionsLoading',
    deferInvokes: ['yearn:getCatalog', 'yearn:getPositions', 'yearn:getWorkflows']
  })
  expect(invokeReplyFor(earnLoading, 'yearn:getCatalog', [{ force: false, cacheOnly: true }])).toMatchObject({
    status: 'unavailable',
    fetchedAt: null
  })
  expect(inspectors).toHaveLength(9)
  expect(inspectorForms.map(({ id }) => id)).toEqual([
    'dash-inspector-form-full-1',
    'dash-inspector-form-short-1'
  ])
  expect(
    inspectorForms.every(({ layoutExpectations }) =>
      layoutExpectations.some(
        ({ kind, selector }) => kind === 'scroll-fits' && selector === '.dashMainScroll'
      )
    )
  ).toBe(true)
  expect(inspectorResults.every(({ ready }) => ready === '.inspectorResult')).toBe(true)
  expect(inspectors.every(({ requiredText }) => requiredText.includes('Never signs or broadcasts'))).toBe(
    true
  )
  expect(invokeReplyFor(inspectorResults[0], 'inspector:inspect')).toMatchObject({
    success: true,
    inspection: {
      kind: 'transaction',
      evidence: expect.arrayContaining([
        { kind: 'calldata', status: 'available', source: 'local' },
        { kind: 'simulation', status: 'available', source: 'configured-rpc' }
      ])
    }
  })
  expect(addressQrReviews).toHaveLength(6)
  expect(addressQrReviews.every(({ ready }) => ready === '.accountAddressQrPopover')).toBe(true)
  expect(addressQrReviews.every(({ requiredControls }) => requiredControls.join(',') === 'Close')).toBe(true)
  expect(
    addressQrReviews.every(({ layoutExpectations }) =>
      layoutExpectations.some(
        ({ kind, selector, width, height }) =>
          kind === 'size' && selector === '.accountAddressQrCode' && width === 185 && height === 185
      )
    )
  ).toBe(true)
  const activity = scenarios.find(({ state }) => state === 'account-activity')
  const activityClear = scenarios.find(({ id }) => id === 'tray-account-activity-clear-full-1')
  const activityLifecycle = scenarios.find(({ id }) => id === 'tray-account-activity-lifecycle-full-1')
  const nativePairing = scenarios.find(({ id }) => id === 'tray-native-pairing-full-1')
  const ledgerBottom = scenarios.find(({ id }) => id === 'tray-account-ledger-bottom-full-1')
  const ledgerNoRequests = scenarios.find(({ id }) => id === 'tray-account-ledger-no-requests-full-1')
  const removalConfirm = scenarios.find(({ id }) => id === 'tray-account-removal-confirm-full-1')
  const drawers = scenarios.filter(({ state }) => state === 'account-drawer')
  const drawer = drawers.find(({ id }) => id === 'tray-account-drawer-full-right-1')
  const leftDashCanvases = scenarios.filter(
    ({ id }) => id.startsWith('dash-control-center-') && id.includes('-left-')
  )
  const leftWalletCanvases = scenarios.filter(
    ({ id }) => id.startsWith('tray-account-home-') && id.includes('-left-')
  )
  const rightWalletCanvases = scenarios.filter(
    ({ id }) => id.startsWith('tray-account-home-') && id.includes('-right-')
  )

  expect(
    [chooser, settings, networks, editor].map(({ logicalWidth, scale }) => [logicalWidth, scale])
  ).toEqual([
    [620, 1],
    [620, 1],
    [620, 1],
    [620, 1]
  ])
  expect(accountSetups.map(({ logicalWidth, scale }) => [logicalWidth, scale])).toEqual([
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
  expect([ledger.logicalWidth, ledger.scale]).toEqual([620, 1])
  expect([startup.logicalWidth, startup.scale]).toEqual([620, 1])
  expect([balances.logicalWidth, balances.scale]).toEqual([620, 1])
  expect(balances).toMatchObject({ glideSide: 'left', workspaceOpen: true })
  expect(switchedGas.action).toEqual({
    type: 'sequence',
    steps: [
      { type: 'clickText', text: 'Show gas details for Ethereum' },
      { type: 'clickText', text: 'Next network from Ethereum' }
    ]
  })
  expect([chainFallback.logicalWidth, chainFallback.scale]).toEqual([520, 1])
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
  expect([activity.logicalWidth, activity.scale]).toEqual([620, 1])
  expect(activity).toMatchObject({ glideSide: 'left', workspaceOpen: true })
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
  process.env.WREN_UI_QUALIFICATION_PAIRING_CODE = '193704'
  try {
    expect(fixtureFor(nativePairing).view.notifyData.pairingCode).toBe('193 704')
  } finally {
    delete process.env.WREN_UI_QUALIFICATION_PAIRING_CODE
  }
  process.env.WREN_UI_QUALIFICATION_PAIRING_CODE = 'invalid'
  try {
    expect(() => fixtureFor(nativePairing)).toThrow(
      'WREN_UI_QUALIFICATION_PAIRING_CODE must contain exactly six digits'
    )
  } finally {
    delete process.env.WREN_UI_QUALIFICATION_PAIRING_CODE
  }
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
  expect([drawer.logicalWidth, drawer.scale]).toEqual([620, 1])
  expect(drawers).toHaveLength(12)
  expect(leftDashCanvases).toHaveLength(6)
  expect(leftWalletCanvases).toHaveLength(6)
  expect(rightWalletCanvases).toHaveLength(6)
  expect(leftWalletCanvases.every(({ ready }) => ready.startsWith('body.workspace-open '))).toBe(true)
  expect(rightWalletCanvases.every(({ ready }) => ready.startsWith('body.workspace-open '))).toBe(true)
  expect(fixtureFor(drawer).main.glideSide).toBe('right')
  expect(fixtureFor(leftDashCanvases[0]).main.glideSide).toBe('left')
  expect(fixtureFor(leftWalletCanvases[0]).windows.dash.showing).toBe(true)
  expect(fixtureFor(rightWalletCanvases[0]).windows.dash.showing).toBe(true)
  expect(fixtureFor(chooser).windows.dash.nav[0]).toEqual({
    view: 'accounts',
    data: { showAddAccounts: true }
  })
  expect(fixtureFor(settings).main.instanceId).toBeTruthy()
  expect(Object.values(fixtureFor(networks).main.networks.ethereum).some(({ isTestnet }) => isTestnet)).toBe(
    true
  )
  expect(fixtureFor(editor).main.networks.ethereum[1].connection.endpoints).toHaveLength(2)
  expect(overflowingNetworkEditor).toMatchObject({
    captureScroll: 'bottom',
    captureScrollSelector: '.localSettingsWrap',
    layoutExpectations: [{ kind: 'scroll-overflows', selector: '.localSettingsWrap' }]
  })
  expect(overflowingNetworkEditor.action.steps).toHaveLength(4)
  expect(Object.keys(fixtureFor(drawer).main.accounts)).toHaveLength(6)
  expect(Object.keys(fixtureFor(startup).main.accounts)).toHaveLength(3)
  expect(fixtureFor(startup).selected.open).toBe(false)
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
  expect(ledgerFixture.panel.account.modules.balances.height).toBe(396)
  expect(ledgerFixture.main.balances[QUALIFICATION_ACCOUNT]).toHaveLength(4)
  expect(ledgerFixture.panel.account.modules.activity.height).toBe(332)
  expect(ledgerFixture.main.activity).toHaveLength(4)
  expect(ledgerFixture.panel.account.modules.permissions.height).toBe(92)
  expect(fixtureFor(activity).windows.panel.nav[0]).toMatchObject({
    view: 'expandedModule',
    data: { id: 'activity', title: 'Activity' }
  })
  expect(fixtureFor(balances).windows.panel.nav[0]).toMatchObject({
    view: 'expandedModule',
    data: { id: 'balances', title: 'Balances' }
  })
})

it('qualifies recipient and contact surfaces at every scale and shell height', () => {
  const scenarios = scenarioMatrix({ includeReview: true })
  const contactLists = scenarios.filter(
    ({ state, variant }) => state === 'address-book-list' && variant !== 'remove'
  )
  const contactEditors = scenarios.filter(({ state }) => state === 'address-book-editor')
  const recipientPickers = scenarios.filter(({ state }) => state === 'send-recipient-picker')
  const recentRecipientSettings = scenarios.filter(
    ({ state, variant }) => state === 'settings-recent-recipients' && variant !== 'clear'
  )
  const sendConfirmations = scenarios.filter(({ state }) => state === 'send-confirmed')
  const maxReviews = scenarios.filter(({ state }) => state === 'send-max-review')
  const sweepReviews = scenarios.filter(({ state }) => state === 'send-sweep-review')

  expect(contactLists).toHaveLength(6)
  expect(contactEditors).toHaveLength(6)
  expect(recipientPickers).toHaveLength(6)
  expect(recentRecipientSettings).toHaveLength(6)
  expect(sendConfirmations).toHaveLength(6)
  expect(maxReviews).toHaveLength(6)
  expect(sweepReviews).toHaveLength(6)
  expect(
    contactLists.every(({ layoutExpectations }) =>
      layoutExpectations.some(
        ({ kind, selector }) => kind === 'scroll-fits' && selector === '.dashMainScroll'
      )
    )
  ).toBe(true)
  expect(scenarios.find(({ id }) => id === 'dash-address-book-remove-short-1.5')).toMatchObject({
    action: { type: 'clickText', text: 'Remove Operations multisig with a deliberately long label' },
    scale: 1.5,
    logicalHeight: 744
  })
  expect(scenarios.find(({ id }) => id === 'dash-settings-recent-clear-short-1.5')).toMatchObject({
    expectedInitialFocus: 'Cancel',
    scale: 1.5,
    logicalHeight: 744
  })
  for (const scenario of [
    ...contactLists,
    ...contactEditors,
    ...recipientPickers,
    ...recentRecipientSettings,
    ...sendConfirmations,
    ...maxReviews,
    ...sweepReviews
  ]) {
    expect(INTERFACE_SCALES).toContain(scenario.scale)
    expect([744, 900]).toContain(scenario.logicalHeight)
  }

  const listState = fixtureFor(contactLists[0])
  const verified = Object.values(listState.main.addressBook).find(
    ({ provenance }) => provenance.status === 'verified-out-of-band'
  )
  expect(verified.provenance.verifiedAt).toBeLessThanOrEqual(verified.updatedAt)
  expect(verified.address).toBe('0x3333333333333333333333333333333333333333')

  const recipientPickerState = fixtureFor(recipientPickers[0])
  expect(recipientPickerState.main.rememberRecentRecipients).toBe(true)
  expect(recipientPickerState.main.recentRecipientUses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ address: '0x5555555555555555555555555555555555555555' })
    ])
  )
  expect(recipientPickers[0].expectedInitialFocus).toBe('Search recipients')

  expect(invokeReplyFor(recentRecipientSettings[0], 'signers:protectionStatus')).toMatchObject({
    success: true,
    status: { available: true, enabled: false }
  })

  const sendScenario = sendConfirmations[0]
  expect(invokeReplyFor(sendScenario, 'send:resolveRecipient')).toEqual({
    success: true,
    address: '0x2222222222222222222222222222222222222222',
    name: ''
  })
  expect(invokeReplyFor(sendScenario, 'send:queue')).toEqual({
    success: true,
    handlerId: 'qualification-send-request'
  })
  expect(sendScenario.action.steps.at(-1)).toMatchObject({
    type: 'setRequestStatus',
    status: 'confirmed'
  })
  expect(invokeReplyFor(maxReviews[0], 'send:maxAmount')).toMatchObject({
    success: true,
    quoteId: 'qualification-max-quote',
    reserve: { l1Fee: '900000000', total: '42000900000000' }
  })
  expect(invokeReplyFor(sweepReviews[0], 'send:quoteSweep')).toMatchObject({
    success: true,
    quote: {
      execution: 'sequential-non-atomic',
      calls: [{ to: '0x3333333333333333333333333333333333333333' }]
    }
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

  const listScenario = byId('tray-account-requests-list-full-1')
  expect(listScenario).toMatchObject({ glideSide: 'left', workspaceOpen: true })
  const list = fixtureFor(listScenario)
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
  expect(trezor.windows.dash.hardwarePrompt).toEqual({
    signerId: 'qualification-trezor-pin',
    dismissible: true,
    restoreHidden: false
  })
  expect(trezor.main.signers['qualification-trezor-pin']).toMatchObject({
    name: 'Trezor Signer',
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
    name: 'Ethereum',
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

it('qualifies account-scoped guardrails across shell geometry, scale, provenance, busy, and error states', () => {
  const scenarios = scenarioMatrix({ includeReview: true })
  const editors = scenarios.filter(({ id }) => id.startsWith('tray-account-guardrail-editor-'))
  const native = scenarios.find(({ id }) => id === 'tray-account-guardrail-native-source-full-1')
  const busy = scenarios.find(({ id }) => id === 'tray-account-guardrail-save-busy-full-1')
  const error = scenarios.find(({ id }) => id === 'tray-account-guardrail-save-error-full-1')

  expect(editors).toHaveLength(6)
  for (const scale of INTERFACE_SCALES) {
    expect(editors.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `tray-account-guardrail-editor-full-${scale}`,
        `tray-account-guardrail-editor-short-${scale}`
      ])
    )
  }
  expect(
    editors.every(
      ({ expectedInitialFocus }) => expectedInitialFocus === 'When a request exceeds a restriction'
    )
  ).toBe(true)
  expect(native.requiredText).toEqual(
    expect.arrayContaining(['22222222-2222-4222-8222-222222222222', 'Native app · bound to the source below'])
  )
  expect(busy.ready).toBe('.dappGuardrailConfirm[aria-busy="true"]')
  expect(error.ready).toBe('.dappGuardrailMessage-alert')

  const state = fixtureFor(editors[0])
  const account = QUALIFICATION_ACCOUNT.toLowerCase()
  const originId = '11111111-1111-4111-8111-111111111111'
  expect(state.windows.panel.nav[0]).toEqual({
    view: 'expandedModule',
    data: { id: 'permissions', account: QUALIFICATION_ACCOUNT, title: 'Connected apps' }
  })
  expect(state.main.permissions[QUALIFICATION_ACCOUNT][originId]).toMatchObject({
    handlerId: originId,
    caveats: [{ value: { account: QUALIFICATION_ACCOUNT, chains: ['0x1'] } }]
  })
  expect(state.main.dappGuardrails[account][originId]['0x1']).toMatchObject({
    account,
    originId,
    chainId: '0x1',
    mode: 'block',
    targets: ['0x4444444444444444444444444444444444444444'],
    spenders: []
  })
})

it('qualifies source verification entry, evidence, results, credentials, and confirmed handoff', () => {
  const scenarios = scenarioMatrix({ includeReview: true })
  const forms = scenarios.filter(({ id }) => id.startsWith('dash-contract-verification-form-'))
  const evidence = scenarios.filter(({ id }) => id.startsWith('dash-contract-verification-evidence-'))
  const confirmations = scenarios.filter(({ id }) => id.startsWith('tray-transaction-deployment-confirmed-'))
  const results = scenarios.filter(({ id }) => id.startsWith('dash-contract-verification-result-'))
  const credential = scenarios.find(({ id }) => id === 'dash-settings-contract-verification-short-1.5')
  const capped = scenarios.find(({ id }) => id === 'dash-contract-verification-evidence-capped-1.5')

  expect(forms).toHaveLength(6)
  expect(evidence).toHaveLength(7)
  expect(confirmations).toHaveLength(6)
  expect(results).toHaveLength(2)
  expect(credential.captureScrollSelector).toBe('#wren-settings-contract-verification')
  expect(capped.layoutExpectations).toEqual(
    expect.arrayContaining([
      { kind: 'stacked', selector: '.contractVerificationLedgerRow' },
      {
        kind: 'full-width',
        selector: '.contractVerificationActionShelf button',
        container: '.contractVerificationActionShelf',
        inset: 0
      }
    ])
  )

  const state = fixtureFor(forms[0])
  expect(state.windows.dash.nav).toEqual([{ view: 'contracts', data: { mode: 'verify' } }])
  const artifact = invokeReplyFor(forms[0], 'contractVerification:inspectArtifact')
  expect(artifact).toMatchObject({ success: true, artifact: { summary: { localRuntimeMatch: true } } })
  expect(JSON.stringify(artifact)).not.toMatch(/filePath|stdJsonInput|sourceContent|apiKey/u)
  expect(confirmations[0].requiredControls).toEqual(['View details', 'Verify source', 'Close'])
  expect(confirmations[0].layoutExpectations).toContainEqual({
    kind: 'viewport-bottom',
    selector: '.requestNoticeTransactionDeploymentStatus'
  })
  expect(fixtureFor(confirmations[0]).windows.panel.footer.height).toBe(250)
})

it('qualifies connected-app destination margins at full and short heights', () => {
  const matrix = scenarioMatrix({ includeReview: true })
  const scenarios = matrix.filter(({ id }) => id.startsWith('dash-connected-apps-'))
  const details = matrix.filter(({ id }) => id.startsWith('dash-connected-app-details-'))

  expect(scenarios.map(({ id }) => id)).toEqual([
    'dash-connected-apps-full-1',
    'dash-connected-apps-short-1',
    'dash-connected-apps-capped-1'
  ])
  expect(scenarios.every(({ ready }) => ready === '.connectedApps .sliceOrigin')).toBe(true)
  expect(
    scenarios
      .filter(({ id }) => id !== 'dash-connected-apps-capped-1')
      .every(({ layoutExpectations }) =>
        layoutExpectations.some(
          ({ kind, selector }) => kind === 'scroll-fits' && selector === '.dashMainScroll'
        )
      )
  ).toBe(true)
  expect(fixtureFor(scenarios[0]).windows.dash.nav).toEqual([{ view: 'dapps', data: {} }])
  expect(details.map(({ id }) => id)).toEqual([
    'dash-connected-app-details-full-1',
    'dash-connected-app-details-short-1'
  ])
  expect(fixtureFor(details[0]).windows.dash.nav).toEqual([
    { view: 'dapps', data: { dappDetails: 'workshop' } }
  ])
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
