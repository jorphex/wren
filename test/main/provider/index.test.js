import log from 'electron-log'
import { parseUnits, toBeHex } from 'ethers'
import { validate as validateUUID } from 'uuid'
import { addHexPrefix, intToHex } from '@ethereumjs/util'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import provider from '../../../main/provider'
import accounts from '../../../main/accounts'
import connection from '../../../main/chains'
import store from '../../../main/store'
import chainConfig from '../../../main/chains/config'
import { hasSubscriptionPermission } from '../../../main/provider/subscriptions'
import { toRpcQuantity } from '../../../resources/domain/transaction/quantity'
import { gweiToHex } from '../../../resources/utils'
import { Type as SignerType } from '../../../resources/domain/signer'
import Erc20Contract from '../../../main/contracts/erc20'
import { resolveErc1046Metadata } from '../../../main/provider/erc1046'
import walletCallBatchLedger from '../../../main/provider/walletCallLedger'
import { executeWalletCallRuntime } from '../../../main/provider/walletCallRuntime'
import walletCallEvidenceRuntime from '../../../main/provider/walletCallEvidenceRuntime'
import { showWalletCallStatus } from '../../../main/provider/walletCallStatusView'
import { ApprovalType } from '../../../resources/constants'
import { bindRequestSignal } from '../../../main/provider/requestSignal'
import { createAccountPermission } from '../../../main/provider/permissions'

const address = '0x22dd63c3619818fdbc262c78baee43cb61e9cccf'
const defaultOriginId = '8073729a-5e59-53b7-9e69-5d9bcff94087'

const grant = (originId = defaultOriginId, origin = 'example.test', chains = [1, 5, 99]) =>
  createAccountPermission({ account: address, chains, handlerId: originId, origin })

let accountRequests = []
let currentAccount

jest.mock('../../../main/store')
jest.mock('../../../main/chains', () => ({ send: jest.fn(), syncDataEmit: jest.fn(), on: jest.fn() }))
jest.mock('../../../main/accounts', () => ({}))
jest.mock('../../../main/reveal', () => ({
  resolveEntityType: jest.fn().mockResolvedValue('external')
}))
jest.mock('../../../main/contracts/erc20', () => jest.fn())
jest.mock('../../../main/provider/erc1046', () => ({
  ...jest.requireActual('../../../main/provider/erc1046'),
  resolveErc1046Metadata: jest.fn()
}))
jest.mock('../../../main/provider/walletCallRuntime', () => ({ executeWalletCallRuntime: jest.fn() }))
jest.mock('../../../main/provider/walletCallEvidenceRuntime', () => ({
  __esModule: true,
  default: { wake: jest.fn() }
}))
jest.mock('../../../main/provider/walletCallStatusView', () => ({ showWalletCallStatus: jest.fn() }))

jest.mock('../../../main/provider/subscriptions', () => {
  const { SubscriptionType } = jest.requireActual('../../../main/provider/subscriptions')
  return {
    SubscriptionType,
    hasSubscriptionPermission: jest.fn()
  }
})

beforeAll(async () => {
  log.transports.console.level = false

  accounts.getAccounts = () => [address]
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

beforeEach(() => {
  store.set('main.colorway', 'light')
  store.set('main.accounts', {})
  store.set('main.origins', {})
  store.set('main.permissions', {})
  store.set('main.walletCallBatches', {})
  store.setWalletCallBatches = jest.fn((batches) => store.set('main.walletCallBatches', batches))
  showWalletCallStatus.mockClear()

  provider.handlers = {}

  const eventTypes = ['accountsChanged', 'chainChanged', 'chainsChanged', 'assetsChanged', 'networkChanged']
  eventTypes.forEach((eventType) => (provider.subscriptions[eventType] = []))

  accountRequests = []
  accounts.addRequest = jest.fn((req, res) => {
    store.set('main.accounts', req.account, 'requests', { [req.handlerId]: req })
    accountRequests.push(req)
    if (res) res()
  })
  accounts.addRequestForAccount = jest.fn((accountId, req, res) => {
    if (accountId !== req.account) throw new Error('wrong request account')
    req.res = res
    if (req.type === 'transaction') {
      store.set('main.accounts', req.account, 'requests', { [req.handlerId]: req })
    }
    accountRequests.push(req)
    if (req.type === 'transaction' && res) res()
    return true
  })
  accounts.claimWalletCallsRequestWithResponse = jest.fn((accountId, handlerId) => {
    const request = accountRequests.find((candidate) => candidate.handlerId === handlerId)
    if (!request || request.account !== accountId || typeof request.res?.accept !== 'function') {
      throw new Error('wallet-call request unavailable')
    }
    request.locked = true
    request.status = 'pending'
    const responder = request.res
    delete request.res
    return {
      snapshot: {
        id: request.batchId,
        origin: request.origin,
        account: request.account,
        chainId: request.chainId,
        calls: request.calls,
        preparation: request.preparation
      },
      responder
    }
  })
  accounts.settleWalletCallsRequest = jest.fn(() => true)
  accounts.getRequestForAccount = jest.fn((accountId, handlerId) => {
    const request = accountRequests.find((candidate) => candidate.handlerId === handlerId)
    if (!request || request.account !== accountId) throw new Error('wallet-call request unavailable')
    return request
  })
  accounts.refreshRequestAddressSafety = jest.fn((accountId, handlerId) => {
    const request = accounts.getRequestForAccount(accountId, handlerId)
    request.addressSafety ||= { assessedAt: Date.now(), fingerprint: 'none', targets: [] }
    return request.addressSafety
  })
  accounts.getActiveRequestForAccount = jest.fn((accountId, handlerId) => {
    const request = accountRequests.find((candidate) => candidate.handlerId === handlerId)
    if (!request || request.account !== accountId) throw new Error('request is waiting for review')
    return request
  })
  accounts.rejectRequestForAccount = jest.fn((accountId, handlerId, error) => {
    const index = accountRequests.findIndex((candidate) => candidate.handlerId === handlerId)
    const request = accountRequests[index]
    if (!request || request.account !== accountId) throw new Error('wallet-call request unavailable')
    request.res({ id: request.payload.id, jsonrpc: request.payload.jsonrpc, error })
    accountRequests.splice(index, 1)
    return true
  })
  accounts.declineRequest = jest.fn((handlerId, accountId) => {
    const request = accountRequests.find((candidate) => candidate.handlerId === handlerId)
    if (!request || request.account !== accountId || request.status !== undefined) return false
    request.status = 'declined'
    request.notice = 'Request declined'
    return true
  })

  connection.send = jest.fn()
  connection.connections = {
    ethereum: {
      1: { chainConfig: chainConfig(1, 'london'), primary: { connected: true } },
      5: { chainConfig: chainConfig(5, 'london'), primary: { connected: true } }
    }
  }

  currentAccount = {
    id: address,
    getAccounts: () => [address],
    getSelectedAddress: () => address,
    getRequest: (handlerId) => accountRequests.find((request) => request.handlerId === handlerId),
    rejectRequest: jest.fn(),
    rejectUnapprovedRequestsForOriginChain: jest.fn(),
    resolveRequest: jest.fn()
  }
  accounts.current = jest.fn(() => currentAccount)
  accounts.getSelectedAddresses = jest.fn(() => [address])
  accounts.get = jest.fn((addr) =>
    addr === address ? { id: address, address, lastSignerType: 'ring' } : undefined
  )
  accounts.signTransaction = jest.fn()
  accounts.signTransactionForAccount = jest.fn()
  accounts.setTxSigned = jest.fn()
  accounts.lockRequest = jest.fn()
  accounts.rejectUnapprovedRequestsForOriginChain = jest.fn()
  executeWalletCallRuntime.mockReset()
  executeWalletCallRuntime.mockResolvedValue(['0xhash'])
  walletCallEvidenceRuntime.wake.mockReset()
})

describe('#approveTransactionRequest', () => {
  it('refuses to lock or sign while the execution check is pending', (done) => {
    provider.approveTransactionRequest(
      {
        handlerId: 'pending-simulation',
        data: { nonce: '0x1' },
        simulation: { status: 'pending' }
      },
      (error) => {
        expect(error.message).toMatch(/execution check is still pending/i)
        expect(accounts.lockRequest).not.toHaveBeenCalled()
        expect(accounts.signTransactionForAccount).not.toHaveBeenCalled()
        done()
      }
    )
  })

  it('refuses to lock or sign while a required approval is unconfirmed', (done) => {
    provider.approveTransactionRequest(
      {
        handlerId: 'unconfirmed-approval',
        data: { nonce: '0x1' },
        simulation: { status: 'succeeded' },
        approvals: [{ type: 'testApproval', approved: false }]
      },
      (error) => {
        expect(error.message).toMatch(/unconfirmed required approval/i)
        expect(accounts.lockRequest).not.toHaveBeenCalled()
        expect(accounts.signTransactionForAccount).not.toHaveBeenCalled()
        done()
      }
    )
  })
})

describe('#approveSignTypedData', () => {
  it('refuses to sign generic typed data while risk consent is unconfirmed', (done) => {
    accounts.signTypedData = jest.fn()

    provider.approveSignTypedData(
      {
        handlerId: 'unconfirmed-typed-data',
        type: 'signTypedData',
        approvals: [{ type: 'approveDangerousSignature', approved: false }]
      },
      (error) => {
        expect(error.message).toMatch(/missing or unconfirmed/i)
        expect(accounts.signTypedData).not.toHaveBeenCalled()
        done()
      }
    )
  })

  it('refuses to sign a permit while its required approval is unconfirmed', (done) => {
    accounts.signTypedData = jest.fn()

    provider.approveSignTypedData(
      {
        handlerId: 'unconfirmed-permit',
        type: 'signErc20Permit',
        approvals: [{ type: 'approveUnlimitedTokenPermit', approved: false }]
      },
      (error) => {
        expect(error.message).toMatch(/missing or unconfirmed/i)
        expect(accounts.signTypedData).not.toHaveBeenCalled()
        done()
      }
    )
  })

  it('fails closed when permit approval state is missing', (done) => {
    accounts.signTypedData = jest.fn()

    provider.approveSignTypedData(
      { handlerId: 'missing-permit-approval', type: 'signErc20Permit' },
      (error) => {
        expect(error.message).toMatch(/missing or unconfirmed/i)
        expect(accounts.signTypedData).not.toHaveBeenCalled()
        done()
      }
    )
  })
})

describe('#approveSign', () => {
  it('refuses to sign a message while risk consent is unconfirmed', (done) => {
    const request = {
      handlerId: 'unconfirmed-message',
      type: 'sign',
      account: address,
      payload: { params: [address, '0x01'] },
      data: { rawMessage: '0x01' },
      approvals: [{ type: 'approveDangerousSignature', approved: false }]
    }
    accountRequests.push(request)
    accounts.signMessage = jest.fn()

    provider.approveSign(request, (error) => {
      expect(error.message).toMatch(/missing or unconfirmed/i)
      expect(accounts.signMessage).not.toHaveBeenCalled()
      done()
    })
  })

  it.each([
    ['success', null, '0xsignature'],
    ['error', new Error('signer unavailable'), undefined]
  ])('releases the message handler exactly once on %s', (_label, signerError, signature, done) => {
    const handlerId = `message-${_label}`
    const response = jest.fn()
    const request = {
      handlerId,
      type: 'sign',
      account: address,
      payload: { id: 2, jsonrpc: '2.0', method: 'personal_sign', params: [address, '0x01'] },
      data: { rawMessage: '0x01' },
      approvals: []
    }
    accountRequests.push(request)
    provider.handlers[handlerId] = response
    accounts.signMessage = jest.fn((_address, _message, callback) => callback(signerError, signature))
    const verify = jest
      .spyOn(provider, 'verifySignature')
      .mockImplementation((_signature, _message, _address, callback) => callback(null, true))

    provider.approveSign(request, (error) => {
      try {
        if (signerError) expect(error).toBe(signerError)
        else expect(error).toBeNull()
        expect(response).toHaveBeenCalledTimes(1)
        expect(provider.handlers).toEqual({})
        done()
      } catch (testError) {
        done(testError)
      } finally {
        verify.mockRestore()
      }
    })
  })
})

describe('#declineRequest', () => {
  it.each(['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'])(
    'returns a method-neutral rejection for %s',
    (method) => {
      const respond = jest.fn()
      const handlerId = `decline-${method}`
      provider.handlers[handlerId] = respond

      provider.declineRequest({
        handlerId,
        payload: { id: 1, jsonrpc: '2.0', method, params: [] }
      })

      expect(respond).toHaveBeenCalledWith({
        id: 1,
        jsonrpc: '2.0',
        error: { code: 4001, message: 'User rejected the request' }
      })
      expect(provider.handlers).toEqual({})
    }
  )
})

describe('#wallet-call provider boundary', () => {
  const originId = '8073729a-5e59-53b7-9e69-5d9bcff94087'
  const payload = (overrides = {}) => ({
    id: 71,
    jsonrpc: '2.0',
    method: 'wallet_sendCalls',
    _origin: originId,
    params: [
      {
        version: '2.0.0',
        from: address,
        chainId: '0x1',
        atomicRequired: false,
        calls: [{ to: address, data: '0x', value: '0x0' }],
        ...overrides
      }
    ]
  })

  const authorize = () => {
    store.set('main.origins', originId, {
      chain: { id: 1, type: 'ethereum' },
      name: 'example.test'
    })
    store.set('main.permissions', address, {
      [originId]: grant()
    })
    store.set('main.networks.ethereum', 1, { id: 1, on: true })
  }

  beforeEach(authorize)

  it.each([
    ['wallet_sendCalls', 'sendWalletCalls'],
    ['wallet_getCallsStatus', 'getWalletCallsStatus'],
    ['wallet_showCallsStatus', 'showWalletCallsStatus'],
    ['wallet_getCapabilities', 'getWalletCallCapabilities']
  ])('dispatches %s internally instead of forwarding it to a chain RPC', (method, handler) => {
    const response = jest.fn()
    const dispatch = jest.spyOn(provider, handler).mockImplementation(() => 'handled')
    const request = { id: 70, jsonrpc: '2.0', method, params: [], _origin: originId }

    expect(provider.send(request, response)).toBe('handled')

    expect(dispatch).toHaveBeenCalledWith(request, response)
    expect(connection.send).not.toHaveBeenCalled()
    dispatch.mockRestore()
  })

  it('admits an authorized request without allocating a global provider handler', () => {
    const respond = jest.fn()

    const admitted = provider.sendWalletCalls(payload(), respond)

    expect(admitted).toMatchObject({ origin: originId, account: address, chainId: '0x1' })
    expect(validateUUID(admitted.handlerId)).toBe(true)
    expect(accountRequests).toHaveLength(1)
    expect(accountRequests[0]).toMatchObject({
      handlerId: admitted.handlerId,
      batchId: admitted.id,
      origin: originId,
      account: address,
      type: 'walletCalls'
    })
    expect(provider.handlers).toEqual({})
    expect(respond).not.toHaveBeenCalled()
    expect(walletCallBatchLedger.getStatus(originId, address, admitted.id).status).toBe(100)
  })

  it.each([
    ['unauthorized origin', () => store.set('main.permissions', {}), payload(), 4100],
    ['wrong sender', () => {}, payload({ from: '0x3333333333333333333333333333333333333333' }), 4100],
    ['chain outside the grant', () => {}, payload({ chainId: '0xa' }), 4100],
    ['disabled chain', () => store.set('main.networks.ethereum', 1, { id: 1, on: false }), payload(), 5710],
    [
      'disconnected chain',
      () => {
        connection.connections.ethereum[1].primary.connected = false
      },
      payload(),
      5710
    ]
  ])('rejects a request from an %s before admission', (_label, arrange, request, code) => {
    arrange()
    const respond = jest.fn()

    expect(provider.sendWalletCalls(request, respond)).toBeUndefined()

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code }) })
    )
    expect(accounts.addRequestForAccount).not.toHaveBeenCalled()
    expect(store('main.walletCallBatches')).toEqual({})
    expect(provider.handlers).toEqual({})
  })

  it('rejects required atomicity before allocating review or persistent batch state', () => {
    const respond = jest.fn()

    expect(provider.sendWalletCalls(payload({ atomicRequired: true }), respond)).toBeUndefined()

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 5760 }) })
    )
    expect(accounts.addRequestForAccount).not.toHaveBeenCalled()
    expect(accountRequests).toHaveLength(0)
    expect(store('main.walletCallBatches')).toEqual({})
    expect(provider.handlers).toEqual({})
  })

  it('approves against the captured account after current-account selection changes', async () => {
    const events = []
    const respond = jest.fn(() => events.push('response'))
    executeWalletCallRuntime.mockImplementationOnce(async (_input, dependencies) => {
      events.push('execute')
      dependencies.evidenceAvailable()
      return ['0xhash']
    })
    const admitted = provider.sendWalletCalls(payload(), respond)
    currentAccount = { id: '0x3333333333333333333333333333333333333333' }

    await expect(provider.approveWalletCallsRequest(address, admitted.handlerId)).resolves.toEqual(['0xhash'])

    expect(respond).toHaveBeenCalledWith({ id: 71, jsonrpc: '2.0', result: { id: admitted.id } })
    expect(events).toEqual(['response', 'execute'])
    expect(accounts.claimWalletCallsRequestWithResponse).toHaveBeenCalledWith(
      address,
      admitted.handlerId,
      false
    )
    expect(executeWalletCallRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ id: admitted.id, origin: originId, account: address, chainId: '0x1' }),
      expect.objectContaining({
        accounts,
        connection,
        ledger: walletCallBatchLedger,
        evidenceAvailable: expect.any(Function)
      })
    )
    expect(accounts.settleWalletCallsRequest).toHaveBeenCalledWith(address, admitted.handlerId, undefined)
    expect(walletCallEvidenceRuntime.wake).toHaveBeenCalledTimes(1)
    expect(provider.handlers).toEqual({})
  })

  it('wakes evidence reconciliation after an execution failure', async () => {
    const failure = new Error('broadcast outcome is ambiguous')
    executeWalletCallRuntime.mockImplementationOnce(async (_input, dependencies) => {
      dependencies.evidenceAvailable()
      throw failure
    })
    const admitted = provider.sendWalletCalls(payload(), jest.fn())

    await expect(provider.approveWalletCallsRequest(address, admitted.handlerId)).rejects.toThrow(failure)

    expect(walletCallEvidenceRuntime.wake).toHaveBeenCalledTimes(1)
    expect(accounts.settleWalletCallsRequest).toHaveBeenCalledWith(address, admitted.handlerId, failure)
  })

  it('rechecks lookalike evidence at approval without blocking submission', async () => {
    executeWalletCallRuntime.mockResolvedValueOnce(['0xhash'])
    const admitted = provider.sendWalletCalls(payload(), jest.fn())
    const stored = accounts.getRequestForAccount(address, admitted.handlerId)
    stored.addressSafety = {
      assessedAt: 1,
      fingerprint: 'a'.repeat(64),
      targets: [{ address: stored.calls[0].to, state: 'lookalike' }]
    }

    await expect(provider.approveWalletCallsRequest(address, admitted.handlerId)).resolves.toEqual(['0xhash'])
    expect(accounts.refreshRequestAddressSafety).toHaveBeenCalledWith(address, admitted.handlerId)
  })

  it('declines against the captured account and durably closes the batch', () => {
    const respond = jest.fn()
    const admitted = provider.sendWalletCalls(payload(), respond)
    currentAccount = { id: '0x3333333333333333333333333333333333333333' }

    expect(provider.declineWalletCallsRequest(address, admitted.handlerId)).toBe(true)

    expect(accounts.declineRequest).toHaveBeenCalledWith(admitted.handlerId, address)
    expect(accounts.rejectRequestForAccount).not.toHaveBeenCalled()
    expect(accounts.getRequestForAccount(address, admitted.handlerId)).toMatchObject({
      status: 'declined',
      notice: 'Request declined'
    })
    expect(respond).toHaveBeenCalledWith({
      id: 71,
      jsonrpc: '2.0',
      error: { code: 4001, message: 'User rejected the wallet-call request' }
    })
    expect(walletCallBatchLedger.getStatus(originId, address, admitted.id).status).toBe(400)
    expect(executeWalletCallRuntime).not.toHaveBeenCalled()
    expect(walletCallEvidenceRuntime.wake).not.toHaveBeenCalled()
  })

  it.each([
    ['revoked origin permission', () => store.set('main.permissions', {}), 4100],
    ['disabled target chain', () => store.set('main.networks.ethereum', 1, { id: 1, on: false }), 5710],
    [
      'malformed stored chain',
      () => {
        accountRequests[0].chainId = 'not-a-chain'
      },
      -32602
    ]
  ])('rejects approval after %s without executing', async (_label, arrange, code) => {
    const respond = jest.fn()
    const admitted = provider.sendWalletCalls(payload(), respond)
    arrange()

    await expect(provider.approveWalletCallsRequest(address, admitted.handlerId)).rejects.toMatchObject({
      code
    })

    expect(respond).toHaveBeenCalledWith({
      id: 71,
      jsonrpc: '2.0',
      error: expect.objectContaining({ code })
    })
    expect(walletCallBatchLedger.getStatus(originId, address, admitted.id).status).toBe(400)
    expect(executeWalletCallRuntime).not.toHaveBeenCalled()
  })

  it('returns status only within the authorized origin and account scope', () => {
    const admitted = provider.sendWalletCalls(payload(), jest.fn())
    const respond = jest.fn()

    provider.getWalletCallsStatus(
      {
        id: 72,
        jsonrpc: '2.0',
        method: 'wallet_getCallsStatus',
        _origin: originId,
        params: [admitted.id]
      },
      respond
    )

    expect(respond).toHaveBeenCalledWith({
      id: 72,
      jsonrpc: '2.0',
      result: {
        version: '2.0.0',
        id: admitted.id,
        chainId: '0x1',
        status: 100,
        atomic: false
      }
    })
  })

  it('does not reveal a known batch to another authorized origin', () => {
    const admitted = provider.sendWalletCalls(payload(), jest.fn())
    const otherOrigin = '4db938a0-9935-520b-991d-0a02b8601f36'
    store.set('main.origins', otherOrigin, {
      chain: { id: 1, type: 'ethereum' },
      name: 'other.test'
    })
    store.set('main.permissions', address, {
      [originId]: grant(),
      [otherOrigin]: grant(otherOrigin, 'other.test')
    })
    const respond = jest.fn()

    provider.getWalletCallsStatus(
      {
        id: 73,
        jsonrpc: '2.0',
        method: 'wallet_getCallsStatus',
        _origin: otherOrigin,
        params: [admitted.id]
      },
      respond
    )

    expect(respond).toHaveBeenCalledWith({
      id: 73,
      jsonrpc: '2.0',
      error: { code: 5730, message: 'Unknown bundle id' }
    })
  })

  it('requires authorization before looking up even an unknown status id', () => {
    store.set('main.permissions', {})
    const respond = jest.fn()

    provider.getWalletCallsStatus(
      {
        id: 74,
        jsonrpc: '2.0',
        method: 'wallet_getCallsStatus',
        _origin: originId,
        params: ['unknown-id']
      },
      respond
    )

    expect(respond.mock.calls[0][0].error.code).toBe(4100)
  })

  it('shows a known batch and returns no value', () => {
    const admitted = provider.sendWalletCalls(payload(), jest.fn())
    const respond = jest.fn()

    provider.showWalletCallsStatus(
      {
        id: 78,
        jsonrpc: '2.0',
        method: 'wallet_showCallsStatus',
        _origin: originId,
        params: [admitted.id]
      },
      respond
    )

    expect(showWalletCallStatus).toHaveBeenCalledWith({
      account: address,
      originName: 'example.test',
      status: {
        version: '2.0.0',
        id: admitted.id,
        chainId: '0x1',
        status: 100,
        atomic: false
      }
    })
    expect(respond).toHaveBeenCalledWith({ id: 78, jsonrpc: '2.0', result: null })
  })

  it.each([
    ['unauthorized origin', () => store.set('main.permissions', {}), 'known-id', 4100],
    ['unknown batch', () => {}, 'unknown-id', 5730]
  ])('does not open a status view for an %s', (_label, arrange, id, code) => {
    arrange()
    const respond = jest.fn()

    provider.showWalletCallsStatus(
      {
        id: 79,
        jsonrpc: '2.0',
        method: 'wallet_showCallsStatus',
        _origin: originId,
        params: [id]
      },
      respond
    )

    expect(showWalletCallStatus).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      id: 79,
      jsonrpc: '2.0',
      error: expect.objectContaining({ code })
    })
  })

  it('does not show a known batch to another authorized origin', () => {
    const admitted = provider.sendWalletCalls(payload(), jest.fn())
    const otherOrigin = '4db938a0-9935-520b-991d-0a02b8601f36'
    store.set('main.origins', otherOrigin, {
      chain: { id: 1, type: 'ethereum' },
      name: 'other.test'
    })
    store.set('main.permissions', address, {
      [originId]: grant(),
      [otherOrigin]: grant(otherOrigin, 'other.test')
    })
    const respond = jest.fn()

    provider.showWalletCallsStatus(
      {
        id: 80,
        jsonrpc: '2.0',
        method: 'wallet_showCallsStatus',
        _origin: otherOrigin,
        params: [admitted.id]
      },
      respond
    )

    expect(showWalletCallStatus).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      id: 80,
      jsonrpc: '2.0',
      error: { code: 5730, message: 'Unknown bundle id' }
    })
  })

  it('reports only conservative capabilities on requested available chains', () => {
    store.set('main.networks.ethereum', 5, { id: 5, on: true })
    const respond = jest.fn()

    provider.getWalletCallCapabilities(
      {
        id: 75,
        jsonrpc: '2.0',
        method: 'wallet_getCapabilities',
        _origin: originId,
        params: [address.toUpperCase().replace('0X', '0x'), ['0x5', '0x1', '0xa', '0x5']]
      },
      respond
    )

    expect(respond).toHaveBeenCalledWith({
      id: 75,
      jsonrpc: '2.0',
      result: {
        '0x1': { atomic: { status: 'unsupported' } },
        '0x5': { atomic: { status: 'unsupported' } }
      }
    })
  })

  it('derives omitted capability chains and excludes disabled connections', () => {
    store.set('main.networks.ethereum', 5, { id: 5, on: false })
    const respond = jest.fn()

    provider.getWalletCallCapabilities(
      {
        id: 76,
        jsonrpc: '2.0',
        method: 'wallet_getCapabilities',
        _origin: originId,
        params: [address]
      },
      respond
    )

    expect(respond.mock.calls[0][0].result).toEqual({
      '0x1': { atomic: { status: 'unsupported' } }
    })
  })

  it('does not disclose capabilities for another account', () => {
    const respond = jest.fn()

    provider.getWalletCallCapabilities(
      {
        id: 77,
        jsonrpc: '2.0',
        method: 'wallet_getCapabilities',
        _origin: originId,
        params: ['0x3333333333333333333333333333333333333333', ['0x1']]
      },
      respond
    )

    expect(respond.mock.calls[0][0].error.code).toBe(4100)
  })
})

