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

test('validates fee quantities and request identifiers', () => {
  expect(parseRendererRpcRequest(wire(1, 'setGasLimit', address, '0x5208', handlerId)).success).toBe(true)
  expect(parseRendererRpcRequest(wire(1, 'setGasLimit', address, '21000', handlerId)).success).toBe(false)
  expect(parseRendererRpcRequest(wire(1, 'setGasLimit', address, '0x5208', '1')).success).toBe(false)
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

test('validates companion credential revocation fingerprints', () => {
  expect(parseRendererRpcRequest(wire(1, 'revokeExtensionCredential', 'a'.repeat(43))).success).toBe(true)
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
