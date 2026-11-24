import { Interface, Transaction, Wallet } from 'ethers'

import accounts from '../../main/accounts'
import Account from '../../main/accounts/Account'
import { RequestStatus } from '../../main/accounts/types'
import connection from '../../main/chains'
import provider from '../../main/provider'
import { createAccountPermission } from '../../main/provider/permissions'
import signers from '../../main/signers'
import store from '../../main/store'
import { recordSubmittedTokenApproval } from '../../main/tokenApprovals/runtime'
import { inspectTransactionAccountCode } from '../../main/transaction/simulation'
import { originIdForInvoker } from '../../resources/domain/origin'
import { GasFeesSource } from '../../resources/domain/transaction'
import { createDappClient, startJsonRpcFixture, TARGET } from './support/harness'
import { saveIssueEvidence } from './support/issue105'

jest.mock('../../main/accounts', () => ({}))
jest.mock('../../main/chains', () =>
  Object.assign(new (require('events').EventEmitter)(), { send: jest.fn() })
)
jest.mock('../../main/provider/proxy', () => new (require('events').EventEmitter)())
jest.mock('../../main/reveal', () => ({}))
jest.mock('../../main/signers', () => ({ get: jest.fn() }))
jest.mock('../../main/store')
jest.mock('../../main/store/persist', () => ({ commitMainState: jest.fn() }))
jest.mock('../../main/tokenApprovals/runtime', () => ({ recordSubmittedTokenApproval: jest.fn() }))
jest.mock('../../main/windows', () => ({}))
jest.mock('../../main/windows/nav', () => ({}))
jest.mock('../../main/nebula', () => () => ({ ready: () => false, once() {} }))

const wallet = new Wallet(`0x${'4'.repeat(64)}`)
const site = 'https://wren-signing.invalid'
const address = wallet.address.toLowerCase()
const origin = originIdForInvoker(site, { provenance: 'direct' })
const abi = new Interface(['function approve(address spender, uint256 amount)'])
const chain = { type: 'ethereum', id: 1 }
const evidence = []
let account
let upstream

afterEach(async () => {
  account?.close()
  await upstream?.close()
})

afterAll(() => saveIssueEvidence('single-transaction-broadcast', { evidence }))

it.each(['native EIP-1559', 'legacy fallback', 'changed fallback fee'])(
  'checks the real single-transaction signing handoff before RPC broadcast: %s',
  async (mode) => {
    const legacy = mode !== 'native EIP-1559'
    const changed = mode === 'changed fallback fee'
    const admitted = []
    const broadcasts = []
    upstream = await startJsonRpcFixture(({ method, params }) => {
      if (method === 'eth_getCode') return { result: '0x' }
      if (method === 'eth_getBalance') return { result: '0xffffffffffffffff' }
      if (method === 'eth_sendRawTransaction') {
        const signed = Transaction.from(params[0])
        broadcasts.push(signed)
        return { result: signed.hash }
      }
      throw new Error('Unexpected RPC method')
    })
    const rpc = createDappClient(upstream.url, site)
    connection.send = ({ id, jsonrpc, method, params }, complete, route) => {
      expect(route).toEqual(chain)
      rpc.request(method, params).then(
        (result) => complete({ id, jsonrpc, result }),
        (error) => complete({ id, jsonrpc, error })
      )
    }
    store.set('main.origins', origin, {
      name: site,
      provenance: 'direct',
      chain,
      session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
    })
    store.set(
      'main.permissions',
      address,
      origin,
      createAccountPermission({
        account: address,
        chains: [1],
        handlerId: origin,
        origin: site
      })
    )
    account = new Account({ address, name: 'Signer fixture', created: '1:1', active: true }, { update() {} })
    account.signer = 'fixture'
    const tx = {
      chainId: '0x1',
      from: address,
      to: TARGET,
      nonce: '0x0',
      type: '0x2',
      data: abi.encodeFunctionData('approve', [address, 100n]),
      gasLimit: '0x10000',
      value: '0x0',
      maxFeePerGas: '0x10',
      maxPriorityFeePerGas: '0x2',
      gasFeesSource: GasFeesSource.Frame
    }
    const request = {
      type: 'transaction',
      account: address,
      origin,
      handlerId: 'verified-signing',
      data: tx,
      status: RequestStatus.Pending,
      approvals: [],
      payload: { id: 1, method: 'eth_sendTransaction', jsonrpc: '2.0' },
      simulation: {
        status: 'succeeded',
        accountCodeEvidence: await inspectTransactionAccountCode(tx, { send: connection.send })
      }
    }
    account.requests[request.handlerId] = request
    Object.assign(accounts, {
      getActiveRequestForAccount: (_owner, id) => account.getRequest(id),
      signTransactionForAccount: (_owner, transaction, callback, beforeSign) =>
        account.signTransaction(transaction, callback, beforeSign),
      lockRequest: () => {
        request.locked = true
      },
      markRequestResponseSettled: jest.fn(),
      setTxSigned: jest.fn((_id, done) => done(null)),
      transactionSubmissionContext: () => ({ chainId: 1 }),
      admitTxBroadcast: (_id, hash) => {
        admitted.push(hash)
        return true
      },
      startTxBroadcastMonitoring: () => {},
      setTxSent: () => true
    })
    const signTransaction = jest.fn((_index, transaction, callback) => {
      const { gasFeesSource: _source, maxFeePerGas, maxPriorityFeePerGas, ...data } = transaction
      const fees = legacy
        ? { type: 0, gasPrice: changed ? BigInt(maxFeePerGas) + 1n : maxFeePerGas }
        : { type: 2, maxFeePerGas, maxPriorityFeePerGas }
      wallet.signTransaction({ ...data, ...fees }).then(
        (signed) => callback(null, signed),
        (error) => callback(error)
      )
    })
    signers.get.mockReturnValue({
      addresses: [address],
      type: 'ledger',
      summary: () => ({ type: 'ledger', appVersion: { major: 1, minor: legacy ? 8 : 9, patch: 0 } }),
      signTransaction
    })
    provider.prepareDappGuardrailReview(request)

    const result = new Promise((resolve, reject) =>
      provider.approveTransactionRequest(request, (error, hash) => (error ? reject(error) : resolve(hash)))
    )
    if (changed) {
      await expect(result).rejects.toThrow(/does not match the approved transaction/)
      expect(accounts.setTxSigned).not.toHaveBeenCalled()
      expect(admitted).toEqual([])
      expect(broadcasts).toEqual([])
      expect(recordSubmittedTokenApproval).not.toHaveBeenCalled()
    } else {
      await expect(result).resolves.toMatch(/^0x[0-9a-f]{64}$/)
      expect(broadcasts).toHaveLength(1)
      expect(admitted).toEqual([broadcasts[0].hash])
      expect(broadcasts[0]).toMatchObject({ type: legacy ? 0 : 2, data: tx.data })
      expect(recordSubmittedTokenApproval).toHaveBeenCalledTimes(1)
    }
    expect(signTransaction).toHaveBeenCalledTimes(1)
    const methods = upstream.requests.map(({ payload }) => payload.method)
    expect(methods.sort()).toEqual([
      'eth_getBalance',
      ...Array(4).fill('eth_getCode'),
      ...(changed ? [] : ['eth_sendRawTransaction'])
    ])
    evidence.push({ mode, broadcasts: broadcasts.length, admitted: admitted.length, methods })
  }
)
