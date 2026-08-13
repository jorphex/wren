'use strict'

const INTERFACE_SCALES = Object.freeze([1, 1.25, 1.5])
const FULL_SHELL_HEIGHT = 900
const SHORT_SHELL_HEIGHT = 744

const COMPACT_TARGET_EXCEPTIONS = Object.freeze([
  {
    selector: '.wrenControlChrome',
    minimum: 24,
    reason: 'Native window chrome is a compact desktop-only control.'
  },
  {
    selector: '.wrenControlCompact',
    minimum: 32,
    reason: 'Explicit compact controls are secondary actions inside dense ledgers.'
  },
  {
    selector: '.wrenControlIcon',
    minimum: 38,
    reason: 'Icon-only shell utilities use the established compact optical target.'
  },
  {
    selector: '.wrenShellNav',
    minimum: 38,
    reason: 'Paired shell navigation controls use the established compact optical target.'
  },
  {
    selector: '.accountSwitcherTrigger',
    minimum: 40,
    reason: 'The persistent desktop account switcher uses the established compact shell-row target.'
  },
  {
    selector: '.requestFeatureButton',
    minimum: 38,
    reason: 'Control-center support links are a compact tertiary utility row.'
  }
])

const transactionLookalikeScenario = (geometry, scale, logicalHeight) => ({
  id: `tray-transaction-lookalike-${geometry}-${scale}`,
  renderer: 'tray',
  state: 'transaction-lookalike',
  scale,
  logicalWidth: 760,
  logicalHeight,
  ready: '.requestApproveTransaction .requestSign:not(:disabled)',
  requiredControls: ['Copy transaction recipient address', 'Decline', 'Sign transaction'],
  requiredText: [
    'Possible address poisoning.',
    'Verify the full address. Its first and last four characters match a destination you used before.'
  ]
})

