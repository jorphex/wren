import {
  encodeRendererRpcValues,
  parseRendererRpcRequest,
  parseRendererRpcResponse
} from '../../../main/ipc/rpcSchemas'

const address = '0x0000000000000000000000000000000000000001'
const handlerId = '8073729a-5e59-53b7-9e69-5d9bcff94087'
const wire = (id: unknown, method: unknown, ...args: unknown[]) =>
  [id, method, ...args].map((value) =>
    value === undefined || value === null ? value : JSON.stringify(value)
  )

test('parses a bounded method-specific RPC request', () => {
  expect(parseRendererRpcRequest(wire(1, 'resolveEnsName', 'yearn.eth'))).toEqual({
    success: true,
    data: { id: 1, method: 'resolveEnsName', args: ['yearn.eth'] }
  })
  expect(parseRendererRpcRequest(wire('1', 'getState')).success).toBe(false)
  expect(parseRendererRpcRequest(wire(1, 'getState', 'extra')).success).toBe(false)
  expect(parseRendererRpcRequest(wire(1, 'unknown')).success).toBe(false)
})

test('reduces request snapshots before approval dispatch', () => {
  expect(
    parseRendererRpcRequest(
      wire(1, 'approveRequest', {
        handlerId,
        account: address,
        type: 'transaction',
        data: { to: address },
        locked: false
      })
    )
  ).toEqual({
    success: true,
    data: {
      id: 1,
      method: 'approveRequest',
      args: [{ handlerId, account: address, type: 'transaction' }]
    }
  })
})

test.each(['retryTransactionRequest', 'closeFailedTransactionRequest'])(
  'bounds %s to an account-owned request reference',
  (method) => {
    const request = { handlerId, account: address, type: 'transaction', notice: 'private details' }
    expect(parseRendererRpcRequest(wire(1, method, request))).toEqual({
      success: true,
      data: { id: 1, method, args: [{ handlerId, account: address, type: 'transaction' }] }
    })
    expect(parseRendererRpcRequest(wire(1, method, { ...request, handlerId: 'forged' })).success).toBe(false)
    expect(parseRendererRpcRequest(wire(1, method, { ...request, type: 'sign' })).success).toBe(false)
  }
)

test.each(['retryWalletCallsRequest', 'closeFailedWalletCallsRequest'])(
  'bounds %s to an account-owned wallet-call request reference',
  (method) => {
    const request = { handlerId, account: address, type: 'walletCalls', calls: [{ data: 'private' }] }
    expect(parseRendererRpcRequest(wire(1, method, request))).toEqual({
      success: true,
      data: { id: 1, method, args: [{ handlerId, account: address, type: 'walletCalls' }] }
    })
    expect(parseRendererRpcRequest(wire(1, method, { ...request, handlerId: 'forged' })).success).toBe(false)
    expect(parseRendererRpcRequest(wire(1, method, { ...request, type: 'transaction' })).success).toBe(false)
  }
)

test('bounds transaction replacement to an account-owned request and known action', () => {
  const request = { handlerId, account: address, type: 'transaction', notice: 'private details' }
  expect(parseRendererRpcRequest(wire(1, 'replaceTransactionRequest', request, 'speed'))).toEqual({
    success: true,
    data: {
      id: 1,
      method: 'replaceTransactionRequest',
      args: [{ handlerId, account: address, type: 'transaction' }, 'speed']
    }
  })
  expect(parseRendererRpcRequest(wire(1, 'replaceTransactionRequest', request, 'other')).success).toBe(false)
})

test('accepts only an explicit wallet-call simulation acknowledgement', () => {
  const request = { handlerId, account: address, type: 'walletCalls' }
  expect(
    parseRendererRpcRequest(wire(1, 'approveRequest', request, { walletCallsSimulationAcknowledged: true }))
  ).toMatchObject({
    success: true,
    data: {
      args: [request, { walletCallsSimulationAcknowledged: true }]
    }
  })
  expect(
    parseRendererRpcRequest(wire(1, 'approveRequest', request, { walletCallsSimulationAcknowledged: false }))
      .success
  ).toBe(false)
  expect(parseRendererRpcRequest(wire(1, 'approveRequest', request, {})).success).toBe(false)
  expect(
    parseRendererRpcRequest(
      wire(1, 'approveRequest', request, { addressLookalikeFingerprint: 'a'.repeat(64) })
    ).success
  ).toBe(false)
})

test('validates sensitive signer methods without coercion', () => {
  expect(
    parseRendererRpcRequest(wire(1, 'createFromPrivateKey', `0x${'a'.repeat(64)}`, 'password')).success
  ).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'createFromPrivateKey', 'not-a-key', 'password')).success).toBe(
    false
  )
  expect(parseRendererRpcRequest(wire(1, 'trezorPairing', 'trezor-id', { tag: 123 })).success).toBe(false)

  const phrase = '  abandon abandon abandon  '
  expect(parseRendererRpcRequest(wire(1, 'createFromPhrase', phrase, 'password'))).toMatchObject({
    success: true,
    data: { args: [phrase, 'password'] }
  })
  expect(
    parseRendererRpcRequest(wire(1, 'createAccount', address, 'Account', { type: 'unknown' })).success
  ).toBe(false)
})

