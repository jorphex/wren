import {
  assertRendererInvokeResultSchema,
  assertRendererIpcSchema,
  parseRendererIpcArgs,
  parseRendererInvokeResult
} from '../../../main/ipc/schemas'

const address = '0x0000000000000000000000000000000000000001'
const handlerId = '8073729a-5e59-53b7-9e69-5d9bcff94087'

const parse = (method: 'event' | 'invoke', channel: string, args: unknown[]) => {
  const result = parseRendererIpcArgs(method, channel, args)
  if (!result.success) throw result.error
  return result.data
}

test('requires an explicit schema for every registered channel', () => {
  expect(() => assertRendererIpcSchema('event', 'missing')).toThrow(
    'Renderer IPC channel has no event schema: missing'
  )
  expect(() => assertRendererIpcSchema('invoke', 'missing')).toThrow(
    'Renderer IPC channel has no invoke schema: missing'
  )
})

test('enforces exact event tuple arity and Ethereum values', () => {
  expect(parseRendererIpcArgs('event', 'tray:copyTxHash', [`0x${'a'.repeat(64)}`]).success).toBe(true)
  expect(parseRendererIpcArgs('event', 'tray:copyTxHash', ['0x1']).success).toBe(false)
  expect(parseRendererIpcArgs('event', 'tray:copyTxHash', [`0x${'a'.repeat(64)}`, 'extra']).success).toBe(
    false
  )
  expect(parseRendererIpcArgs('event', 'tray:renameAccount', [address, 'Account']).success).toBe(true)
  expect(parseRendererIpcArgs('event', 'tray:renameAccount', ['0x1', 'Account']).success).toBe(false)
})

test('does not coerce chain or token identifiers', () => {
  expect(parseRendererIpcArgs('invoke', 'tray:getTokenDetails', [address, 1]).success).toBe(true)
  expect(parseRendererIpcArgs('invoke', 'tray:getTokenDetails', [address, '1']).success).toBe(false)
  expect(parseRendererIpcArgs('event', 'tray:removeToken', [{ address, chainId: '1' }]).success).toBe(false)
})

test('strictly validates acknowledged custom-token saves and results', () => {
  const token = {
    address,
    chainId: 1,
    name: 'Test token',
    symbol: 'TEST',
    decimals: 6,
    logoURI: ''
  }
  const requestReference = { account: address, handlerId }

  expect(parse('invoke', 'tokens:save', [token, requestReference])).toEqual([token, requestReference])
  expect(parseRendererIpcArgs('invoke', 'tokens:save', [{ ...token, chainId: '1' }]).success).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'tokens:save', [{ ...token, unexpected: true }]).success).toBe(false)
  expect(parseRendererInvokeResult('tokens:save', { success: true }).success).toBe(true)
  expect(
    parseRendererInvokeResult('tokens:save', { success: false, error: 'Token could not be saved' }).success
  ).toBe(true)
  expect(parseRendererInvokeResult('tokens:save', { success: false }).success).toBe(false)
})

test('strictly validates bounded wallet-call adjustments and results', () => {
  const request = {
    account: address,
    handlerId,
    adjustment: {
      startingNonce: '0x9',
      calls: [{ gasLimit: '0x6000', maxFeePerGas: '0x20', maxPriorityFeePerGas: '0x2' }]
    }
  }
  expect(parse('invoke', 'tray:adjustWalletCalls', [request])).toEqual([request])
  expect(
    parseRendererIpcArgs('invoke', 'tray:adjustWalletCalls', [
      {
        ...request,
        adjustment: {
          ...request.adjustment,
          calls: [...request.adjustment.calls, ...Array(16).fill(request.adjustment.calls[0])]
        }
      }
    ]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'tray:adjustWalletCalls', [
      {
        ...request,
        adjustment: {
          startingNonce: '0x09',
          calls: request.adjustment.calls
        }
      }
    ]).success
  ).toBe(false)
  expect(parseRendererInvokeResult('tray:adjustWalletCalls', { success: true }).success).toBe(true)
  expect(
    parseRendererInvokeResult('tray:adjustWalletCalls', { success: false, error: 'Request changed' }).success
  ).toBe(true)
})

