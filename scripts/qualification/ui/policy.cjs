'use strict'

const INTERFACE_SCALES = Object.freeze([1, 1.25, 1.5])
const FULL_SHELL_HEIGHT = 900
const SHORT_SHELL_HEIGHT = 744
const GENERATED_EXPIRY_COLOR = Object.freeze({
  kind: 'computed-style',
  selector: '.generatedWalletExpiryNotice',
  property: 'color',
  value: 'rgb(208, 214, 206)'
})

const RPC_WARNING_SCENARIOS = Object.freeze([
  {
    variant: 'gas-estimate',
    title: 'estimated to fail',
    message: 'execution reverted: ERC20 transfer amount exceeds balance',
    confirmLabel: 'Proceed'
  },
  {
    variant: 'revert',
    title: 'RPC Reports Revert',
    message: 'Your configured RPC reports that this transaction will revert.',
    confirmLabel: 'Sign Anyway'
  },
  {
    variant: 'execution-failed',
    title: 'Execution Check Failed',
    message: 'Wren could not determine whether this transaction will execute successfully.',
    confirmLabel: 'Sign Anyway'
  },
  {
    variant: 'execution-unavailable',
    title: 'Execution Check Unavailable',
    message: 'Your configured RPC does not provide a usable transaction execution check.',
    confirmLabel: 'Sign Anyway'
  },
  {
    variant: 'broad-token-approval',
    title: 'Broad Token Approval',
    message: 'Your configured RPC reports broad ERC-20 spending authority.',
    confirmLabel: 'Approve Anyway'
  },
  {
    variant: 'existing-token-allowance',
    title: 'Existing Token Allowance',
    message: 'Your configured RPC reports a different nonzero allowance for this owner and spender.',
    confirmLabel: 'Change Anyway'
  },
  {
    variant: 'delegated-account',
    title: 'Delegated Account',
    message: 'This account delegates execution to',
    confirmLabel: 'Sign With Delegated Account'
  },
  {
    variant: 'proxy-implementation',
    title: 'Proxy Implementation Change',
    message: 'Your configured RPC reports that 1 ERC-1967 proxy implementation slot will be different',
    confirmLabel: 'Proceed Anyway'
  }
])

const onboardingAction = (nextCount = 0) => ({
  type: 'sequence',
  delayMs: 650,
  steps: [
    { type: 'clickText', text: 'Get started' },
    ...(nextCount >= 0 ? [{ type: 'clickText', text: 'Skip shortcut' }] : []),
    ...Array.from({ length: nextCount }, () => ({ type: 'clickText', text: 'Next' }))
  ]
})

const generatedWalletPresentationAction = () => ({
  type: 'sequence',
  delayMs: 900,
  steps: [
    { type: 'inputLabel', label: 'Create password', value: 'correct horse battery staple' },
    { type: 'clickText', text: 'Continue' },
    { type: 'inputLabel', label: 'Confirm password', value: 'correct horse battery staple' },
    { type: 'clickText', text: 'Create' }
  ]
})

const generatedWalletVerificationAction = (kind) => ({
  type: 'sequence',
  delayMs: 650,
  steps: [
    ...generatedWalletPresentationAction().steps,
    ...(kind === 'private-key' ? [{ type: 'clickText', text: 'Show private key' }] : []),
    { type: 'clickText', text: kind === 'phrase' ? "I've written it down" : "I've saved my key" }
  ]
})

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
  logicalWidth: 620,
  logicalHeight,
  ready: '.requestApproveTransaction .requestSign:not(:disabled)',
  requiredControls: ['Copy transaction recipient address', 'Decline', 'Sign transaction'],
  requiredText: [
    'Possible address poisoning.',
    'Verify the full address. Its first and last four characters match a destination you used before.'
  ],
  layoutExpectations:
    geometry === 'short' ? [{ kind: 'viewport-bottom', selector: '.requestNoticeTransactionReview' }] : []
})

const transactionDeploymentScenario = (geometry, scale, logicalHeight) => ({
  id: `tray-transaction-deployment-${geometry}-${scale}`,
  renderer: 'tray',
  state: 'transaction-deployment',
  scale,
  logicalWidth: 620,
  logicalHeight,
  ready: '.requestApproveTransaction .requestSign:not(:disabled)',
  requiredControls: [
    'View transaction data',
    'Copy transaction sender address',
    'Copy deployment initcode hash',
    'Copy provisional deployment address',
    'Decline',
    'Sign transaction'
  ],
  requiredText: [
    'Deploy contract',
    'Wren Deploy',
    'Deployment data',
    '4 bytes',
    'Provisional address',
    'may change before signing'
  ],
  layoutExpectations:
    geometry === 'short' ? [{ kind: 'viewport-bottom', selector: '.requestNoticeTransactionReview' }] : []
})

const joinedCanvasScenarios = () => [
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].flatMap(([geometry, logicalHeight]) => [
      {
        id: `tray-account-drawer-${geometry}-right-${scale}`,
        renderer: 'tray',
        state: 'account-drawer',
        glideSide: 'right',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.accountChooserPanel',
        requiredText: ['Primary account', 'Hardware account', 'Watch account', 'Add account']
      },
      {
        id: `tray-account-drawer-${geometry}-left-${scale}`,
        renderer: 'tray',
        state: 'account-drawer',
        glideSide: 'left',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.accountChooserPanel',
        requiredText: ['Primary account', 'Hardware account', 'Watch account', 'Add account']
      },
      {
        id: `dash-control-center-${geometry}-left-${scale}`,
        renderer: 'dash',
        state: 'control-center',
        glideSide: 'left',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.dashModules',
        layoutExpectations: [
          { kind: 'size', selector: '.dashHomeWren', width: 96, height: 96 },
          ...(geometry === 'full' ? [{ kind: 'scroll-fits', selector: '.dashMainScroll' }] : [])
        ]
      },
      {
        id: `tray-account-home-${geometry}-left-${scale}`,
        renderer: 'tray',
        state: 'account-home',
        glideSide: 'left',
        workspaceOpen: true,
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: 'body.workspace-open .chainMonitorPreview',
        requiredControls: [
          'Previous network from Ethereum',
          'Next network from Ethereum',
          'View Ethereum account on block explorer',
          'Show gas details for Ethereum'
        ],
        requiredText: ['Ethereum', '2', 'gwei', 'Details']
      },
      {
        id: `tray-account-home-${geometry}-right-${scale}`,
        renderer: 'tray',
        state: 'account-home',
        glideSide: 'right',
        workspaceOpen: true,
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: 'body.workspace-open .chainMonitorPreview',
        requiredControls: [
          'Previous network from Ethereum',
          'Next network from Ethereum',
          'View Ethereum account on block explorer',
          'Show gas details for Ethereum'
        ],
        requiredText: ['Ethereum', '2', 'gwei', 'Details']
      }
    ])
  )
]

const accountAccessReviewScenarios = () =>
  [
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `tray-account-access-review-${geometry}-1`,
    renderer: 'tray',
    state: 'account-access-review',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.requestApproveCompact .requestSign:not(:disabled)',
    requiredControls: ['Decline', 'Allow access'],
    requiredText: ['Only this account'],
    layoutExpectations: [
      { kind: 'size', selector: '.requestApproveCompact .requestDecline', width: 104, height: 44 },
      { kind: 'size', selector: '.requestApproveCompact .requestSign', width: 128, height: 44 },
      { kind: 'viewport-bottom', selector: '.requestApproveCompact' }
    ]
  }))

const switchChainReviewScenarios = () =>
  [
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `tray-switch-chain-review-${geometry}-1`,
    renderer: 'tray',
    state: 'switch-chain-review',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.requestApproveCompact .requestSign:not(:disabled)',
    requiredControls: ['Decline', 'Switch network'],
    requiredText: [
      'NETWORK CHANGE',
      'Switch to Base?',
      'https://basescan.org',
      'Ethereum',
      'Base',
      'Account access remains separate.'
    ],
    layoutExpectations: [
      { kind: 'size', selector: '.requestApproveCompact .requestDecline', width: 104, height: 44 },
      { kind: 'size', selector: '.requestApproveCompact .requestSign', width: 128, height: 44 },
      { kind: 'viewport-bottom', selector: '.requestApproveCompact' }
    ]
  }))

const updateDialogScenarios = () =>
  INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].flatMap(([geometry, logicalHeight]) => [
      {
        id: `tray-update-available-${geometry}-${scale}`,
        renderer: 'tray',
        state: 'update-available',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.updateDialog',
        expectedInitialFocus: 'Get update',
        requiredControls: ['Get update', 'Later', 'Skip this version'],
        requiredText: ['Update available', 'Wren 0.1.3 is available. Get the update when you are ready.']
      },
      {
        id: `tray-update-ready-${geometry}-${scale}`,
        renderer: 'tray',
        state: 'update-ready',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.updateDialog',
        expectedInitialFocus: 'Continue',
        requiredControls: ['Continue', 'Later'],
        requiredText: ['Update ready', 'Wren 0.1.3 is ready. Continue to complete the update.']
      }
    ])
  )