test('bounds generated-wallet creation and its one-time presentation payload', () => {
  const sessionId = 'a'.repeat(32)
  const phrase = 'test test test test test test test test test test test junk'
  const privateKey = `0x${'1'.padStart(64, '0')}`
  const expiresAt = Date.now() + 60_000

  expect(parseRendererRpcRequest(wire(1, 'reserveGeneratedWallet'))).toMatchObject({
    success: true,
    data: { args: [] }
  })
  expect(
    parseRendererRpcRequest(wire(1, 'beginGeneratedWallet', sessionId, 'phrase', 'password'))
  ).toMatchObject({
    success: true,
    data: { args: [sessionId, 'phrase', 'password'] }
  })
  expect(
    parseRendererRpcRequest(wire(1, 'beginGeneratedWallet', sessionId, 'seed', 'password')).success
  ).toBe(false)
  expect(
    parseRendererRpcRequest(
      wire(1, 'completeGeneratedWallet', sessionId, { words: ['test', 'test', 'test'] })
    ).success
  ).toBe(true)
  expect(
    parseRendererRpcRequest(wire(1, 'completeGeneratedWallet', sessionId, { words: ['test'] })).success
  ).toBe(false)
  expect(parseRendererRpcRequest(wire(1, 'discardGeneratedWallet', sessionId)).success).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'discardGeneratedWallet', 'not-a-session')).success).toBe(false)

  expect(parseRendererRpcResponse('reserveGeneratedWallet', [null, { sessionId }])).toEqual({
    success: true,
    data: [null, { sessionId }]
  })
  expect(
    parseRendererRpcResponse('beginGeneratedWallet', [
      null,
      { address, challenge: [2, 6, 10], expiresAt, kind: 'phrase', secret: phrase, sessionId }
    ]).success
  ).toBe(true)
  expect(
    parseRendererRpcResponse('beginGeneratedWallet', [
      null,
      { address, challenge: 'private-key', expiresAt, kind: 'private-key', secret: privateKey, sessionId }
    ]).success
  ).toBe(true)
  expect(
    parseRendererRpcResponse('beginGeneratedWallet', [
      null,
      { address, challenge: 'private-key', expiresAt, kind: 'private-key', secret: phrase, sessionId }
    ]).success
  ).toBe(false)
  expect(
    parseRendererRpcResponse('completeGeneratedWallet', [
      null,
      { accountId: address, address, id: 'signer-id', selected: true, type: 'seed' }
    ])
  ).toEqual({
    success: true,
    data: [null, { accountId: address, address, id: 'signer-id', selected: true, type: 'seed' }]
  })
  expect(
    parseRendererRpcResponse('beginGeneratedWallet', [
      null,
      { address, challenge: [2, 2, 10], expiresAt, kind: 'phrase', secret: phrase, sessionId }
    ]).success
  ).toBe(false)
})

test('validates fee quantities and request identifiers', () => {
  expect(parseRendererRpcRequest(wire(1, 'setGasLimit', address, '0x5208', handlerId)).success).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'setGasLimit', address, '21000', handlerId)).success).toBe(false)
  expect(parseRendererRpcRequest(wire(1, 'setGasLimit', address, '0x5208', '1')).success).toBe(false)
})