test('strictly validates read-only wallet-call status refreshes and results', () => {
  const request = { account: address, id: 'batch-id', origin: 'example.test' }

  expect(parse('invoke', 'tray:refreshWalletCallsStatus', [request])).toEqual([request])
  expect(
    parseRendererIpcArgs('invoke', 'tray:refreshWalletCallsStatus', [{ ...request, account: '0x1' }]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'tray:refreshWalletCallsStatus', [{ ...request, resubmit: true }]).success
  ).toBe(false)
  expect(parseRendererInvokeResult('tray:refreshWalletCallsStatus', { success: true }).success).toBe(true)
})

test('validates address-book mutations and bounded results', () => {
  const request = { mode: 'add', address, name: 'Treasury', note: 'Operations' }
  const entry = { address, name: 'Treasury', note: 'Operations', createdAt: 1, updatedAt: 1 }
  expect(parse('invoke', 'addressBook:save', [request])).toEqual([request])
  expect(parseRendererIpcArgs('invoke', 'addressBook:save', [{ ...request, address: '0x1' }]).success).toBe(
    false
  )
  expect(parseRendererInvokeResult('addressBook:save', { success: true, entry }).success).toBe(true)
  expect(parseRendererInvokeResult('addressBook:save', { success: true, entry: jest.fn() }).success).toBe(
    false
  )
  expect(
    parseRendererInvokeResult('addressBook:import', { success: true, imported: 2, skipped: 1 }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('addressBook:export', {
      success: true,
      exported: 1,
      path: '/tmp/private.json'
    }).success
  ).toBe(false)
})

test('strictly bounds native Send requests and results', () => {
  const recipient = '0x0000000000000000000000000000000000000002'
  const draft = {
    account: address,
    amount: '0.25',
    assetAddress: '0x0000000000000000000000000000000000000000',
    chainId: 1,
    recipient
  }

  expect(parse('invoke', 'send:queue', [draft])).toEqual([draft])
  expect(parseRendererIpcArgs('invoke', 'send:queue', [{ ...draft, amount: '1e18' }]).success).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'send:queue', [{ ...draft, data: '0x' }]).success).toBe(false)
  expect(parse('invoke', 'send:maxAmount', [1, draft.assetAddress, draft.recipient])).toEqual([
    1,
    draft.assetAddress,
    draft.recipient
  ])
  expect(parse('invoke', 'send:resolveRecipient', ['name.eth'])).toEqual(['name.eth'])
  expect(parseRendererIpcArgs('invoke', 'send:resolveRecipient', ['x'.repeat(256)]).success).toBe(false)

  expect(
    parseRendererInvokeResult('send:resolveRecipient', {
      success: true,
      address: recipient,
      name: 'name.eth'
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('send:maxAmount', { success: true, amount: '1000000000000000000' }).success
  ).toBe(true)
  expect(parseRendererInvokeResult('send:queue', { success: true, handlerId: 'send-request' }).success).toBe(
    true
  )
})

test('requires explicit Yearn catalog options and validates returned metadata', () => {
  expect(parse('invoke', 'yearn:getCatalog', [{ force: false }])).toEqual([{ force: false }])
  expect(parseRendererIpcArgs('invoke', 'yearn:getCatalog', [{}]).success).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'yearn:getCatalog', [{ force: false, endpoint: 'https://evil.test' }])
      .success
  ).toBe(false)

  const unavailableVault = {
    id: 'ethereum-yvusd',
    chainId: 1,
    chainName: 'Ethereum',
    address,
    kind: 'yvUSD',
    name: 'yvUSD',
    symbol: 'N/A',
    description: 'Unavailable during this test.',
    asset: { address, name: 'Unavailable', symbol: 'N/A', decimals: 18 },
    decimals: 18,
    tvlUsd: 0,
    apy: { value: null, label: 'Unavailable', source: 'unavailable' },
    riskLevel: null,
    riskLabel: 'Unrated',
    performanceFeeBps: 0,
    managementFeeBps: 0,
    inceptionTime: null,
    yearnUrl: `https://yearn.fi/vaults/1/${address}`,
    status: 'unavailable',
    statusReason: 'Kong is unavailable',
    variants: [
      {
        id: 'unlocked',
        address,
        name: 'yvUSD',
        symbol: 'N/A',
        asset: { address, name: 'Unavailable', symbol: 'N/A', decimals: 18 },
        decimals: 18,
        tvlUsd: 0,
        apy: { value: null, label: 'Unavailable', source: 'unavailable' }
      }
    ]
  }

  expect(
    parseRendererInvokeResult('yearn:getCatalog', {
      status: 'unavailable',
      fetchedAt: null,
      vaults: [unavailableVault],
      errors: [{ chainId: 1, message: 'Kong is unavailable' }]
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('yearn:getCatalog', {
      status: 'unavailable',
      fetchedAt: null,
      vaults: [{ ...unavailableVault, chainId: 10 }],
      errors: []
    }).success
  ).toBe(false)
})

test('bounds Yearn position requests and results', () => {
  expect(parse('invoke', 'yearn:getPositions', [])).toEqual([])
  expect(parseRendererIpcArgs('invoke', 'yearn:getPositions', [{}]).success).toBe(false)
  expect(
    parseRendererInvokeResult('yearn:getPositions', {
      account: null,
      chains: [1, 8453, 747474].map((chainId) => ({
        chainId,
        status: 'no-account',
        reason: 'Select an account',
        positions: []
      }))
    }).success
  ).toBe(true)
})

test('validates Yearn workflow commands and returned persistent state', () => {
  const workflowId = '00000000-0000-4000-8000-000000000001'
  const stepId = '00000000-0000-4000-8000-000000000002'
  const request = {
    vaultId: 'base-yvusdc-h',
    action: 'deposit',
    variant: 'direct',
    amount: '12.5',
    max: false
  }
  const workflow = {
    policyVersion: 1,
    id: workflowId,
    account: address,
    vaultId: request.vaultId,
    chainId: 8453,
    action: request.action,
    variant: request.variant,
    amountRaw: '12500000',
    displayAmount: request.amount,
    symbol: 'USDC',
    max: false,
    maxLossBps: 0,
    status: 'active',
    steps: [
      {
        id: stepId,
        kind: 'deposit',
        label: 'Deposit into Yearn',
        target: address,
        data: '0x12345678',
        amountRaw: '12500000',
        status: 'awaiting-review'
      }
    ],
    currentStep: 0,
    createdAt: 1,
    updatedAt: 2
  }

  expect(parse('invoke', 'yearn:startWorkflow', [request])).toEqual([request])
  expect(
    parseRendererIpcArgs('invoke', 'yearn:startWorkflow', [{ ...request, target: address }]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'yearn:startWorkflow', [{ ...request, amount: '1e18' }]).success
  ).toBe(false)
  expect(parse('invoke', 'yearn:resumeWorkflow', [{ id: workflowId }])).toEqual([{ id: workflowId }])
  expect(parseRendererIpcArgs('invoke', 'yearn:resumeWorkflow', [{ id: 'not-a-uuid' }]).success).toBe(false)

  expect(parseRendererInvokeResult('yearn:startWorkflow', { success: true, workflow }).success).toBe(true)
  expect(
    parseRendererInvokeResult('yearn:startWorkflow', {
      success: true,
      workflow: { ...workflow, maxLossBps: 1 }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('yearn:startWorkflow', {
      success: true,
      workflow: { ...workflow, cleanupRecovery: 'unknown-outcome' }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('yearn:startWorkflow', {
      success: true,
      workflow: {
        ...workflow,
        action: 'revoke',
        amountRaw: '0',
        displayAmount: '0',
        status: 'canceled',
        cleanupRecovery: 'unknown-outcome',
        steps: [
          {
            ...workflow.steps[0],
            kind: 'revoke',
            amountRaw: '1',
            status: 'error',
            approvalToken: address,
            approvalSpender: address
          }
        ]
      }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('yearn:getWorkflows', {
      workflows: Array.from({ length: 65 }, (_, index) => ({
        ...workflow,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      }))
    }).success
  ).toBe(false)
})

test('keeps only trusted request reference fields', () => {
  expect(
    parse('event', 'tray:rejectRequest', [
      { handlerId, account: address, data: { value: 'renderer snapshot' }, locked: true }
    ])
  ).toEqual([{ account: address, handlerId }])

  expect(
    parse('event', 'tray:addToken', [
      false,
      { account: address, handlerId, data: { value: 'renderer snapshot' }, locked: true }
    ])
  ).toEqual([false, { account: address, handlerId }])

  expect(
    parse('event', 'tray:giveAccess', [
      { type: 'access', handlerId, origin: 'example.test', account: address, provider: true },
      true
    ])
  ).toEqual([{ type: 'access', handlerId, origin: 'example.test', account: address }, true])

  for (const [channel, trailingArgs] of [
    ['tray:adjustNonce', [-1]],
    ['tray:replaceTx', ['speed']],
    ['tray:resetNonce', []]
  ] as const) {
    expect(
      parse('event', channel, [
        { handlerId, account: address, data: { value: 'renderer snapshot' }, locked: true },
        ...trailingArgs
      ])
    ).toEqual([{ account: address, handlerId }, ...trailingArgs])
    expect(parseRendererIpcArgs('event', channel, [{ handlerId }, ...trailingArgs]).success).toBe(false)
  }
})

test('allows partial navigation updates but bounds their data', () => {
  const requestCrumb = {
    view: 'requestView',
    data: { step: 'confirm', accountId: address, requestId: handlerId }
  }

  expect(parse('event', 'nav:forward', ['panel', requestCrumb])).toEqual(['panel', requestCrumb])
  expect(parse('event', 'nav:update', ['panel', { data: { step: 'viewData' } }])).toEqual([
    'panel',
    { data: { step: 'viewData' } }
  ])
  expect(parseRendererIpcArgs('event', 'nav:forward', ['panel', { data: {} }]).success).toBe(false)
  expect(
    parseRendererIpcArgs('event', 'nav:update', ['panel', { data: { value: 'x'.repeat(256 * 1024) } }])
      .success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('event', 'nav:forward', [
      'dash',
      { view: 'accounts', data: { newAccountType: 'seed', accountData: { secret: 'sensitive value' } } }
    ]).success
  ).toBe(false)
  expect(parseRendererIpcArgs('event', 'nav:update', ['dash', { data: { accountData: {} } }]).success).toBe(
    false
  )
})

test('dispatches only recognized store actions with validated arguments', () => {
  expect(
    parse('event', 'tray:action', ['removeNetwork', { type: 'ethereum', id: 10, name: 'ignored' }])
  ).toEqual(['removeNetwork', { type: 'ethereum', id: 10 }])
  expect(parseRendererIpcArgs('event', 'tray:action', ['unknownAction']).success).toBe(false)
  expect(parseRendererIpcArgs('event', 'tray:action', ['setColorway', 'purple']).success).toBe(false)
  expect(parseRendererIpcArgs('event', 'tray:action', ['setColorway', 'light']).success).toBe(false)
  expect(parse('event', 'tray:action', ['setGlideSide', 'left'])).toEqual(['setGlideSide', 'left'])
  expect(parseRendererIpcArgs('event', 'tray:action', ['setGlideSide', 'top']).success).toBe(false)
  expect(parse('event', 'tray:action', ['setInterfaceScale', 1.25])).toEqual(['setInterfaceScale', 1.25])
  expect(parseRendererIpcArgs('event', 'tray:action', ['setInterfaceScale', 2]).success).toBe(false)
  expect(parse('event', 'tray:action', ['toggleAccess', address, handlerId, true])).toEqual([
    'toggleAccess',
    address,
    handlerId,
    true
  ])
  expect(parseRendererIpcArgs('event', 'tray:action', ['toggleAccess', address, handlerId]).success).toBe(
    false
  )
})

test('validates native currency decimals in network updates', () => {
  const existing = {
    type: 'ethereum',
    id: 10,
    name: 'Optimism',
    explorer: 'https://optimistic.etherscan.io',
    symbol: 'ETH',
    isTestnet: false,
    primaryColor: 'accent2'
  }
  const updated = {
    ...existing,
    icon: '',
    nativeCurrencyIcon: '',
    nativeCurrencyName: 'Ether',
    nativeCurrencyDecimals: 18
  }

  expect(parse('event', 'tray:action', ['updateNetwork', existing, updated])).toEqual([
    'updateNetwork',
    existing,
    updated
  ])
  expect(
    parseRendererIpcArgs('event', 'tray:action', [
      'updateNetwork',
      existing,
      { ...updated, nativeCurrencyDecimals: 256 }
    ]).success
  ).toBe(false)
})

test('validates complete add-chain invokes and strips their request reference', () => {
  const chain = {
    type: 'ethereum',
    id: 10,
    name: 'Optimism',
    explorer: 'https://optimistic.etherscan.io',
    symbol: 'ETH',
    isTestnet: false,
    primaryColor: 'accent2',
    icon: '',
    nativeCurrencyIcon: '',
    nativeCurrencyName: 'Ether',
    rpcUrls: ['https://mainnet.optimism.io'],
    nativeCurrencyDecimals: 18
  }

  expect(parse('invoke', 'tray:addChain', [chain, { handlerId, account: address, ignored: true }])).toEqual([
    chain,
    { handlerId, account: address }
  ])
  expect(parseRendererIpcArgs('invoke', 'tray:addChain', [{ ...chain, id: '10' }]).success).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'tray:addChain', [{ ...chain, unexpected: true }]).success).toBe(
    false
  )
})

test('validates exact invoke result shapes', () => {
  expect(parseRendererInvokeResult('tray:addChain', { success: true }).success).toBe(true)
  expect(
    parseRendererInvokeResult('tray:addChain', { success: false, error: 'Could not add chain' }).success
  ).toBe(true)
  expect(parseRendererInvokeResult('tray:addChain', { success: true, error: 'ignored' }).success).toBe(false)

  expect(
    parseRendererInvokeResult('tray:getTokenDetails', {
      decimals: 18,
      name: 'Token',
      symbol: 'TKN',
      totalSupply: '1000000'
    }).success
  ).toBe(true)
  expect(parseRendererInvokeResult('tray:getTokenDetails', {}).success).toBe(true)
  expect(parseRendererInvokeResult('tray:getTokenDetails', { totalSupply: '-1' }).success).toBe(false)
  expect(() => parseRendererInvokeResult('missing', {})).toThrow(
    'Renderer IPC channel has no invoke result schema: missing'
  )
  expect(() => assertRendererInvokeResultSchema('missing')).toThrow(
    'Renderer IPC channel has no invoke result schema: missing'
  )
})

test('reduces explorer snapshots to the selected chain identity', () => {
  expect(
    parse('event', 'tray:openExplorer', [
      { id: 1, type: 'ethereum', name: 'Mainnet', connection: { endpoints: [] } },
      null,
      address
    ])
  ).toEqual([{ id: 1, type: 'ethereum' }, null, address])
})

test('rejects unsafe and oversized nested navigation collections', () => {
  const unsafe = JSON.parse('{"constructor":{"polluted":true}}')
  expect(parseRendererIpcArgs('event', 'nav:update', ['panel', { data: unsafe }]).success).toBe(false)
  expect(
    parseRendererIpcArgs('event', 'nav:update', ['panel', { data: { values: Array(1025).fill(1) } }]).success
  ).toBe(false)
})