const reviewScenarios = () => [
  ...INTERFACE_SCALES.flatMap((scale) => [
    transactionLookalikeScenario('full', scale, FULL_SHELL_HEIGHT),
    transactionLookalikeScenario('short', scale, SHORT_SHELL_HEIGHT)
  ]),
  {
    id: 'dash-account-chooser-full-1',
    renderer: 'dash',
    state: 'account-chooser',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.addAccountsChooser',
    requiredText: ['Watch-only']
  },
  {
    id: 'dash-accounts-icons-full-1',
    renderer: 'dash',
    state: 'accounts-icons',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.watchAccountIcon',
    requiredText: ['Watch account', 'Ledger', 'Trezor', 'GridPlus', 'Seed Phrase', 'Imported Keys']
  },
  {
    id: 'dash-trezor-pin-full-1',
    renderer: 'dash',
    state: 'trezor-pin',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.trezorPinInput',
    requiredControls: ['PIN position 1', 'PIN position 9'],
    requiredText: ['Enter PIN', 'scrambled matrix', '0 positions selected']
  },
  {
    id: 'dash-settings-full-1',
    renderer: 'dash',
    state: 'settings',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.wrenSettings',
    requiredText: ['Desktop behavior', 'Accounts and signing']
  },
  {
    id: 'dash-settings-local-connections-full-1',
    renderer: 'dash',
    state: 'settings-local-connections',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '#wren-settings-local-connections',
    requiredControls: ['Copy full connection ID', 'Revoke'],
    requiredText: [
      'Wallet activity notifications',
      'Show private updates while Wren is hidden.',
      'Local connections',
      'Authenticated software on this computer.'
    ],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-local-connections'
  },
  {
    id: 'dash-settings-wallet-notifications-full-1',
    renderer: 'dash',
    state: 'settings-local-connections',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '#wren-settings-wallet-notifications',
    requiredControls: ['Wallet activity notifications'],
    requiredText: [
      'Wallet activity notifications',
      'Show private updates while Wren is hidden.',
      'They never include app, account, network, amounts, addresses, call data, transaction hashes, or delegation details.'
    ],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-wallet-notifications'
  },
  {
    id: 'dash-settings-recovery-full-1',
    renderer: 'dash',
    state: 'settings',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.recoverySettings',
    requiredControls: ['Export backup', 'Restore backup'],
    requiredText: ['Recovery', 'Live balances, rates, and pending requests are left out'],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-recovery'
  },
  {
    id: 'dash-settings-recovery-export-full-1',
    renderer: 'dash',
    state: 'settings',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Export backup' },
    ready: '[role="dialog"][aria-label="Export encrypted backup"]',
    requiredControls: ['Cancel', 'Choose save location'],
    requiredText: ['Wren cannot recover it if you forget it', 'Backup password', 'Confirm password'],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-recovery'
  },
  {
    id: 'dash-settings-recovery-restore-full-1',
    renderer: 'dash',
    state: 'settings',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Restore backup' },
    ready: '[role="dialog"][aria-label="Inspect encrypted backup"]',
    requiredControls: ['Cancel', 'Choose backup to inspect'],
    requiredText: ['Nothing is replaced yet', 'Backup password'],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-recovery'
  },
  {
    id: 'dash-settings-recovery-restore-confirm-full-1',
    renderer: 'dash',
    state: 'settings',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      steps: [
        { type: 'clickText', text: 'Restore backup' },
        { type: 'inputLabel', label: 'Backup password', value: 'orchard-sparrow-26' },
        { type: 'clickText', text: 'Choose backup to inspect' }
      ]
    },
    ready: '[role="alertdialog"][aria-labelledby="recovery-replace-title"]',
    expectedInitialFocus: 'Cancel',
    requiredControls: ['Cancel', 'Replace this Wren profile'],
    requiredText: ['Version 1', 'Signer records', 'atomically replaces the current profile'],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-recovery'
  },
  {
    id: 'dash-networks-full-1',
    renderer: 'dash',
    state: 'networks',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.networkBreak',
    requiredText: ['Ethereum Mainnet', 'Optimism Mainnet', 'Workshop Chain', 'Sepolia', 'Testnets']
  },
  {
    id: 'dash-network-editor-full-1',
    renderer: 'dash',
    state: 'network-editor',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.networkEditor',
    requiredText: ['Edit Ethereum Mainnet', 'RPC endpoints', 'Add RPC', 'Save changes']
  },
  {
    id: 'tray-account-ledger-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.settingsPreviewActions',
    requiredText: ['Ethereum Mainnet', 'Balances', 'Activity', 'Connected apps', 'Signer', 'Remove account']
  },
  {
    id: 'tray-account-requests-summary-full-1',
    renderer: 'tray',
    state: 'account-requests-summary',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestPreviewContentMeta',
    requiredControls: ['Requests. 3 requests · 1 pending · 2 confirming'],
    requiredText: ['Requests', '3 requests · 1 pending · 2 confirming']
  },
  {
    id: 'tray-account-requests-list-full-1',
    renderer: 'tray',
    state: 'account-requests-list',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestClearAll',
    requiredControls: ['Clear all requests'],
    requiredText: ['Requests (3)', 'No requests waiting', 'workshop.example', 'garden.example']
  },
  {
    id: 'tray-transaction-safety-unavailable-short-1',
    renderer: 'tray',
    state: 'transaction-safety-unavailable',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.requestApproveRecoverable',
    requiredControls: ['Close request', 'Recheck'],
    requiredText: [
      'Safety check unavailable',
      'The safety check could not be repeated. Nothing was signed or sent.'
    ]
  },
  {
    id: 'tray-transaction-confirming-full-1',
    renderer: 'tray',
    state: 'transaction-confirming',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.txLifecycle',
    requiredControls: ['View details'],
    requiredText: ['Confirming', 'Transaction hash', 'Confirmations', '4']
  },
  {
    id: 'tray-transaction-confirmed-full-1',
    renderer: 'tray',
    state: 'transaction-confirmed',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.txLifecycle-success',
    requiredControls: ['View details', 'Close'],
    requiredText: ['Confirmed', 'Transaction hash', 'Confirmations', '13']
  },
  {
    id: 'tray-account-activity-full-1',
    renderer: 'tray',
    state: 'account-activity',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.activityModuleExpanded',
    requiredControls: ['All', 'Transactions', 'Signatures', 'Connections', 'Clear activity'],
    requiredText: ['Transaction', 'Typed-data signature', 'Account access', 'Ethereum Mainnet']
  },
  {
    id: 'tray-account-activity-clear-full-1',
    renderer: 'tray',
    state: 'account-activity',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Clear activity' },
    ready: '[role="alertdialog"]',
    requiredControls: ['Cancel', 'Clear history'],
    requiredText: ['Clear activity history?', 'every account on this device', 'cannot be undone']
  },
  {
    id: 'tray-account-activity-lifecycle-full-1',
    renderer: 'tray',
    state: 'account-activity-lifecycle',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.activityModuleExpanded',
    requiredText: [
      'Submitted',
      'Confirming',
      'Reorg detected',
      'Replaced',
      'Monitoring stopped',
      'Clearance not verified',
      'Delegation removed'
    ]
  },
  {
    id: 'tray-native-pairing-full-1',
    renderer: 'tray',
    state: 'native-pairing',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '[role="dialog"][aria-labelledby="wren-notify-title"]',
    expectedInitialFocus: 'Not now',
    requiredControls: ['Copy full connection ID', 'Not now', 'Allow'],
    requiredText: [
      'Allow local app to connect?',
      'Compare this code with the app before allowing it.',
      'Connection ID'
    ]
  },
  {
    id: 'tray-account-ledger-bottom-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.settingsPreviewActions',
    requiredText: ['Connected apps', 'Signer', 'Remove account'],
    captureScroll: 'bottom',
    captureScrollSelector: '.accountMainScroll'
  },
  {
    id: 'tray-account-ledger-no-requests-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    requestsAbsent: true,
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.settingsPreviewActions',
    requiredText: ['Ethereum Mainnet', 'Balances', 'Connected apps']
  },
  {
    id: 'tray-account-removal-confirm-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Remove account' },
    ready: '[role="alertdialog"]',
    requiredText: ['Remove Workshop Software Account With A Long Name?', 'Cancel', 'Confirm removal'],
    captureScroll: 'bottom',
    captureScrollSelector: '.accountMainScroll'
  },
  {
    id: 'tray-account-drawer-full-1',
    renderer: 'tray',
    state: 'account-drawer',
    scale: 1,
    logicalWidth: 760,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.accountChooserPanel',
    requiredText: ['Primary account', 'Hardware account', 'Watch account', 'Add account']
  }
]