test('bounds wallet-owned EIP-7702 renderer requests', () => {
  expect(parseRendererRpcRequest(wire(1, 'getAccountExecutionState', address, 1))).toMatchObject({
    success: true,
    data: { args: [address, 1] }
  })
  expect(parseRendererRpcRequest(wire(1, 'getAccountExecutionState', address, 0)).success).toBe(false)
  expect(
    parseRendererRpcResponse('getAccountExecutionState', [
      null,
      {
        status: 'delegated',
        account: address,
        chainId: 1,
        source: 'eth_getCode',
        delegate: '0x0000000000000000000000000000000000000002',
        codeHash: `0x${'a'.repeat(64)}`
      }
    ]).success
  ).toBe(true)
  expect(
    parseRendererRpcResponse('getAccountExecutionState', [
      null,
      { status: 'contract', account: address, chainId: 1, codeHash: `0x${'a'.repeat(64)}` }
    ]).success
  ).toBe(false)

  expect(parseRendererRpcRequest(wire(1, 'getEip7702RevocationEligibility', address, 1))).toMatchObject({
    success: true,
    data: { args: [address, 1] }
  })
  expect(parseRendererRpcRequest(wire(1, 'requestEip7702Revocation', address, 1))).toMatchObject({
    success: true,
    data: { args: [address, 1] }
  })
  expect(parseRendererRpcRequest(wire(1, 'requestEip7702Revocation', address, 0)).success).toBe(false)
  expect(
    parseRendererRpcRequest(wire(1, 'requestEip7702Revocation', address, 1, { authorizationList: [] }))
      .success
  ).toBe(false)

  expect(
    parseRendererRpcResponse('getEip7702RevocationEligibility', [
      null,
      {
        status: 'eligible',
        account: address,
        chainId: 1,
        source: 'eth_getCode',
        delegate: '0x0000000000000000000000000000000000000002',
        codeHash: `0x${'a'.repeat(64)}`
      }
    ]).success
  ).toBe(true)
  expect(
    parseRendererRpcResponse('getEip7702RevocationEligibility', [
      null,
      { status: 'eligible', account: address, chainId: 1 }
    ]).success
  ).toBe(false)
  expect(
    parseRendererRpcResponse('getEip7702RevocationEligibility', [
      null,
      {
        status: 'not-delegated',
        account: address,
        chainId: 1,
        source: 'eth_getCode',
        delegate: '0x0000000000000000000000000000000000000002',
        codeHash: `0x${'a'.repeat(64)}`
      }
    ]).success
  ).toBe(false)
  expect(
    parseRendererRpcResponse('getEip7702RevocationEligibility', [
      null,
      { status: 'not-delegated', account: address, chainId: 1 }
    ]).success
  ).toBe(true)
  expect(
    parseRendererRpcResponse('requestEip7702Revocation', [
      null,
      {
        handlerId,
        account: address,
        type: 'eip7702Revoke',
        rawTransaction: '0x04'
      }
    ]).success
  ).toBe(false)

  expect(
    parseRendererRpcRequest(
      wire(1, 'stopEip7702RevocationMonitoring', {
        handlerId,
        account: address,
        type: 'eip7702Revoke',
        submission: { status: 'unconfirmed' }
      })
    )
  ).toEqual({
    success: true,
    data: {
      id: 1,
      method: 'stopEip7702RevocationMonitoring',
      args: [{ handlerId, account: address, type: 'eip7702Revoke' }]
    }
  })
  expect(
    parseRendererRpcRequest(
      wire(1, 'stopEip7702RevocationMonitoring', {
        handlerId: 'not-a-uuid',
        account: address,
        type: 'eip7702Revoke'
      })
    ).success
  ).toBe(false)
  expect(parseRendererRpcResponse('stopEip7702RevocationMonitoring', [null]).success).toBe(true)
})

test('binds signer compatibility checks to an account and request', () => {
  expect(parseRendererRpcRequest(wire(1, 'signerCompatibility', address, handlerId)).success).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'signerCompatibility', handlerId)).success).toBe(false)
})

test('binds request mutations to an account and request', () => {
  expect(
    parseRendererRpcRequest(wire(1, 'updateRequest', address, handlerId, { amount: '1' }, null)).success
  ).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'updateRequest', handlerId, { amount: '1' }, null)).success).toBe(
    false
  )
})

test('accepts the ERC-1967 implementation-slot approval type', () => {
  expect(
    parseRendererRpcRequest(
      wire(
        1,
        'confirmRequestApproval',
        { handlerId, account: address, type: 'transaction' },
        'approveProxyImplementationChange',
        {}
      )
    ).success
  ).toBe(true)
})

test('accepts the dapp guardrail warning approval type', () => {
  expect(
    parseRendererRpcRequest(
      wire(
        1,
        'confirmRequestApproval',
        { handlerId, account: address, type: 'transaction' },
        'approveDappGuardrailWarning',
        {}
      )
    ).success
  ).toBe(true)
})

test('validates companion credential revocation fingerprints', () => {
  expect(parseRendererRpcRequest(wire(1, 'revokeExtensionCredential', 'a'.repeat(43))).success).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'revokeNativePeerCredential', 'a'.repeat(43))).success).toBe(true)
  expect(
    parseRendererRpcRequest(
      wire(1, 'respondToNativePeerRequest', '11111111-1111-4111-8111-111111111111', true)
    ).success
  ).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'revokeExtensionCredential', 'not-a-fingerprint')).success).toBe(
    false
  )
})

test('validates and minimizes callback results', () => {
  expect(
    parseRendererRpcResponse('createFromPhrase', [null, { id: 'seed-id', secret: 'do not return' }])
  ).toEqual({
    success: true,
    data: [null, { id: 'seed-id' }]
  })
  expect(parseRendererRpcResponse('resolveEnsName', [null, address]).success).toBe(true)
  expect(parseRendererRpcResponse('resolveEnsName', [null, 'invalid']).success).toBe(false)
  expect(parseRendererRpcResponse('getState', [new Error('failed')])).toEqual({
    success: true,
    data: ['failed']
  })
})

test('preserves nullish wire values and bounds encoded responses', () => {
  expect(encodeRendererRpcValues([undefined, null, { ready: true }])).toEqual([
    undefined,
    null,
    '{"ready":true}'
  ])
  expect(() => encodeRendererRpcValues(['x'.repeat(16 * 1024 * 1024)])).toThrow(
    'Renderer RPC response is too large'
  )
})
