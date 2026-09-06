import { erc20Interface } from '../../resources/contracts'
import { parseRpcQuantity } from '../../resources/domain/transaction/quantity'
import { operationLifecycleRpc, type OperationLifecycleRpc } from '../operationLifecycle/rpc'
import type { AnyAccountRequest } from './types'

export function approvalBalanceTarget(request: AnyAccountRequest) {
  let chainId: number
  let token: string
  if (request.status !== undefined) throw new Error('Approval is no longer editable')
  if (request.type === 'transaction') {
    if (request.locked) throw new Error('Approval is being updated')
    erc20Interface.decodeFunctionData('approve', request.data.data || '0x')
    chainId = Number(parseRpcQuantity(request.data.chainId))
    token = request.data.to || ''
  } else if (request.type === 'signErc20Permit') {
    if (request.permit.owner.toLowerCase() !== request.account.toLowerCase()) {
      throw new Error('Permit owner does not match the account')
    }
    chainId = Number(request.permit.chainId)
    token = request.permit.verifyingContract.address
  } else throw new Error('Request is not an editable token approval')
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[0-9a-fA-F]{40}$/u.test(token)) {
    throw new Error('Approval token or network is unavailable')
  }
  return { chainId, token: token.toLowerCase(), owner: request.account.toLowerCase() }
}

export async function readApprovalBalance(
  target: ReturnType<typeof approvalBalanceTarget>,
  rpc: OperationLifecycleRpc = operationLifecycleRpc
): Promise<string> {
  const result = await rpc(target.chainId, 'eth_call', [
    { to: target.token, data: erc20Interface.encodeFunctionData('balanceOf', [target.owner]) },
    'latest'
  ])
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(result)) {
    throw new Error('Token balance is unavailable')
  }
  return BigInt(result).toString(10)
}