const scenarioMatrix = ({ includeReview = false } = {}) => {
  const scenarios = [
    ...INTERFACE_SCALES.flatMap((scale) => [
      {
        id: `tray-empty-full-${scale}`,
        renderer: 'tray',
        state: 'empty',
        scale,
        logicalWidth: 760,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.accountSelectorEmpty'
      },
      {
        id: `tray-empty-short-${scale}`,
        renderer: 'tray',
        state: 'empty',
        scale,
        logicalWidth: 760,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.accountSelectorEmpty'
      },
      {
        id: `dash-control-center-full-${scale}`,
        renderer: 'dash',
        state: 'control-center',
        scale,
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.dashModules',
        layoutExpectations: [{ kind: 'size', selector: '.dashHomeWren', width: 96, height: 96 }]
      },
      {
        id: `dash-control-center-short-${scale}`,
        renderer: 'dash',
        state: 'control-center',
        scale,
        logicalWidth: 620,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.dashModules',
        layoutExpectations: [{ kind: 'size', selector: '.dashHomeWren', width: 96, height: 96 }]
      },
      {
        id: `tray-account-home-full-${scale}`,
        renderer: 'tray',
        state: 'account-home',
        scale,
        logicalWidth: 760,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.chainMonitorPreview',
        requiredControls: [
          'Previous network from Ethereum Mainnet',
          'Next network from Ethereum Mainnet',
          'View Ethereum Mainnet account on block explorer',
          'Show gas details for Ethereum Mainnet'
        ],
        requiredText: ['Ethereum Mainnet', 'Gas']
      },
      {
        id: `tray-account-home-short-${scale}`,
        renderer: 'tray',
        state: 'account-home',
        scale,
        logicalWidth: 760,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.chainMonitorPreview',
        requiredControls: [
          'Previous network from Ethereum Mainnet',
          'Next network from Ethereum Mainnet',
          'View Ethereum Mainnet account on block explorer',
          'Show gas details for Ethereum Mainnet'
        ],
        requiredText: ['Ethereum Mainnet', 'Gas']
      },
      {
        id: `dash-delegation-full-${scale}`,
        renderer: 'dash',
        state: 'delegation',
        scale,
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.delegationRevocationEligible',
        requiredControls: ['Revoke delegation'],
        requiredText: ['RPC-reported delegation target', 'Reported by configured RPC · eth_getCode']
      },
      {
        id: `dash-delegation-short-${scale}`,
        renderer: 'dash',
        state: 'delegation',
        scale,
        logicalWidth: 620,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.delegationRevocationEligible',
        requiredControls: ['Revoke delegation'],
        requiredText: ['RPC-reported delegation target', 'Reported by configured RPC · eth_getCode']
      },
      {
        id: `dash-tokens-full-${scale}`,
        renderer: 'dash',
        state: 'tokens',
        scale,
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.customTokens',
        requiredControls: ['Add New Token'],
        requiredText: ['No custom tokens']
      },
      {
        id: `dash-tokens-short-${scale}`,
        renderer: 'dash',
        state: 'tokens',
        scale,
        logicalWidth: 620,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.customTokens',
        requiredControls: ['Add New Token'],
        requiredText: ['No custom tokens']
      },
      {
        id: `tray-revocation-review-full-${scale}`,
        renderer: 'tray',
        state: 'revocation-review',
        scale,
        logicalWidth: 760,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.eip7702RevokeRequest-review',
        requiredControls: ['Cancel', 'Revoke delegation', 'Adjust'],
        requiredText: ['Current delegation evidence', 'Maximum execution fee', 'Transaction nonce']
      },
      {
        id: `tray-revocation-review-short-${scale}`,
        renderer: 'tray',
        state: 'revocation-review',
        scale,
        logicalWidth: 760,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.eip7702RevokeRequest-review',
        requiredControls: ['Cancel', 'Revoke delegation', 'Adjust'],
        requiredText: ['Current delegation evidence', 'Maximum execution fee', 'Transaction nonce']
      },
      {
        id: `tray-revocation-monitor-full-${scale}`,
        renderer: 'tray',
        state: 'revocation-monitor',
        scale,
        logicalWidth: 760,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.eip7702StopMonitoringDialog',
        action: { type: 'clickText', text: 'Stop monitoring' },
        expectedInitialFocus: 'Keep monitoring',
        requiredControls: ['Keep monitoring', 'Stop monitoring and continue requests'],
        requiredText: ['Submission status unclear', 'cannot cancel a transaction']
      },
      {
        id: `tray-revocation-monitor-short-${scale}`,
        renderer: 'tray',
        state: 'revocation-monitor',
        scale,
        logicalWidth: 760,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.eip7702StopMonitoringDialog',
        action: { type: 'clickText', text: 'Stop monitoring' },
        expectedInitialFocus: 'Keep monitoring',
        requiredControls: ['Keep monitoring', 'Stop monitoring and continue requests'],
        requiredText: ['Submission status unclear', 'cannot cancel a transaction']
      },
      {
        id: `onboard-intro-${scale}`,
        renderer: 'onboard',
        state: 'intro',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: 'button'
      },
      {
        id: `onboard-access-${scale}`,
        renderer: 'onboard',
        state: 'access',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: { type: 'clickText', text: 'Get started' }
      }
    ]),
    {
      id: 'dash-control-center-capped-1.5',
      renderer: 'dash',
      state: 'control-center',
      scale: 1.5,
      logicalWidth: 530,
      logicalHeight: SHORT_SHELL_HEIGHT,
      ready: '.dashModules',
      layoutExpectations: [{ kind: 'hidden', selector: '.dashHomeWren' }]
    },
    {
      id: 'dash-delegation-capped-1.5',
      renderer: 'dash',
      state: 'delegation',
      scale: 1.5,
      logicalWidth: 530,
      logicalHeight: SHORT_SHELL_HEIGHT,
      ready: '.delegationRevocationEligible',
      requiredControls: ['Revoke delegation'],
      requiredText: ['RPC-reported delegation target', 'Reported by configured RPC · eth_getCode'],
      layoutExpectations: [
        { kind: 'stacked', selector: '.delegationRevocationSelectors > label' },
        {
          kind: 'full-width',
          selector: '.delegationRevocationSelectors > label',
          container: '.delegationRevocationSelectors'
        },
        { kind: 'stacked', selector: '.delegationRevocationEligible > *' },
        {
          kind: 'full-width',
          selector: '.delegationRevocationEligible > button',
          container: '.delegationRevocationEligible'
        }
      ]
    },
    {
      id: 'tray-revocation-review-capped-1.5',
      renderer: 'tray',
      state: 'revocation-review',
      scale: 1.5,
      logicalWidth: 600,
      logicalHeight: SHORT_SHELL_HEIGHT,
      ready: '.eip7702RevokeRequest-review',
      requiredControls: ['Cancel', 'Revoke delegation', 'Adjust'],
      requiredText: ['Current delegation evidence', 'Maximum execution fee', 'Transaction nonce'],
      layoutExpectations: [
        {
          kind: 'full-width',
          selector: '.eip7702RevokeFeeRow > button',
          container: '.eip7702RevokeFeeRow'
        }
      ]
    }
  ]
  return includeReview ? [...scenarios, ...reviewScenarios()] : scenarios
}

const physicalSize = ({ logicalWidth, logicalHeight, scale }) => ({
  width: Math.round(logicalWidth * scale),
  height: Math.round(logicalHeight * scale)
})

module.exports = {
  COMPACT_TARGET_EXCEPTIONS,
  FULL_SHELL_HEIGHT,
  INTERFACE_SCALES,
  SHORT_SHELL_HEIGHT,
  physicalSize,
  scenarioMatrix
}
