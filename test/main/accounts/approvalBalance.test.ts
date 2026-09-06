import { approvalBalanceTarget, readApprovalBalance } from '../../../main/accounts/approvalBalance'
import { erc20Interface } from '../../../resources/contracts'
import type { AnyAccountRequest } from '../../../main/accounts/types'

jest.mock('../../../main/operationLifecycle/rpc', () => ({ operationLifecycleRpc: jest.fn() }))
const owner = `0x${'1'.repeat(40)}`
const token = `0x${'2'.repeat(40)}`
const spender = `0x${'3'.repeat(40)}`
const approval = (overrides = {}) =>
  ({
    type: 'transaction',
    account: owner,
    data: {
      to: token,
      from: owner,
      chainId: '0x2105',
      data: erc20Interface.encodeFunctionData('approve', [spender, 1])
    },
    ...overrides
  }) as AnyAccountRequest

test('derives balance lookup from the transaction network, token, and owner', async () => {
  const target = approvalBalanceTarget(approval())
  const rpc = jest.fn(async () => `0x${123456789012345678901n.toString(16).padStart(64, '0')}`)
  expect(await readApprovalBalance(target, rpc)).toBe('123456789012345678901')
  expect(rpc).toHaveBeenCalledWith(8453, 'eth_call', [
    { to: token, data: erc20Interface.encodeFunctionData('balanceOf', [owner]) },
    'latest'
  ])
})

test('uses the permit owner and verifying contract', () => {
  expect(
    approvalBalanceTarget(
      approval({
        type: 'signErc20Permit',
        permit: {
          owner,
          chainId: 1,
          verifyingContract: { address: token }
        }
      })
    )
  ).toEqual({ owner, token, chainId: 1 })
  expect(() =>
    approvalBalanceTarget(
      approval({
        type: 'signErc20Permit',
        permit: {
          owner: spender,
          chainId: 1,
          verifyingContract: { address: token }
        }
      })
    )
  ).toThrow('owner')
})

test.each([
  { locked: true },
  { status: 'confirmed' },
  { type: 'sign' },
  {
    data: { to: token, chainId: '0x1', data: erc20Interface.encodeFunctionData('transfer', [spender, 1]) }
  }
])('rejects requests that are not editable approvals: %p', (overrides) => {
  expect(() => approvalBalanceTarget(approval(overrides))).toThrow()
})

test.each(['0x', '0x01', '-1', undefined, `0x${'0'.repeat(66)}`])(
  'does not treat malformed balance %p as zero',
  async (value) => {
    await expect(
      readApprovalBalance(
        approvalBalanceTarget(approval()),
        jest.fn(async () => value)
      )
    ).rejects.toThrow('unavailable')
  }
)

test('keeps a genuine zero distinct from an RPC failure', async () => {
  const target = approvalBalanceTarget(approval())
  await expect(
    readApprovalBalance(
      target,
      jest.fn(async () => `0x${'0'.repeat(64)}`)
    )
  ).resolves.toBe('0')
  await expect(
    readApprovalBalance(
      target,
      jest.fn(async () => {
        throw new Error('offline')
      })
    )
  ).rejects.toThrow('offline')
})
