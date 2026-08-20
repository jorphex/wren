import { getCreateAddress, keccak256 } from 'ethers'

import { snapshotDeploymentMetadata } from '../../../main/deployment/metadata'

const account = '0x22dd63c3619818fdbc262c78baee43cb61e9cccf'
const initcode = '0x60006000'
const base = {
  version: 1,
  inspectionId: 'a'.repeat(32),
  account,
  chainId: '0x1',
  initcodeHash: keccak256(initcode),
  initcodeBytes: 4,
  value: '0x0',
  preparedAt: 1_000,
  expiresAt: 61_000
}
const transaction = { from: account, chainId: '0x1', data: initcode, value: '0x0' }

describe('deployment trusted metadata', () => {
  it('freezes an exact transaction-bound snapshot', () => {
    const pendingNonce = '0x0'
    const provisionalAddress = getCreateAddress({ from: account, nonce: 0n }).toLowerCase()
    const snapshot = snapshotDeploymentMetadata({ ...base, pendingNonce, provisionalAddress }, transaction)

    expect(snapshot).toEqual({ ...base, pendingNonce, provisionalAddress })
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it.each([
    ['destination', base, { ...transaction, to: account }],
    ['present undefined destination', base, { ...transaction, to: undefined }],
    ['account', base, { ...transaction, from: '0x2222222222222222222222222222222222222222' }],
    ['chain', base, { ...transaction, chainId: '0x2' }],
    ['value', base, { ...transaction, value: '0x1' }],
    ['creation data', base, { ...transaction, data: '0x6001' }],
    ['creation length', { ...base, initcodeBytes: 3 }, transaction],
    ['creation hash', { ...base, initcodeHash: `0x${'0'.repeat(64)}` }, transaction]
  ])('rejects a mismatched %s binding', (_label, metadata, tx) => {
    expect(() => snapshotDeploymentMetadata(metadata, tx)).toThrow(/deployment/i)
  })

  it.each([
    ['extra key', { ...base, recipient: account }],
    ['missing key', (({ expiresAt: _expiresAt, ...rest }) => rest)(base)],
    ['noncanonical account', { ...base, account: account.toUpperCase().replace('0X', '0x') }],
    ['noncanonical chain', { ...base, chainId: '0x01' }],
    ['noncanonical value', { ...base, value: '0x00' }],
    ['bad inspection id', { ...base, inspectionId: 'not-an-id' }],
    ['bad evidence time', { ...base, expiresAt: base.preparedAt }]
  ])('rejects %s', (_label, metadata) => {
    expect(() => snapshotDeploymentMetadata(metadata, transaction)).toThrow(/deployment/i)
  })

  it('requires complete, canonical, matching provisional address evidence', () => {
    const provisionalAddress = getCreateAddress({ from: account, nonce: 0n }).toLowerCase()
    expect(() => snapshotDeploymentMetadata({ ...base, provisionalAddress }, transaction)).toThrow(
      /provisional/i
    )
    expect(() =>
      snapshotDeploymentMetadata({ ...base, provisionalAddress, pendingNonce: '0x1' }, transaction)
    ).toThrow(/provisional/i)
    expect(() =>
      snapshotDeploymentMetadata({ ...base, provisionalAddress, pendingNonce: '0x00' }, transaction)
    ).toThrow(/pending nonce/i)
  })
})
