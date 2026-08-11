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

const scenarioMatrix = () => [
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
      requiredText: ['Delegated to', 'Configured RPC · eth_getCode']
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
      requiredText: ['Delegated to', 'Configured RPC · eth_getCode']
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
    requiredText: ['Delegated to', 'Configured RPC · eth_getCode'],
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
