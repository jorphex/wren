import {
  createAccountPermission,
  findUnsupportedRequiredMethod,
  grantedAccountPermission,
  permissionCovers,
  parseGetPermissions,
  parseRequestPermissions,
  requestedAccountPermission
} from '../../../main/provider/permissions'
import { getSignerCapabilities } from '../../../main/signers/capabilities'

it('accepts an empty get-permissions parameter list', () => {
  expect(parseGetPermissions([])).toBeUndefined()
  expect(parseGetPermissions(undefined)).toBeUndefined()
})

it('accepts exactly one unrestricted account permission request', () => {
  expect(parseRequestPermissions([{ eth_accounts: {} }])).toEqual({
    parentCapability: 'eth_accounts',
    requiredMethods: []
  })
})

it('normalizes a bounded required-method hint', () => {
  expect(
    parseRequestPermissions([
      { eth_accounts: { requiredMethods: ['personal_sign', 'eth_signTypedData_v4', 'personal_sign'] } }
    ])
  ).toEqual({
    parentCapability: 'eth_accounts',
    requiredMethods: ['personal_sign', 'eth_signTypedData_v4']
  })
})

it.each([
  [[{}]],
  [[{ eth_accounts: {} }, { eth_accounts: {} }]],
  [[{ eth_signTransaction: {} }]],
  [[{ eth_accounts: { unknownCaveat: true } }]],
  [[{ eth_accounts: { requiredMethods: 'personal_sign' } }]],
  [[{ eth_accounts: { requiredMethods: [''] } }]],
  [[{ eth_accounts: { requiredMethods: Array(33).fill('personal_sign') } }]]
])('rejects unsupported request shape %#', (params) => {
  expect(() => parseRequestPermissions(params)).toThrow(expect.objectContaining({ code: -32602 }))
})

it('checks required methods against the selected signer profile', () => {
  const software = getSignerCapabilities({ type: 'ring' })
  const trezor = getSignerCapabilities({ type: 'trezor' })
  const watchOnly = getSignerCapabilities({ type: 'address' })

  expect(
    findUnsupportedRequiredMethod(
      [
        'personal_sign',
        'eth_sign',
        'signTypedData_v3',
        'eth_signTypedData_v1',
        'eth_sendTransaction',
        'wallet_sendCalls'
      ],
      software
    )
  ).toBeUndefined()
  expect(findUnsupportedRequiredMethod(['eth_signTypedData_v3'], trezor)).toBe('eth_signTypedData_v3')
  expect(findUnsupportedRequiredMethod(['personal_sign'], watchOnly)).toBe('personal_sign')
  expect(findUnsupportedRequiredMethod(['wallet_unknownMethod'], software)).toBe('wallet_unknownMethod')
})

it('creates, evaluates, and formats a finite scoped account permission', () => {
  const permission = createAccountPermission({
    account: '0x1111111111111111111111111111111111111111',
    chains: [10, 1, '0x1'],
    handlerId: 'origin-id',
    origin: 'https://example.test',
    now: 123
  })

  expect(grantedAccountPermission(permission)).toEqual({
    invoker: 'https://example.test',
    parentCapability: 'eth_accounts',
    caveats: [
      {
        type: 'wren:permissionScope',
        value: expect.objectContaining({
          account: '0x1111111111111111111111111111111111111111',
          chains: ['0x1', '0xa'],
          expiresAt: 2592000123
        })
      }
    ]
  })
  expect(requestedAccountPermission(123)).toEqual({ parentCapability: 'eth_accounts', date: 123 })

  const check = {
    account: '0x1111111111111111111111111111111111111111',
    handlerId: 'origin-id',
    method: 'eth_accounts',
    now: 124
  }
  expect(permissionCovers(permission, check)).toBe(true)
  expect(permissionCovers(permission, { ...check, chainId: 10 })).toBe(true)
  expect(permissionCovers(permission, { ...check, chainId: 137 })).toBe(false)
  expect(permissionCovers(permission, { ...check, account: `0x${'2'.repeat(40)}` })).toBe(false)
  expect(permissionCovers(permission, { ...check, handlerId: 'other-origin' })).toBe(false)
  expect(permissionCovers(permission, { ...check, method: 'wallet_unknownMethod' })).toBe(false)
  expect(permissionCovers(permission, { ...check, now: permission.caveats[0].value.expiresAt })).toBe(false)
})
