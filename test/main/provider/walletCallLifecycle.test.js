import { WalletCallBatchLedger } from '../../../main/provider/walletCallBatches'
import { WalletCallLifecycleController } from '../../../main/provider/walletCallLifecycle'
import { bindRequestSignal, getRequestSignal } from '../../../main/provider/requestSignal'
import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'
const claimEvidence = Object.freeze({ execution: Object.freeze({}), simulation: '{}' })

function storage() {
  let batches = {}
  return {
    load: () => JSON.parse(JSON.stringify(batches)),
    save: (value) => {
      batches = JSON.parse(JSON.stringify(value))
    }
  }
}

function input(overrides = {}) {
  return {
    handlerId: 'handler-id',
    origin: 'example.test',
    account,
    payload: {
      id: 7,
      jsonrpc: '2.0',
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          from: account,
          chainId: '0xa',
          atomicRequired: false,
          calls: [{ to: target, data: '0xabcd', value: '0x0' }]
        }
      ]
    },
    ...overrides
  }
}

function snapshot(request) {
  return Object.freeze({
    id: request.batchId,
    origin: request.origin,
    account: request.account,
    chainId: request.chainId,
    calls: request.calls,
    preparation: {
      calls: [],
      maxFee: '0x0'
    }
  })
}

function dependencies() {
  const operationLifecycles = new OperationLifecycleLedger(storage())
  const ledger = new WalletCallBatchLedger(storage(), operationLifecycles)
  const requests = new Map()
  const events = []
  const accounts = {
    addRequestForAccount: jest.fn((accountId, request, responder) => {
      expect(accountId).toBe(request.account)
      request.res = responder
      requests.set(request.handlerId, request)
      events.push('request')
      return true
    }),
    claimWalletCallsRequestWithResponse: jest.fn((accountId, handlerId) => {
      const request = requests.get(handlerId)
      if (!request || request.account !== accountId) throw new Error('request unavailable')
      request.locked = true
      request.status = 'pending'
      const responder = request.res
      delete request.res
      events.push('claim')
      return Object.freeze({ snapshot: snapshot(request), responder })
    }),
    settleWalletCallsRequest: jest.fn((_accountId, _handlerId, error) => {
      events.push(error ? `error:${error.message}` : 'success')
      return true
    })
  }
  const execute = jest.fn(async () => {
    events.push('execute')
    return ['0xhash']
  })
  const reportError = jest.fn()
  const deps = { ledger, accounts, execute, reportError }
  return {
    ledger,
    accounts,
    execute,
    reportError,
    operationLifecycles,
    requests,
    events,
    controller: new WalletCallLifecycleController(deps),
    deps
  }
}

it('admits an account-bound one-shot responder without publishing the batch id', () => {
  const { controller, ledger, requests } = dependencies()
  const respond = jest.fn()

  const admitted = controller.admit(input(), respond)
  const request = requests.get('handler-id')

  expect(respond).not.toHaveBeenCalled()
  expect(request.res.walletCallsLifecycle).toBe(true)
  expect(typeof request.res.accept).toBe('function')
  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(100)
})

it('carries transport ownership onto the admitted account responder', () => {
  const { controller, requests } = dependencies()
  const abortController = new AbortController()
  const respond = bindRequestSignal(jest.fn(), abortController.signal)

  controller.admit(input(), respond)

  expect(getRequestSignal(requests.get('handler-id').res)).toBe(abortController.signal)
})

it('durably closes a rejected review before returning its error exactly once', () => {
  const { controller, ledger, operationLifecycles, requests } = dependencies()
  const respond = jest.fn()
  const admitted = controller.admit(input(), respond)
  const rejection = {
    id: 999,
    jsonrpc: 'mutated',
    error: { code: 4001, message: 'User rejected request' }
  }

  requests.get('handler-id').res(rejection)
  requests.get('handler-id').res(rejection)

  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(400)
  expect(respond).toHaveBeenCalledTimes(1)
  expect(respond).toHaveBeenCalledWith({
    id: 7,
    jsonrpc: '2.0',
    error: { code: 4001, message: 'User rejected request' }
  })
  expect(operationLifecycles.listStored()).toEqual([])
})

it('fails closed when generic account resolution bypasses approval', () => {
  const { controller, ledger, requests } = dependencies()
  const respond = jest.fn()
  const admitted = controller.admit(input(), respond)

  requests.get('handler-id').res({ id: 7, jsonrpc: '2.0', result: { id: admitted.id } })

  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(400)
  expect(respond.mock.calls[0][0].error).toMatchObject({ code: -32603 })
})

