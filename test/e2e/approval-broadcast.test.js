import { Interface, Wallet } from 'ethers'

import { executeWalletCallRuntime } from '../../main/provider/walletCallRuntime'
import { hashSignedTransaction } from '../../main/provider/walletCallExecution'
import { WalletCallBatchLedger } from '../../main/provider/walletCallBatches'
import { TokenApprovalsService } from '../../main/tokenApprovals/service'
import { GasFeesSource } from '../../resources/domain/transaction'
import { TARGET, createDappClient, profileStorage, receipt, startJsonRpcFixture } from './support/harness'

const wallet = new Wallet(`0x${'1'.padStart(64, '0')}`)
const account = wallet.address.toLowerCase()
const spender = '0x3333333333333333333333333333333333333333'
const abi = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)'
])
let upstream

afterEach(async () => {
  await upstream?.close()
})

it.each(['success', 'lost reply', 'wrong hash', 'declined'])(
  'tracks signed approval broadcast attempts without depending on the RPC reply: %s',
  async (mode) => {
    const accepted = []
    upstream = await startJsonRpcFixture(async ({ method, params }) => {
      if (method === 'eth_sendRawTransaction') {
        accepted.push(hashSignedTransaction(params[0]))
        if (mode === 'lost reply') throw new Error('Reply lost after acceptance')
        return { result: mode === 'wrong hash' ? `0x${'ff'.repeat(32)}` : accepted[0] }
      }
      if (method === 'eth_call') {
        const decoded = abi.decodeFunctionData('allowance', params[0].data)
        expect(decoded.owner.toLowerCase()).toBe(account)
        expect(decoded.spender.toLowerCase()).toBe(spender)
        expect(params[0].to).toBe(TARGET)
        return { result: abi.encodeFunctionResult('allowance', [100n]) }
      }
      throw new Error('Unexpected RPC method')
    })
    const rpc = createDappClient(upstream.url, 'https://wren-test.invalid')
    const storage = profileStorage(`broadcast-approvals-${mode}.json`)
    const batchStorage = profileStorage(`broadcast-batch-${mode}.json`)
    const dependencies = {
      load: () => storage.load(),
      save: (value) => storage.save(value),
      accounts: () => [account],
      chainEnabled: (chainId) => chainId === 1,
      rpc: (_chain, method, params) => rpc.request(method, params)
    }
    const approvals = new TokenApprovalsService(dependencies)
    const ledger = new WalletCallBatchLedger(batchStorage)
    const id = `approval-${mode}`
    const origin = 'https://wren-test.invalid'
    ledger.create({ id, origin, account, chainId: '0x1', callCount: 1 })
    const data = abi.encodeFunctionData('approve', [spender, 100n])
    const transaction = {
      from: account,
      to: TARGET,
      chainId: '0x1',
      nonce: '0x0',
      type: '0x2',
      gasLimit: '0x10000',
      data,
      value: '0x0',
      maxFeePerGas: '0x10',
      maxPriorityFeePerGas: '0x1',
      gasFeesSource: GasFeesSource.Frame
    }
    const execute = executeWalletCallRuntime(
      {
        id,
        origin,
        account,
        chainId: '0x1',
        calls: [{ to: TARGET, data, value: '0x0' }],
        preparation: { calls: [{ transaction, maxFee: '0x100000' }], maxFee: '0x100000' }
      },
      {
        ledger,
        recordSubmittedApproval: (tx, hash) => approvals.observeSubmitted(tx, hash),
        accounts: {
          signTransactionForAccount(owner, prepared, callback, beforeSign) {
            expect(owner).toBe(account)
            if (mode === 'declined') return callback(new Error('User declined'))
            beforeSign?.()
            const { from: _from, gasFeesSource: _source, ...tx } = prepared
            wallet.signTransaction(tx).then(
              (signed) => callback(null, signed),
              (error) => callback(error)
            )
          }
        },
        connection: {
          send(payload, callback, chain) {
            expect(chain).toMatchObject({ id: 1, type: 'ethereum' })
            rpc.request(payload.method, payload.params).then(
              (result) => callback({ id: payload.id, jsonrpc: '2.0', result }),
              (error) => callback({ id: payload.id, jsonrpc: '2.0', error })
            )
          }
        }
      }
    )
    if (mode === 'success') await expect(execute).resolves.toEqual(accepted)
    else await expect(execute).rejects.toThrow()
    if (mode === 'declined') {
      expect(accepted).toEqual([])
      expect(approvals.list(account)).toEqual([])
      return
    }

    expect(accepted).toHaveLength(1)
    const restarted = new TokenApprovalsService(dependencies)
    const [{ id: pairId }] = restarted.list(account)
    expect(restarted.list(account)[0]).toMatchObject({ token: TARGET, spender, status: 'unchecked' })
    const recoveredBatch = new WalletCallBatchLedger(batchStorage)
    if (mode !== 'success') {
      expect(recoveredBatch.listReconciliationCandidates()[0].hash).toBe(accepted[0])
      recoveredBatch.markTransactionSubmitted(origin, account, id, accepted[0])
      recoveredBatch.complete(origin, account, id)
    }
    recoveredBatch.recordReceipt(origin, account, id, receipt(accepted[0]))
    expect(recoveredBatch.getStatus(origin, account, id).status).toBe(200)
    await restarted.afterExecution(1, accepted[0], 'canonical receipt')
    expect(restarted.list(account)[0]).toMatchObject({ id: pairId, status: 'current', amount: '100' })
    expect(accepted).toHaveLength(1)
  }
)
