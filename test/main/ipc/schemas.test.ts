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
  expect(parse('event', 'dash:dismissHardwarePrompt', ['trezor-1'])).toEqual(['trezor-1'])
  expect(parseRendererIpcArgs('event', 'dash:dismissHardwarePrompt', []).success).toBe(false)
})

test('strictly validates acknowledged clipboard writes and results', () => {
  expect(parse('invoke', 'tray:writeClipboard', [{ secret: true, value: 'secret' }])).toEqual([
    { secret: true, value: 'secret' }
  ])
  expect(
    parseRendererIpcArgs('invoke', 'tray:writeClipboard', [{ secret: true, value: 'secret', extra: true }])
      .success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'tray:writeClipboard', [{ secret: false, value: 'x'.repeat(4097) }])
      .success
  ).toBe(false)
  expect(parseRendererInvokeResult('tray:writeClipboard', { success: true }).success).toBe(true)
  expect(parseRendererInvokeResult('tray:writeClipboard', { success: false }).success).toBe(false)
})

test('strictly validates acknowledged permission revocation', () => {
  expect(parse('invoke', 'tray:revokeAccess', [address, handlerId])).toEqual([address, handlerId])
  expect(parse('invoke', 'tray:revokeAccess', [address])).toEqual([address])
  expect(parseRendererIpcArgs('invoke', 'tray:revokeAccess', [address, handlerId, false]).success).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'tray:revokeAccess', ['0x1', handlerId]).success).toBe(false)
  expect(parseRendererInvokeResult('tray:revokeAccess', { success: true }).success).toBe(true)
  expect(
    parseRendererInvokeResult('tray:revokeAccess', { success: false, error: 'Permission unavailable' })
      .success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('tray:revokeAccess', {
      success: false,
      uncertain: true,
      error: 'Revocation confirmation is unavailable'
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('tray:revokeAccess', {
      success: false,
      uncertain: true,
      sessionOnly: true,
      error: 'persistence-failed'
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('tray:revokeAccess', {
      success: false,
      sessionOnly: true,
      error: 'persistence-failed'
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('tray:revokeAccess', {
      success: false,
      uncertain: true,
      sessionOnly: true,
      error: 'Permission unavailable'
    }).success
  ).toBe(false)
  expect(parseRendererInvokeResult('tray:revokeAccess', { success: false }).success).toBe(false)
})

test('allows only an argument-free acknowledged activity clear', () => {
  expect(parse('invoke', 'activity:clear', [])).toEqual([])
  expect(parseRendererIpcArgs('invoke', 'activity:clear', [true]).success).toBe(false)
  expect(parseRendererIpcArgs('event', 'tray:action', ['clearActivity']).success).toBe(false)
  expect(parseRendererInvokeResult('activity:clear', { success: true, durable: true }).success).toBe(true)
  expect(
    parseRendererInvokeResult('activity:clear', {
      success: false,
      durable: false,
      sessionOnly: true,
      error: 'persistence-failed'
    }).success
  ).toBe(true)
})

test('strictly validates recent-recipient renderer actions', () => {
  expect(parse('event', 'tray:action', ['setRememberRecentRecipients', true])).toEqual([
    'setRememberRecentRecipients',
    true
  ])
  expect(parseRendererIpcArgs('event', 'tray:action', ['clearRecentRecipients']).success).toBe(false)
  expect(parseRendererIpcArgs('event', 'tray:action', ['setRememberRecentRecipients', false]).success).toBe(
    false
  )
  expect(parseRendererIpcArgs('event', 'tray:action', ['setRememberRecentRecipients', 'true']).success).toBe(
    false
  )
  expect(parseRendererIpcArgs('event', 'tray:action', ['recordRecentRecipientUse', {}]).success).toBe(false)
})

test('strictly validates dapp guardrail action payloads without renderer-owned metadata', () => {
  const target = '0x2222222222222222222222222222222222222222'
  const save = {
    account: address,
    originId: handlerId,
    chainId: '0x1',
    body: { mode: 'block', targets: [target] }
  }
  expect(parse('event', 'tray:action', ['saveDappGuardrail', save])).toEqual(['saveDappGuardrail', save])
  expect(
    parse('event', 'tray:action', [
      'removeDappGuardrail',
      { account: address, originId: handlerId, chainId: '0x1' }
    ])
  ).toEqual(['removeDappGuardrail', { account: address, originId: handlerId, chainId: '0x1' }])
  expect(
    parseRendererIpcArgs('event', 'tray:action', [
      'saveDappGuardrail',
      { ...save, body: { ...save.body, revision: 4 } }
    ]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('event', 'tray:action', ['saveDappGuardrail', { ...save, chainId: 1 }]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('event', 'tray:action', [
      'saveDappGuardrail',
      { ...save, body: { mode: 'warn', targets: [target, address] } }
    ]).success
  ).toBe(false)
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

  expect(parse('invoke', 'tokens:save', [token])).toEqual([token])
  expect(parse('invoke', 'tokens:save', [token, requestReference])).toEqual([token, requestReference])
  expect(parseRendererIpcArgs('invoke', 'tokens:save', [token, null]).success).toBe(false)
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
  const entry = {
    address,
    name: 'Treasury',
    note: 'Operations',
    provenance: { status: 'saved' },
    createdAt: 1,
    updatedAt: 1
  }
  expect(parse('invoke', 'addressBook:save', [request])).toEqual([request])
  expect(
    parse('invoke', 'addressBook:save', [
      {
        ...request,
        provenance: { status: 'verified-out-of-band', note: '  Confirmed   by phone ' }
      }
    ])
  ).toEqual([
    {
      ...request,
      provenance: { status: 'verified-out-of-band', note: 'Confirmed by phone' }
    }
  ])
  expect(
    parseRendererIpcArgs('invoke', 'addressBook:save', [
      {
        ...request,
        provenance: { status: 'verified-out-of-band', verifiedAt: 1, note: 'Untrusted timestamp' }
      }
    ]).success
  ).toBe(false)
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

test('keeps profile backup passwords and inspection metadata strictly bounded', () => {
  const password = 'correct horse battery staple'
  expect(parse('invoke', 'profile:export', [password])).toEqual([password])
  expect(parseRendererIpcArgs('invoke', 'profile:export', ['too short']).success).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'profile:inspectBackup', [password, 'extra']).success).toBe(false)
  expect(
    parse('invoke', 'profile:stageRestore', [handlerId, password, 'REPLACE_PROFILE_ON_RESTART'])
  ).toEqual([handlerId, password, 'REPLACE_PROFILE_ON_RESTART'])
  expect(parseRendererIpcArgs('invoke', 'profile:stageRestore', [handlerId, password, true]).success).toBe(
    false
  )
  expect(parseRendererInvokeResult('profile:export', { success: true, bytes: 128 }).success).toBe(true)
  expect(
    parseRendererInvokeResult('profile:inspectBackup', {
      success: true,
      restoreToken: handlerId,
      tokenExpiresAt: '2026-08-12T00:05:00.000Z',
      backup: { formatVersion: 1, createdAt: '2026-08-12T00:00:00.000Z', signerCount: 2 }
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('profile:inspectBackup', {
      success: true,
      restoreToken: handlerId,
      tokenExpiresAt: '2026-08-12T00:05:00.000Z',
      backup: {
        formatVersion: 1,
        createdAt: '2026-08-12T00:00:00.000Z',
        signerCount: 2,
        sourcePath: '/private/profile.wrenbackup'
      }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('profile:stageRestore', {
      success: true,
      restore: {
        restoreId: handlerId,
        stagedAt: '2026-08-12T00:00:00.000Z',
        expiresAt: '2026-08-12T00:10:00.000Z',
        signerCount: 2,
        relaunchRequired: true
      }
    }).success
  ).toBe(true)
})

test('strictly bounds software signer protection commands and status', () => {
  const protectionStatus = {
    available: true,
    backend: 'gnome_libsecret',
    enabled: true,
    protectedFiles: 2,
    signerFiles: 2,
    state: 'enabled'
  }
  expect(parse('invoke', 'signers:protectionStatus', [])).toEqual([])
  expect(parse('invoke', 'signers:enableProtection', ['ENABLE_OS_SIGNER_PROTECTION'])).toEqual([
    'ENABLE_OS_SIGNER_PROTECTION'
  ])
  expect(parseRendererIpcArgs('invoke', 'signers:enableProtection', ['enable']).success).toBe(false)
  expect(parse('invoke', 'signers:disableProtection', ['DISABLE_OS_SIGNER_PROTECTION'])).toEqual([
    'DISABLE_OS_SIGNER_PROTECTION'
  ])
  expect(
    parseRendererInvokeResult('signers:protectionStatus', { success: true, status: protectionStatus }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('signers:protectionStatus', {
      success: true,
      status: { ...protectionStatus, backend: 'windows_dpapi' }
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('signers:protectionStatus', {
      success: true,
      status: { ...protectionStatus, keychainPath: '/private/keyring' }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('signers:enableProtection', {
      success: true,
      status: { ...protectionStatus, backend: 'basic_text', available: true }
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
  const maxRequest = {
    account: draft.account,
    assetAddress: draft.assetAddress,
    chainId: draft.chainId,
    recipient: draft.recipient
  }
  expect(parse('invoke', 'send:maxAmount', [maxRequest])).toEqual([maxRequest])
  expect(parse('invoke', 'send:maxAmount', [{ ...maxRequest, recipient: undefined }])).toEqual([
    { ...maxRequest, recipient: undefined }
  ])
  expect(
    parseRendererIpcArgs('invoke', 'send:maxAmount', [{ ...maxRequest, endpoint: 'https://evil.test' }])
      .success
  ).toBe(false)
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
  expect(
    parseRendererInvokeResult('send:maxAmount', {
      success: true,
      quoteId: 'a'.repeat(32),
      amount: '999999999999999',
      expiresAt: 2_000_000_000_000,
      reserve: {
        feeModel: 'eip1559',
        gasLimit: '0x5208',
        maxFeePerGas: '0x3b9aca00',
        maxPriorityFeePerGas: '0x1',
        executionFee: '21000000000000',
        l1Fee: '0',
        total: '21000000000000'
      }
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('send:maxAmount', {
      success: true,
      quoteId: 'a'.repeat(32),
      amount: '1',
      expiresAt: 2_000_000_000_000,
      reserve: {
        feeModel: 'legacy',
        gasLimit: '0x5208',
        maxFeePerGas: '0x1',
        executionFee: '1',
        l1Fee: '0',
        total: '1'
      }
    }).success
  ).toBe(false)
  expect(parseRendererInvokeResult('send:queue', { success: true, handlerId: 'send-request' }).success).toBe(
    true
  )
})

test('strictly bounds prepared deployment requests and public evidence', () => {
  const draft = { account: address, chainId: 1, initcode: '0x60006000', value: '' }
  const inspectionId = 'a'.repeat(32)
  expect(parse('invoke', 'deployment:prepare', [draft])).toEqual([draft])
  expect(parse('invoke', 'deployment:queue', [{ inspectionId, draft }])).toEqual([{ inspectionId, draft }])

  for (const invalid of [
    { ...draft, initcode: '0x' },
    { ...draft, initcode: '0x0' },
    { ...draft, value: '1e18' },
    { ...draft, endpoint: 'https://evil.test' }
  ]) {
    expect(parseRendererIpcArgs('invoke', 'deployment:prepare', [invalid]).success).toBe(false)
  }
  expect(
    parseRendererIpcArgs('invoke', 'deployment:prepare', [{ ...draft, initcode: `0x${'00'.repeat(49_153)}` }])
      .success
  ).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'deployment:queue', [{ inspectionId: 'bad', draft }]).success).toBe(
    false
  )
  expect(parseRendererIpcArgs('invoke', 'deployment:queue', [{ inspectionId, ...draft }]).success).toBe(false)

  const result = {
    success: true,
    inspection: {
      id: inspectionId,
      preparedAt: 1_000,
      expiresAt: 61_000,
      account: address,
      chainId: '0x1',
      initcode: { bytes: 4, hash: `0x${'1'.repeat(64)}` },
      value: '0x0',
      gasEstimate: {
        status: 'succeeded',
        source: 'configured-rpc',
        method: 'eth_estimateGas',
        value: '0x10000',
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
        nonce: '0x1',
        provisionalAddress: '0x0000000000000000000000000000000000000002',
        provisional: true
      }
    }
  }
  expect(parseRendererInvokeResult('deployment:prepare', result).success).toBe(true)
  expect(
    parseRendererInvokeResult('deployment:prepare', {
      ...result,
      inspection: {
        ...result.inspection,
        simulation: {
          status: 'succeeded',
          source: 'configured-rpc',
          advancedChecks: 'partly-unavailable'
        }
      }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('deployment:prepare', {
      ...result,
      inspection: {
        ...result.inspection,
        simulation: {
          status: 'reverted',
          source: 'configured-rpc',
          reasonCode: 'execution-reverted',
          reason: 'Execution reverted',
          advancedChecks: 'complete'
        }
      }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('deployment:prepare', {
      ...result,
      inspection: { ...result.inspection, trace: { secret: true } }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('deployment:prepare', {
      ...result,
      inspection: {
        ...result.inspection,
        simulation: {
          status: 'reverted',
          source: 'configured-rpc',
          reasonCode: 'rpc-error',
          reason: 'Failed',
          advancedChecks: 'not-run'
        }
      }
    }).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('deployment:queue', { success: true, handlerId: 'deployment-request' }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('deployment:queue', {
      success: true,
      handlerId: 'deployment-request',
      metadata: { initcode: draft.initcode }
    }).success
  ).toBe(false)
})

test('strictly bounds dashboard Sweep requests and results', () => {
  const recipient = '0x0000000000000000000000000000000000000002'
  const account = '0x0000000000000000000000000000000000000001'
  const token = '0x0000000000000000000000000000000000000003'
  const quoteRequest = { account, chainId: 1, recipient, tokens: [token], includeNative: true }
  const queueRequest = { quoteId: 'quote-id', account, chainId: 1, recipient }

  expect(parse('invoke', 'send:quoteSweep', [quoteRequest])).toEqual([quoteRequest])
  expect(parse('invoke', 'send:queueSweep', [queueRequest])).toEqual([queueRequest])
  expect(
    parseRendererIpcArgs('invoke', 'send:quoteSweep', [
      { ...quoteRequest, tokens: Array.from({ length: 16 }, () => token) }
    ]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'send:quoteSweep', [{ ...quoteRequest, tokens: [], includeNative: false }])
      .success
  ).toBe(false)
  expect(parseRendererIpcArgs('invoke', 'send:queueSweep', [{ ...queueRequest, calls: [] }]).success).toBe(
    false
  )

  expect(
    parseRendererInvokeResult('send:quoteSweep', {
      success: true,
      quoteId: 'quote-id',
      expiresAt: 2_000_000_000_000,
      account,
      chainId: 1,
      recipient,
      assets: [{ address: token, balance: '0x2' }],
      native: { selected: true, balance: '0x100', value: '0x80' },
      maximumFee: '0x80',
      calls: [
        { to: token, data: `0x${'00'.repeat(68)}`, value: '0x0' },
        { to: recipient, data: '0x', value: '0x80' }
      ],
      execution: 'sequential-non-atomic'
    }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('send:queueSweep', { success: true, handlerId: crypto.randomUUID() }).success
  ).toBe(true)
})

test('requires explicit Yearn catalog options and validates returned metadata', () => {
  expect(parse('invoke', 'yearn:getCatalog', [{ force: false }])).toEqual([{ force: false }])
  expect(parse('invoke', 'yearn:getCatalog', [{ force: false, cacheOnly: true }])).toEqual([
    { force: false, cacheOnly: true }
  ])
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
  expect(parseRendererIpcArgs('event', 'tray:action', ['clearPermissions', address]).success).toBe(false)
  expect(
    parseRendererIpcArgs('event', 'tray:action', ['toggleAccess', address, handlerId, false]).success
  ).toBe(false)
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

test('bounds the dashboard inspector invoke and its result', () => {
  expect(parse('invoke', 'inspector:inspect', [{ kind: 'calldata', data: '0xa9059cbb' }])).toEqual([
    { kind: 'calldata', data: '0xa9059cbb' }
  ])
  expect(
    parseRendererIpcArgs('invoke', 'inspector:inspect', [
      { kind: 'calldata', data: '0xa9059cbb', method: 'eth_sendTransaction' }
    ]).success
  ).toBe(false)
  expect(
    parseRendererIpcArgs('invoke', 'inspector:inspect', [
      { kind: 'json-rpc', input: 'x'.repeat(256 * 1024 + 1) }
    ]).success
  ).toBe(false)
  expect(
    parseRendererInvokeResult('inspector:inspect', { success: false, error: 'Unsupported input' }).success
  ).toBe(true)
  expect(
    parseRendererInvokeResult('inspector:inspect', {
      success: false,
      error: 'x'.repeat(241)
    }).success
  ).toBe(false)
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

describe('contract verification renderer IPC', () => {
  const jobId = '4b25b5d0-b4c0-4c11-914c-c2f9936f6982'
  const artifactToken = '398ec34b-1bfc-47a9-a431-6e31e78b165c'
  const acknowledgementToken = 'c5890403-fc22-49d3-b68e-4605289d310d'
  const runtimeCodeHash = `0x${'a'.repeat(64)}`
  const sourceHash = 'b'.repeat(64)
  const submissionHash = 'c'.repeat(64)
  const job = {
    id: jobId,
    target: { address, chainId: 1, runtimeCodeHash },
    language: 'Solidity',
    compilerVersion: '0.8.26+commit.8a97fa7a',
    contractIdentifier: 'src/Vault.sol:Vault',
    sourceHash,
    submissionHash,
    status: 'published',
    destinations: [{ destination: 'sourcify', status: 'published' }],
    createdAt: 1,
    updatedAt: 2
  }
  const artifact = {
    token: artifactToken,
    summary: {
      format: 'solidity-standard-json',
      language: 'Solidity',
      compilerStatus: 'required',
      compilerVersion: null,
      sourceCount: 1,
      contractCandidates: [],
      localRuntimeMatch: false,
      selectionRequired: false,
      selectedContractIdentifier: null
    }
  }

  test('accepts only exact bounded invoke arguments', () => {
    const noArgumentChannels = [
      'contractVerification:credentialStatus',
      'contractVerification:inspectArtifact',
      'contractVerification:list',
      'contractVerification:removeCredential'
    ]
    for (const channel of noArgumentChannels) {
      expect(parseRendererIpcArgs('invoke', channel, []).success).toBe(true)
      expect(parseRendererIpcArgs('invoke', channel, [null]).success).toBe(false)
    }

    expect(parse('invoke', 'contractVerification:get', [jobId])).toEqual([jobId])
    expect(parse('invoke', 'contractVerification:refresh', [jobId])).toEqual([jobId])
    expect(
      parse('invoke', 'contractVerification:selectArtifact', [artifactToken, 'src/Vault.sol:Vault'])
    ).toEqual([artifactToken, 'src/Vault.sol:Vault'])
    expect(
      parse('invoke', 'contractVerification:prepare', [
        {
          artifactToken,
          chainId: 1,
          address,
          compilerVersion: '0.8.26+commit.8a97fa7a',
          contractIdentifier: 'src/Vault.sol:Vault'
        }
      ])
    ).toHaveLength(1)
    expect(
      parse('invoke', 'contractVerification:publish', [
        { acknowledgementToken, confirmation: 'PUBLISH_CONTRACT_SOURCE' }
      ])
    ).toHaveLength(1)
    expect(
      parse('invoke', 'contractVerification:reselect', [
        { artifactToken, jobId, contractIdentifier: 'src/Vault.sol:Vault' }
      ])
    ).toHaveLength(1)
    expect(
      parse('invoke', 'contractVerification:publishEtherscan', [
        { jobId, confirmation: 'PUBLISH_TO_ETHERSCAN', noConstructorArguments: true }
      ])
    ).toHaveLength(1)
    expect(
      parse('invoke', 'contractVerification:publishEtherscan', [
        { jobId, confirmation: 'PUBLISH_TO_ETHERSCAN', constructorArguments: '1234' }
      ])
    ).toHaveLength(1)
    expect(
      parseRendererIpcArgs('invoke', 'contractVerification:publishEtherscan', [
        { jobId, confirmation: 'PUBLISH_TO_ETHERSCAN' }
      ]).success
    ).toBe(false)
    expect(
      parse('invoke', 'contractVerification:openResult', [{ jobId, destination: 'blockscout-forwarded' }])
    ).toHaveLength(1)
    expect(parse('invoke', 'contractVerification:saveCredential', ['etherscan_key_1234567890'])).toHaveLength(
      1
    )
  })

  test('rejects extra arguments, fields, invalid identifiers, addresses, chain IDs, and credentials', () => {
    expect(parseRendererIpcArgs('invoke', 'contractVerification:get', [jobId, jobId]).success).toBe(false)
    expect(
      parseRendererIpcArgs('invoke', 'contractVerification:prepare', [
        { artifactToken, chainId: 1, address, path: '/tmp/build-info.json' }
      ]).success
    ).toBe(false)
    expect(
      parseRendererIpcArgs('invoke', 'contractVerification:prepare', [{ artifactToken, chainId: 0, address }])
        .success
    ).toBe(false)
    expect(
      parseRendererIpcArgs('invoke', 'contractVerification:prepare', [
        { artifactToken, chainId: 1, address: address.toUpperCase() }
      ]).success
    ).toBe(false)
    expect(
      parseRendererIpcArgs('invoke', 'contractVerification:prepare', [
        { artifactToken, chainId: 1, address, contractIdentifier: 'x'.repeat(1025) }
      ]).success
    ).toBe(false)
    expect(
      parseRendererIpcArgs('invoke', 'contractVerification:publish', [
        { acknowledgementToken, confirmation: 'YES' }
      ]).success
    ).toBe(false)
    for (const apiKey of ['short', 'has spaces 123456789', 'x'.repeat(129)]) {
      expect(parseRendererIpcArgs('invoke', 'contractVerification:saveCredential', [apiKey]).success).toBe(
        false
      )
    }
  })

  test('projects only bounded artifact summaries and explicit cancellation', () => {
    expect(
      parseRendererInvokeResult('contractVerification:inspectArtifact', {
        success: true,
        artifact
      }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:inspectArtifact', {
        success: false,
        canceled: true
      }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:selectArtifact', {
        success: false,
        error: 'invalid-contract-selection'
      }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:inspectArtifact', {
        success: true,
        artifact: { ...artifact, path: '/tmp/build-info.json' }
      }).success
    ).toBe(false)
    expect(
      parseRendererInvokeResult('contractVerification:inspectArtifact', {
        success: true,
        artifact: {
          ...artifact,
          summary: { ...artifact.summary, contractCandidates: Array(1025).fill('src/Vault.sol:Vault') }
        }
      }).success
    ).toBe(false)
  })

  test('accepts exact prepared and job results while rejecting private or raw fields', () => {
    const prepared = {
      acknowledgementToken,
      target: job.target,
      language: 'Solidity',
      compilerVersion: job.compilerVersion,
      contractIdentifier: job.contractIdentifier,
      sourceCount: 1,
      localRuntimeMatch: 'matched',
      deploymentSettlement: 'not-applicable'
    }
    expect(
      parseRendererInvokeResult('contractVerification:prepare', { success: true, prepared }).success
    ).toBe(true)
    expect(parseRendererInvokeResult('contractVerification:get', { success: true, job }).success).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:list', { success: true, jobs: [job] }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:refresh', {
        success: false,
        error: 'refresh-unavailable',
        job
      }).success
    ).toBe(true)

    for (const leaked of [
      { source: 'contract Vault {}' },
      { stdJsonInput: { language: 'Solidity' } },
      { path: '/tmp/build-info.json' },
      { apiKey: 'etherscan_key_1234567890' },
      { rawError: 'upstream body' }
    ]) {
      expect(
        parseRendererInvokeResult('contractVerification:get', {
          success: true,
          job: { ...job, ...leaked }
        }).success
      ).toBe(false)
    }
    expect(
      parseRendererInvokeResult('contractVerification:get', {
        success: true,
        job: { ...job, target: { ...job.target, address: address.toUpperCase() } }
      }).success
    ).toBe(false)
    expect(
      parseRendererInvokeResult('contractVerification:list', { success: true, jobs: [job, job] }).success
    ).toBe(false)
    expect(
      parseRendererInvokeResult('contractVerification:get', {
        success: false,
        error: 'job-unavailable',
        rawError: 'upstream body'
      }).success
    ).toBe(false)
  })

  test('accepts only renderer-safe credential and deployment continuation results', () => {
    const credential = { available: true, backend: 'secret_service', configured: true }
    expect(
      parseRendererInvokeResult('contractVerification:credentialStatus', {
        success: true,
        credential
      }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:credentialStatus', {
        success: true,
        credential: { available: false, backend: 'unsupported', configured: true }
      }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('contractVerification:credentialStatus', {
        success: true,
        credential: { ...credential, apiKey: 'etherscan_key_1234567890' }
      }).success
    ).toBe(false)
    expect(
      parseRendererIpcArgs('invoke', 'tray:continueContractVerification', [{ account: address, handlerId }])
        .success
    ).toBe(true)
    expect(
      parseRendererIpcArgs('invoke', 'tray:continueContractVerification', [
        { account: address, handlerId, operationId: jobId }
      ]).success
    ).toBe(false)
    expect(
      parseRendererInvokeResult('tray:continueContractVerification', {
        success: true,
        operationId: jobId,
        chainId: 1,
        address
      }).success
    ).toBe(true)
    expect(
      parseRendererInvokeResult('tray:continueContractVerification', {
        success: false,
        error: 'operation-unsettled'
      }).success
    ).toBe(false)
  })
})