const sendComposerScenarios = () =>
  INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].flatMap(([geometry, logicalHeight]) => [
      {
        id: `dash-send-composer-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-composer',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.sendComposer',
        requiredControls: ['Send one', 'Sweep assets', 'Choose an asset', 'Choose recipient'],
        requiredText: ['NETWORK FEE', 'Calculated during review', 'Available: 1.25 ETH']
      },
      {
        id: `dash-send-asset-picker-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-asset-picker',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.sendAssetList',
        expectedInitialFocus: 'Search assets',
        requiredControls: ['Select ETH', 'Select USDC'],
        requiredText: ['Ethereum', 'Optimism Mainnet', 'Ether', 'USD Coin'],
        layoutExpectations: [
          { kind: 'size', selector: '.sendPickerSearch > svg', width: 15, height: 15 },
          { kind: 'size', selector: '.sendAssetOption .assetMarkChain', width: 12, height: 12 },
          {
            kind: 'computed-style',
            selector: '.sendAssetOption .assetMarkGlyph',
            property: 'borderTopColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          {
            kind: 'computed-style',
            selector: '.sendAssetOption .assetMarkGlyph',
            property: 'backgroundColor',
            value: 'rgba(0, 0, 0, 0)'
          }
        ]
      },
      {
        id: `dash-send-sweep-selection-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-sweep-selection',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: {
          type: 'sequence',
          steps: [
            { type: 'clickText', text: 'Sweep assets' },
            { type: 'selectLabel', label: 'Network', value: '10' },
            { type: 'clickCheckboxText', text: 'USDC' }
          ]
        },
        ready: '.sendSweepAssetSelected',
        requiredControls: ['Send one', 'Sweep assets'],
        requiredText: [
          'Select positive balances',
          '1 selected · 16 per sweep',
          'Sweep is sequential and non-atomic.'
        ]
      }
    ])
  )

const SEND_LIFECYCLE_CASES = [
  {
    variant: 'queued',
    geometry: 'full',
    logicalHeight: FULL_SHELL_HEIGHT,
    scale: 1,
    heading: 'Transaction queued',
    requiredControls: ['Close']
  },
  {
    variant: 'submitted',
    geometry: 'short',
    logicalHeight: SHORT_SHELL_HEIGHT,
    scale: 1,
    status: 'verifying',
    heading: 'Transaction submitted',
    requiredControls: ['Close']
  },
  {
    variant: 'unconfirmed',
    geometry: 'full',
    logicalHeight: FULL_SHELL_HEIGHT,
    scale: 1.25,
    status: 'verifying',
    submission: { status: 'unconfirmed' },
    heading: 'Submission status unconfirmed',
    requiredControls: ['Close']
  },
  {
    variant: 'declined',
    geometry: 'short',
    logicalHeight: SHORT_SHELL_HEIGHT,
    scale: 1.25,
    status: 'declined',
    heading: 'Transaction declined',
    requiredControls: ['Try again', 'Close']
  },
  {
    variant: 'failed',
    geometry: 'short',
    logicalHeight: SHORT_SHELL_HEIGHT,
    scale: 1.5,
    status: 'error',
    notice: 'The configured RPC could not confirm the request.',
    heading: 'Transaction failed',
    requiredControls: ['Try again', 'Close']
  }
]

const sendLifecycleScenarios = () =>
  SEND_LIFECYCLE_CASES.map(
    ({ variant, geometry, logicalHeight, scale, status, submission, notice, heading, requiredControls }) => {
      const steps = [
        {
          type: 'inputLabel',
          label: 'Recipient',
          value: '0x2222222222222222222222222222222222222222'
        },
        { type: 'inputLabel', label: 'Amount', value: '0.25' },
        { type: 'clickText', text: 'Review send' }
      ]
      if (status) {
        steps.push({
          type: 'setRequestStatus',
          account: '0x9A91D79cB7d27d71E109F4DFD177475E1D35dD02',
          requestId: 'qualification-send-request',
          status,
          ...(submission ? { submission } : {}),
          ...(notice ? { notice } : {})
        })
      }
      return {
        id: `dash-send-lifecycle-${variant}-${geometry}-${scale}`,
        renderer: 'dash',
        state: `send-lifecycle-${variant}`,
        variant,
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: { type: 'sequence', delayMs: 300, steps },
        ready: '.sendRequestState',
        expectedInitialFocus: heading,
        requiredControls,
        requiredText: [heading],
        layoutExpectations: [{ kind: 'scroll-fits', selector: '.dashMainScroll' }]
      }
    }
  )

const reviewScenarios = () => [
  ...joinedCanvasScenarios(),
  ...updateDialogScenarios(),
  ...sendComposerScenarios().filter(({ state }) => state !== 'send-asset-picker'),
  ...sendLifecycleScenarios(),
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `tray-transaction-deployment-confirmed-${geometry}-${scale}`,
      renderer: 'tray',
      state: 'transaction-deployment-confirmed',
      scale,
      logicalWidth: 620,
      logicalHeight,
      ready: '.txLifecycle-success',
      layoutExpectations: [
        { kind: 'viewport-bottom', selector: '.requestNoticeTransactionDeploymentStatus' }
      ],
      requiredControls: ['View details', 'Verify source', 'Close'],
      requiredText: ['Confirmed', 'Transaction hash', 'Confirmations', '13']
    }))
  ),
  ...INTERFACE_SCALES.flatMap((scale) =>
    ['unlocked', 'locked'].flatMap((variant) =>
      [
        ['full', FULL_SHELL_HEIGHT],
        ['short', SHORT_SHELL_HEIGHT]
      ].map(([geometry, logicalHeight]) => ({
        id: `dash-earn-yvusd-${variant}-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'earn-yvusd',
        variant,
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.earnDetails',
        requiredControls:
          variant === 'locked'
            ? ['Flexible', 'Locked', 'Deposit', 'Start locked cooldown']
            : ['Flexible', 'Locked', 'Deposit', 'Withdraw'],
        requiredText: [
          'yvUSD',
          'Earn with flexible or time-locked yvUSD.',
          'EST. APY',
          'TVL',
          'RISK',
          'Choose how to earn',
          'Locked withdrawal timing',
          'APY is variable and not guaranteed.',
          'Yearn vaults involve smart-contract and strategy risk.'
        ]
      }))
    )
  ),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-earn-loading-${geometry}-1`,
    renderer: 'dash',
    state: 'earn-loading',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.earnPositionsLoading',
    deferInvokes: ['yearn:getCatalog', 'yearn:getPositions', 'yearn:getWorkflows'],
    requiredControls: ['View yvUSD on Ethereum'],
    requiredText: [
      'Earn',
      'Loading current Yearn metrics…',
      'Loading account positions…',
      'Ethereum',
      'yvUSD'
    ],
    layoutExpectations: [
      {
        kind: geometry === 'short' ? 'scroll-overflows' : 'scroll-fits',
        selector: '.dashMainScroll'
      }
    ]
  })),
  {
    id: 'dash-earn-list-full-1',
    renderer: 'dash',
    state: 'earn-list',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.earnPositionList',
    requiredControls: ['Refresh', 'Manage yvUSD position', 'View yvUSD on Ethereum'],
    requiredText: ['Earn', 'YOUR POSITIONS', '1.5 USDC', '5.12%', '$1.5M TVL']
  },
  {
    id: 'dash-earn-privacy-short-1',
    renderer: 'dash',
    state: 'earn-privacy',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.earnPositionList',
    requiredControls: ['Manage yvUSD position', 'View yvUSD on Ethereum'],
    requiredText: ['YOUR POSITIONS', '•••• USDC', '•••• USDC available', '5.12%', '$1.5M TVL']
  },
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-inspector-form-${geometry}-1`,
    renderer: 'dash',
    state: 'inspector',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.inspectorInputPanel',
    layoutExpectations: [{ kind: 'scroll-fits', selector: '.dashMainScroll' }],
    requiredControls: ['Transaction', 'Calldata', 'EIP-712', 'JSON-RPC'],
    requiredText: ['Read-only inspector', 'Never signs or broadcasts', 'Raw input is not saved.']
  })),
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `dash-contract-verification-form-${geometry}-${scale}`,
      renderer: 'dash',
      state: 'contract-verification',
      scale,
      logicalWidth: 620,
      logicalHeight,
      ready: '.contractVerificationForm',
      layoutExpectations: [
        {
          kind: 'computed-style',
          selector: '.contracts, .contractVerification',
          property: 'overflowY',
          value: 'visible'
        },
        {
          kind: 'edge-clearance',
          selector: '.contractVerification .wrenInput',
          container: '.contractsPanel',
          inset: 2
        },
        ...(geometry === 'full' ? [{ kind: 'scroll-fits', selector: '.dashMainScroll' }] : [])
      ],
      requiredControls: ['Network', 'Contract address', 'Choose artifact'],
      requiredText: [
        'Contracts',
        'Verify source',
        'Match source to deployed bytecode and publish a public record.',
        'Solidity or Vyper standard JSON',
        'Foundry or Hardhat build-info'
      ]
    }))
  ),
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `dash-contract-verification-evidence-${geometry}-${scale}`,
      renderer: 'dash',
      state: 'contract-verification',
      scale,
      logicalWidth: 620,
      logicalHeight,
      action: {
        type: 'sequence',
        steps: [
          { type: 'selectLabel', label: 'Network', value: '10' },
          {
            type: 'inputLabel',
            label: 'Contract address',
            value: '0x6666666666666666666666666666666666666666'
          },
          { type: 'clickText', text: 'Choose artifact' },
          { type: 'clickText', text: 'Check source' },
          { type: 'clickCheckboxText', text: 'possible forwarding' }
        ]
      },
      ready: '.contractVerificationPublication',
      captureScroll: 'target',
      captureScrollSelector: '.contractVerificationPublication',
      requiredControls: ['Edit and recheck', 'Publish source'],
      requiredText: [
        'Source check',
        'Matched locally',
        'selected Solidity or Vyper source artifact',
        'Sourcify may forward them to Etherscan, Blockscout, or Routescan'
      ]
    }))
  ),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-contract-verification-result-${geometry}-1`,
    renderer: 'dash',
    state: 'contract-verification',
    variant: 'result',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    action: {
      type: 'sequence',
      steps: [
        { type: 'clickCheckboxText', text: 'no constructor arguments' },
        { type: 'clickCheckboxText', text: 'direct Etherscan submission' }
      ]
    },
    ready: '.contractVerificationResult',
    requiredControls: ['Refresh status', 'Submit directly with API key'],
    requiredText: [
      'Verification status',
      'Sourcify',
      'Published',
      'Blockscout',
      'Verified',
      'directly to Etherscan'
    ]
  })),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-contract-verification-direct-unknown-${geometry}-1`,
    renderer: 'dash',
    state: 'contract-verification',
    variant: 'direct-transport-unknown',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.contractVerificationResult',
    requiredControls: ['Check another contract', 'Refresh status'],
    requiredText: [
      'Verification status',
      'Etherscan · direct',
      'Status unknown',
      'Etherscan’s response was not confirmed. Wren will not submit this publication again; check the contract on Etherscan later.'
    ]
  })),
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `dash-inspector-${geometry}-${scale}`,
      renderer: 'dash',
      state: 'inspector',
      scale,
      logicalWidth: 620,
      logicalHeight,
      action: {
        type: 'sequence',
        steps: [
          { type: 'clickText', text: 'Calldata' },
          { type: 'inputLabel', label: 'Calldata', value: '0x12345678' },
          { type: 'inputLabel', label: 'Chain ID optional', value: '1' },
          { type: 'clickText', text: 'Inspect read-only' }
        ]
      },
      ready: '.inspectorResult',
      requiredControls: [
        'Transaction',
        'Calldata',
        'EIP-712',
        'JSON-RPC',
        'Inspect read-only',
        'Copy selector'
      ],
      requiredText: [
        'Read-only inspector',
        'Never signs or broadcasts',
        'Raw input is not saved.',
        'Unknown function',
        '0x12345678',
        'Configured-RPC simulation'
      ]
    }))
  ),
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `dash-deployment-form-${geometry}-${scale}`,
      renderer: 'dash',
      state: 'deployment',
      scale,
      logicalWidth: 620,
      logicalHeight,
      ready: '.deploymentForm',
      layoutExpectations: [
        {
          kind: 'computed-style',
          selector: '.contracts, .deployment',
          property: 'overflowY',
          value: 'visible'
        },
        {
          kind: 'edge-clearance',
          selector: '.deploymentForm .wrenInput',
          container: '.contractsPanel',
          inset: 2
        },
        ...(geometry === 'short'
          ? [
              {
                kind: 'computed-style',
                selector: '.deploymentActionShelf',
                property: 'backgroundColor',
                value: 'rgb(9, 12, 10)'
              }
            ]
          : []),
        ...(geometry === 'full' ? [{ kind: 'scroll-fits', selector: '.dashMainScroll' }] : [])
      ],
      requiredControls: [
        'Account',
        'Network',
        'Deployment data',
        'Optional native value',
        'Check deployment'
      ],
      requiredText: [
        'Contracts',
        'Deploy contract',
        'Check prepared creation data, then queue it for native review.',
        'Workshop Software Account With A Long Name',
        'Optimism',
        'configured RPC',
        'does not compile Solidity'
      ]
    }))
  ),
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `dash-deployment-result-${geometry}-${scale}`,
      renderer: 'dash',
      state: 'deployment',
      scale,
      logicalWidth: 620,
      logicalHeight,
      action: {
        type: 'sequence',
        steps: [
          { type: 'inputLabel', label: 'Deployment data', value: '0x60006000' },
          { type: 'inputLabel', label: 'Optional native value', value: '0.01' },
          { type: 'clickText', text: 'Check deployment' }
        ]
      },
      ready: '.deploymentEvidence',
      captureScroll: 'target',
      captureScrollSelector: '.deploymentEvidence',
      captureScrollOffset: -80,
      layoutExpectations:
        geometry === 'short'
          ? [
              {
                kind: 'computed-style',
                selector: '.deploymentActionShelf',
                property: 'backgroundColor',
                value: 'rgb(9, 12, 10)'
              }
            ]
          : [],
      requiredControls: ['Edit and recheck', 'Review deployment'],
      requiredText: [
        'PREPARED EVIDENCE',
        'Keccak-256',
        'Simulation is evidence only',
        'Provisional CREATE address',
        'does not compile Solidity'
      ]
    }))
  ),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-deployment-abandon-${geometry}-1`,
    renderer: 'dash',
    state: 'deployment',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    action: {
      type: 'sequence',
      steps: [
        { type: 'inputLabel', label: 'Deployment data', value: '0x60006000' },
        { type: 'clickText', text: 'Back' }
      ]
    },
    ready: '.deploymentAbandonDialog[aria-modal="true"]',
    expectedInitialFocus: 'Keep editing',
    requiredControls: ['Keep editing', 'Discard and leave'],
    requiredText: [
      'Discard this deployment?',
      'Leaving now clears the deployment data and any prepared evidence.',
      'Nothing has been signed or broadcast.'
    ]
  })),
  {
    id: 'dash-inspector-result-full-1',
    renderer: 'dash',
    state: 'inspector',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      steps: [
        { type: 'clickText', text: 'Calldata' },
        { type: 'inputLabel', label: 'Calldata', value: '0x12345678' },
        { type: 'inputLabel', label: 'Chain ID optional', value: '1' },
        { type: 'clickText', text: 'Inspect read-only' }
      ]
    },
    ready: '.inspectorResult',
    requiredControls: ['Copy selector'],
    requiredText: ['Never signs or broadcasts', 'Unknown function', '0x12345678'],
    captureScroll: 'target',
    captureScrollSelector: '.inspectorMissing',
    captureScrollOffset: -220
  },
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `tray-account-guardrail-editor-${geometry}-${scale}`,
      renderer: 'tray',
      state: 'account-permissions',
      scale,
      logicalWidth: 620,
      logicalHeight,
      action: { type: 'clickText', text: 'Edit guardrail · Ethereum (0x1)' },
      ready: '.dappGuardrailEditor',
      expectedInitialFocus: 'When a request exceeds a restriction',
      requiredControls: [
        'Close editor',
        'When a request exceeds a restriction',
        'Restrict request targets',
        'Restrict approval spenders',
        'Set native-value ceiling',
        'Set token ceilings',
        'Set allowed-until time',
        'Remove guardrail',
        'Save changes'
      ],
      requiredText: [
        'Local request guardrail',
        '11111111-1111-4111-8111-111111111111',
        'Direct web origin · asserted by the connecting app',
        'never sign automatically and never replace normal transaction review',
        'Enabled with no addresses denies every target',
        'Amounts are raw whole base units'
      ]
    }))
  ),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `tray-account-access-revoke-${geometry}-1`,
    renderer: 'tray',
    state: 'account-permissions',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    action: { type: 'clickText', text: 'Revoke access' },
    ready: '.revokeAccessDialog',
    expectedInitialFocus: 'Cancel',
    requiredControls: ['Cancel', 'Confirm revoke'],
    requiredText: [
      'Revoke access for https://treasury.workshop.example?',
      'App connection ID 11111111-1111-4111-8111-111111111111',
      'Its guardrails will be removed, and it must request access again.'
    ]
  })),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `tray-account-access-clear-${geometry}-1`,
    renderer: 'tray',
    state: 'account-permissions',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    action: { type: 'clickText', text: 'Revoke all app access' },
    ready: '.clearPermissionsConfirm',
    expectedInitialFocus: 'Cancel',
    requiredControls: ['Cancel', 'Confirm revoke'],
    requiredText: [
      'Revoke all app access?',
      'External apps will lose access to this account.',
      'Their guardrails will be removed, and they must request access again.'
    ]
  })),
  {
    id: 'tray-account-access-revoke-failed-short-1',
    renderer: 'tray',
    state: 'account-permissions',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      delayMs: 650,
      steps: [
        { type: 'clickText', text: 'Revoke access' },
        { type: 'clickText', text: 'Confirm revoke' }
      ]
    },
    ready: '.revokeAccessFailure',
    expectedInitialFocus: 'Confirm revoke',
    requiredControls: ['Cancel', 'Confirm revoke'],
    requiredText: [
      'Revoke access for https://treasury.workshop.example?',
      'Revocation confirmation is unavailable. Wren will keep checking for the access change.'
    ]
  },
  ...['left', 'right'].map((glideSide) => ({
    id: `tray-account-access-revoke-workspace-${glideSide}-1`,
    renderer: 'tray',
    state: 'account-permissions',
    glideSide,
    workspaceOpen: true,
    scale: 1,
    logicalWidth: 1240,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Revoke access' },
    ready: '.revokeAccessDialog',
    expectedInitialFocus: 'Cancel',
    requiredControls: ['Cancel', 'Confirm revoke'],
    requiredText: [
      'Revoke access for https://treasury.workshop.example?',
      'App connection ID 11111111-1111-4111-8111-111111111111',
      'Its guardrails will be removed, and it must request access again.'
    ],
    layoutExpectations: [
      { kind: 'edge-clearance', selector: '.revokeAccessPanel', container: '#panel', inset: 16 }
    ]
  })),
  {
    id: 'tray-account-guardrail-native-source-full-1',
    renderer: 'tray',
    state: 'account-permissions',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Add guardrail · Ethereum (0x1)' },
    ready: '.dappGuardrailEditor',
    expectedInitialFocus: 'When a request exceeds a restriction',
    requiredText: [
      '22222222-2222-4222-8222-222222222222',
      'Native app · bound to the source below',
      'B7mKnX3q8A2dL5pR9vT4wY6cF1hJ0sUeZgQxN2oC7iM'
    ]
  },
  {
    id: 'tray-account-guardrail-save-busy-full-1',
    renderer: 'tray',
    state: 'account-permissions',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      steps: [
        { type: 'clickText', text: 'Edit guardrail · Ethereum (0x1)' },
        { type: 'clickText', text: 'Save changes' },
        { type: 'clickText', text: 'Confirm save' }
      ]
    },
    ready: '.dappGuardrailConfirm[aria-busy="true"]',
    requiredText: ['Save guardrail changes?', 'Saving…']
  },
  {
    id: 'tray-account-guardrail-save-error-full-1',
    renderer: 'tray',
    state: 'account-permissions',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      steps: [
        { type: 'clickText', text: 'Edit guardrail · Ethereum (0x1)' },
        { type: 'clickText', text: 'Save changes' },
        { type: 'clickText', text: 'Confirm save' }
      ]
    },
    ready: '.dappGuardrailMessage-alert',
    requiredControls: ['Remove guardrail', 'Save changes'],
    requiredText: ['Wren could not save this guardrail. Nothing changed. Try again.']
  },
  ...INTERFACE_SCALES.flatMap((scale) => [
    transactionLookalikeScenario('full', scale, FULL_SHELL_HEIGHT),
    transactionLookalikeScenario('short', scale, SHORT_SHELL_HEIGHT),
    transactionDeploymentScenario('full', scale, FULL_SHELL_HEIGHT),
    transactionDeploymentScenario('short', scale, SHORT_SHELL_HEIGHT),
    ...[
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].map(([geometry, logicalHeight]) => ({
      id: `tray-account-address-qr-${geometry}-${scale}`,
      renderer: 'tray',
      state: 'account-home',
      scale,
      logicalWidth: 620,
      logicalHeight,
      action: { type: 'focusText', text: 'Account address QR code' },
      ready: '.accountAddressQrPopover',
      requiredText: ['Account address', 'Workshop Software Account With A Long Name'],
      layoutExpectations: [{ kind: 'size', selector: '.accountAddressQrCode', width: 185, height: 185 }]
    }))
  ]),
  {
    id: 'tray-wallet-calls-funding-full-1',
    renderer: 'tray',
    state: 'wallet-calls-funding',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.walletCallsFundingRecovery',
    requiredControls: ['Copy address', 'Show receive QR', 'Reject request', 'Recheck'],
    requiredText: [
      'More funds needed',
      'Fund this account on Optimism Mainnet — Community RPC.',
      'Amounts at last check',
      'AVAILABLE',
      'REQUIRED',
      'MISSING'
    ]
  },
  {
    id: 'tray-wallet-calls-funding-qr-full-1',
    renderer: 'tray',
    state: 'wallet-calls-funding',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Show receive QR' },
    ready: '.transactionFundingQr',
    requiredControls: ['Copy address', 'Hide receive QR', 'Reject request', 'Recheck'],
    requiredText: ['More funds needed', 'Amounts at last check']
  },
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].flatMap(([geometry, logicalHeight]) => [
      {
        id: `dash-address-book-list-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'address-book-list',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.addressBookList',
        layoutExpectations: [{ kind: 'scroll-fits', selector: '.dashMainScroll' }],
        requiredControls: [
          'Copy address for Operations multisig with a deliberately long label',
          'Edit Operations multisig with a deliberately long label',
          'Remove Operations multisig with a deliberately long label'
        ],
        requiredText: [
          'Quarterly treasury recipient',
          'Checked 2026-08-18 · Compared with the deployment record on a separate device',
          '0x3333333333333333333333333333333333333333'
        ]
      },
      {
        id: `dash-address-book-editor-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'address-book-editor',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.addressBookEditor',
        requiredControls: ['Save Contact'],
        requiredText: ['Address check', 'Checked outside Wren', 'Wren does not verify it.']
      },
      {
        id: `dash-send-recipient-picker-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-recipient-picker',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.sendRecentRecipients',
        expectedInitialFocus: 'Search recipients',
        requiredControls: [
          'Workshop Software Account With A Long Name',
          'Operations multisig with a deliberately long label',
          'Recent recipient 0x5555555555555555555555555555555555555555'
        ],
        requiredText: [
          'ACTIVE ACCOUNTS',
          'SAVED CONTACTS',
          'RECENT RECIPIENTS',
          'Previously sent from this device · verify the full address',
          '0x5555555555555555555555555555555555555555'
        ]
      },
      {
        id: `dash-settings-recent-recipients-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'settings-recent-recipients',
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '#wren-settings-privacy',
        requiredControls: ['Save recent recipients', 'Clear'],
        requiredText: [
          'Privacy',
          'Recent recipients',
          'Store canonical destinations from Wren Send and managed Sweep only after successful network confirmation.',
          'Recent recipients are not included in backups.'
        ],
        captureScroll: 'target',
        captureScrollSelector: '#wren-settings-privacy'
      },
      {
        id: `dash-send-confirmed-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-confirmed',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: {
          type: 'sequence',
          delayMs: 450,
          steps: [
            { type: 'inputLabel', label: 'Recipient', value: '0x2222222222222222222222222222222222222222' },
            { type: 'inputLabel', label: 'Amount', value: '0.25' },
            { type: 'clickText', text: 'Review send' },
            {
              type: 'setRequestStatus',
              account: '0x9A91D79cB7d27d71E109F4DFD177475E1D35dD02',
              requestId: 'qualification-send-request',
              status: 'confirmed'
            }
          ]
        },
        ready: '.sendRequestStateSuccess',
        requiredControls: ['Copy address', 'View contact', 'Close'],
        requiredText: ['Transaction confirmed', 'Garden Friend', '0x2222222222222222222222222222222222222222']
      },
      {
        id: `dash-send-max-review-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-max-review',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: {
          type: 'sequence',
          delayMs: 300,
          steps: [
            { type: 'inputLabel', label: 'Recipient', value: '0x2222222222222222222222222222222222222222' },
            { type: 'clickText', text: 'Use Max' },
            { type: 'clickText', text: 'Review Max send' }
          ]
        },
        ready: '.sendQuotePanelReview',
        requiredControls: ['Edit amount', 'Queue transfer'],
        requiredText: [
          'Review maximum send',
          'Total reserved',
          'L1 data fee',
          'may leave dust',
          'Quote expires'
        ]
      },
      {
        id: `dash-send-sweep-review-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'send-sweep-review',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: {
          type: 'sequence',
          delayMs: 300,
          steps: [
            { type: 'clickText', text: 'Sweep assets' },
            { type: 'inputLabel', label: 'Recipient', value: '0x2222222222222222222222222222222222222222' },
            { type: 'selectLabel', label: 'Network', value: '10' },
            { type: 'clickCheckboxText', text: 'USDC' },
            { type: 'clickText', text: 'Review 1 transfer' }
          ]
        },
        ready: '.sendSweepReview',
        requiredControls: [
          'Copy full sweep recipient address',
          'Copy full token 1 address',
          'Copy full token 1 amount',
          'Back to selection',
          'Queue 1 transfer'
        ],
        requiredText: [
          'Sequential, not atomic',
          'No bridge or batch contract is used.',
          '0x3333333333333333333333333333333333333333',
          '100000000',
          'Exact ordered calls (1)',
          'Quote expires'
        ]
      }
    ])
  ),
  {
    id: 'dash-address-book-remove-short-1.5',
    renderer: 'dash',
    state: 'address-book-list',
    variant: 'remove',
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    action: {
      type: 'clickText',
      text: 'Remove Operations multisig with a deliberately long label'
    },
    ready: '.addressBookRemovalDialog[aria-modal="true"]',
    requiredControls: ['Cancel', 'Confirm removing Operations multisig with a deliberately long label'],
    requiredText: [
      'Remove Operations multisig with a deliberately long label?',
      'This removes the saved contact from Wren. Funds are not affected.'
    ]
  },
  {
    id: 'dash-settings-recent-clear-short-1.5',
    renderer: 'dash',
    state: 'settings-recent-recipients',
    variant: 'clear',
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Clear' },
    ready: '.recentRecipientsDialog',
    expectedInitialFocus: 'Cancel',
    requiredControls: ['Cancel', 'Clear recipients'],
    requiredText: ['Clear recent recipients?', 'This cannot be undone.', 'Saved contacts are not affected.'],
    captureScroll: 'target',
    captureScrollSelector: '.recentRecipientsDialog'
  },
  {
    id: 'dash-add-token-selector-short-1',
    renderer: 'dash',
    state: 'add-token-selector',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.originSwapChainList',
    requiredControls: ['Ethereum', 'Optimism Mainnet — Community RPC', 'Workshop Chain', 'Open Networks'],
    requiredText: ['Select a network']
  },
  {
    id: 'dash-add-token-details-full-1',
    renderer: 'dash',
    state: 'add-token-details',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.newTokenDetails',
    requiredControls: ['Add token'],
    requiredText: ['Token details detected.', 'On Ethereum']
  },
  {
    id: 'tray-transaction-advanced-pending-full-1',
    renderer: 'tray',
    state: 'transaction-responsive',
    variant: 'advanced-pending',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestSign:disabled',
    requiredControls: ['Copy transaction recipient address'],
    requiredText: ['Simulation completed', 'Additional checks pending', 'Final checks', 'Finishing checks']
  },
  {
    id: 'tray-transaction-advanced-partial-full-1',
    renderer: 'tray',
    state: 'transaction-responsive',
    variant: 'advanced-partial',
    viewData: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.transactionEvidenceGroupDisclosure',
    requiredText: ['Execution', 'Raw data']
  },
  ...[
    ['trezor-waiting', 'Waiting for Trezor', 'Review and approve the transaction on your Trezor.'],
    ['trezor-slow', 'Still waiting for Trezor', 'Check your Trezor and approve the transaction.'],
    [
      'trezor-delayed',
      'Still waiting for Trezor',
      'Check that your Trezor is connected and showing this transaction.'
    ]
  ].map(([variant, title, detail]) => ({
    id: `tray-transaction-${variant}-full-1`,
    renderer: 'tray',
    state: 'transaction-responsive',
    variant,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestApproveSigning',
    requiredControls: ['Cancel'],
    requiredText: [title, detail]
  })),
  ...[
    ['method-verified', 'Method verified · ABI source: Sourcify', 'Workshop Token', 'transfer'],
    ['method-standard', 'Method identified · ABI source: Standard ERC-20 ABI', 'Workshop Token', 'transfer'],
    [
      'method-retained',
      'Showing method details retained from an earlier decode.',
      'Workshop Token',
      'transfer'
    ],
    [
      'method-selector',
      'Possible method: transfer(address,uint256)',
      'Selector match only. Arguments are not decoded.'
    ],
    ['method-unknown', 'Contract method not identified', 'Selector', '0x12345678']
  ].map(([variant, ...requiredText]) => ({
    id: `tray-transaction-${variant}-full-1`,
    renderer: 'tray',
    state: 'transaction-responsive',
    variant,
    viewData: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.decodedDataContract',
    requiredText
  })),
  {
    id: 'tray-transaction-method-verified-short-1',
    renderer: 'tray',
    state: 'transaction-responsive',
    variant: 'method-verified',
    viewData: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.decodedDataContract',
    requiredText: ['Method verified · ABI source: Sourcify', 'Workshop Token', 'transfer']
  },
  {
    id: 'dash-notify-remove-network-short-1',
    renderer: 'dash',
    state: 'dash-notify-remove-network',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '[role="dialog"][aria-label="Remove Optimism Mainnet?"]',
    expectedInitialFocus: 'Cancel',
    requiredControls: ['Cancel', 'Remove network'],
    requiredText: ['Remove Optimism Mainnet?', 'This removes the network from Wren.']
  },
  {
    id: 'tray-transaction-method-verified-full-1.5',
    renderer: 'tray',
    state: 'transaction-responsive',
    variant: 'method-verified',
    viewData: true,
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.decodedDataContract',
    requiredText: ['Method verified · ABI source: Sourcify', 'Workshop Token', 'transfer']
  },
  {
    id: 'tray-transaction-trezor-delayed-full-1.5',
    renderer: 'tray',
    state: 'transaction-responsive',
    variant: 'trezor-delayed',
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestApproveSigning',
    requiredControls: ['Cancel'],
    requiredText: [
      'Still waiting for Trezor',
      'Check that your Trezor is connected and showing this transaction.'
    ]
  },
  {
    id: 'dash-account-chooser-full-1',
    renderer: 'dash',
    state: 'account-chooser',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.addAccountsChooser',
    requiredText: ['Create new', 'Import existing', 'Watch-only']
  },
  {
    id: 'dash-account-weak-password-short-1.5',
    renderer: 'dash',
    state: 'account-create-weak-password',
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      steps: [
        { type: 'inputLabel', label: 'Create password', value: 'aaaaaaaa', delayMs: 650 },
        { type: 'clickCheckboxText', text: 'I understand this password may be easy to guess.' }
      ]
    },
    ready: '.addAccountItemOptionPasswordConsent',
    requiredControls: ['Continue'],
    requiredText: [
      'Repeats like "aaa" are easy to guess',
      'I understand this password may be easy to guess.'
    ],
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.addAccountItemOptionSetupFrame[aria-hidden="false"]' }
    ]
  },
  ...INTERFACE_SCALES.flatMap((scale) =>
    [
      ['full', FULL_SHELL_HEIGHT],
      ['short', SHORT_SHELL_HEIGHT]
    ].flatMap(([geometry, logicalHeight]) => [
      {
        id: `dash-account-create-phrase-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'account-create-phrase',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: generatedWalletPresentationAction(),
        ready: '.generatedWalletFrame[aria-hidden="false"] .generatedWalletPhrase',
        requiredControls: ['Copy recovery phrase', "I've written it down"],
        requiredText: [
          'Your recovery phrase',
          'Write these 12 words down in order. Wren will not show them again.',
          'Wren clears an unchanged clipboard after 60 seconds. Clipboard history may retain it.',
          'Finish setup within about 10 minutes.',
          'Leaving now deletes this new wallet.'
        ],
        layoutExpectations: [GENERATED_EXPIRY_COLOR]
      },
      {
        id: `dash-account-create-private-key-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'account-create-private-key',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: generatedWalletPresentationAction(),
        ready: '.generatedWalletFrame[aria-hidden="false"] .generatedWalletEvidence',
        requiredControls: ['Copy address', 'Show private key', 'Copy private key'],
        requiredText: [
          'Your private key',
          'Account address',
          'Show or copy this key, then save it somewhere safe. Wren will not show it again.',
          "I've saved my key",
          'Wren clears an unchanged clipboard after 60 seconds. Clipboard history may retain it.',
          'Finish setup within about 10 minutes.',
          'Leaving now deletes this new account.'
        ],
        layoutExpectations: [GENERATED_EXPIRY_COLOR]
      },
      {
        id: `dash-account-verify-phrase-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'account-create-phrase',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: generatedWalletVerificationAction('phrase'),
        ready: '.generatedWalletFrame[aria-hidden="false"] .generatedWalletVerify',
        requiredText: [
          'Verify your backup',
          'Enter the requested words from your saved copy.',
          'Word 2',
          'Word 6',
          'Word 10',
          'Finish setup within about 10 minutes.',
          'Leaving now deletes this new wallet.'
        ],
        layoutExpectations: [GENERATED_EXPIRY_COLOR]
      },
      {
        id: `dash-account-verify-private-key-${geometry}-${scale}`,
        renderer: 'dash',
        state: 'account-create-private-key',
        scale,
        logicalWidth: 620,
        logicalHeight,
        action: generatedWalletVerificationAction('private-key'),
        ready: '.generatedWalletFrame[aria-hidden="false"] .generatedWalletKeyInput',
        requiredText: [
          'Verify your backup',
          'Enter the private key from your saved copy.',
          'Finish setup within about 10 minutes.',
          'Leaving now deletes this new account.'
        ],
        layoutExpectations: [GENERATED_EXPIRY_COLOR]
      }
    ])
  ),
  {
    id: 'dash-account-add-watch-full-1',
    renderer: 'dash',
    state: 'account-add-watch',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.addAccountItemSmart .addAccountItemOptionInput.address',
    requiredText: ['Watch Account', 'Follow balances and activity without adding signing access.']
  },
  {
    id: 'dash-account-add-seed-full-1',
    renderer: 'dash',
    state: 'account-add-seed',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.addAccountItemOptionInput.phrase',
    requiredText: ['Recovery phrase', 'Import an account from a recovery phrase.']
  },
  {
    id: 'dash-account-add-trezor-full-1',
    renderer: 'dash',
    state: 'account-add-trezor',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.addAccountItemDeviceArtwork',
    requiredText: ['Trezor', 'Looking for your Trezor', 'Connect and unlock your device.']
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
    ready: '.hardwareSignerPromptSurface .trezorPinInput',
    requiredControls: ['PIN position 1', 'PIN position 9', 'Not now'],
    requiredText: ['Trezor Signer', 'Enter PIN', 'scrambled matrix', '0 positions selected']
  },
  {
    id: 'dash-seed-locked-full-1',
    renderer: 'dash',
    state: 'signer-seed-locked',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.expandedSigner .signerUnlockInput',
    requiredControls: ['Signer password', 'Remove signer'],
    requiredText: ['Seed Phrase Signer', 'Enter the signer password to unlock', 'Unlock']
  },
  {
    id: 'dash-private-key-locked-full-1',
    renderer: 'dash',
    state: 'signer-ring-locked',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.expandedSigner .signerUnlockInput',
    requiredControls: ['Signer password', 'Remove signer'],
    requiredText: ['Private Key Signer', 'Enter the signer password to unlock', 'Unlock']
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
    id: 'dash-settings-contract-verification-short-1.5',
    renderer: 'dash',
    state: 'settings',
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.contractVerificationCredential',
    requiredControls: ['Etherscan API key', 'Save'],
    requiredText: [
      'Contract verification',
      'Not configured',
      'OS credential protection',
      'Use 16–128 letters, numbers, underscores, or hyphens.',
      'Not included in profile backups'
    ],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-contract-verification'
  },
  {
    id: 'dash-settings-contract-verification-unavailable-short-1.5',
    renderer: 'dash',
    state: 'settings',
    variant: 'credential-status-unavailable',
    scale: 1.5,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.contractVerificationCredentialError',
    requiredText: [
      'Contract verification',
      'Storage status unavailable',
      'Wren could not confirm OS credential protection, so it will not accept a key.',
      'Credential status unavailable.'
    ],
    captureScroll: 'target',
    captureScrollSelector: '#wren-settings-contract-verification'
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
    requiredText: ['Ethereum', 'Optimism Mainnet', 'Workshop Chain', 'Sepolia', 'Testnets']
  },
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-connected-apps-${geometry}-1`,
    renderer: 'dash',
    state: 'connected-apps',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.connectedApps .sliceOrigin',
    layoutExpectations: [
      { kind: 'full-width', selector: '.sliceOriginList', container: '.connectedApps', inset: 20 },
      { kind: 'scroll-fits', selector: '.dashMainScroll' }
    ],
    requiredControls: ['Open workshop.example app details, active · no account access'],
    requiredText: [
      'App activity',
      'Recent activity, account access, and default networks across all accounts.',
      'workshop.example',
      'Active · No account access',
      'treasury.example',
      'Inactive · Access to 1 account'
    ]
  })),
  {
    id: 'dash-connected-apps-capped-1',
    renderer: 'dash',
    state: 'connected-apps',
    scale: 1,
    logicalWidth: 530,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.connectedApps .sliceOrigin',
    layoutExpectations: [
      { kind: 'full-width', selector: '.sliceOriginList', container: '.connectedApps', inset: 12 }
    ],
    requiredControls: ['Open workshop.example app details, active · no account access'],
    requiredText: ['App activity', 'workshop.example', 'Active · No account access']
  },
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].map(([geometry, logicalHeight]) => ({
    id: `dash-connected-app-details-${geometry}-1`,
    renderer: 'dash',
    state: 'connected-apps',
    variant: 'details',
    scale: 1,
    logicalWidth: 620,
    logicalHeight,
    ready: '.connectedAppsDetails .originSwapChainList',
    layoutExpectations: [
      {
        kind: 'full-width',
        selector: '.originSwapChainList',
        container: '.connectedAppsDetails',
        inset: 20
      }
    ],
    requiredControls: ['Optimism Mainnet'],
    requiredText: [
      'workshop.example',
      'Account access',
      'Open an account in the wallet, then choose Apps with access to review or revoke this app.',
      'Default network',
      'Ethereum',
      'Optimism Mainnet'
    ]
  })),
  {
    id: 'dash-network-editor-full-1',
    renderer: 'dash',
    state: 'network-editor',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.networkEditor',
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.dashMainScroll' },
      { kind: 'scroll-fits', selector: '.localSettingsWrap' },
      { kind: 'viewport-bottom', selector: '.networkEditorFooter' }
    ],
    requiredControls: ['Cancel', 'Save changes'],
    requiredText: ['Edit Ethereum', 'RPC endpoints', 'Connected', 'Off', '2 of 5 RPC endpoints used']
  },
  {
    id: 'dash-network-editor-short-1',
    renderer: 'dash',
    state: 'network-editor',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.networkEditor',
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.localSettingsWrap' },
      { kind: 'scroll-overflows', selector: '.networkEditorBody' },
      { kind: 'viewport-bottom', selector: '.networkEditorFooter' }
    ],
    requiredControls: ['Cancel', 'Save changes'],
    requiredText: ['Edit Ethereum', 'RPC endpoints', 'Connected', 'Off', '2 of 5 RPC endpoints used']
  },
  {
    id: 'dash-network-editor-removable-short-1',
    renderer: 'dash',
    state: 'network-editor',
    variant: 'removable',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.networkEditor',
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.localSettingsWrap' },
      { kind: 'scroll-overflows', selector: '.networkEditorBody' },
      { kind: 'viewport-bottom', selector: '.networkEditorFooter' }
    ],
    requiredControls: ['Remove network', 'Cancel', 'Save changes'],
    requiredText: ['Edit Optimism Mainnet', 'RPC endpoints', 'Connected', 'Off', '2 of 5 RPC endpoints used']
  },
  {
    id: 'dash-network-add-full-1',
    renderer: 'dash',
    state: 'network-add',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.networkEditor',
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.dashMainScroll' },
      { kind: 'scroll-fits', selector: '.localSettingsWrap' },
      { kind: 'viewport-bottom', selector: '.networkEditorFooter' }
    ],
    requiredControls: ['Cancel', 'Add network'],
    requiredText: ['Add Base Mainnet', 'RPC endpoints', 'Not checked', '1 of 5 RPC endpoints used']
  },
  {
    id: 'dash-network-add-short-1',
    renderer: 'dash',
    state: 'network-add',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.networkEditor',
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.localSettingsWrap' },
      { kind: 'scroll-fits', selector: '.networkEditorBody' },
      { kind: 'viewport-bottom', selector: '.networkEditorFooter' }
    ],
    requiredControls: ['Cancel', 'Add network'],
    requiredText: ['Add Base Mainnet', 'RPC endpoints', 'Not checked', '1 of 5 RPC endpoints used']
  },
  {
    id: 'dash-network-add-overflow-short-1',
    renderer: 'dash',
    state: 'network-add',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.networkEditor',
    action: {
      type: 'sequence',
      delayMs: 20,
      steps: Array.from({ length: 4 }, () => ({ type: 'clickText', text: 'Add RPC endpoint' }))
    },
    captureScroll: 'bottom',
    captureScrollSelector: '.networkEditorBody',
    layoutExpectations: [
      { kind: 'scroll-fits', selector: '.localSettingsWrap' },
      { kind: 'scroll-overflows', selector: '.networkEditorBody' },
      { kind: 'viewport-bottom', selector: '.networkEditorFooter' }
    ],
    requiredControls: ['Cancel', 'Add network'],
    requiredText: ['Add Base Mainnet', 'RPC endpoints', '5 of 5 RPC endpoints used', 'Test network']
  },
  {
    id: 'tray-account-startup-full-1',
    renderer: 'tray',
    state: 'account-startup',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.accountSelectorWelcome',
    requiredControls: ['Open dashboard'],
    requiredText: ['Choose an account', 'Choose an account to open your wallet.', 'Trezor Account']
  },
  {
    id: 'tray-account-ledger-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    balanceArtwork: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.settingsPreviewActions',
    requiredText: [
      'Ethereum',
      'Balances',
      'Yearn WETH',
      'Activity',
      'Apps with access',
      'Signer',
      'Remove account'
    ]
  },
  {
    id: 'tray-account-gas-expanded-switched-full-1',
    renderer: 'tray',
    state: 'account-home',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: {
      type: 'sequence',
      steps: [
        { type: 'clickText', text: 'Show gas details for Ethereum' },
        { type: 'clickText', text: 'Next network from Ethereum' }
      ]
    },
    ready: '.gasDetails',
    requiredControls: ['Hide gas details for Optimism Mainnet'],
    requiredText: ['Optimism Mainnet', 'Next base fee', 'Priority fee']
  },
  {
    id: 'tray-account-chain-fallback-narrow-1',
    renderer: 'tray',
    state: 'account-home',
    scale: 1,
    logicalWidth: 520,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.chainMonitorPreview',
    requiredControls: [
      'Previous network from Ethereum',
      'Next network from Ethereum',
      'View Ethereum account on block explorer',
      'Show gas details for Ethereum'
    ],
    requiredText: ['Ethereum', '2', 'gwei', 'Details']
  },
  {
    id: 'tray-account-requests-summary-full-1',
    renderer: 'tray',
    state: 'account-requests-summary',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestPreviewContentMeta',
    requiredControls: ['Requests. 3 active. 1 pending. 2 confirming.'],
    requiredText: ['Requests (3)', '1 pending · 2 confirming']
  },
  {
    id: 'tray-account-requests-list-full-1',
    renderer: 'tray',
    state: 'account-requests-list',
    glideSide: 'left',
    workspaceOpen: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestClearAll',
    requiredControls: ['Back', 'Clear all requests'],
    requiredText: ['Requests', '3 requests', 'Clear all', 'workshop.example', 'garden.example'],
    layoutExpectations: [{ kind: 'hidden', selector: '.accountSelectorOpen' }]
  },
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].flatMap(([geometry, logicalHeight]) => [
    {
      id: `tray-account-signing-queue-${geometry}-1`,
      renderer: 'tray',
      state: 'account-signing-queue',
      scale: 1,
      logicalWidth: 620,
      logicalHeight,
      ready: '.requestQueueStatus',
      requiredControls: ['Back', 'Clear all requests'],
      requiredText: [
        '3 pending signatures · oldest first',
        'Current · 1 of 3',
        'Queued · 2 of 3',
        'Queued · 3 of 3'
      ],
      layoutExpectations: [{ kind: 'hidden', selector: '.accountSelectorOpen' }]
    },
    {
      id: `tray-transaction-signing-queue-review-${geometry}-1`,
      renderer: 'tray',
      state: 'transaction-signing-queue-review',
      scale: 1,
      logicalWidth: 620,
      logicalHeight,
      ready: '.transactionReviewQueueContext',
      requiredText: ['3 pending signatures', 'Current request 1 of 3 · oldest pending'],
      layoutExpectations: [{ kind: 'hidden', selector: '.accountSelectorOpen' }]
    }
  ]),
  ...[
    ['full', FULL_SHELL_HEIGHT],
    ['short', SHORT_SHELL_HEIGHT]
  ].flatMap(([geometry, logicalHeight]) =>
    RPC_WARNING_SCENARIOS.map(({ variant, title, message, confirmLabel }) => ({
      id: `tray-rpc-warning-${variant}-${geometry}-1`,
      renderer: 'tray',
      state: 'transaction-rpc-warning',
      variant,
      scale: 1,
      logicalWidth: 620,
      logicalHeight,
      ready: '.approveTransactionWarning',
      requiredControls: ['Decline', confirmLabel],
      requiredText: [title, message],
      layoutExpectations: [
        { kind: 'hidden', selector: '.accountSelectorOpen' },
        { kind: 'viewport-bottom', selector: '.requestNoticeApproval' }
      ]
    }))
  ),
  {
    id: 'tray-rpc-warning-revert-hover-full-1',
    renderer: 'tray',
    state: 'transaction-rpc-warning',
    variant: 'revert',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.approveTransactionWarning',
    action: { type: 'hoverText', text: 'Sign Anyway' },
    requiredControls: ['Decline', 'Sign Anyway'],
    requiredText: ['RPC Reports Revert', 'Your configured RPC reports that this transaction will revert.'],
    layoutExpectations: [{ kind: 'viewport-bottom', selector: '.requestNoticeApproval' }]
  },
  {
    id: 'tray-rpc-warning-revert-confirmed-full-1',
    renderer: 'tray',
    state: 'transaction-rpc-warning',
    variant: 'revert',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.requestApproveTransaction',
    action: {
      type: 'confirmRequestWarning',
      text: 'Sign Anyway',
      requestId: 'qualification-rpc-warning-revert'
    },
    requiredText: [
      'Ready for review',
      'Verify on your signer before approving.',
      'Decline',
      'Sign transaction'
    ],
    layoutExpectations: [
      { kind: 'viewport-bottom', selector: '.requestNoticeTransactionReview' },
      {
        kind: 'computed-style',
        selector: '.requestNoticeTransactionReview',
        property: 'animationName',
        value: 'none'
      },
      {
        kind: 'computed-style',
        selector: '.requestApproveTransaction',
        property: 'animationName',
        value: 'none'
      },
      {
        kind: 'computed-style',
        selector: '.footerModule',
        property: 'transitionDuration',
        value: '0s'
      },
      {
        kind: 'computed-style',
        selector: '.accountViewRequest',
        property: 'transitionDuration',
        value: '0s'
      },
      {
        kind: 'computed-style',
        selector: '.requestApproveTransaction .requestDeclineButton',
        property: 'color',
        value: 'rgb(242, 244, 239)'
      }
    ]
  },
  {
    id: 'tray-transaction-safety-unavailable-short-1',
    renderer: 'tray',
    state: 'transaction-safety-unavailable',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: SHORT_SHELL_HEIGHT,
    ready: '.requestApproveRecoverable',
    requiredControls: ['Close request', 'Recheck'],
    requiredText: [
      'Safety check unavailable',
      'The safety check could not be repeated. Nothing was signed or sent.'
    ]
  },
  {
    id: 'tray-account-activity-full-1',
    renderer: 'tray',
    state: 'account-activity',
    glideSide: 'left',
    workspaceOpen: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.activityModuleExpanded',
    requiredControls: ['Back', 'All', 'Transactions', 'Signatures', 'Connections', 'Clear activity'],
    requiredText: ['Transaction', 'Typed-data signature', 'Account access', 'Ethereum'],
    layoutExpectations: [{ kind: 'hidden', selector: '.accountSelectorOpen' }]
  },
  {
    id: 'tray-account-activity-clear-full-1',
    renderer: 'tray',
    state: 'account-activity',
    scale: 1,
    logicalWidth: 620,
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
    logicalWidth: 620,
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
    logicalWidth: 620,
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
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.settingsPreviewActions',
    requiredControls: ['View all activity'],
    requiredText: ['Apps with access', 'Signer', 'Remove account'],
    captureScroll: 'bottom',
    captureScrollSelector: '.accountMainScroll'
  },
  {
    id: 'tray-account-ledger-no-requests-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    requestsAbsent: true,
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    ready: '.settingsPreviewActions',
    requiredText: ['Ethereum', 'Balances', 'Apps with access']
  },
  {
    id: 'tray-account-removal-confirm-full-1',
    renderer: 'tray',
    state: 'account-ledger',
    scale: 1,
    logicalWidth: 620,
    logicalHeight: FULL_SHELL_HEIGHT,
    action: { type: 'clickText', text: 'Remove account' },
    ready: '[role="alertdialog"]',
    requiredText: ['Remove Workshop Software Account With A Long Name?', 'Cancel', 'Confirm removal'],
    captureScroll: 'bottom',
    captureScrollSelector: '.accountMainScroll'
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
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.accountSelectorEmpty'
      },
      {
        id: `tray-empty-short-${scale}`,
        renderer: 'tray',
        state: 'empty',
        scale,
        logicalWidth: 620,
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
        layoutExpectations: [
          { kind: 'size', selector: '.dashHomeWren', width: 96, height: 96 },
          { kind: 'scroll-fits', selector: '.dashMainScroll' }
        ]
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
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.chainMonitorPreview',
        requiredControls: [
          'Previous network from Ethereum',
          'Next network from Ethereum',
          'View Ethereum account on block explorer',
          'Show gas details for Ethereum'
        ],
        requiredText: ['Ethereum', '2', 'gwei', 'Details']
      },
      {
        id: `tray-account-home-short-${scale}`,
        renderer: 'tray',
        state: 'account-home',
        scale,
        logicalWidth: 620,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.chainMonitorPreview',
        requiredControls: [
          'Previous network from Ethereum',
          'Next network from Ethereum',
          'View Ethereum account on block explorer',
          'Show gas details for Ethereum'
        ],
        requiredText: ['Ethereum', '2', 'gwei', 'Details']
      },
      ...[
        ['full', FULL_SHELL_HEIGHT],
        ['short', SHORT_SHELL_HEIGHT]
      ].map(([geometry, logicalHeight]) => ({
        id: `tray-account-balances-${geometry}-${scale}`,
        renderer: 'tray',
        state: 'account-balances',
        balanceArtwork: true,
        glideSide: 'left',
        workspaceOpen: true,
        scale,
        logicalWidth: 620,
        logicalHeight,
        ready: '.accountLedgerView',
        requiredControls: ['Back', 'Filter balances', 'Add token'],
        requiredText: ['Balances', 'Ether', 'Workshop token', 'Yearn WETH', 'Total'],
        layoutExpectations: [
          { kind: 'hidden', selector: '.accountSelectorOpen' },
          { kind: 'hidden', selector: '.balancesExpandedScroll > ._txMain' },
          { kind: 'size', selector: '.balancesAssetMark .assetMarkChain', width: 12, height: 12 },
          { kind: 'size', selector: '.balanceFilter .panelFilterIcon > svg', width: 15, height: 15 },
          {
            kind: 'computed-style',
            selector: '.balancesAssetMark .assetMarkGlyph',
            property: 'borderTopColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          {
            kind: 'computed-style',
            selector: '.balancesAssetMark .assetMarkGlyph',
            property: 'backgroundColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          ...(geometry === 'short' ? [{ kind: 'scroll-fits', selector: '.balancesExpandedScroll' }] : [])
        ]
      })),
      {
        id: `tray-transaction-confirming-full-${scale}`,
        renderer: 'tray',
        state: 'transaction-confirming',
        scale,
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.txLifecycle',
        requiredControls: ['View details'],
        requiredText: ['Confirming', 'Transaction hash', 'Confirmations', '4'],
        layoutExpectations: [{ kind: 'size', selector: '.txLifecycleStepMarker', width: 8, height: 8 }]
      },
      {
        id: `tray-transaction-confirmed-full-${scale}`,
        renderer: 'tray',
        state: 'transaction-confirmed',
        scale,
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.txLifecycle-success',
        requiredControls: ['View details', 'Close'],
        requiredText: ['Confirmed', 'Transaction hash', 'Confirmations', '13'],
        layoutExpectations: [{ kind: 'size', selector: '.txLifecycleStepMarker', width: 8, height: 8 }]
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
        requiredControls: ['Add token'],
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
        requiredControls: ['Add token'],
        requiredText: ['No custom tokens']
      },
      {
        id: `dash-tokens-list-full-${scale}`,
        renderer: 'dash',
        state: 'tokens-list',
        scale,
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.customTokensListItem',
        requiredControls: ['Add token', 'Expand yvWETH-1 token on chain 1'],
        requiredText: ['Yearn Wrapped Ether', 'yvWETH-1'],
        layoutExpectations: [
          { kind: 'size', selector: '.customTokensAssetMark .assetMarkGlyph', width: 30, height: 30 },
          {
            kind: 'computed-style',
            selector: '.customTokensAssetMark .assetMarkGlyph',
            property: 'borderTopColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          {
            kind: 'computed-style',
            selector: '.customTokensAssetMark .assetMarkGlyph',
            property: 'backgroundColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          { kind: 'size', selector: '.customTokensListItemExpand', width: 44, height: 44 }
        ]
      },
      {
        id: `dash-tokens-list-short-${scale}`,
        renderer: 'dash',
        state: 'tokens-list',
        scale,
        logicalWidth: 620,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.customTokensListItem',
        requiredControls: ['Add token', 'Expand yvWETH-1 token on chain 1'],
        requiredText: ['Yearn Wrapped Ether', 'yvWETH-1'],
        layoutExpectations: [
          { kind: 'size', selector: '.customTokensAssetMark .assetMarkGlyph', width: 30, height: 30 },
          {
            kind: 'computed-style',
            selector: '.customTokensAssetMark .assetMarkGlyph',
            property: 'borderTopColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          {
            kind: 'computed-style',
            selector: '.customTokensAssetMark .assetMarkGlyph',
            property: 'backgroundColor',
            value: 'rgba(0, 0, 0, 0)'
          },
          { kind: 'size', selector: '.customTokensListItemExpand', width: 44, height: 44 }
        ]
      },
      {
        id: `tray-revocation-review-full-${scale}`,
        renderer: 'tray',
        state: 'revocation-review',
        scale,
        logicalWidth: 620,
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
        logicalWidth: 620,
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
        logicalWidth: 620,
        logicalHeight: FULL_SHELL_HEIGHT,
        ready: '.eip7702StopMonitoringDialog',
        action: { type: 'clickText', text: 'Stop monitoring' },
        expectedInitialFocus: 'Keep monitoring',
        requiredControls: ['Keep monitoring', 'Stop monitoring'],
        requiredText: ['Submission status unclear', 'cannot cancel a transaction']
      },
      {
        id: `tray-revocation-monitor-short-${scale}`,
        renderer: 'tray',
        state: 'revocation-monitor',
        scale,
        logicalWidth: 620,
        logicalHeight: SHORT_SHELL_HEIGHT,
        ready: '.eip7702StopMonitoringDialog',
        action: { type: 'clickText', text: 'Stop monitoring' },
        expectedInitialFocus: 'Keep monitoring',
        requiredControls: ['Keep monitoring', 'Stop monitoring'],
        requiredText: ['Submission status unclear', 'cannot cancel a transaction']
      },
      {
        id: `onboard-intro-${scale}`,
        renderer: 'onboard',
        state: 'intro',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: 'button',
        requiredControls: ['Get started'],
        requiredText: ['Meet Wren']
      },
      {
        id: `onboard-access-${scale}`,
        renderer: 'onboard',
        state: 'access',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: { type: 'clickText', text: 'Get started' },
        requiredControls: ['Back', 'Skip shortcut'],
        requiredText: ['Open Wren quickly']
      },
      {
        id: `onboard-networks-${scale}`,
        renderer: 'onboard',
        state: 'onboarding-networks',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: onboardingAction(0),
        requiredControls: ['Back', 'Next'],
        requiredText: ['Choose your networks']
      },
      {
        id: `onboard-context-${scale}`,
        renderer: 'onboard',
        state: 'onboarding-context',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: onboardingAction(1),
        requiredControls: ['Back', 'Next'],
        requiredText: ['Use the right network']
      },
      {
        id: `onboard-accounts-${scale}`,
        renderer: 'onboard',
        state: 'onboarding-accounts',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: onboardingAction(2),
        requiredControls: ['Back', 'Next'],
        requiredText: ['Add your accounts']
      },
      {
        id: `onboard-companion-${scale}`,
        renderer: 'onboard',
        state: 'onboarding-companion',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: onboardingAction(3),
        requiredControls: ['Chrome', 'Firefox', 'Back', 'Next'],
        requiredText: ['Connect browser dapps']
      },
      {
        id: `onboard-dapp-network-${scale}`,
        renderer: 'onboard',
        state: 'onboarding-dapp-network',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: onboardingAction(4),
        requiredControls: ['Back', 'Next'],
        requiredText: ['Check the dapp network']
      },
      {
        id: `onboard-ready-${scale}`,
        renderer: 'onboard',
        state: 'onboarding-ready',
        scale,
        logicalWidth: 720,
        logicalHeight: 405,
        ready: '[aria-labelledby="onboarding-slide-title"]',
        action: onboardingAction(5),
        requiredControls: ['Back', 'Open Wren'],
        requiredText: ['Ready to begin']
      }
    ]),
    {
      id: 'dash-contract-verification-evidence-capped-1.5',
      renderer: 'dash',
      state: 'contract-verification',
      scale: 1.5,
      logicalWidth: 530,
      logicalHeight: SHORT_SHELL_HEIGHT,
      action: {
        type: 'sequence',
        steps: [
          { type: 'selectLabel', label: 'Network', value: '10' },
          {
            type: 'inputLabel',
            label: 'Contract address',
            value: '0x6666666666666666666666666666666666666666'
          },
          { type: 'clickText', text: 'Choose artifact' },
          { type: 'clickText', text: 'Check source' },
          { type: 'clickCheckboxText', text: 'possible forwarding' }
        ]
      },
      ready: '.contractVerificationPublication',
      captureScroll: 'target',
      captureScrollSelector: '.contractVerificationPublication',
      requiredControls: ['Edit and recheck', 'Publish source'],
      requiredText: ['Sourcify may forward them to Etherscan, Blockscout, or Routescan', 'Matched locally'],
      layoutExpectations: [
        { kind: 'stacked', selector: '.contractVerificationLedgerRow' },
        {
          kind: 'full-width',
          selector: '.contractVerificationActionShelf button',
          container: '.contractVerificationActionShelf',
          inset: 0
        }
      ]
    },
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
  const defaultScenarios = [
    ...scenarios,
    ...accountAccessReviewScenarios(),
    ...switchChainReviewScenarios(),
    ...sendComposerScenarios().filter(({ state }) => state === 'send-asset-picker')
  ]
  return includeReview ? [...defaultScenarios, ...reviewScenarios()] : defaultScenarios
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