describe('#send', () => {
  beforeEach(() => {
    store.set('main.origins', '8073729a-5e59-53b7-9e69-5d9bcff94087', {
      chain: { id: 1, type: 'ethereum', on: true },
      name: 'example.test'
    })
  })

  const send = (request, cb = jest.fn()) =>
    provider.send({ ...request, _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087' }, cb)

  it.each([
    ['eth_accounts', []],
    ['eth_coinbase', null]
  ])('does not expose an account through passive %s before permission', (method, expected) => {
    const response = jest.fn()

    send({ method }, response)

    expect(response).toHaveBeenCalledWith(expect.objectContaining({ result: expected }))
  })

  it.each([
    ['eth_accounts', [address]],
    ['eth_coinbase', address]
  ])('returns the selected account through %s after permission', (method, expected) => {
    store.set('main.permissions', address, {
      [defaultOriginId]: grant()
    })
    const response = jest.fn()

    send({ method }, response)

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({
        result: Array.isArray(expected)
          ? expected.map((entry) => entry.toLowerCase())
          : expected.toLowerCase()
      })
    )
  })

  it('passes the given target chain to the connection', () => {
    connection.connections.ethereum[10] = {
      chainConfig: { hardfork: 'london', chainId: 10 },
      primary: { connected: true }
    }

    const request = { method: 'eth_testFrame' }

    send({ ...request, chainId: '0xa' })

    expect(connection.send).toHaveBeenCalledWith(request, expect.any(Function), { type: 'ethereum', id: 10 })
  })

  it('passes the default target chain to the connection when none is given', () => {
    const request = { method: 'eth_testFrame' }

    send(request)

    expect(connection.send).toHaveBeenCalledWith(request, expect.any(Function), {
      type: 'ethereum',
      id: 1,
      on: true
    })
  })

  it.each([
    'wallet_invokeMethod',
    'wallet_futureMethod',
    'personal_sendTransaction',
    'personal_unlockAccount',
    'account_signTransaction',
    'eth_signTransaction',
    'admin_stopRPC',
    'debug_cpuProfile',
    'debug_getAndDeleteDatabase',
    'debug_setHead',
    'debug_traceFutureMethod',
    'engine_newPayloadV4',
    'miner_start'
  ])('rejects unsafe fallback method %s without contacting the chain connection', (method) => {
    const response = jest.fn()

    send({ id: 19, jsonrpc: '2.0', method, params: [] }, response)

    expect(response).toHaveBeenCalledWith({
      id: 19,
      jsonrpc: '2.0',
      error: { message: `Wren does not support ${method}`, code: 4200 }
    })
    expect(connection.send).not.toHaveBeenCalled()
  })

  it.each([
    ['wallet_request', { request: { method: 'personal_sendTransaction', params: [] } }],
    [
      'caip_request',
      {
        chainId: 'eip155:1',
        session: 'session',
        request: { method: 'personal_sendTransaction', params: [] }
      }
    ]
  ])('rejects removed legacy %s envelopes before inspecting nested methods', (method, params) => {
    const response = jest.fn()

    send({ id: 20, jsonrpc: '2.0', method, params }, response)

    expect(response).toHaveBeenCalledWith({
      id: 20,
      jsonrpc: '2.0',
      error: {
        message: `${method} is no longer supported. Send the inner EIP-1193 method directly and use a top-level hexadecimal chainId.`,
        code: 4200
      }
    })
    expect(connection.send).not.toHaveBeenCalled()
  })

  it.each(['caip_request', 'wallet_request'])(
    'rejects every nested method family in removed %s envelopes without side effects',
    (method) => {
      const nestedMethods = [
        'eth_requestAccounts',
        'wallet_requestPermissions',
        'eth_accounts',
        'eth_subscribe',
        'eth_pollSubscriptions',
        'eth_unsubscribe',
        'wallet_request',
        'frame_summon',
        'eth_call'
      ]

      nestedMethods.forEach((nestedMethod, index) => {
        const response = jest.fn()
        const request = { method: nestedMethod, params: [] }
        const params =
          method === 'caip_request' ? { chainId: 'eip155:1', session: 'session', request } : { request }

        send({ id: 30 + index, jsonrpc: '2.0', method, params }, response)

        expect(response).toHaveBeenCalledWith({
          id: 30 + index,
          jsonrpc: '2.0',
          error: {
            code: 4200,
            message: `${method} is no longer supported. Send the inner EIP-1193 method directly and use a top-level hexadecimal chainId.`
          }
        })
      })

      expect(accounts.addRequest).not.toHaveBeenCalled()
      expect(connection.send).not.toHaveBeenCalled()
    }
  )

  it.each([
    'eth_getProof',
    'debug_getRawBlock',
    'debug_traceTransaction',
    'trace_replayTransaction',
    'eth_sendRawTransaction'
  ])('preserves chain forwarding for %s', (method) => {
    const request = { method, params: [] }

    send(request)

    expect(connection.send).toHaveBeenCalledWith(request, expect.any(Function), {
      type: 'ethereum',
      id: 1,
      on: true
    })
  })

  it.each([
    ['EIP-4844 type-3', '0x03c0', 'EIP-4844 type-3 transactions'],
    ['EIP-7702 type-4', '0x04c0', 'EIP-7702 authorization transactions']
  ])(
    'rejects externally signed %s transactions without forwarding them',
    (_family, rawTransaction, reason) => {
      const response = jest.fn()

      send({ id: 21, jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: [rawTransaction] }, response)

      expect(response).toHaveBeenCalledWith({
        id: 21,
        jsonrpc: '2.0',
        error: { message: `Wren does not support ${reason}`, code: 4200 }
      })
      expect(connection.send).not.toHaveBeenCalled()
    }
  )

  it('returns an error when an unknown chain is given', (done) => {
    const request = { method: 'eth_testFrame', chainId: '0x63' }

    send(request, (response) => {
      expect(connection.send).not.toHaveBeenCalled()
      expect(response.error.message).toMatch(/unknown chain/)
      expect(response.result).toBe(undefined)
      done()
    })
  })

  it('returns an error when an invalid chain is given', (done) => {
    const request = { method: 'eth_testFrame', chainId: 'test' }

    send(request, (response) => {
      expect(connection.send).not.toHaveBeenCalled()
      expect(response.error.message).toMatch(/unknown chain/)
      expect(response.result).toBe(undefined)
      done()
    })
  })

  describe('#eth_chainId', () => {
    it('returns the current chain id from the store', () => {
      store.set('main.networks.ethereum', 1, { id: 1, on: true })

      send({ method: 'eth_chainId', chainId: '0x1' }, (response) => {
        expect(response.result).toBe('0x1')
      })
    })

    it('returns a chain id from the target chain', () => {
      store.set('main.networks.ethereum', 5, { id: 5, on: true })

      send({ method: 'eth_chainId', chainId: '0x5' }, (response) => {
        expect(response.result).toBe('0x5')
      })
    })

    it('returns an error for a disabled chain', () => {
      store.set('main.networks.ethereum', 5, { id: 5, on: false })

      send({ method: 'eth_chainId', chainId: '0x5' }, (response) => {
        expect(response.error).toEqual({ message: 'Wren is not connected to chain 5', code: 4901 })
        expect(response.result).toBeUndefined()
      })
    })
  })

  describe('#net_version', () => {
    it('returns the decimal target chain id', () => {
      store.set('main.networks.ethereum', 5, { id: 5, on: true })

      send({ method: 'net_version', chainId: '0x5' }, (response) => {
        expect(response.result).toBe('5')
      })
    })

    it('returns a chain-disconnected error exactly once for a disabled chain', () => {
      store.set('main.networks.ethereum', 5, { id: 5, on: false })
      const response = jest.fn()

      send({ method: 'net_version', chainId: '0x5' }, response)

      expect(response).toHaveBeenCalledTimes(1)
      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'Wren is not connected to chain 5', code: 4901 }
        })
      )
    })
  })

  describe('#wallet_addEthereumChain', () => {
    const sendRequest = (chain, cb) => send({ method: 'wallet_addEthereumChain', params: [chain] }, cb)
    const validChain = {
      chainId: '0x1234',
      chainName: 'Bizarro Polygon',
      nativeCurrency: { name: 'New', symbol: 'NEW', decimals: 18 },
      rpcUrls: ['https://pylon.link'],
      blockExplorerUrls: ['https://explorer.pylon.link']
    }

    it('rejects a request with no chain id', (done) => {
      const cb = (response) => {
        expect(response.error.message).toMatch(/invalid params/i)
        expect(response.result).toBeUndefined()
        done()
      }

      sendRequest({ chainName: 'Rinkeby', nativeCurrency: { symbol: 'rETH' } }, cb)
    })

    it('rejects a request with an invalid chain id', (done) => {
      const cb = (response) => {
        expect(response.error.message).toMatch(/invalid params/i)
        expect(response.result).toBeUndefined()
        done()
      }

      sendRequest({ chainId: 'test', chainName: 'Rinkeby', nativeCurrency: { symbol: 'rETH' } }, cb)
    })

    it('rejects a request with no chain name', (done) => {
      const cb = (response) => {
        expect(response.error.message).toMatch(/invalid params/i)
        expect(response.result).toBeUndefined()
        done()
      }

      sendRequest(
        {
          chainId: '0x1234',
          nativeCurrency: { name: 'Ether', symbol: 'gETH', decimals: 18 },
          rpcUrls: ['https://rpc.example']
        },
        cb
      )
    })

    it('rejects a request with no native currency', (done) => {
      const cb = (response) => {
        expect(response.error.message).toMatch(/invalid params/i)
        expect(response.result).toBeUndefined()
        done()
      }

      sendRequest({ chainId: '0xaa36a7', chainName: 'Sepolia', rpcUrls: ['https://rpc.example'] }, cb)
    })

    it.each([
      ['a decimal chain ID', { ...validChain, chainId: '4660' }],
      ['a zero chain ID', { ...validChain, chainId: '0x0' }],
      ['a non-canonical chain ID', { ...validChain, chainId: '0x01234' }],
      ['a partially parseable chain ID', { ...validChain, chainId: '0x1234junk' }],
      ['an unsafe chain ID', { ...validChain, chainId: '0x20000000000000' }],
      ['no RPC URL', { ...validChain, rpcUrls: [] }],
      ['an HTTP RPC URL', { ...validChain, rpcUrls: ['http://rpc.example'] }],
      [
        'negative native currency decimals',
        { ...validChain, nativeCurrency: { name: 'New', symbol: 'NEW', decimals: -1 } }
      ]
    ])('rejects %s without creating request state', (_description, chain, done) => {
      sendRequest(chain, (response) => {
        try {
          expect(response.error.code).toBe(-32602)
          expect(accountRequests).toHaveLength(0)
          expect(provider.handlers).toEqual({})
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it('rejects instead of hanging when no account can approve the request', (done) => {
      accounts.current.mockReturnValueOnce(null)

      sendRequest(validChain, (response) => {
        try {
          expect(response.error).toEqual({
            code: 4100,
            message: 'No account selected to approve the add-chain request'
          })
          expect(accountRequests).toHaveLength(0)
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it('should create a request to add the chain', (done) => {
      const cb = () => {
        expect(accountRequests).toHaveLength(1)
        expect(accountRequests[0]).toEqual(
          expect.objectContaining({
            handlerId: expect.any(String),
            type: 'addChain',
            chain: {
              type: 'ethereum',
              id: 4660,
              name: 'Bizarro Polygon',
              symbol: 'NEW',
              nativeCurrencyName: 'New',
              rpcUrls: ['https://pylon.link'],
              explorer: 'https://explorer.pylon.link',
              nativeCurrencyDecimals: 18,
              icon: '',
              nativeCurrencyIcon: '',
              isTestnet: false,
              primaryColor: 'accent2'
            }
          })
        )

        done()
      }

      sendRequest(validChain, cb)
    })

    it('switches automatically if the chain already exists and the origin is authorized', () => {
      store.set('main.networks.ethereum', 1, { id: 1 })
      store.set('main.origins', '8073729a-5e59-53b7-9e69-5d9bcff94087', {
        chain: { id: 137, type: 'ethereum' },
        name: 'example.test'
      })
      store.set('main.permissions', address, {
        [defaultOriginId]: grant()
      })
      store.switchOriginChain = jest.fn()
      const response = jest.fn()

      sendRequest({ chainId: '0x1' }, response)

      expect(response).toHaveBeenCalledWith(expect.objectContaining({ result: null }))
      expect(accountRequests).toHaveLength(0)
      expect(accounts.rejectUnapprovedRequestsForOriginChain).toHaveBeenCalledWith(
        '8073729a-5e59-53b7-9e69-5d9bcff94087',
        137
      )
      expect(store.switchOriginChain).toHaveBeenCalledWith(
        '8073729a-5e59-53b7-9e69-5d9bcff94087',
        1,
        'ethereum'
      )
    })
  })

  describe('#wallet_switchEthereumChain', () => {
    const authorizeOrigin = () =>
      store.set('main.permissions', address, {
        [defaultOriginId]: grant()
      })

    it('switches the authorized origin immediately without queuing a wallet request', () => {
      store.set('main.networks.ethereum', 5, { id: 5 })
      authorizeOrigin()
      store.switchOriginChain = jest.fn()
      const response = jest.fn()

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x5' }] }, response)

      expect(response).toHaveBeenCalledWith(expect.objectContaining({ result: null }))
      expect(accountRequests).toHaveLength(0)
      expect(accounts.rejectUnapprovedRequestsForOriginChain).toHaveBeenCalledWith(
        '8073729a-5e59-53b7-9e69-5d9bcff94087',
        1
      )
      expect(store.switchOriginChain).toHaveBeenCalledWith(
        '8073729a-5e59-53b7-9e69-5d9bcff94087',
        5,
        'ethereum'
      )
    })

    it('resolves without prompting when the origin is already on the requested chain', (done) => {
      store.set('main.networks.ethereum', 1, { id: 1 })
      authorizeOrigin()

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }, (response) => {
        expect(response.result).toBeNull()
        expect(accountRequests).toHaveLength(0)
        expect(accounts.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
        done()
      })
    })

    it('rejects instead of hanging when no account has authorized the switch', (done) => {
      store.set('main.networks.ethereum', 5, { id: 5 })
      accounts.current.mockReturnValueOnce(null)

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x5' }] }, (response) => {
        expect(response.error).toEqual({
          code: 4100,
          message: 'Origin is not authorized to switch chains'
        })
        expect(accountRequests).toHaveLength(0)
        expect(store.switchOriginChain).not.toHaveBeenCalled()
        done()
      })
    })

    it('rejects a known origin that lacks account permission', (done) => {
      store.set('main.networks.ethereum', 5, { id: 5 })

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x5' }] }, (response) => {
        expect(response.error).toEqual({
          code: 4100,
          message: 'Origin is not authorized to switch chains'
        })
        expect(accounts.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
        expect(store.switchOriginChain).not.toHaveBeenCalled()
        done()
      })
    })

    it('rejects an unknown origin without trying to resolve its current chain', (done) => {
      store.set('main.networks.ethereum', 5, { id: 5 })
      store.set('main.origins', '8073729a-5e59-53b7-9e69-5d9bcff94087', undefined)

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x5' }] }, (response) => {
        expect(response.error).toEqual({ code: 4100, message: 'Unknown requesting origin' })
        expect(accountRequests).toHaveLength(0)
        expect(store.switchOriginChain).not.toHaveBeenCalled()
        done()
      })
    })

    it('should reject with the correct error if the chain does not exist in the store', (done) => {
      send(
        {
          method: 'wallet_switchEthereumChain',
          params: [
            {
              chainId: '0x1234'
            }
          ],
          _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087'
        },
        (response) => {
          try {
            expect(response.error.code).toBe(4902)
            expect(accountRequests).toHaveLength(0)
            done()
          } catch (e) {
            done(e)
          }
        }
      )
    })

    it('rejects a configured but disabled destination as disconnected', (done) => {
      store.set('main.networks.ethereum', 5, { id: 5, on: false })

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x5' }] }, (response) => {
        expect(response.error).toEqual({ code: 4901, message: 'Wren is not connected to chain 5' })
        expect(accountRequests).toHaveLength(0)
        done()
      })
    })

    it.each([undefined, [], [{}], [{ chainId: '1' }], [{ chainId: '0x01' }], [{ chainId: '0x1' }, {}]])(
      'rejects malformed params %#',
      (params, done) => {
        send({ method: 'wallet_switchEthereumChain', params }, (response) => {
          try {
            expect(response.error.code).toBe(-32602)
            expect(store.switchOriginChain).not.toHaveBeenCalled()
            done()
          } catch (error) {
            done(error)
          }
        })
      }
    )

    it('fails closed if the origin-chain store action is unavailable', (done) => {
      store.set('main.networks.ethereum', 5, { id: 5 })
      authorizeOrigin()
      store.switchOriginChain = undefined

      send({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x5' }] }, (response) => {
        expect(response.error).toEqual({
          code: -32603,
          message: 'Store action switchOriginChain is unavailable'
        })
        expect(accounts.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
        done()
      })
    })
  })

  describe('#wallet_getPermissions', () => {
    const originId = '8073729a-5e59-53b7-9e69-5d9bcff94087'
    const request = { method: 'wallet_getPermissions', params: [], _origin: originId }

    beforeEach(() => {
      store.set('main.origins', originId, { name: 'test.frame', chain: { id: 1, type: 'ethereum' } })
    })

    it('returns no permissions when provider access is not granted', (done) => {
      send(request, (response) => {
        expect(response).toMatchObject({ result: [] })
        done()
      })
    })

    it('does not depend on the origin chain connection', (done) => {
      store.set('main.origins', originId, { name: 'test.frame', chain: { id: 99, type: 'ethereum' } })

      send(request, (response) => {
        expect(response).toMatchObject({ result: [] })
        done()
      })
    })

    it('returns the current account permission for the invoker', (done) => {
      store.set('main.permissions', address, {
        [originId]: grant(originId, 'test.frame')
      })

      send(request, (response) => {
        expect(response.result).toEqual([
          {
            invoker: 'test.frame',
            parentCapability: 'eth_accounts',
            caveats: [expect.objectContaining({ type: 'wren:permissionScope' })]
          }
        ])
        done()
      })
    })

    it('rejects unexpected parameters', (done) => {
      send({ ...request, params: [{}] }, (response) => {
        expect(response.error.code).toBe(-32602)
        done()
      })
    })
  })

  describe('#eth_requestAccounts', () => {
    const originId = '8073729a-5e59-53b7-9e69-5d9bcff94087'
    const request = { method: 'eth_requestAccounts', params: [], _origin: originId }

    beforeEach(() => {
      store.set('main.origins', originId, { name: 'test.frame', chain: { id: 1, type: 'ethereum' } })
    })

    it('prompts explicitly and returns the selected account after approval', (done) => {
      accounts.addRequest.mockImplementationOnce((req, cb) => {
        accountRequests.push(req)
        store.set('main.permissions', address, {
          [originId]: req.permission
        })
        cb()
      })

      send(request, (response) => {
        expect(response).toMatchObject({ result: [address] })
        expect(accountRequests[0]).toMatchObject({
          type: 'access',
          handlerId: originId,
          origin: originId,
          account: address
        })
        done()
      })
    })

    it('returns user rejection after the explicit access prompt is declined', (done) => {
      accounts.addRequest.mockImplementationOnce((_req, cb) => cb())

      send(request, (response) => {
        expect(response.error).toEqual({ code: 4001, message: 'User rejected the account request' })
        done()
      })
    })
  })

  describe('#wallet_requestPermissions', () => {
    const originId = '8073729a-5e59-53b7-9e69-5d9bcff94087'
    const request = {
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
      _origin: originId
    }

    beforeEach(() => {
      store.set('main.origins', originId, { name: 'test.frame', chain: { id: 1, type: 'ethereum' } })
    })

    const grantAccess = (req, cb) => {
      accountRequests.push(req)
      store.set('main.permissions', address, {
        [originId]: req.permission
      })
      cb()
    }

    it('prompts and returns the requested permission after approval', (done) => {
      accounts.addRequest.mockImplementationOnce(grantAccess)

      send(request, (response) => {
        expect(response.error).toBeUndefined()
        expect(response.result[0].parentCapability).toBe('eth_accounts')
        expect(Number.isInteger(response.result[0].date)).toBe(true)
        expect(accountRequests[0]).toMatchObject({
          type: 'access',
          handlerId: originId,
          origin: originId,
          account: address
        })
        done()
      })
    })

    it('accepts required methods supported by the selected signer', (done) => {
      accounts.addRequest.mockImplementationOnce(grantAccess)

      send(
        {
          ...request,
          params: [
            {
              eth_accounts: {
                requiredMethods: ['personal_sign', 'signTypedData_v4', 'eth_sendTransaction']
              }
            }
          ]
        },
        (response) => {
          expect(response.error).toBeUndefined()
          expect(response.result[0].parentCapability).toBe('eth_accounts')
          expect(accounts.addRequest).toHaveBeenCalledTimes(1)
          done()
        }
      )
    })

    it.each([
      ['an unsupported wallet method', 'wallet_unknownMethod', 'ring'],
      ['typed data unsupported by the signer', 'eth_signTypedData_v3', SignerType.Trezor],
      ['signing from a watch-only account', 'personal_sign', 'address']
    ])('rejects %s before prompting', (_description, requiredMethod, signerType, done) => {
      accounts.get.mockReturnValueOnce({
        id: address,
        address,
        lastSignerType: signerType
      })

      send(
        {
          ...request,
          params: [{ eth_accounts: { requiredMethods: [requiredMethod] } }]
        },
        (response) => {
          expect(response.error).toEqual({
            code: 4200,
            message: `Selected account does not support required method: ${requiredMethod}`
          })
          expect(accounts.addRequest).not.toHaveBeenCalled()
          done()
        }
      )
    })

    it('returns immediately when access is already granted', (done) => {
      store.set('main.permissions', address, {
        [originId]: grant(originId, 'test.frame')
      })

      send(request, (response) => {
        expect(response.result[0].parentCapability).toBe('eth_accounts')
        expect(accounts.addRequest).not.toHaveBeenCalled()
        done()
      })
    })

    it('does not depend on the origin chain connection', (done) => {
      store.set('main.origins', originId, { name: 'test.frame', chain: { id: 99, type: 'ethereum' } })
      store.set('main.permissions', address, {
        [originId]: grant(originId, 'test.frame')
      })

      send(request, (response) => {
        expect(response.result[0].parentCapability).toBe('eth_accounts')
        done()
      })
    })

    it('returns user rejection after the access prompt is declined', (done) => {
      accounts.addRequest.mockImplementationOnce((req, cb) => {
        store.set('main.permissions', address, {
          [originId]: { handlerId: originId, origin: 'test.frame', provider: false }
        })
        cb()
      })

      send(request, (response) => {
        expect(response.error).toEqual({ code: 4001, message: 'User rejected the permission request' })
        done()
      })
    })

    it('settles without prompting if the selected account changes before queueing', (done) => {
      accounts.current
        .mockReturnValueOnce({ id: address })
        .mockReturnValue({ id: '0x3333333333333333333333333333333333333333' })

      send(request, (response) => {
        expect(response.error).toEqual({ code: 4100, message: 'Account changed during permission request' })
        expect(accounts.addRequest).not.toHaveBeenCalled()
        done()
      })
    })

    it('returns unauthorized when no account is selected', (done) => {
      accounts.current.mockReturnValue(null)

      send(request, (response) => {
        expect(response.error).toEqual({
          code: 4100,
          message: 'No account is available to grant permission'
        })
        expect(accounts.addRequest).not.toHaveBeenCalled()
        done()
      })
    })

    it('allows an explicitly denied origin to request access again', (done) => {
      store.set('main.permissions', address, {
        [originId]: { handlerId: originId, origin: 'test.frame', provider: false }
      })
      accounts.addRequest.mockImplementationOnce(grantAccess)

      send(request, (response) => {
        expect(response.result[0].parentCapability).toBe('eth_accounts')
        expect(accounts.addRequest).toHaveBeenCalledTimes(1)
        done()
      })
    })

    it('coalesces concurrent permission prompts and settles both callers', async () => {
      let resolvePrompt
      accounts.addRequest.mockImplementationOnce((req, cb) => {
        accountRequests.push(req)
        resolvePrompt = cb
      })

      const first = new Promise((resolve) => send(request, resolve))
      const second = new Promise((resolve) => send({ ...request, id: 11 }, resolve))

      expect(accounts.addRequest).toHaveBeenCalledTimes(1)
      store.set('main.permissions', address, {
        [originId]: grant(originId, 'test.frame')
      })
      resolvePrompt()

      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ result: [expect.objectContaining({ parentCapability: 'eth_accounts' })] }),
        expect.objectContaining({ result: [expect.objectContaining({ parentCapability: 'eth_accounts' })] })
      ])
    })

    it.each([
      ['missing params', undefined],
      ['multiple request objects', [{ eth_accounts: {} }, { eth_accounts: {} }]],
      ['an unsupported capability', [{ eth_signTransaction: {} }]],
      ['an unsupported caveat', [{ eth_accounts: { unknownCaveat: true } }]]
    ])('rejects %s before prompting', (_description, params, done) => {
      send({ ...request, params }, (response) => {
        expect(response.error.code).toBe(-32602)
        expect(accounts.addRequest).not.toHaveBeenCalled()
        done()
      })
    })
  })

  describe('#wallet_watchAsset', () => {
    let getTokenData, getTokenUri, request

    const checksumAddress = '0xBfa641051Ba0a0Ad1b0AcF549a89536A0D76472E'
    const settle = async () => {
      await Promise.resolve()
      await Promise.resolve()
    }
    const sendRequest = (payload = request) => new Promise((resolve) => send(payload, resolve))

    beforeEach(() => {
      store.set('main.networks.ethereum.1', { id: 1, on: true })
      store.set('main.networks.ethereum.5', { id: 5, on: true })
      store.set('main.tokens.custom', [])

      getTokenData = jest.fn().mockResolvedValue({
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18,
        totalSupply: '21000000000000000000000000'
      })
      getTokenUri = jest.fn().mockResolvedValue('ipfs://bafy-metadata')
      resolveErc1046Metadata.mockReset()
      resolveErc1046Metadata.mockResolvedValue({
        interop: { erc1046: true },
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18
      })
      Erc20Contract.mockClear()
      Erc20Contract.mockImplementation(() => ({ getTokenData, getTokenUri }))

      request = {
        id: 10,
        jsonrpc: '2.0',
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: checksumAddress,
            symbol: 'SPOOF',
            name: 'Spoofed Token',
            decimals: 2,
            image: 'https://badgerdao.io/icon.jpg'
          }
        },
        _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087'
      }
    })

    it('acknowledges before metadata lookup and queues verified contract data', async () => {
      const events = []
      let resolveMetadata
      getTokenData.mockImplementation(
        () =>
          new Promise((resolve) => {
            events.push('metadata')
            resolveMetadata = resolve
          })
      )

      const responsePromise = new Promise((resolve) =>
        send(request, (response) => {
          events.push('response')
          resolve(response)
        })
      )

      await expect(responsePromise).resolves.toMatchObject({ result: true })
      expect(events).toEqual(['response', 'metadata'])
      expect(accountRequests).toHaveLength(0)

      resolveMetadata({
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18,
        totalSupply: '21000000000000000000000000'
      })
      await settle()

      expect(Erc20Contract).toHaveBeenCalledWith(checksumAddress, 1)
      expect(accountRequests).toHaveLength(1)
      expect(validateUUID(accountRequests[0].handlerId)).toBe(true)
      expect(accountRequests[0]).toEqual(
        expect.objectContaining({
          type: 'addToken',
          account: address,
          token: {
            chainId: 1,
            address: checksumAddress,
            symbol: 'BADGER',
            name: 'BadgerDAO Token',
            decimals: 18,
            logoURI: ''
          },
          payload: request
        })
      )
      expect(provider.handlers).toEqual({})
    })

    it('uses the optional asset chain rather than the origin chain', async () => {
      request.params.options.chainId = 5

      await expect(sendRequest()).resolves.toMatchObject({ result: true })
      await settle()

      expect(Erc20Contract).toHaveBeenCalledWith(checksumAddress, 5)
      expect(accountRequests[0].token.chainId).toBe(5)
    })

    it('validates ERC-1046 metadata before acknowledging and prompts only afterward', async () => {
      request.params.type = 'ERC1046'
      let resolveMetadata
      resolveErc1046Metadata.mockImplementation(() => new Promise((resolve) => (resolveMetadata = resolve)))

      const response = new Promise((resolve) =>
        send(request, (value) => resolve({ value, promptCount: accountRequests.length }))
      )
      await settle()
      expect(resolveMetadata).toBeDefined()
      expect(accountRequests).toHaveLength(0)

      resolveMetadata({
        interop: { erc1046: true },
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18
      })

      await expect(response).resolves.toEqual({
        value: expect.objectContaining({ result: true }),
        promptCount: 0
      })
      expect(getTokenUri).toHaveBeenCalledTimes(1)
      expect(resolveErc1046Metadata).toHaveBeenCalledWith('ipfs://bafy-metadata')
      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].token).toEqual({
        chainId: 1,
        address: checksumAddress,
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18,
        logoURI: ''
      })
    })

    it('returns an RPC error when ERC-1046 metadata cannot be verified', async () => {
      request.params.type = 'ERC1046'
      resolveErc1046Metadata.mockRejectedValue(new Error('unsupported URI'))

      await expect(sendRequest()).resolves.toMatchObject({
        error: { code: -32602, message: expect.stringMatching(/ERC-1046 metadata/) }
      })
      expect(accountRequests).toHaveLength(0)
    })

    it('clears failed ERC-1046 validation so a later request can retry', async () => {
      request.params.type = 'ERC1046'
      resolveErc1046Metadata.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({
        interop: { erc1046: true },
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18
      })

      await expect(sendRequest()).resolves.toMatchObject({ error: { code: -32602 } })
      await expect(sendRequest({ ...request, id: 11 })).resolves.toMatchObject({ result: true })

      expect(Erc20Contract).toHaveBeenCalledTimes(2)
      expect(accountRequests).toHaveLength(1)
    })

    it('coalesces ERC-1046 validation and creates one prompt', async () => {
      request.params.type = 'ERC1046'
      let resolveMetadata
      resolveErc1046Metadata.mockImplementation(() => new Promise((resolve) => (resolveMetadata = resolve)))

      const first = sendRequest()
      const second = sendRequest({ ...request, id: 11 })
      await settle()

      expect(Erc20Contract).toHaveBeenCalledTimes(1)
      resolveMetadata({
        interop: { erc1046: true },
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18
      })

      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ result: true }),
        expect.objectContaining({ result: true })
      ])
      expect(accountRequests).toHaveLength(1)
    })

    it('acknowledges valid ERC-1046 metadata but drops a stale account prompt', async () => {
      request.params.type = 'ERC1046'
      let resolveMetadata
      resolveErc1046Metadata.mockImplementation(() => new Promise((resolve) => (resolveMetadata = resolve)))

      const response = sendRequest()
      await settle()
      accounts.current.mockReturnValue({ id: '0x3333333333333333333333333333333333333333' })
      resolveMetadata({
        interop: { erc1046: true },
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18
      })

      await expect(response).resolves.toMatchObject({ result: true })
      expect(accountRequests).toHaveLength(0)
    })

    it('does not send a second response when prompt delivery fails after validation', async () => {
      request.params.type = 'ERC1046'
      const response = jest.fn()
      accounts.addRequest.mockImplementationOnce(() => {
        throw new Error('prompt unavailable')
      })

      send(request, response)
      await settle()
      await settle()

      expect(response).toHaveBeenCalledTimes(1)
      expect(response).toHaveBeenCalledWith(expect.objectContaining({ result: true }))
    })

    it('still validates an already listed ERC-1046 token without prompting again', async () => {
      request.params.type = 'ERC1046'
      store.set('main.tokens.custom', [{ address: '0xbfa641051ba0a0ad1b0acf549a89536a0d76472e', chainId: 1 }])

      await expect(sendRequest()).resolves.toMatchObject({ result: true })

      expect(getTokenUri).toHaveBeenCalledTimes(1)
      expect(accountRequests).toHaveLength(0)
    })

    it('does not look up or prompt for a token that is already added', async () => {
      store.set('main.tokens.custom', [{ address: '0xbfa641051ba0a0ad1b0acf549a89536a0d76472e', chainId: 1 }])

      await expect(sendRequest()).resolves.toMatchObject({ result: true })

      expect(Erc20Contract).not.toHaveBeenCalled()
      expect(accountRequests).toHaveLength(0)
    })

    it('coalesces simultaneous suggestions for the same account and token', async () => {
      let resolveMetadata
      getTokenData.mockImplementation(() => new Promise((resolve) => (resolveMetadata = resolve)))

      await Promise.all([sendRequest(), sendRequest()])

      expect(Erc20Contract).toHaveBeenCalledTimes(1)
      resolveMetadata({
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18,
        totalSupply: '1'
      })
      await settle()

      expect(accountRequests).toHaveLength(1)
    })

    it('clears in-flight deduplication after a metadata timeout', async () => {
      getTokenData.mockImplementation(() => new Promise(() => {}))

      await expect(sendRequest()).resolves.toMatchObject({ result: true })
      jest.advanceTimersByTime(15_000)
      await settle()
      await settle()

      await expect(sendRequest()).resolves.toMatchObject({ result: true })
      expect(Erc20Contract).toHaveBeenCalledTimes(2)

      jest.advanceTimersByTime(15_000)
      await settle()
      await settle()
    })

    it('does not prompt if the selected account changes during metadata lookup', async () => {
      let resolveMetadata
      getTokenData.mockImplementation(() => new Promise((resolve) => (resolveMetadata = resolve)))

      await expect(sendRequest()).resolves.toMatchObject({ result: true })
      accounts.current.mockReturnValue({ id: '0x3333333333333333333333333333333333333333' })
      resolveMetadata({
        name: 'BadgerDAO Token',
        symbol: 'BADGER',
        decimals: 18,
        totalSupply: '1'
      })
      await settle()

      expect(accountRequests).toHaveLength(0)
    })

    it('supports ERC-20 tokens with zero decimals', async () => {
      getTokenData.mockResolvedValue({ name: 'Zero', symbol: 'ZERO', decimals: 0, totalSupply: '1' })

      await expect(sendRequest()).resolves.toMatchObject({ result: true })
      await settle()

      expect(accountRequests[0].token.decimals).toBe(0)
    })

    it.each([
      ['a metadata lookup failure', () => getTokenData.mockRejectedValue(new Error('RPC unavailable'))],
      [
        'missing required metadata',
        () => getTokenData.mockResolvedValue({ name: '', symbol: 'BADGER', decimals: 18, totalSupply: '1' })
      ],
      [
        'invalid decimals',
        () =>
          getTokenData.mockResolvedValue({
            name: 'BadgerDAO Token',
            symbol: 'BADGER',
            decimals: 256,
            totalSupply: '1'
          })
      ],
      [
        'unavailable decimals',
        () =>
          getTokenData.mockResolvedValue({
            name: 'BadgerDAO Token',
            symbol: 'BADGER',
            decimals: undefined,
            totalSupply: '1'
          })
      ],
      [
        'oversized display metadata',
        () =>
          getTokenData.mockResolvedValue({
            name: 'x'.repeat(129),
            symbol: 'BADGER',
            decimals: 18,
            totalSupply: '1'
          })
      ]
    ])('acknowledges but does not prompt after %s', async (_description, arrange) => {
      arrange()

      await expect(sendRequest()).resolves.toMatchObject({ result: true })
      await settle()

      expect(accountRequests).toHaveLength(0)
    })

    it.each([
      ['an unknown chain', 99],
      ['a disabled chain', 5]
    ])('rejects %s before metadata lookup', async (_description, chainId) => {
      request.params.options.chainId = chainId
      if (chainId === 5) store.set('main.networks.ethereum.5', { id: 5, on: false })

      await expect(sendRequest()).resolves.toMatchObject({ error: { code: 4901 } })
      expect(Erc20Contract).not.toHaveBeenCalled()
      expect(accountRequests).toHaveLength(0)
    })

    it('rejects when no account can review the suggestion', async () => {
      accounts.current.mockReturnValueOnce(null)

      await expect(sendRequest()).resolves.toMatchObject({ error: { code: 4100 } })
      expect(Erc20Contract).not.toHaveBeenCalled()
      expect(accountRequests).toHaveLength(0)
    })
  })

  describe('#wallet_getEthereumChains', () => {
    beforeEach(() => {
      store.set('main.networksMeta.ethereum', {
        1: {
          primaryColor: 'accent3',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
            icon: 'ethereum'
          }
        },
        137: {
          primaryColor: 'accent7',
          nativeCurrency: {
            name: 'Matic',
            symbol: 'MATIC',
            decimals: 18,
            icon: 'matic'
          }
        }
      })
    })

    it('returns a list of enabled chains', () => {
      store.set('main.networks.ethereum', {
        137: {
          name: 'polygon',
          id: 137,
          explorer: 'https://polygonscan.com',
          connection: { endpoints: [{ id: 'rpc-1', connected: true }] },
          on: true
        },
        1: {
          name: 'mainnet',
          id: 1,
          explorer: 'https://etherscan.io',
          connection: { endpoints: [{ id: 'rpc-1', connected: true }] },
          on: true
        }
      })

      send({ method: 'wallet_getEthereumChains', id: 14, jsonrpc: '2.0' }, (response) => {
        expect(response.error).toBe(undefined)
        expect(response.id).toBe(14)
        expect(response.jsonrpc).toBe('2.0')
        expect(response.result).toStrictEqual([
          {
            name: 'mainnet',
            chainId: 1,
            networkId: 1,
            icon: [{ url: 'ethereum' }],
            explorers: [{ url: 'https://etherscan.io' }],
            external: {
              wallet: {
                colors: [{ r: 255, g: 0, b: 174, hex: '#ff00ae' }]
              }
            },
            nativeCurrency: {
              name: 'Ether',
              symbol: 'ETH',
              decimals: 18
            },
            connected: true
          },
          {
            name: 'polygon',
            chainId: 137,
            networkId: 137,
            icon: [{ url: 'matic' }],
            explorers: [{ url: 'https://polygonscan.com' }],
            external: {
              wallet: {
                colors: [{ r: 62, g: 173, b: 241, hex: '#3eadf1' }]
              }
            },
            nativeCurrency: {
              name: 'Matic',
              symbol: 'MATIC',
              decimals: 18
            },
            connected: true
          }
        ])
      })
    })

    it('does not return disabled chains', () => {
      store.set('main.networks.ethereum', {
        137: {
          name: 'polygon',
          id: 137,
          explorer: 'https://polygonscan.com',
          connection: { endpoints: [{ id: 'rpc-1', connected: false }] },
          on: false
        },
        1: {
          name: 'mainnet',
          id: 1,
          explorer: 'https://etherscan.io',
          connection: { endpoints: [{ id: 'rpc-1', connected: true }] },
          on: true
        }
      })

      send({ method: 'wallet_getEthereumChains', id: 14, jsonrpc: '2.0' }, (response) => {
        expect(response.result).toStrictEqual([
          {
            name: 'mainnet',
            chainId: 1,
            networkId: 1,
            icon: [{ url: 'ethereum' }],
            explorers: [{ url: 'https://etherscan.io' }],
            external: {
              wallet: { colors: [{ r: 255, b: 174, g: 0, hex: '#ff00ae' }] }
            },
            nativeCurrency: {
              name: 'Ether',
              symbol: 'ETH',
              decimals: 18
            },
            connected: true
          }
        ])
      })
    })
  })

  describe('#wallet_getAssets', () => {
    const balances = [
      {
        address: '0x3472a5a71965499acd81997a54bba8d852c6e53d',
        chainId: 137,
        name: 'Polygon Badger',
        symbol: 'BADGER',
        balance: '0x1605d9ee98627100000',
        decimals: 18,
        displayBalance: '6500'
      },
      {
        address: '0x383518188c0c6d7730d91b2c03a03c837814a899',
        chainId: 1,
        name: 'Olympus DAO',
        symbol: 'OHM',
        balance: '0xd14d13208',
        decimals: 9,
        displayBalance: '56.183829'
      },
      {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 42161,
        name: 'Ether',
        symbol: 'AETH',
        balance: '0xd8f8753a603f70000',
        decimals: 18,
        displayBalance: '250.15'
      }
    ]

    beforeEach(() => {
      store.set('main.accounts', address, { balances: { lastUpdated: new Date() } })
      store.set('main.balances', address, balances)
      store.set('main.permissions', address, {
        [defaultOriginId]: grant(defaultOriginId, 'example.test', [1, 137, 42161])
      })
    })

    it('returns an authorization error without origin permission', (done) => {
      store.set('main.permissions', {})

      send({ method: 'wallet_getAssets', id: 21, jsonrpc: '2.0' }, (response) => {
        expect(response.id).toBe(21)
        expect(response.jsonrpc).toBe('2.0')
        expect(response.result).toBe(undefined)
        expect(response.error).toMatchObject({ code: 4100 })
        done()
      })
    })

    it('returns native currencies from all chains', (done) => {
      send({ method: 'wallet_getAssets' }, (response) => {
        expect(response.error).toBe(undefined)
        expect(response.result.nativeCurrency).toHaveLength(1)

        expect(response.result.nativeCurrency[0]).toEqual(expect.objectContaining(balances[2]))

        done()
      })
    })

    it('returns erc20 tokens from all chains', (done) => {
      send({ method: 'wallet_getAssets' }, (response) => {
        expect(response.error).toBe(undefined)
        expect(response.result.erc20).toHaveLength(2)

        expect(response.result.erc20[0]).toEqual(expect.objectContaining(balances[0]))
        expect(response.result.erc20[1]).toEqual(expect.objectContaining(balances[1]))

        done()
      })
    })

    it('returns an error while scanning', (done) => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      store.set('main.accounts', address, 'balances.lastUpdated', yesterday)

      send({ method: 'wallet_getAssets', id: 51, jsonrpc: '2.0' }, (response) => {
        expect(response.id).toBe(51)
        expect(response.jsonrpc).toBe('2.0')
        expect(response.result).toBe(undefined)
        expect(response.error.code).toBe(5901)
        done()
      })
    })
  })

  describe('#eth_getTransactionByHash', () => {
    const chain = 5
    const txHash = '0x06c1c968d4bd20c0ebfed34f6f34d8a5d189d9d2ce801f2ee8dd45dac32628d5'
    const request = {
      method: 'eth_getTransactionByHash',
      params: [txHash],
      chainId: '0x' + chain.toString(16)
    }

    let blockResult

    beforeEach(() => {
      connection.send.mockImplementation((payload, res, targetChain) => {
        expect(targetChain.id).toBe(chain)
        expect(payload.params[0]).toBe(txHash)

        return res({ result: blockResult })
      })
    })

    it('returns the response from the connection', (done) => {
      blockResult = {
        blockHash: '0xc1b0227f0721a05357b2b417e3872c5f6f01da209422013fe66ee291527fb123',
        blockNumber: '0xc80d08'
      }

      send(request, (response) => {
        expect(response.result.blockHash).toBe(
          '0xc1b0227f0721a05357b2b417e3872c5f6f01da209422013fe66ee291527fb123'
        )
        expect(response.result.blockNumber).toBe('0xc80d08')
        done()
      })
    })

    it('uses maxFeePerGas as the gasPrice if one is not defined', (done) => {
      const fee = `0x${(10e9).toString(16)}`

      blockResult = {
        maxFeePerGas: fee
      }

      send(request, (response) => {
        expect(response.result.gasPrice).toBe(fee)
        expect(response.result.maxFeePerGas).toBe(fee)
        done()
      })
    })

    it('maintains the gasPrice if maxFeePerGas exists', (done) => {
      const gasPrice = `0x${(8e9).toString(16)}`
      const maxFeePerGas = `0x${(10e9).toString(16)}`

      blockResult = {
        gasPrice,
        maxFeePerGas
      }

      send(request, (response) => {
        expect(response.result.gasPrice).toBe(gasPrice)
        expect(response.result.maxFeePerGas).toBe(maxFeePerGas)
        done()
      })
    })

    it('returns a response with no result attribute', (done) => {
      mockConnectionError('no transaction!')

      send(request, (response) => {
        expect(response.error.message).toBe('no transaction!')
        done()
      })
    })
  })

  describe('#eth_sendTransaction', () => {
    let tx

    const sendTransaction = (cb, chainId) => {
      const payload = {
        jsonrpc: '2.0',
        id: 7,
        method: 'eth_sendTransaction',
        params: [tx]
      }

      if (chainId) payload.chainId = chainId

      provider.send({ ...payload, _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087' }, cb)
    }

    beforeEach(() => {
      tx = {
        from: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
        to: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
        chainId: '0x1',
        gasLimit: intToHex(21000),
        type: '0x1',
        nonce: '0xa'
      }

      const chainIds = [1, 137]

      chainIds.forEach((chainId) => {
        store.set('main.networksMeta.ethereum', chainId, 'gas', {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: gweiToHex(30), asap: '', custom: '' },
            fees: {
              maxPriorityFeePerGas: gweiToHex(1),
              maxBaseFeePerGas: gweiToHex(8)
            }
          }
        })

        connection.connections.ethereum[chainId] = {
          primary: {
            connected: true
          },
          chainConfig: chainConfig(chainId, chainId === 1 ? 'london' : 'istanbul')
        }
      })
    })

    it('rejects a request without transaction params', (done) => {
      tx = undefined

      sendTransaction((response) => {
        expect(response.result).toBeUndefined()
        expect(response.error).toMatchObject({ code: -32602, message: 'Transaction params are required' })
        done()
      })
    })

    it('rejects a transaction with a mismatched chain id', (done) => {
      sendTransaction((response) => {
        try {
          expect(response.result).toBe(undefined)
          expect(response.error.message.toLowerCase()).toMatch(/does not match/)
          done()
        } catch (e) {
          done(e)
        }
      }, '0x5')
    })

    it.each([
      ['type-4 transaction', (transaction) => (transaction.type = '0x4')],
      ['numeric type-4 transaction', (transaction) => (transaction.type = 4)],
      ['authorization list', (transaction) => (transaction.authorizationList = [])]
    ])('rejects an unsupported EIP-7702 %s before creating a request', (_label, mutate, done) => {
      mutate(tx)

      sendTransaction((response) => {
        try {
          expect(response.result).toBeUndefined()
          expect(response.error).toMatchObject({ code: 4200 })
          expect(response.error.message).toMatch(/EIP-7702 authorization transactions are not supported/)
          expect(accountRequests).toHaveLength(0)
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it.each([
      ['blob transaction', '0x3', 4200],
      ['unknown transaction', '0x5', 4200],
      ['malformed transaction type', '0x03', -32602]
    ])('rejects an explicit %s before creating a request', (_label, type, code, done) => {
      tx.type = type

      sendTransaction((response) => {
        try {
          expect(response.result).toBeUndefined()
          expect(response.error).toMatchObject({ code })
          expect(response.error.message).toMatch(/transaction type/i)
          expect(accountRequests).toHaveLength(0)
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it.each(['blobVersionedHashes', 'maxFeePerBlobGas', 'futureEnvelopeField'])(
      "rejects unsupported transaction parameter '%s' before creating a request",
      (field, done) => {
        tx[field] = []

        sendTransaction((response) => {
          try {
            expect(response.result).toBeUndefined()
            expect(response.error).toMatchObject({ code: -32602 })
            expect(response.error.message).toContain(`'${field}'`)
            expect(accountRequests).toHaveLength(0)
            done()
          } catch (error) {
            done(error)
          }
        })
      }
    )

    it('rejects malformed access-list input before creating a request', (done) => {
      tx.accessList = [{ address: '0x1234', storageKeys: [] }]

      sendTransaction((response) => {
        try {
          expect(response.result).toBeUndefined()
          expect(response.error.message).toMatch(/access list.*invalid address/i)
          expect(accountRequests).toHaveLength(0)
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it('attaches the complete normalized access list to transaction review', (done) => {
      const accessList = [
        {
          address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          storageKeys: [`0x${'BB'.repeat(32)}`]
        }
      ]
      tx.accessList = accessList

      sendTransaction(() => {
        try {
          expect(accountRequests).toHaveLength(1)
          expect(accountRequests[0].data.accessList).toEqual([
            {
              address: accessList[0].address.toLowerCase(),
              storageKeys: [accessList[0].storageKeys[0].toLowerCase()]
            }
          ])
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it('rejects an access list on a chain before EIP-2930 activation', (done) => {
      tx.chainId = '0x89'
      tx.accessList = []

      sendTransaction((response) => {
        try {
          expect(response.result).toBeUndefined()
          expect(response.error.message).toMatch(/access lists are not supported on this chain/i)
          expect(accountRequests).toHaveLength(0)
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it('populates the transaction with the request chain id if not provided in the transaction', (done) => {
      delete tx.chainId

      sendTransaction(() => {
        try {
          const initialRequest = accountRequests[0]
          expect(initialRequest.data.chainId).toBe('0x89')
          expect(initialRequest.simulation).toEqual({ status: 'pending' })
          done()
        } catch (e) {
          done(e)
        }
      }, '0x89')
    })

    it('reports the admitted handler id to trusted internal callers', (done) => {
      const payload = {
        jsonrpc: '2.0',
        id: 8,
        method: 'eth_sendTransaction',
        params: [tx],
        _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087'
      }

      provider.sendTransaction(
        payload,
        () => {},
        { type: 'ethereum', id: 1 },
        (handlerId) => {
          try {
            expect(validateUUID(handlerId)).toBe(true)
            expect(accountRequests[0].handlerId).toBe(handlerId)
            expect(accounts.addRequestForAccount).toHaveBeenCalledWith(
              address,
              expect.objectContaining({ handlerId, account: address }),
              expect.any(Function)
            )
            expect(accounts.addRequest).not.toHaveBeenCalled()
            done()
          } catch (error) {
            done(error)
          }
        }
      )
    })

    it('fails admission without reporting a queued request or leaking its handler', (done) => {
      const onQueued = jest.fn()
      accounts.addRequestForAccount.mockImplementationOnce(() => {
        throw new Error('Could not locate request account')
      })
      const payload = {
        jsonrpc: '2.0',
        id: 9,
        method: 'eth_sendTransaction',
        params: [tx],
        _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087'
      }

      provider.sendTransaction(
        payload,
        (response) => {
          try {
            expect(response.error.message).toBe('Could not locate request account')
            expect(onQueued).not.toHaveBeenCalled()
            expect(accountRequests).toHaveLength(0)
            expect(provider.handlers).toEqual({})
            done()
          } catch (error) {
            done(error)
          }
        },
        { type: 'ethereum', id: 1 },
        onQueued
      )
    })

    it('releases a transaction handler exactly once through its account responder', (done) => {
      let settle
      const response = jest.fn()
      accounts.addRequestForAccount.mockImplementationOnce((_accountId, req, responder) => {
        req.res = responder
        accountRequests.push(req)
        settle = responder
        return true
      })
      const payload = {
        jsonrpc: '2.0',
        id: 10,
        method: 'eth_sendTransaction',
        params: [tx],
        _origin: '8073729a-5e59-53b7-9e69-5d9bcff94087'
      }

      provider.sendTransaction(payload, response, { type: 'ethereum', id: 1 }, (handlerId) => {
        try {
          expect(provider.handlers).toHaveProperty(handlerId)
          settle({
            id: payload.id,
            jsonrpc: payload.jsonrpc,
            error: { code: 4001, message: 'User rejected the request' }
          })
          settle({
            id: payload.id,
            jsonrpc: payload.jsonrpc,
            error: { code: 4001, message: 'late duplicate' }
          })

          expect(response).toHaveBeenCalledTimes(1)
          expect(response).toHaveBeenCalledWith(
            expect.objectContaining({ error: { code: 4001, message: 'User rejected the request' } })
          )
          expect(provider.handlers).toEqual({})
          done()
        } catch (error) {
          done(error)
        }
      })
    })

    it('maintains transaction chain id if no target chain provided with the request', (done) => {
      tx.chainId = '0x89'

      sendTransaction(() => {
        try {
          const initialRequest = accountRequests[0]
          expect(initialRequest.data.chainId).toBe('0x89')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('pads the gas estimate from the network by 50 percent', (done) => {
      connection.send.mockImplementationOnce((payload, cb) => {
        expect(payload.method).toBe('eth_estimateGas')
        cb({ result: addHexPrefix((150000).toString(16)) })
      })

      delete tx.gasLimit

      sendTransaction(() => {
        try {
          const initialRequest = accountRequests[0]
          expect(initialRequest.data.gasLimit).toBe(addHexPrefix((225000).toString(16)))
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it.each([null, '1', '0x01'])(
      'requires explicit approval after a malformed gas estimate: %p',
      (estimate, done) => {
        connection.send.mockImplementationOnce((_payload, cb) => cb({ result: estimate }))
        delete tx.gasLimit

        provider.fillTransaction(tx, (error, metadata) => {
          expect(error).toBeNull()
          expect(metadata.tx.gasLimit).toBe('0x00')
          expect(metadata.approvals).toContainEqual({
            type: ApprovalType.GasLimitApproval,
            data: { message: 'Invalid gas estimate response', gasLimit: '0x00' }
          })
          done()
        })
      }
    )

    it('uses gasPrice from input params for legacy transactions', (done) => {
      tx.gasPrice = '0x00'

      sendTransaction(() => {
        try {
          const initialRequest = accountRequests[0]
          expect(initialRequest.data.gasPrice).toBe('0x00')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    describe('replacing gas fees', () => {
      const bumpedByTenPercent = (value) => (BigInt(value) * 11n + 9n) / 10n

      it('adds a 10% gas buffer when replacing a legacy transaction', (done) => {
        tx.type = '0x0'
        tx.chainId = addHexPrefix((137).toString(16))

        try {
          sendTransaction(() => {
            const initialRequest = accountRequests[0]
            const initialPrice = initialRequest.data.gasPrice

            expect(initialPrice).toBe(gweiToHex(30))
            expect(initialRequest.feesUpdatedByUser).toBeFalsy()

            initialRequest.mode = 'monitor'

            sendTransaction(() => {
              const replacementRequest = accountRequests[1]
              const bumpedPrice = bumpedByTenPercent(initialPrice)
              expect(replacementRequest.data.gasPrice).toBe(toRpcQuantity(bumpedPrice))
              expect(replacementRequest.feesUpdatedByUser).toBe(false)
              done()
            })
          })
        } catch (e) {
          done(e)
        }
      })

      it('does not add a buffer to replacement legacy transactions if the current gas price is already higher', (done) => {
        tx.type = '0x0'
        tx.chainId = addHexPrefix((137).toString(16))

        try {
          sendTransaction(() => {
            const initialRequest = accountRequests[0]
            const initialPrice = initialRequest.data.gasPrice

            expect(initialPrice).toBe(gweiToHex(30))
            expect(initialRequest.feesUpdatedByUser).toBeFalsy()

            initialRequest.mode = 'monitor'

            store.set('main.networksMeta.ethereum', 137, 'gas', {
              price: {
                selected: 'standard',
                levels: { slow: '', standard: '', fast: gweiToHex(40), asap: '', custom: '' },
                fees: {
                  maxPriorityFeePerGas: gweiToHex(1),
                  maxBaseFeePerGas: gweiToHex(8)
                }
              }
            })

            sendTransaction(() => {
              const replacementRequest = accountRequests[1]
              expect(replacementRequest.data.gasPrice).toBe(gweiToHex(40))
              expect(replacementRequest.feesUpdatedByUser).toBeFalsy()
              done()
            })
          })
        } catch (e) {
          done(e)
        }
      })

      it('adds a 10% gas buffer when replacing an EIP-1559 transaction', (done) => {
        tx.type = '0x2'
        tx.chainId = addHexPrefix((1).toString(16))

        try {
          sendTransaction(() => {
            const initialRequest = accountRequests[0]
            const initialTip = initialRequest.data.maxPriorityFeePerGas
            const initialMax = initialRequest.data.maxFeePerGas

            expect(initialTip).toBe(gweiToHex(1))
            expect(initialMax).toBe(gweiToHex(9))
            expect(initialRequest.feesUpdatedByUser).toBeFalsy()

            initialRequest.mode = 'monitor'

            sendTransaction(() => {
              const replacementRequest = accountRequests[1]
              const bumpedFee = bumpedByTenPercent(initialTip)
              const bumpedBase = bumpedByTenPercent(BigInt(initialMax) - BigInt(initialTip))
              const bumpedMax = bumpedFee + bumpedBase

              expect(replacementRequest.data.maxPriorityFeePerGas).toBe(toRpcQuantity(bumpedFee))
              expect(replacementRequest.data.maxFeePerGas).toBe(toRpcQuantity(bumpedMax))
              expect(replacementRequest.feesUpdatedByUser).toBe(false)
              done()
            })
          })
        } catch (e) {
          done(e)
        }
      })

      it('buffers only the priority fee for replacement EIP-1559 transactions if the current base price is high enough for replacement', (done) => {
        tx.type = '0x2'
        tx.chainId = addHexPrefix((1).toString(16))

        try {
          sendTransaction(() => {
            const initialRequest = accountRequests[0]
            const initialTip = initialRequest.data.maxPriorityFeePerGas
            const initialMax = initialRequest.data.maxFeePerGas

            expect(initialTip).toBe(gweiToHex(1))
            expect(initialMax).toBe(gweiToHex(9))
            expect(initialRequest.feesUpdatedByUser).toBeFalsy()

            initialRequest.mode = 'monitor'

            store.set('main.networksMeta.ethereum', 1, 'gas', {
              price: {
                selected: 'standard',
                levels: { slow: '', standard: '', fast: gweiToHex(40), asap: '', custom: '' },
                fees: {
                  maxPriorityFeePerGas: gweiToHex(1),
                  maxBaseFeePerGas: gweiToHex(20)
                }
              }
            })

            sendTransaction(() => {
              const replacementRequest = accountRequests[1]
              const bumpedFee = bumpedByTenPercent(initialTip)
              expect(replacementRequest.data.maxPriorityFeePerGas).toBe(toRpcQuantity(bumpedFee))
              expect(replacementRequest.data.maxFeePerGas).toBe(toRpcQuantity(20_000_000_000n + bumpedFee))
              expect(replacementRequest.feesUpdatedByUser).toBe(false)
              done()
            })
          })
        } catch (e) {
          done(e)
        }
      })

      it('does not add a buffer to replacement EIP-1559 transactions if the current gas price is already higher', (done) => {
        tx.type = '0x2'
        tx.chainId = addHexPrefix((1).toString(16))

        try {
          sendTransaction(() => {
            const initialRequest = accountRequests[0]
            const initialTip = initialRequest.data.maxPriorityFeePerGas
            const initialMax = initialRequest.data.maxFeePerGas

            expect(initialTip).toBe(gweiToHex(1))
            expect(initialMax).toBe(gweiToHex(9))
            expect(initialRequest.feesUpdatedByUser).toBeFalsy()

            initialRequest.mode = 'monitor'
            store.set('main.networksMeta.ethereum', 1, 'gas', {
              price: {
                selected: 'standard',
                levels: { slow: '', standard: '', fast: gweiToHex(40), asap: '', custom: '' },
                fees: {
                  maxPriorityFeePerGas: gweiToHex(2),
                  maxBaseFeePerGas: gweiToHex(14)
                }
              }
            })

            sendTransaction(() => {
              const replacementRequest = accountRequests[1]

              expect(replacementRequest.data.maxPriorityFeePerGas).toBe(gweiToHex(2))
              expect(replacementRequest.data.maxFeePerGas).toBe(gweiToHex(16))
              expect(replacementRequest.feesUpdatedByUser).toBeFalsy()
              done()
            })
          })
        } catch (e) {
          done(e)
        }
      })
    })
  })

  describe('#eth_sign', () => {
    const message = 'hello, Ethereum!'
    const hexMessage = addHexPrefix(Buffer.from(message, 'utf-8').toString('hex'))

    it('submits a request to sign a message', () => {
      send({ method: 'eth_sign', params: [address, hexMessage] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].handlerId).toBeTruthy()
      expect(accountRequests[0].payload.params[0]).toBe(address)
      expect(accountRequests[0].payload.params[1]).toEqual(hexMessage)
      expect(accountRequests[0].account).toBe(address)
      expect(accountRequests[0].data).toEqual({
        rawMessage: hexMessage,
        decodedMessage: message,
        context: {
          method: 'eth_sign',
          requestChainId: 1,
          origin: 'example.test',
          encoding: 'utf8',
          byteLength: 16,
          risks: ['legacy-eth-sign']
        }
      })
    })

    it('signs the normalized request bytes instead of re-reading payload display data', (done) => {
      send({ method: 'eth_sign', params: [address, hexMessage] })
      const storedRequest = accountRequests[0]
      const rendererRequest = {
        ...storedRequest,
        payload: { ...storedRequest.payload, params: [address, 'tampered payload'] },
        data: { ...storedRequest.data, rawMessage: '0xdeadbeef' }
      }
      accounts.signMessage = jest.fn((_address, _message, cb) => cb(null, '0xsignature'))
      const verify = jest
        .spyOn(provider, 'verifySignature')
        .mockImplementation((_sig, _msg, _address, cb) => cb(null, true))

      provider.approveSign(rendererRequest, (error, signature) => {
        try {
          expect(error).toBeNull()
          expect(signature).toBe('0xsignature')
          expect(accounts.signMessage).toHaveBeenCalledWith(address, hexMessage, expect.any(Function))
          expect(verify).toHaveBeenCalledWith('0xsignature', hexMessage, address, expect.any(Function))
          done()
        } catch (testError) {
          done(testError)
        } finally {
          verify.mockRestore()
        }
      })
    })

    it('does not submit a request from an account other than the current one', (done) => {
      const params = ['0xa4581bfe76201f3aa147cce8e360140582260441', message]

      send({ method: 'eth_sign', params }, (err) => {
        expect(err.error).toBeTruthy()
        done()
      })
    })
  })

  describe('#personal_sign', () => {
    const message = 'hello, Ethereum!'
    const password = 'supersecret'
    const hexMessage = addHexPrefix(Buffer.from(message, 'utf-8').toString('hex'))

    it('submits a request to sign a personal message with the address first', () => {
      send({ method: 'personal_sign', params: [address, hexMessage, password] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].handlerId).toBeTruthy()
      expect(accountRequests[0].payload.params[0]).toBe(address)
      expect(accountRequests[0].payload.params[1]).toEqual(hexMessage)
      expect(accountRequests[0].payload.params[2]).toEqual(password)
      expect(accountRequests[0].data.context).toEqual({
        method: 'personal_sign',
        requestChainId: 1,
        origin: 'example.test',
        encoding: 'utf8',
        byteLength: 16,
        risks: []
      })
    })

    it('submits a request to sign a personal message with the message first', () => {
      send({ method: 'personal_sign', params: [hexMessage, address, password] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].handlerId).toBeTruthy()
      expect(accountRequests[0].payload.params[0]).toBe(address)
      expect(accountRequests[0].payload.params[1]).toEqual(hexMessage)
      expect(accountRequests[0].payload.params[2]).toEqual(password)
    })

    it('submits a request to sign a personal message with a 20-byte message first', () => {
      const addressSizedMessage = '0x6672616d652e7368206973206772656174212121'

      send({ method: 'personal_sign', params: [addressSizedMessage, address, password] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].handlerId).toBeTruthy()
      expect(accountRequests[0].payload.params[0]).toBe(address)
      expect(accountRequests[0].payload.params[1]).toEqual(addressSizedMessage)
      expect(accountRequests[0].payload.params[2]).toEqual(password)
    })

    it('releases the exact response handler when its transport disconnects before approval', () => {
      const controller = new AbortController()
      const callback = bindRequestSignal(jest.fn(), controller.signal)
      accounts.addRequest.mockImplementationOnce((req, responder) => {
        req.res = responder
        accountRequests.push(req)
      })

      send({ method: 'personal_sign', params: [hexMessage, address, password] }, callback)
      const [handlerId] = Object.keys(provider.handlers)

      expect(handlerId).toBe(accountRequests[0].handlerId)
      controller.abort()

      expect(provider.handlers).toEqual({})
      expect(callback).not.toHaveBeenCalled()
    })

    it('does not create approval state for an already-disconnected transport', () => {
      const controller = new AbortController()
      const callback = bindRequestSignal(jest.fn(), controller.signal)
      controller.abort()

      send({ method: 'personal_sign', params: [hexMessage, address, password] }, callback)

      expect(accountRequests).toHaveLength(0)
      expect(provider.handlers).toEqual({})
      expect(callback).not.toHaveBeenCalled()
    })

    it('responds and releases its handler when message-request admission fails', () => {
      const callback = jest.fn()
      accounts.addRequest.mockImplementationOnce(() => {
        throw new Error('request UI failed')
      })

      send({ method: 'personal_sign', params: [hexMessage, address, password] }, callback)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ message: 'request UI failed' }) })
      )
      expect(provider.handlers).toEqual({})
    })

    it('does not submit a request from an account other than the current one', (done) => {
      const params = [message, '0xa4581bfe76201f3aa147cce8e360140582260441']

      send({ method: 'personal_sign', params }, (err) => {
        expect(err.error).toBeTruthy()
        done()
      })
    })

    it.each([
      ['missing message', [address]],
      ['non-string message', [1, address]],
      ['partial hex byte', ['0x0', address]]
    ])('rejects %s before creating request state', (_label, params) => {
      const callback = jest.fn()

      send({ method: 'personal_sign', params }, callback)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: -32602 }) })
      )
      expect(accountRequests).toHaveLength(0)
      expect(provider.handlers).toEqual({})
    })
  })

  describe('#eth_signTypedData', () => {
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' }
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' }
        ]
      },
      domain: {
        name: 'Ether Mail',
        version: '1',
        chainId: 1,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
      },
      primaryType: 'Mail',
      message: {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
        },
        contents: 'Hello!'
      }
    }

    const typedDataLegacy = [
      {
        type: 'string',
        name: 'fullName',
        value: 'Satoshi Nakamoto'
      },
      {
        type: 'uint32',
        name: 'userId',
        value: '1212'
      }
    ]

    const permitData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }
        ]
      },
      domain: {
        name: 'Test Token',
        version: '1',
        chainId: 1,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
      },
      primaryType: 'Permit',
      message: {
        owner: address,
        spender: '0x1111111111111111111111111111111111111111',
        value: (2n ** 256n - 1n).toString(10),
        nonce: '0',
        deadline: '2000000000'
      }
    }

    const authorizationData = (authorizer = address) => ({
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' }
        ]
      },
      primaryType: 'TransferWithAuthorization',
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: 1,
        verifyingContract: '0x3333333333333333333333333333333333333333'
      },
      message: {
        from: authorizer,
        to: '0x2222222222222222222222222222222222222222',
        value: '100',
        validAfter: '0',
        validBefore: '2000000000',
        nonce: `0x${'ab'.repeat(32)}`
      }
    })

    const validRequests = [
      {
        method: 'eth_signTypedData',
        params: [address, typedDataLegacy],
        version: SignTypedDataVersion.V1,
        dataDescription: 'legacy'
      },
      {
        method: 'eth_signTypedData',
        params: [address, typedData],
        version: SignTypedDataVersion.V4,
        dataDescription: 'eip-712'
      },
      {
        method: 'eth_signTypedData_v1',
        params: [address, typedDataLegacy],
        version: SignTypedDataVersion.V1,
        dataDescription: 'legacy'
      },
      {
        method: 'eth_signTypedData_v3',
        params: [address, typedData],
        version: SignTypedDataVersion.V3,
        dataDescription: 'eip-712'
      },
      {
        method: 'eth_signTypedData_v4',
        params: [address, typedData],
        version: SignTypedDataVersion.V4,
        dataDescription: 'eip-712'
      },
      {
        method: 'eth_signTypedData',
        params: [typedDataLegacy, address],
        version: SignTypedDataVersion.V1,
        dataFirst: true,
        dataDescription: 'legacy'
      },
      {
        method: 'eth_signTypedData',
        params: [typedData, address],
        version: SignTypedDataVersion.V4,
        dataFirst: true,
        dataDescription: 'eip-712'
      },
      {
        method: 'eth_signTypedData_v1',
        params: [typedDataLegacy, address],
        version: SignTypedDataVersion.V1,
        dataFirst: true,
        dataDescription: 'legacy'
      },
      {
        method: 'eth_signTypedData_v3',
        params: [typedData, address],
        version: SignTypedDataVersion.V3,
        dataFirst: true,
        dataDescription: 'eip-712'
      },
      {
        method: 'eth_signTypedData_v4',
        params: [typedData, address],
        version: SignTypedDataVersion.V4,
        dataFirst: true,
        dataDescription: 'eip-712'
      }
    ]

    function verifyRequest(version, expectedPayload) {
      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].handlerId).toBeTruthy()
      expect(accountRequests[0].payload.params[0]).toBe(address)
      expect(accountRequests[0].payload.params[1]).toStrictEqual(expectedPayload)
      expect(accountRequests[0].typedMessage.version).toBe(version)
      expect(accountRequests[0].typedMessage.data).toStrictEqual(expectedPayload)
      expect(accountRequests[0].context).toEqual(
        version === SignTypedDataVersion.V1
          ? { requestChainId: 1, risks: ['legacy-v1'] }
          : { requestChainId: 1, domainChainId: '1', risks: [] }
      )
    }

    validRequests.forEach(({ method, params, version, dataFirst, dataDescription }) => {
      it(`submits an ${method} request supplying ${dataDescription} data${
        dataFirst ? ' (inverted params)' : ''
      }`, () => {
        send({ method, params })

        const expectedPayload = params[dataFirst ? 0 : 1]
        verifyRequest(version, expectedPayload)
      })
    })

    beforeEach(() => {
      accounts.current.mockReturnValue({ id: address })
    })

    it('handles typed data as a stringified json param', () => {
      const params = [JSON.stringify(typedData), address]

      send({ method: 'eth_signTypedData', params })

      verifyRequest(SignTypedDataVersion.V4, typedData)
    })

    it('creates a main-owned EIP-2612 permit request with approval state', () => {
      send({ method: 'eth_signTypedData_v4', params: [address, permitData] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0]).toMatchObject({
        type: 'signErc20Permit',
        account: address,
        approvals: [],
        permit: {
          owner: address,
          value: permitData.message.value
        }
      })
    })

    it('keeps Permit2 on the generic typed-data path with normalized authority context', () => {
      const permit2Data = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          PermitSingle: [
            { name: 'details', type: 'PermitDetails' },
            { name: 'spender', type: 'address' },
            { name: 'sigDeadline', type: 'uint256' }
          ],
          PermitDetails: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' }
          ]
        },
        primaryType: 'PermitSingle',
        domain: {
          name: 'Permit2',
          chainId: 1,
          verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3'
        },
        message: {
          details: {
            token: '0x2222222222222222222222222222222222222222',
            amount: '100',
            expiration: '2000000000',
            nonce: '1'
          },
          spender: '0x1111111111111111111111111111111111111111',
          sigDeadline: '1900000000'
        }
      }

      send({ method: 'eth_signTypedData_v4', params: [address, permit2Data] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0]).toMatchObject({
        type: 'signTypedData',
        typedMessage: { data: permit2Data, version: SignTypedDataVersion.V4 },
        context: {
          requestChainId: 1,
          domainChainId: '1',
          risks: ['permit2-allowance'],
          permit2: {
            kind: 'allowance',
            canonicalContract: true,
            grantsAuthority: true,
            maximumAmount: false
          }
        }
      })
    })

    it('keeps matching-owner ERC-3009 authorization on the exact generic typed-data path', () => {
      const authorization = authorizationData()

      send({ method: 'eth_signTypedData_v4', params: [address, authorization] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0]).toMatchObject({
        type: 'signTypedData',
        typedMessage: { data: authorization, version: SignTypedDataVersion.V4 },
        context: {
          risks: ['eip3009-transfer'],
          eip3009: { authorizer: address, value: '100', grantsAuthority: true }
        }
      })
    })

    it('rejects an ERC-3009 authorization owned by another account', () => {
      const authorization = authorizationData('0x1111111111111111111111111111111111111111')
      const response = jest.fn()

      send({ method: 'eth_signTypedData_v4', params: [address, authorization] }, response)

      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: -32602,
            message: 'Invalid params: authorization owner does not match signing address'
          }
        })
      )
      expect(accountRequests).toHaveLength(0)
      expect(provider.handlers).toEqual({})
    })

    it('rejects an EIP-2612 owner mismatch before allocating request state', () => {
      const response = jest.fn()
      const mismatchedPermit = {
        ...permitData,
        message: {
          ...permitData.message,
          owner: '0x1111111111111111111111111111111111111111'
        }
      }

      send({ method: 'eth_signTypedData_v4', params: [address, mismatchedPermit] }, response)

      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { code: -32602, message: 'Invalid params: permit owner does not match signing address' }
        })
      )
      expect(accountRequests).toHaveLength(0)
      expect(provider.handlers).toEqual({})
    })

    it('responds and releases its handler when typed-data admission fails', () => {
      const response = jest.fn()
      accounts.addRequest.mockImplementationOnce(() => {
        throw new Error('typed request UI failed')
      })

      send({ method: 'eth_signTypedData_v4', params: [address, typedData] }, response)

      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ message: 'typed request UI failed' }) })
      )
      expect(provider.handlers).toEqual({})
    })

    it('infers V4 for fixed arrays', () => {
      const arrayData = {
        ...typedData,
        types: {
          ...typedData.types,
          Mail: [...typedData.types.Mail, { name: 'values', type: 'uint256[2]' }]
        },
        message: { ...typedData.message, values: [1, 2] }
      }

      send({ method: 'eth_signTypedData', params: [address, arrayData] })

      verifyRequest(SignTypedDataVersion.V4, arrayData)
    })

    it('records a domain chain mismatch against the resolved request chain', () => {
      send({ method: 'eth_signTypedData_v4', params: [address, typedData], chainId: '0x5' })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].context).toEqual({
        requestChainId: 5,
        domainChainId: '1',
        risks: ['domain-chain-mismatch']
      })
    })

    it('records a typed signature without domain chain binding', () => {
      const chainlessData = {
        ...typedData,
        types: {
          ...typedData.types,
          EIP712Domain: typedData.types.EIP712Domain.filter(({ name }) => name !== 'chainId')
        },
        domain: Object.fromEntries(Object.entries(typedData.domain).filter(([name]) => name !== 'chainId'))
      }

      send({ method: 'eth_signTypedData_v4', params: [address, chainlessData] })

      expect(accountRequests).toHaveLength(1)
      expect(accountRequests[0].context).toEqual({
        requestChainId: 1,
        risks: ['domain-chain-missing']
      })
    })

    const invalidRequests = [
      ['null data', 'eth_signTypedData', [address, null]],
      ['primitive data', 'eth_signTypedData', [address, 1]],
      ['missing data', 'eth_signTypedData', [address]],
      ['named params', 'eth_signTypedData', { address, typedData }],
      ['invalid signing address', 'eth_signTypedData_v4', [1, typedData]],
      ['missing types', 'eth_signTypedData_v4', [address, { ...typedData, types: undefined }]],
      ['missing domain', 'eth_signTypedData_v4', [address, { ...typedData, domain: undefined }]],
      ['missing message', 'eth_signTypedData_v3', [address, { ...typedData, message: undefined }]],
      ['unknown primary type', 'eth_signTypedData', [address, { ...typedData, primaryType: 'Unknown' }]],
      ['legacy data passed to V4', 'eth_signTypedData_v4', [address, typedDataLegacy]],
      ['EIP-712 data passed to V1', 'eth_signTypedData_v1', [address, typedData]],
      [
        'V3 dynamic array',
        'eth_signTypedData_v3',
        [
          address,
          {
            ...typedData,
            types: {
              ...typedData.types,
              Mail: [...typedData.types.Mail, { name: 'values', type: 'uint256[]' }]
            },
            message: { ...typedData.message, values: [1, 2] }
          }
        ]
      ],
      [
        'V3 fixed array',
        'eth_signTypedData_v3',
        [
          address,
          {
            ...typedData,
            types: {
              ...typedData.types,
              Mail: [...typedData.types.Mail, { name: 'values', type: 'uint256[2]' }]
            },
            message: { ...typedData.message, values: [1, 2] }
          }
        ]
      ]
    ]

    it.each(invalidRequests)('rejects %s before creating request state', (_, method, params) => {
      const response = jest.fn()

      send({ method, params }, response)

      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: -32602, message: expect.stringMatching(/^Invalid params:/) })
        })
      )
      expect(accountRequests).toHaveLength(0)
      expect(provider.handlers).toEqual({})
    })

    it('does not submit a request from an unknown account', (done) => {
      const params = ['0xa4581bfe76201f3aa147cce8e360140582260441', typedData]

      send({ method: 'eth_signTypedData_v3', params }, (err) => {
        expect(err.error.message).toBe('Unknown account: 0xa4581bfe76201f3aa147cce8e360140582260441')
        expect(err.error.code).toBe(-32603)
        done()
      })
    })

    it('does not submit a request to the wrong account', (done) => {
      accounts.current.mockReturnValueOnce({ id: '0xa4581bfe76201f3aa147cce8e360140582260441' })
      const params = [address, typedData]

      send({ method: 'eth_signTypedData_v3', params }, (err) => {
        expect(err.error.message).toBe('Sign request is not from currently selected account')
        expect(err.error.code).toBe(-32603)
        done()
      })
    })

    it('does not submit a request with malformed typed data JSON', (done) => {
      const params = [address, 'test']

      send({ method: 'eth_signTypedData_v3', params }, (err) => {
        expect(err.error.message).toBe('Invalid params: malformed typed data JSON')
        expect(err.error.code).toBe(-32602)
        expect(accountRequests).toHaveLength(0)
        expect(provider.handlers).toEqual({})
        done()
      })
    })

    // these signers only support V4+
    const HardwareSignersSupportingV4Only = [SignerType.Ledger, SignerType.Trezor]

    HardwareSignersSupportingV4Only.forEach((signerType) => {
      it(`does not submit a V3 request to a ${signerType}`, (done) => {
        accounts.get.mockImplementationOnce((addr) => {
          return addr === address ? { id: address, address, lastSignerType: signerType } : {}
        })

        const params = [address, typedData]

        send({ method: 'eth_signTypedData_v3', params }, (err) => {
          expect(err.error.message).toMatch(new RegExp(signerType, 'i'))
          expect(err.error.code).toBe(-32603)
          done()
        })
      })
    })

    it('should submit a V3 request to a Lattice', () => {
      accounts.get.mockImplementationOnce((addr) => {
        return addr === address ? { id: address, address, lastSignerType: SignerType.Lattice } : {}
      })
      const params = [address, typedData]

      send({ method: 'eth_signTypedData_v3', params })

      verifyRequest(SignTypedDataVersion.V3, typedData)
    })

    const unknownVersions = ['_v5', '_v1.1', 'v3']

    unknownVersions.forEach((versionExtension) => {
      it(`rejects unhandled method eth_signTypedData${versionExtension} without forwarding`, (done) => {
        const method = `eth_signTypedData${versionExtension}`

        const params = [address, 'test']

        send({ method, params }, (err) => {
          expect(err.error).toEqual({ message: `Wren does not support ${method}`, code: 4200 })
          expect(connection.send).not.toHaveBeenCalled()
          done()
        })
      })
    })
  })

  describe('subscriptions', () => {
    const eventTypes = ['accountsChanged', 'chainChanged', 'chainsChanged', 'networkChanged']

    describe('#eth_subscribe', () => {
      const subscribe = (eventType, cb) =>
        send({ id: 9, jsonrpc: '2.0', method: 'eth_subscribe', params: [eventType] }, cb)

      eventTypes.forEach((eventType) => {
        it(`subscribes to ${eventType} events`, () => {
          subscribe(eventType, (response) => {
            expect(response.id).toBe(9)
            expect(response.jsonrpc).toBe('2.0')
            expect(response.error).toBe(undefined)
            expect(response.result).toMatch(/0x\w{32}$/)

            expect(provider.subscriptions[eventType]).toHaveLength(1)
          })
        })
      })

      it('returns an error from the node if attempting to unsubscribe to an unknown event', () => {
        mockConnectionError('unknown event!')

        subscribe('everythingChanged', (response) => {
          expect(response.id).toBe(9)
          expect(response.jsonrpc).toBe('2.0')
          expect(response.error.message).toBe('unknown event!')
          expect(response.result).toBe(undefined)
        })
      })
    })

    describe('#eth_unsubscribe', () => {
      const unsubscribe = (id, cb) =>
        send({ id: 8, jsonrpc: '2.0', method: 'eth_unsubscribe', params: [id] }, cb)

      eventTypes.forEach((eventType) => {
        it(`unsubscribes from ${eventType} events`, () => {
          const subId = '0x1acc2933618a0ff548f03b1c99420366'
          provider.subscriptions[eventType] = [subId]

          unsubscribe(subId, (response) => {
            expect(response.id).toBe(8)
            expect(response.jsonrpc).toBe('2.0')
            expect(response.error).toBe(undefined)
            expect(response.result).toBe(true)
            expect(provider.subscriptions[eventType]).toHaveLength(0)
          })
        })
      })

      it('returns an error from the node if attempting to unsubscribe from an unknown subscription', () => {
        mockConnectionError('unknown subscription!')

        provider.subscriptions.accountsChanged = ['0xtest1']
        provider.subscriptions.chainChanged = ['0xtest2']
        provider.subscriptions.chainsChanged = ['0xtest2']
        provider.subscriptions.networkChanged = ['0xtest3']

        unsubscribe('0xanothersub', (response) => {
          expect(response.id).toBe(8)
          expect(response.jsonrpc).toBe('2.0')
          expect(response.error.message).toBe('unknown subscription!')
          expect(response.result).toBe(undefined)

          eventTypes.forEach((eventType) => {
            expect(provider.subscriptions[eventType]).toHaveLength(1)
          })
        })
      })
    })

    it('publishes an empty account list to subscribers that lose access', () => {
      provider.subscriptions.accountsChanged = [
        { id: 'allowed-subscription', originId: 'allowed-origin' },
        { id: 'revoked-subscription', originId: 'revoked-origin' }
      ]
      hasSubscriptionPermission.mockImplementation(
        (_type, _address, originId) => originId === 'allowed-origin'
      )
      const payloads = []
      const listener = (payload) => payloads.push(payload)
      provider.on('data:subscription', listener)

      provider.accountsChanged([address])

      provider.off('data:subscription', listener)
      expect(payloads).toEqual([
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: { subscription: 'allowed-subscription', result: [address] }
        },
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: { subscription: 'revoked-subscription', result: [] }
        }
      ])
    })

    it('publishes a permission change only to the affected origin', () => {
      provider.subscriptions.accountsChanged = [
        { id: 'affected-subscription', originId: 'affected-origin' },
        { id: 'unrelated-subscription', originId: 'unrelated-origin' }
      ]
      hasSubscriptionPermission.mockReturnValue(true)
      const payloads = []
      const listener = (payload) => payloads.push(payload)
      provider.on('data:subscription', listener)

      provider.accountsChanged([address], ['affected-origin'])

      provider.off('data:subscription', listener)
      expect(payloads).toEqual([
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: { subscription: 'affected-subscription', result: [address] }
        }
      ])
    })
  })
})

