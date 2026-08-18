import {
  signatureDappGuardrailIntent,
  transactionDappGuardrailIntent,
  walletCallsDappGuardrailIntent
} from '../../../main/provider/dappGuardrailIntents'

const account = '0x1111111111111111111111111111111111111111'
const token = '0x2222222222222222222222222222222222222222'
const recipient = '0x3333333333333333333333333333333333333333'
const word = (value: string) => value.replace(/^0x/u, '').padStart(64, '0')

test('extracts canonical native and ERC-20 transfer intent locally', () => {
  const intent = transactionDappGuardrailIntent(
    {
      from: account,
      to: token,
      value: '0x2',
      data: `0xa9059cbb${word(recipient)}${word('0x5')}`
    },
    account
  )

  expect(intent).toEqual({
    targets: [token],
    nativeValue: '0x2',
    tokenAmounts: [{ token, amount: '0x5' }],
    spenders: [],
    unverifiable: []
  })
})

test('marks opaque calldata unavailable only for locally undecodable fields', () => {
  const intent = transactionDappGuardrailIntent(
    { from: account, to: token, value: '0x0', data: '0x12345678' },
    account
  )

  expect(intent.targets).toEqual([token])
  expect(intent.nativeValue).toBe('0x0')
  expect(intent.unverifiable).toEqual(['tokenAmounts', 'spenders'])
})

test('does not treat empty calldata as proof of no contract fallback effects', () => {
  const intent = transactionDappGuardrailIntent(
    { from: account, to: recipient, value: '0x1', data: '0x' },
    account
  )

  expect(intent.nativeValue).toBe('0x1')
  expect(intent.unverifiable).toEqual(['tokenAmounts', 'spenders'])
})

test('aggregates wallet-call intent without counting execution fees', () => {
  const intent = walletCallsDappGuardrailIntent({
    type: 'walletCalls',
    handlerId: 'request',
    account,
    origin: '00000000-0000-5000-8000-000000000000',
    payload: { id: 1, jsonrpc: '2.0', method: 'wallet_sendCalls', params: [] },
    activityId: 'activity',
    version: '2.0.0',
    batchId: `0x${'ab'.repeat(32)}`,
    chainId: '0x1',
    atomic: false,
    calls: [
      { to: recipient, value: '0x2', data: '0x' },
      { to: token, value: '0x3', data: `0xa9059cbb${word(recipient)}${word('0x7')}` }
    ],
    approvals: [],
    preparation: { status: 'pending' },
    simulation: { status: 'pending', calls: [] }
  })

  expect(intent.nativeValue).toBe('0x5')
  expect(intent.targets).toEqual([token, recipient].sort())
  expect(intent.tokenAmounts).toEqual([{ token, amount: '0x7' }])
})

test('fails closed for target and authority restrictions on plain messages', () => {
  const intent = signatureDappGuardrailIntent({
    type: 'sign',
    handlerId: 'request',
    account,
    origin: '00000000-0000-5000-8000-000000000000',
    payload: { id: 1, jsonrpc: '2.0', method: 'personal_sign', params: [] },
    data: {
      rawMessage: '0x01',
      decodedMessage: 'message',
      context: { origin: 'example', requestChainId: 1 }
    },
    approvals: []
  })

  expect(intent.unverifiable).toEqual(['targets', 'tokenAmounts', 'spenders'])
})

test('bounds oversized Permit2 batches and marks token amounts unverifiable', () => {
  const permissions = Array.from({ length: 65 }, (_, index) => ({
    token: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    amount: '1'
  }))
  const intent = signatureDappGuardrailIntent({
    type: 'signTypedData',
    handlerId: 'request',
    account,
    origin: '00000000-0000-5000-8000-000000000000',
    payload: { id: 1, jsonrpc: '2.0', method: 'eth_signTypedData_v4', params: [] },
    typedMessage: {
      version: 'V4',
      data: {
        types: { EIP712Domain: [] },
        primaryType: 'PermitBatch',
        domain: {},
        message: {}
      }
    },
    context: {
      requestChainId: 1,
      risks: [],
      permit2: {
        kind: 'allowance',
        primaryType: 'PermitBatch',
        verifyingContract: token,
        canonicalContract: true,
        spender: recipient,
        deadline: '1',
        permissions,
        batch: true,
        witness: false,
        grantsAuthority: true,
        maximumAmount: false
      }
    },
    approvals: []
  } as never)

  expect(intent.tokenAmounts).toHaveLength(64)
  expect(intent.unverifiable).toContain('tokenAmounts')
})