it('publishes the id after claim and then executes and settles the exact request', async () => {
  const { controller, accounts, execute, events } = dependencies()
  const respond = jest.fn(() => events.push('response'))
  const admitted = controller.admit(input(), respond)

  await expect(controller.approve(account, 'handler-id', claimEvidence)).resolves.toEqual(['0xhash'])

  expect(respond).toHaveBeenCalledWith({ id: 7, jsonrpc: '2.0', result: { id: admitted.id } })
  expect(events).toEqual(['request', 'claim', 'response', 'execute', 'success'])
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: admitted.id, account }), 'handler-id')
  expect(accounts.settleWalletCallsRequest).toHaveBeenCalledWith(account, 'handler-id', undefined)
})

it('threads explicit simulation acknowledgement to the authoritative claim', async () => {
  const { controller, accounts } = dependencies()
  controller.admit(input(), jest.fn())

  await expect(controller.approve(account, 'handler-id', claimEvidence, true)).resolves.toEqual(['0xhash'])

  expect(accounts.claimWalletCallsRequestWithResponse).toHaveBeenCalledWith(
    account,
    'handler-id',
    claimEvidence,
    true
  )
})

it('keeps the published id and reports a terminal execution failure through status', async () => {
  const { controller, ledger, execute, accounts } = dependencies()
  const respond = jest.fn()
  const admitted = controller.admit(input(), respond)
  execute.mockImplementationOnce(async (execution) => {
    ledger.fail(execution.origin, execution.account, execution.id)
    throw new Error('device declined')
  })

  await expect(controller.approve(account, 'handler-id', claimEvidence)).rejects.toThrow(/device declined/)

  expect(respond).toHaveBeenCalledWith({ id: 7, jsonrpc: '2.0', result: { id: admitted.id } })
  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(400)
  expect(accounts.settleWalletCallsRequest).toHaveBeenCalledWith(
    account,
    'handler-id',
    expect.objectContaining({ message: 'device declined' })
  )
})

it('leaves an ambiguous execution pending for reconciliation', async () => {
  const { controller, ledger, execute } = dependencies()
  const admitted = controller.admit(input(), jest.fn())
  execute.mockRejectedValueOnce(new Error('connection closed after signed submission'))

  await expect(controller.approve(account, 'handler-id', claimEvidence)).rejects.toThrow(/connection closed/)

  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(100)
})

it('reports response and outcome callback failures without skipping execution', async () => {
  const { controller, accounts, execute, reportError } = dependencies()
  accounts.settleWalletCallsRequest.mockImplementationOnce(() => {
    throw new Error('review store unavailable')
  })
  const respond = jest.fn(() => {
    throw new Error('transport closed')
  })
  controller.admit(input(), respond)

  await expect(controller.approve(account, 'handler-id', claimEvidence)).resolves.toEqual(['0xhash'])

  expect(execute).toHaveBeenCalledTimes(1)
  expect(reportError.mock.calls.map(([error]) => error.message)).toEqual([
    'transport closed',
    'review store unavailable'
  ])
})

it('preserves the rejection when its status transition cannot be persisted', () => {
  const setup = dependencies()
  const { ledger, requests, reportError } = setup
  jest.spyOn(ledger, 'fail').mockImplementation(() => {
    throw new Error('persistence unavailable')
  })
  const controller = new WalletCallLifecycleController(setup.deps)
  const respond = jest.fn()
  controller.admit(input(), respond)

  requests.get('handler-id').res({ id: 7, jsonrpc: '2.0', error: { code: 4001, message: 'Rejected' } })

  expect(respond.mock.calls[0][0].error.code).toBe(4001)
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'persistence unavailable' }))
})

it('snapshots lifecycle dependencies before caller mutation', async () => {
  const { controller, deps, accounts, execute, ledger } = dependencies()
  const originalClaim = accounts.claimWalletCallsRequestWithResponse
  const originalSettle = accounts.settleWalletCallsRequest
  deps.ledger.create = jest.fn(() => {
    throw new Error('redirected ledger creation')
  })
  deps.accounts.claimWalletCallsRequestWithResponse = jest.fn(() => {
    throw new Error('redirected claim')
  })
  deps.accounts.settleWalletCallsRequest = jest.fn(() => {
    throw new Error('redirected settlement')
  })
  deps.execute = jest.fn(() => {
    throw new Error('redirected execution')
  })
  const admitted = controller.admit(input(), jest.fn())

  await expect(controller.approve(account, 'handler-id', claimEvidence)).resolves.toEqual(['0xhash'])

  expect(originalClaim).toHaveBeenCalledTimes(1)
  expect(originalSettle).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(100)
})

it('snapshots the ledger failure transition before caller mutation', () => {
  const { controller, ledger, requests, reportError } = dependencies()
  const respond = jest.fn()
  ledger.fail = jest.fn(() => {
    throw new Error('redirected ledger failure')
  })
  const admitted = controller.admit(input(), respond)

  requests.get('handler-id').res({ id: 7, jsonrpc: '2.0', error: { code: 4001, message: 'Rejected' } })

  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(400)
  expect(reportError).not.toHaveBeenCalled()
})