describe('#signAndSend', () => {
  let tx = {},
    request = {}

  const signAndSend = (cb = jest.fn()) => provider.signAndSend(request, cb)

  beforeEach(() => {
    tx = {}

    request = {
      account: address,
      handlerId: 99,
      payload: { jsonrpc: '2.0', id: 2, method: 'eth_sendTransaction' },
      data: tx
    }
  })

  it('allows a Fantom transaction with fees over the mainnet hard limit', (done) => {
    // 200 gwei * 10M gas = 2 FTM
    tx.chainId = '0xfa'
    tx.type = '0x0'
    tx.gasPrice = toBeHex(parseUnits('210', 'gwei'))
    tx.gasLimit = addHexPrefix((1e7).toString(16))

    accounts.signTransactionForAccount.mockImplementation((accountId, transaction) => {
      expect(accountId).toBe(address)
      expect(transaction).toBe(tx)
      done()
    })

    signAndSend(done)
  })

  it('does not allow a pre-EIP-1559 transaction with fees that exceeds the hard limit', (done) => {
    // 200 gwei * 10M gas = 2 ETH
    tx.chainId = '0x1'
    tx.type = '0x0'
    tx.gasPrice = toBeHex(parseUnits('210', 'gwei'))
    tx.gasLimit = addHexPrefix((1e7).toString(16))

    signAndSend((err) => {
      try {
        expect(err.message).toMatch(/over hard limit/)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('does not allow a post-EIP-1559 transaction with fees that exceed the hard limit', (done) => {
    // 200 gwei * 10M gas = 2 ETH
    tx.chainId = '0x1'
    tx.type = '0x2'
    tx.maxFeePerGas = toBeHex(parseUnits('210', 'gwei'))
    tx.gasLimit = addHexPrefix((1e7).toString(16))

    signAndSend((err) => {
      try {
        expect(err.message).toMatch(/over hard limit/)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  describe('#fillTransaction', () => {
    beforeEach(() => {
      connection.send.mockImplementationOnce((payload, cb) => {
        expect(payload.method).toBe('eth_estimateGas')
        cb({ result: addHexPrefix((150000).toString(16)) })
      })

      store.set('main.networksMeta.ethereum.1.gas', {
        price: {
          selected: 'standard',
          levels: { slow: '', standard: '', fast: gweiToHex(30), asap: '', custom: '' },
          fees: {
            maxPriorityFeePerGas: gweiToHex(1),
            maxBaseFeePerGas: gweiToHex(8)
          }
        }
      })
    })

    it('should not include an undefined "to" field', (done) => {
      const txJson = {
        chainId: '0x1'
      }

      provider.fillTransaction(txJson, (err, { tx }) => {
        try {
          expect(err).toBeFalsy()
          expect('to' in tx).toBe(false)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  describe('broadcasting transactions', () => {
    const signedTx = '0x2eca5b929f8a671f0a3c0a7996f83141b2260fdfac62a1da8a8098b326001b99'
    const txHash = '0x6e8b1de115105ceab599b4d99604797b961cfd1f46b85e10f23a81974baae3d5'

    beforeEach(() => {
      Object.assign(tx, {
        chainId: '0x1',
        type: '0x0',
        gasPrice: '0x1',
        gasLimit: '0x5208'
      })
      accounts.signTransactionForAccount.mockImplementation((accountId, _tx, cb) => {
        expect(accountId).toBe(address)
        cb(null, signedTx)
      })
      accounts.setTxSigned.mockImplementation((reqId, cb, accountId) => {
        expect(reqId).toBe(request.handlerId)
        expect(accountId).toBe(address)
        cb()
      })
    })

    describe('success', () => {
      beforeEach(() => {
        connection.send.mockImplementation((payload, cb) => {
          expect(payload).toEqual(
            expect.objectContaining({
              id: request.payload.id,
              method: 'eth_sendRawTransaction',
              params: [signedTx]
            })
          )

          cb({ result: txHash })
        })
      })

      it('sends a successfully signed transaction', (done) => {
        signAndSend((err, result) => {
          try {
            expect(err).toBe(null)
            expect(result).toBe(txHash)
            done()
          } catch (e) {
            done(e)
          }
        })
      })

      it('responds to a successful transaction request with the transaction hash result', (done) => {
        provider.handlers[request.handlerId] = (response) => {
          try {
            expect(response.result).toBe(txHash)
            expect(provider.handlers).toEqual({})
            done()
          } catch (e) {
            done(e)
          }
        }

        signAndSend()
      })
    })

    describe('failure', () => {
      let errorMessage = 'invalid transaction!'

      beforeEach(() => {
        mockConnectionError(errorMessage)
      })

      it('handles a transaction send failure', (done) => {
        signAndSend((err) => {
          expect(err.message).toBe(errorMessage)
          done()
        })
      })

      it('returns a signing-time account-code recheck failure without broadcasting', (done) => {
        const recheck = Object.assign(new Error('Delegation recheck unavailable. Request not sent.'), {
          code: 'account-code-evidence-unavailable',
          data: { role: 'target', account: address }
        })
        accounts.signTransactionForAccount.mockImplementationOnce((_accountId, _tx, cb) => cb(recheck))
        const handler = jest.fn()
        provider.handlers[request.handlerId] = handler

        signAndSend((error) => {
          try {
            expect(error).toBe(recheck)
            expect(connection.send).not.toHaveBeenCalled()
            expect(handler).not.toHaveBeenCalled()
            expect(provider.handlers[request.handlerId]).toBe(handler)
            done()
          } catch (assertionError) {
            done(assertionError)
          }
        })
      })

      it('settles a generic pre-sign failure before retaining its review', (done) => {
        const disconnected = new Error('Trezor is disconnected')
        accounts.signTransactionForAccount.mockImplementationOnce((_accountId, _tx, cb) => cb(disconnected))
        const handler = jest.fn()
        provider.handlers[request.handlerId] = handler

        signAndSend((error) => {
          try {
            expect(error).toBe(disconnected)
            expect(connection.send).not.toHaveBeenCalled()
            expect(handler).toHaveBeenCalledTimes(1)
            expect(handler).toHaveBeenCalledWith(
              expect.objectContaining({
                error: expect.objectContaining({ message: 'Trezor is disconnected' })
              })
            )
            expect(provider.handlers[request.handlerId]).toBeUndefined()
            done()
          } catch (assertionError) {
            done(assertionError)
          }
        })
      })

      it('responds to a failed transaction request with the payload', (done) => {
        provider.handlers[request.handlerId] = (err) => {
          expect(err.id).toBe(request.payload.id)
          expect(err.jsonrpc).toBe(request.payload.jsonrpc)
          expect(err.error.message).toBe(errorMessage)
          expect(provider.handlers).toEqual({})
          done()
        }

        signAndSend()
      })

      it('rejects a malformed transaction hash before responding', (done) => {
        connection.send.mockImplementation((_payload, cb) => cb({ result: '0x01' }))
        const handler = jest.fn()
        provider.handlers[request.handlerId] = handler

        signAndSend((err) => {
          expect(err.message).toBe('Invalid transaction hash response')
          expect(handler).toHaveBeenCalledTimes(1)
          expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
              error: expect.objectContaining({ message: 'Invalid transaction hash response' })
            })
          )
          done()
        })
      })
    })
  })
})

describe('#assetsChanged', () => {
  const subscription = {
    id: '0x9509a964a8d24a17fcfc7b77fc575b71',
    originId: '8073729a-5e59-53b7-9e69-5d9bcff94087'
  }

  beforeEach(() => {
    provider.subscriptions.assetsChanged = [subscription]
  })

  it('fires an assetsChanged event when an account has permission', (done) => {
    hasSubscriptionPermission.mockReturnValue(true)

    const assets = {
      account: address,
      nativeCurrency: [],
      erc20: [{ chainId: 1, symbol: 'TOKEN' }]
    }

    provider.once('data:subscription', (payload) => {
      expect(payload.method).toBe('eth_subscription')
      expect(payload.jsonrpc).toBe('2.0')
      expect(payload.params.subscription).toBe(subscription.id)
      expect(payload.params.result).toEqual(assets)

      expect(hasSubscriptionPermission).toHaveBeenCalledWith('assetsChanged', address, subscription.originId)
      expect(hasSubscriptionPermission).toHaveBeenCalledWith(
        'assetsChanged',
        address,
        subscription.originId,
        1
      )

      done()
    })

    provider.assetsChanged(address, assets)
  })

  it('does not fire an assetsChanged event when an account does not have permission', () => {
    hasSubscriptionPermission.mockReturnValueOnce(false)

    const assets = { account: address, nativeCurrency: [], erc20: ['tokens'] }

    const listener = jest.fn()
    provider.once('data:subscription', listener)

    provider.assetsChanged(address, assets)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('state change events', () => {
  // these are more like integration tests as they test that the provider, the store, and observers
  // are all working correctly with each other
  const subscription = {
    id: '0x9509a964a8d24a17fcfc7b77fc575b71',
    originId: '8073729a-5e59-53b7-9e69-5d9bcff94087'
  }

  beforeEach(() => {
    provider.removeAllListeners('data:subscription')
  })

  it('fires a chainChanged event to subscribers', (done) => {
    // set the known state to compare the test event to
    store.set('main.origins', subscription.originId, { chain: { id: 1, type: 'ethereum' } })
    store.getObserver('provider:origins').fire()

    provider.subscriptions.chainChanged = [subscription]
    hasSubscriptionPermission.mockReturnValue(true)
    provider.once('data:subscription', (event) => {
      expect(event.method).toBe('eth_subscription')
      expect(event.jsonrpc).toBe('2.0')
      expect(event.params.subscription).toBe(subscription.id)
      expect(event.params.result).toBe('0x89')
      done()
    })

    store.set('main.origins', '8073729a-5e59-53b7-9e69-5d9bcff94087', {
      chain: { id: 137, type: 'ethereum' }
    })
    store.getObserver('provider:origins').fire()
  })

  it('does not deliver chain changes after subscription permission expires or is revoked', () => {
    provider.subscriptions.chainChanged = [subscription]
    hasSubscriptionPermission.mockReturnValue(false)
    const listener = jest.fn()
    provider.on('data:subscription', listener)

    provider.chainChanged(10, subscription.originId)

    provider.off('data:subscription', listener)
    expect(listener).not.toHaveBeenCalled()
    expect(hasSubscriptionPermission).toHaveBeenCalledWith('chainChanged', address, subscription.originId, 10)
  })

  it('fires a chainsChanged event to subscribers', (done) => {
    const networks = {
      1: {
        name: 'test',
        id: 1,
        explorer: 'https://etherscan.io',
        connection: { endpoints: [{ id: 'rpc-1', connected: true }] },
        on: true
      }
    }

    const networksMeta = {
      1: {
        primaryColor: 'accent5',
        nativeCurrency: {
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
          icon: 'ethereum'
        }
      }
    }

    // set the known state to compare the test event to
    store.set('main.networks.ethereum', networks)
    store.set('main.networksMeta.ethereum', networksMeta)
    store.getObserver('provider:chains').fire()

    provider.subscriptions.chainsChanged = [subscription]
    provider.once('data:subscription', (event) => {
      expect(event.method).toBe('eth_subscription')
      expect(event.jsonrpc).toBe('2.0')
      expect(event.params.subscription).toBe(subscription.id)
      expect(event.params.result).toStrictEqual([
        {
          name: 'test',
          chainId: 1,
          networkId: 1,
          icon: [{ url: 'ethereum' }],
          explorers: [{ url: 'https://etherscan.io' }],
          external: {
            wallet: {
              colors: [{ r: 90, g: 181, b: 178, hex: '#5ab5b2' }]
            }
          },
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18
          },
          connected: true
        },
        {
          name: 'Polygon',
          chainId: 137,
          networkId: 137,
          icon: [],
          explorers: [{ url: 'https://polygonscan.com' }],
          external: {
            wallet: {
              colors: [{ r: 60, g: 40, b: 234, hex: '#3c28ea' }]
            }
          },
          nativeCurrency: {
            name: 'Matic',
            symbol: 'MATIC',
            decimals: 18
          },
          connected: true
        }
      ])

      done()
    })

    const polygon = {
      name: 'Polygon',
      id: 137,
      explorer: 'https://polygonscan.com',
      connection: { endpoints: [{ id: 'rpc-1', connected: true }] },
      on: true
    }

    store.set('main.networks.ethereum', { ...networks, 137: polygon })
    store.set('main.networksMeta.ethereum', {
      ...networksMeta,
      137: { primaryColor: 'accent8', nativeCurrency: { symbol: 'MATIC', name: 'Matic', decimals: 18 } }
    })

    hasSubscriptionPermission.mockReturnValueOnce(true)
    store.getObserver('provider:chains').fire()
    jest.runAllTimers()
  })

  it('fires an assetsChanged event to subscribers', (done) => {
    const fireEvent = () => {
      store.getObserver('provider:assets').fire()

      // event debounce time
      jest.advanceTimersByTime(800)
    }

    const ethPriceData = { usd: { price: 3815.91 } }
    const ethBalance = {
      symbol: 'ETH',
      balance: '0xe7',
      address: '0x0000000000000000000000000000000000000000',
      chainId: 1
    }

    const tokenPriceData = { usd: { price: 225.35 } }
    const tokenBalance = {
      symbol: 'OHM',
      balance: '0x606401fc9',
      chainId: 1,
      address: '0x383518188c0c6d7730d91b2c03a03c837814a899'
    }

    store.set('main.accounts', address, 'balances.lastUpdated', new Date())
    store.set('main.permissions', address, { 'test.frame': { origin: 'test.frame', provider: true } })
    store.set('main.networksMeta.ethereum.1.nativeCurrency', ethPriceData)
    store.set('main.rates', tokenBalance.address, tokenPriceData)
    store.set('main.balances', address, [ethBalance, tokenBalance])
    store.set('selected.current', address)

    hasSubscriptionPermission.mockReturnValue(true)
    accounts.current = () => ({ id: address })
    provider.subscriptions.assetsChanged = [subscription]

    provider.once('data:subscription', (event) => {
      expect(event.method).toBe('eth_subscription')
      expect(event.jsonrpc).toBe('2.0')
      expect(event.params.subscription).toBe(subscription.id)
      expect(event.params.result).toEqual({
        account: address,
        nativeCurrency: [{ ...ethBalance, currencyInfo: ethPriceData }],
        erc20: [{ ...tokenBalance, tokenInfo: { lastKnownPrice: { ...tokenPriceData } } }]
      })

      done()
    })

    fireEvent()
  })
})

// utility functions //

function mockConnectionError(message) {
  connection.send.mockImplementation((p, cb) =>
    cb({ id: p.id, jsonrpc: p.jsonrpc, error: { message, code: -1 } })
  )
}
