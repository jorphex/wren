import { applyRequestUpdate } from '../../../main/rpc/updateRequest'

const reqId = 'approval-request'
const accountId = '0x0000000000000000000000000000000000000001'
const actionId = 'erc20:approve'
const data = { amount: '42' }

it('accepts an applied request update with exact arguments', () => {
  const accounts = { updateRequest: jest.fn(() => true) }

  expect(() => applyRequestUpdate(accounts, reqId, data, actionId, accountId)).not.toThrow()
  expect(accounts.updateRequest).toHaveBeenCalledWith(reqId, data, actionId, accountId)
})

it('rejects an ignored request update so the renderer can retry', () => {
  const accounts = { updateRequest: jest.fn(() => false) }

  expect(() => applyRequestUpdate(accounts, reqId, data, actionId, accountId)).toThrow(
    'Request update was not applied'
  )
})
