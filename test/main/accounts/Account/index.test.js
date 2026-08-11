import Account from '../../../../main/accounts/Account'
import provider from '../../../../main/provider'
import { Interface } from 'ethers'
import reveal from '../../../../main/reveal'
import { fetchContract } from '../../../../main/contracts'
import Erc20Contract from '../../../../main/contracts/erc20'
import {
  inspectTransactionAccountCode,
  simulateTransaction,
  simulateWalletCalls
} from '../../../../main/transaction/simulation'
import { ApprovalType } from '../../../../resources/constants'
import { GasFeesSource } from '../../../../resources/domain/transaction'
import signers from '../../../../main/signers'
import store from '../../../../main/store'
import nebulaApi from '../../../../main/nebula'
import windows from '../../../../main/windows'
import nav from '../../../../main/windows/nav'
import { flushPromises } from '../../../util'
import { transitionNotification } from '../../../../resources/store/notifications'

jest.mock('../../../../main/reveal')
jest.mock('../../../../main/transaction/simulation', () => ({
  ...jest.requireActual('../../../../main/transaction/simulation'),
  inspectTransactionAccountCode: jest.fn(),
  simulateTransaction: jest.fn(),
  simulateWalletCalls: jest.fn()
}))
jest.mock('../../../../main/contracts', () => {
  const real = jest.requireActual('../../../../main/contracts')

  return {
    ...real,
    fetchContract: jest.fn()
  }
})

jest.mock('../../../../main/provider', () => ({
  on: jest.fn(),
  off: jest.fn(),
  getNonce: jest.fn(),
  fillTransaction: jest.fn(),
  accountsChanged: jest.fn()
}))
jest.mock('../../../../main/accounts', () => ({
  RequestMode: { Normal: 'normal', Monitor: 'monitor' }
}))
jest.mock('../../../../main/signers', () => ({ get: jest.fn() }))
jest.mock('../../../../main/windows', () => ({ showTray: jest.fn() }))
jest.mock('../../../../main/nebula', () => {
  const ready = jest.fn()
  const once = jest.fn()
  const reverseLookup = jest.fn()
  const factory = () => ({ ready, once, ens: { reverseLookup } })
  factory.ready = ready
  factory.once = once
  factory.reverseLookup = reverseLookup
  return { __esModule: true, default: factory }
})

jest.mock('../../../../main/windows/nav', () => ({
  forward: jest.fn()
}))

jest.mock('../../../../main/store', () => {
  const store = jest.fn()
  store.setPermission = jest.fn()
  store.setSignerView = jest.fn()
  store.setPanelView = jest.fn()
  store.navDash = jest.fn()
  store.navClearReq = jest.fn()
  store.notify = jest.fn()
  store.observer = jest.fn()
  return store
})

const mockNebulaReady = nebulaApi.ready
const mockNebulaOnce = nebulaApi.once
const mockReverseLookup = nebulaApi.reverseLookup

let account

const accounts = { update: jest.fn(), getSelectedAddresses: jest.fn() }

const accountState = {
  address: '0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990',
  name: 'Test Account',
  lastSignerType: 'ledger'
}

const tokenInterface = new Interface([
  'function approve(address spender, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)'
])
const tokenContract = '0x2222222222222222222222222222222222222222'
const delegate = '0x3333333333333333333333333333333333333333'
const maxTokenAmount = 2n ** 256n - 1n
const emptyCodeHash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const accountCodeEvidence = (target = tokenContract) => ({
  source: 'configured-rpc',
  sender: {
    status: 'no-code',
    source: 'eth_getCode',
    trust: 'configured-rpc',
    account: accountState.address.toLowerCase(),
    codeHash: emptyCodeHash,
    role: 'sender'
  },
  targets: [
    {
      status: 'no-code',
      source: 'eth_getCode',
      trust: 'configured-rpc',
      account: target.toLowerCase(),
      codeHash: emptyCodeHash,
      role: 'target',
      callIndexes: [0]
    }
  ]
})

const permitRequest = (value, handlerId = 'token-permit') => ({
  handlerId,
  type: 'signErc20Permit',
  account: accountState.address,
  origin: 'example.test',
  payload: { params: [accountState.address, {}] },
  typedMessage: {
    data: {
      domain: { chainId: 1, verifyingContract: tokenContract },
      message: {
        owner: accountState.address,
        spender: delegate,
        value,
        nonce: '0',
        deadline: '2000000000'
      }
    },
    version: 'V4'
  },
  permit: {
    owner: accountState.address,
    spender: { address: delegate, ens: '', type: 'external' },
    value,
    nonce: '0',
    deadline: '2000000000',
    chainId: 1,
    verifyingContract: { address: tokenContract, ens: '', type: 'contract' }
  },
  tokenData: { name: 'Test Token', symbol: 'TST', decimals: 18 },
  context: { requestChainId: 1, domainChainId: '1', risks: [] },
  approvals: []
})

const messageRequest = (risks, handlerId = 'message-signature') => ({
  handlerId,
  type: 'sign',
  account: accountState.address,
  origin: 'example.test',
  payload: { params: [accountState.address, '0x01'] },
  data: {
    rawMessage: '0x01',
    decodedMessage: '0x01',
    context: {
      method: 'personal_sign',
      requestChainId: 1,
      origin: 'example.test',
      encoding: 'hex',
      byteLength: 1,
      risks
    }
  },
  approvals: []
})

const typedRequest = (risks, handlerId = 'typed-signature') => ({
  handlerId,
  type: 'signTypedData',
  account: accountState.address,
  origin: 'example.test',
  payload: { params: [accountState.address, {}] },
  typedMessage: { data: {}, version: 'V4' },
  context: { requestChainId: 1, risks },
  approvals: []
})

const walletCallsRequest = (handlerId = 'wallet-calls') => ({
  handlerId,
  type: 'walletCalls',
  account: accountState.address,
  origin: 'example.test',
  payload: { id: 1, jsonrpc: '2.0', method: 'wallet_sendCalls', params: [] },
  version: '2.0.0',
  batchId: 'batch-id',
  chainId: '0x1',
  atomic: false,
  calls: [
    { to: tokenContract, value: '0x0', data: '0xabcd' },
    { value: '0x2', data: '0x6000' }
  ],
  preparation: { status: 'pending' },
  simulation: { status: 'pending', calls: [] }
})

const readyWalletCallsRequest = (handlerId = 'ready-wallet-calls') => {
  const request = walletCallsRequest(handlerId)
  request.simulation = {
    status: 'succeeded',
    source: 'eth_simulateV1',
    calls: request.calls.map(() => ({ status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x1' }))
  }
  request.preparation = {
    status: 'succeeded',
    calls: request.calls.map((call, index) => ({
      transaction: {
        from: accountState.address.toLowerCase(),
        chainId: request.chainId,
        nonce: `0x${(5 + index).toString(16)}`,
        type: '0x2',
        gasLimit: '0x5208',
        ...(call.to ? { to: call.to } : {}),
        data: call.data,
        value: call.value,
        maxFeePerGas: '0x10',
        maxPriorityFeePerGas: '0x1',
        gasFeesSource: GasFeesSource.Frame
      },
      maxFee: '0x52080'
    })),
    maxFee: '0xa4100'
  }
  return request
}

beforeEach(() => {
  jest.clearAllTimers()
  mockNebulaReady.mockReset().mockReturnValue(false)
  mockNebulaOnce.mockReset()
  mockReverseLookup.mockReset().mockResolvedValue(['wren.eth'])
  store.mockImplementation(() => undefined)
  store.setPermission.mockClear()
  store.navDash.mockClear()
  store.notify.mockReset()
  windows.showTray.mockClear()
  nav.forward.mockClear()
  provider.accountsChanged.mockClear()
  accounts.getSelectedAddresses.mockReturnValue([accountState.address.toLowerCase()])
  simulateTransaction.mockImplementation(() => new Promise(() => {}))
  simulateWalletCalls.mockImplementation(() => new Promise(() => {}))
  inspectTransactionAccountCode.mockReset().mockResolvedValue(accountCodeEvidence())
  provider.getNonce.mockImplementation((_transaction, callback) => callback({ result: '0x5' }))
  provider.fillTransaction.mockImplementation((transaction, callback) =>
    callback(null, {
      tx: {
        ...transaction,
        type: '0x2',
        gasLimit: '0x5208',
        maxFeePerGas: '0x10',
        maxPriorityFeePerGas: '0x1',
        gasFeesSource: GasFeesSource.Frame
      },
      approvals: []
    })
  )
  account = new Account(accountState, accounts)
  fetchContract.mockResolvedValueOnce(undefined)
})

describe('ENS identity', () => {
  it('refreshes the reverse record when Ethereum reconnects', async () => {
    const statusHandler = provider.on.mock.calls.find(([event]) => event === 'status:ethereum:1')[1]

    statusHandler('connected')
    await flushPromises()

    expect(mockReverseLookup).toHaveBeenCalledWith(accountState.address.toLowerCase())
    expect(account.ensName).toBe('wren.eth')
  })

  it('preserves a known name when a refresh fails and removes its listener on close', async () => {
    account.ensName = 'known.eth'
    mockReverseLookup.mockRejectedValueOnce(new Error('offline'))
    const statusHandler = provider.on.mock.calls.find(([event]) => event === 'status:ethereum:1')[1]

    statusHandler('connected')
    await flushPromises()
    account.accountObserver = { remove: jest.fn() }
    account.close()

    expect(account.ensName).toBe('known.eth')
    expect(provider.off).toHaveBeenCalledWith('status:ethereum:1', statusHandler)
  })
})

it('opens a dapp network proposal directly in the editable network decision', () => {
  const request = {
    handlerId: 'add-chain-request',
    type: 'addChain',
    account: accountState.address,
    origin: 'origin-id',
    chain: {
      type: 'ethereum',
      id: 31337,
      name: 'Garden Testnet',
      symbol: 'ETH',
      rpcUrls: ['https://rpc.garden.example']
    }
  }

  store.mockImplementation((...path) => {
    const key = path.join('.')
    if (key === 'selected.current') return accountState.address
    if (key === 'windows.panel.nav') return []
    if (key === 'main.origins.origin-id.name') return 'https://garden.example'
  })

  account.addRequest(request)

  expect(store.navDash).toHaveBeenCalledWith({
    view: 'chains',
    data: {
      newChain: request.chain,
      requestReference: {
        account: request.account,
        handlerId: request.handlerId,
        origin: 'https://garden.example'
      }
    }
  })
})

it('publishes account visibility after resolving access for the selected account', () => {
  const request = {
    handlerId: 'access-request',
    origin: 'origin-id',
    account: accountState.address,
    type: 'access'
  }
  store.mockImplementation((path) => (path === 'main.origins' ? { name: 'https://example.test' } : undefined))
  account.requests[request.handlerId] = request

  account.setAccess(request, true)

  expect(store.setPermission).toHaveBeenCalledWith(accountState.address.toLowerCase(), {
    handlerId: request.handlerId,
    origin: 'https://example.test',
    provider: true
  })
  expect(provider.accountsChanged).toHaveBeenCalledWith(
    [accountState.address.toLowerCase()],
    [request.origin]
  )
})

it('does not publish account visibility when resolving access for a non-selected account', () => {
  const request = {
    handlerId: 'background-access-request',
    origin: 'origin-id',
    account: accountState.address,
    type: 'access'
  }
  store.mockImplementation((path) => (path === 'main.origins' ? { name: 'https://example.test' } : undefined))
  accounts.getSelectedAddresses.mockReturnValue(['0x1111111111111111111111111111111111111111'])
  account.requests[request.handlerId] = request

  account.setAccess(request, true)

  expect(provider.accountsChanged).not.toHaveBeenCalled()
})

it('normalizes legacy watch-only account casing in its persisted summary', () => {
  const watchAccount = new Account({ ...accountState, lastSignerType: 'Address' }, accounts)

  expect(watchAccount.summary().lastSignerType).toBe('address')
})

it('prefers a ready signer over a higher-priority unavailable signer', () => {
  const address = accountState.address.toLowerCase()
  const readySeed = { id: 'ready-seed', type: 'seed', status: 'ok', addresses: [address] }
  const unavailableLattice = {
    id: 'offline-lattice',
    type: 'lattice',
    status: 'disconnected',
    addresses: [address]
  }
  store.mockImplementation((path) =>
    path === 'main.signers'
      ? { [readySeed.id]: readySeed, [unavailableLattice.id]: unavailableLattice }
      : undefined
  )

  expect(account.findSigner(address)).toBe(readySeed)
})

describe('#addRequest', () => {
  it('queues same-tick arrivals without replacing the active review', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(100)
    const request = (handlerId) => ({
      handlerId,
      type: 'access',
      account: accountState.address,
      origin: 'origin-id',
      payload: { id: handlerId, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }
    })
    store.mockImplementation((...path) => {
      const key = path.join('.')
      if (key === 'selected.current') return accountState.address
      if (key === 'windows.panel.nav') return []
    })
    const first = request('first')
    const second = request('second')

    account.addRequest(first)
    account.addRequest(second)
    jest.advanceTimersByTime(100)

    expect(first.queueIndex).toBe(0)
    expect(second.queueIndex).toBe(1)
    expect(
      nav.forward.mock.calls
        .map(([, crumb]) => crumb)
        .filter(({ view }) => view === 'requestView')
        .map(({ data }) => data.requestId)
    ).toEqual(['first'])
    expect(windows.showTray).toHaveBeenCalledTimes(1)
    expect(account.summary().activeRequestId).toBe('first')
    expect(accounts.update).toHaveBeenLastCalledWith(expect.objectContaining({ activeRequestId: 'first' }))

    account.clearRequest(first.handlerId)

    expect(
      nav.forward.mock.calls
        .map(([, crumb]) => crumb)
        .filter(({ view }) => view === 'requestView')
        .map(({ data }) => data.requestId)
    ).toEqual(['first', 'second'])
    expect(windows.showTray).toHaveBeenCalledTimes(1)
    expect(account.summary().activeRequestId).toBe('second')
    expect(accounts.update).toHaveBeenLastCalledWith(expect.objectContaining({ activeRequestId: 'second' }))

    second.mode = 'monitor'
    expect(account.releaseRequestReview(second.handlerId)).toBe(true)
    expect(account.summary().activeRequestId).toBeNull()
    expect(accounts.update).toHaveBeenLastCalledWith(expect.objectContaining({ activeRequestId: null }))
    now.mockRestore()
  })

  it('dismisses only notifications owned by the cleared request', () => {
    const owner = (handlerId) => `request:${accountState.address.toLowerCase()}:${handlerId}`
    let notificationView = {
      notifyQueue: [
        { id: 'first-warning', owner: owner('first'), type: 'requestWarning', data: {} },
        { id: 'other-notice', owner: 'extension:other', type: 'extensionConnect', data: {} },
        { id: 'second-warning', owner: owner('second'), type: 'requestWarning', data: {} }
      ],
      notifyId: 'first-warning',
      notifyOwner: owner('first'),
      notify: 'requestWarning',
      notifyData: {}
    }
    store.mockImplementation((...path) => {
      const key = path.join('.')
      if (key === 'selected.current') return accountState.address
      if (key === 'windows.panel.nav') return []
      if (key === 'view.notifyQueue') return notificationView.notifyQueue
    })
    store.notify.mockImplementation((type, data, options) => {
      notificationView = transitionNotification(notificationView, type, data, options)
    })
    const request = (handlerId) => ({
      handlerId,
      type: 'access',
      account: accountState.address,
      origin: 'origin-id',
      payload: { id: handlerId, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }
    })
    account.addRequest(request('first'))
    account.addRequest(request('second'))

    account.clearRequest('second')

    expect(notificationView.notifyQueue.map(({ id }) => id)).toEqual(['first-warning', 'other-notice'])
    expect(notificationView.notifyId).toBe('first-warning')

    account.clearRequest('first')

    expect(notificationView.notifyQueue.map(({ id }) => id)).toEqual(['other-notice'])
    expect(notificationView.notifyId).toBe('other-notice')
    expect(store.notify.mock.calls.map(([, , options]) => options.expectedId)).toEqual([
      'second-warning',
      'first-warning'
    ])
  })

  it('cleans request identity before invoking a late or throwing responder', () => {
    const first = {
      handlerId: 'throwing-response',
      type: 'access',
      account: accountState.address,
      origin: 'origin-id',
      payload: { id: 1, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }
    }
    const response = jest.fn(() => {
      expect(account.requests[first.handlerId]).toBeUndefined()
      throw new Error('transport closed')
    })
    account.addRequest(first, response)

    expect(() => account.resolveRequest(first, [])).toThrow('transport closed')
    account.resolveRequest(first, [])

    expect(response).toHaveBeenCalledTimes(1)
    expect(account.requests[first.handlerId]).toBeUndefined()
  })

  it('advances past a request after it enters monitor mode', () => {
    const request = (handlerId) => ({
      handlerId,
      type: 'access',
      account: accountState.address,
      origin: 'origin-id',
      payload: { id: handlerId, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }
    })
    store.mockImplementation((...path) => {
      const key = path.join('.')
      if (key === 'selected.current') return accountState.address
      if (key === 'windows.panel.nav') return []
    })
    const first = request('monitoring')
    const second = request('next-review')
    account.addRequest(first)
    account.addRequest(second)
    first.mode = 'monitor'

    expect(account.releaseRequestReview(first.handlerId)).toBe(true)

    expect(
      nav.forward.mock.calls
        .map(([, crumb]) => crumb)
        .filter(({ view }) => view === 'requestView')
        .map(({ data }) => data.requestId)
    ).toEqual(['monitoring', 'next-review'])
    expect(account.getActiveReviewRequest(second.handlerId)).toBe(second)
    expect(account.getActiveReviewRequest(first.handlerId)).toBeUndefined()
  })

  it('simulates exact wallet calls under the selected account and chain', async () => {
    const result = {
      status: 'succeeded',
      source: 'eth_simulateV1',
      calls: [
        { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x1' },
        { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x2' }
      ]
    }
    simulateWalletCalls.mockResolvedValueOnce(result)
    const request = walletCallsRequest()
    request.calls[0].from = '0x4444444444444444444444444444444444444444'
    request.calls[0].chainId = '0xa'

    account.addRequest(request)
    expect(request.simulation).toEqual({ status: 'pending', calls: [] })
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(simulateWalletCalls).toHaveBeenCalledWith(
      [
        {
          chainId: '0x1',
          from: accountState.address,
          to: tokenContract,
          value: '0x0',
          data: '0xabcd'
        },
        {
          chainId: '0x1',
          from: accountState.address,
          value: '0x2',
          data: '0x6000'
        }
      ],
      { send: expect.any(Function) }
    )
    expect(request.simulation).toBe(result)
  })

  it('keeps only the newest wallet-call simulation result', async () => {
    let resolveInitial
    let resolveUpdated
    simulateWalletCalls
      .mockImplementationOnce(() => new Promise((resolve) => (resolveInitial = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveUpdated = resolve)))
    const request = walletCallsRequest('wallet-calls-version')

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    account.refreshWalletCallsSimulation(request)
    jest.advanceTimersByTime(1)

    resolveUpdated({ status: 'unavailable', source: 'eth_simulateV1', calls: [], reason: 'unsupported' })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.simulation.status).toBe('unavailable')

    resolveInitial({ status: 'succeeded', source: 'eth_simulateV1', calls: [] })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.simulation.status).toBe('unavailable')
  })

  it('does not apply wallet-call simulation after request removal', async () => {
    let resolveSimulation
    simulateWalletCalls.mockImplementationOnce(() => new Promise((resolve) => (resolveSimulation = resolve)))
    const request = walletCallsRequest('removed-wallet-calls')

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    account.clearRequest(request.handlerId)
    resolveSimulation({ status: 'succeeded', source: 'eth_simulateV1', calls: [] })
    await Promise.resolve()

    expect(account.requests[request.handlerId]).toBeUndefined()
  })

  it('does not apply an in-flight wallet-call simulation after account close', async () => {
    let resolveSimulation
    simulateWalletCalls.mockImplementationOnce(() => new Promise((resolve) => (resolveSimulation = resolve)))
    const request = walletCallsRequest('closed-wallet-calls')

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    account.accountObserver = { remove: jest.fn() }
    account.close()
    resolveSimulation({ status: 'succeeded', source: 'eth_simulateV1', calls: [] })
    await Promise.resolve()

    expect(request.simulation).toEqual({ status: 'pending', calls: [] })
  })

  it('bounds unexpected wallet-call simulation failures', async () => {
    simulateWalletCalls.mockRejectedValueOnce(new Error('x'.repeat(300)))
    const request = walletCallsRequest('failed-wallet-calls')

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.simulation).toEqual({
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'x'.repeat(240)
    })
  })

  it('prepares wallet calls with the pinned account, chain, and pending nonce', async () => {
    const request = walletCallsRequest('prepared-wallet-calls')

    account.addRequest(request)
    expect(request.preparation).toEqual({ status: 'pending' })
    await jest.advanceTimersByTimeAsync(1)

    expect(provider.getNonce).toHaveBeenCalledWith(
      { from: accountState.address, chainId: '0x1' },
      expect.any(Function)
    )
    expect(provider.fillTransaction.mock.calls.map(([transaction]) => transaction)).toEqual([
      {
        from: accountState.address.toLowerCase(),
        chainId: '0x1',
        nonce: '0x5',
        to: tokenContract,
        data: '0xabcd',
        value: '0x0'
      },
      {
        from: accountState.address.toLowerCase(),
        chainId: '0x1',
        nonce: '0x6',
        data: '0x6000',
        value: '0x2'
      }
    ])
    expect(request.preparation).toMatchObject({
      status: 'succeeded',
      maxFee: '0xa4100',
      calls: [{ maxFee: '0x52080' }, { maxFee: '0x52080' }]
    })
  })

  it('keeps only the newest wallet-call preparation result', async () => {
    let resolveInitialNonce
    let resolveUpdatedNonce
    provider.getNonce
      .mockImplementationOnce((_transaction, callback) => (resolveInitialNonce = callback))
      .mockImplementationOnce((_transaction, callback) => (resolveUpdatedNonce = callback))
    const request = walletCallsRequest('wallet-calls-preparation-version')

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    account.refreshWalletCallsPreparation(request)
    jest.advanceTimersByTime(1)

    resolveUpdatedNonce({ result: '0x9' })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.preparation.calls[0].transaction.nonce).toBe('0x9')

    resolveInitialNonce({ result: '0x1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.preparation.calls[0].transaction.nonce).toBe('0x9')
  })

  it('fails closed when the wallet-call request changes during preparation', async () => {
    let resolveNonce
    provider.getNonce.mockImplementationOnce((_transaction, callback) => (resolveNonce = callback))
    const request = walletCallsRequest('mutated-wallet-calls-preparation')

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    request.calls[0].data = '0xffff'
    resolveNonce({ result: '0x5' })
    await jest.advanceTimersByTimeAsync(0)

    expect(request.preparation).toEqual({
      status: 'failed',
      reason: 'Wallet call request changed during preparation'
    })
  })

  it('rejects a wallet-call request not owned by the account', () => {
    const response = jest.fn()
    const request = walletCallsRequest('wrong-wallet-calls-account')
    request.account = '0x4444444444444444444444444444444444444444'

    expect(() => account.addRequest(request, response)).toThrow(
      'Wallet-call request is not owned by this account'
    )

    expect(account.requests[request.handlerId]).toBeUndefined()
    expect(response).not.toHaveBeenCalled()
    expect(provider.getNonce).not.toHaveBeenCalled()
  })

  it('does not apply wallet-call preparation after request removal or account close', async () => {
    let resolveRemovedNonce
    let resolveClosedNonce
    provider.getNonce
      .mockImplementationOnce((_transaction, callback) => (resolveRemovedNonce = callback))
      .mockImplementationOnce((_transaction, callback) => (resolveClosedNonce = callback))

    const removed = walletCallsRequest('removed-wallet-calls-preparation')
    account.addRequest(removed)
    jest.advanceTimersByTime(1)
    account.clearRequest(removed.handlerId)
    resolveRemovedNonce({ result: '0x5' })
    await jest.advanceTimersByTimeAsync(0)
    expect(account.requests[removed.handlerId]).toBeUndefined()
    expect(removed.preparation).toEqual({ status: 'pending' })

    const closed = walletCallsRequest('closed-wallet-calls-preparation')
    account.addRequest(closed)
    jest.advanceTimersByTime(1)
    account.accountObserver = { remove: jest.fn() }
    account.close()
    resolveClosedNonce({ result: '0x5' })
    await jest.advanceTimersByTimeAsync(0)
    expect(closed.preparation).toEqual({ status: 'pending' })
  })

  it('bounds wallet-call preparation provider failures', async () => {
    provider.getNonce.mockImplementationOnce((_transaction, callback) =>
      callback({ error: { message: 'x'.repeat(300) } })
    )
    const request = walletCallsRequest('failed-wallet-calls-preparation')

    account.addRequest(request)
    await jest.advanceTimersByTimeAsync(1)

    expect(request.preparation).toEqual({ status: 'failed', reason: 'x'.repeat(240) })
    expect(provider.fillTransaction).not.toHaveBeenCalled()
  })

  it('resolves contract and ERC-20 names for wallet-call rows', async () => {
    const secondTarget = '0x4444444444444444444444444444444444444444'
    const request = walletCallsRequest('named-wallet-calls')
    request.calls[1] = { to: secondTarget, value: '0x0', data: '0x12345678' }
    reveal.decode
      .mockResolvedValueOnce({
        contractAddress: tokenContract,
        contractName: 'ERC-20',
        source: 'Generic ERC-20',
        method: 'transfer',
        args: []
      })
      .mockResolvedValueOnce({
        contractAddress: secondTarget,
        contractName: '1inch Router',
        source: 'Sourcify',
        method: 'swap',
        args: []
      })
    const tokenData = jest
      .spyOn(Erc20Contract.prototype, 'getTokenData')
      .mockResolvedValueOnce({ name: 'USD Coin', symbol: 'USDC', decimals: 6 })

    account.addRequest(request)
    await flushPromises()

    expect(request.callDetails).toEqual([
      { label: 'USD Coin (USDC)', source: 'ERC-20 token metadata', method: 'transfer' },
      { label: '1inch Router', source: 'Sourcify', method: 'swap' }
    ])
    tokenData.mockRestore()
  })

  it('decodes delegated target calldata from the delegate ABI while preserving the authority', async () => {
    const implementation = '0x4444444444444444444444444444444444444444'
    const request = walletCallsRequest('delegated-target-details')
    request.calls = [{ to: tokenContract, value: '0x0', data: '0x12345678' }]
    request.simulation = {
      status: 'succeeded',
      source: 'eth_simulateV1',
      calls: [{ status: 'succeeded', source: 'eth_simulateV1' }],
      accountCodeEvidence: {
        source: 'configured-rpc',
        sender: { status: 'no-code', role: 'sender', account: accountState.address },
        targets: [
          {
            status: 'delegated',
            role: 'target',
            account: tokenContract,
            callIndexes: [0],
            delegate: implementation,
            delegateCodeStatus: 'contract'
          }
        ]
      }
    }
    account.requests[request.handlerId] = request
    reveal.decode.mockResolvedValueOnce({
      contractAddress: tokenContract,
      codeAddress: implementation,
      contractName: 'Delegated Router',
      source: 'Sourcify',
      method: 'execute',
      args: []
    })

    await account.revealWalletCallDetails(request)

    expect(reveal.decode).toHaveBeenCalledWith(tokenContract, 1, '0x12345678', implementation)
    expect(request.callDetails).toEqual([
      { label: 'Delegated Router', source: 'Sourcify', method: 'execute' }
    ])
  })

  it('drops a delayed wallet-call ABI result when delegate code changes at the same address', async () => {
    const implementation = '0x4444444444444444444444444444444444444444'
    const request = walletCallsRequest('stale-delegated-target-details')
    request.calls = [{ to: tokenContract, value: '0x0', data: '0x12345678' }]
    request.simulation = {
      status: 'succeeded',
      source: 'eth_simulateV1',
      calls: [{ status: 'succeeded', source: 'eth_simulateV1' }],
      accountCodeEvidence: {
        source: 'configured-rpc',
        sender: { status: 'no-code', role: 'sender', account: accountState.address },
        targets: [
          {
            status: 'delegated',
            role: 'target',
            account: tokenContract,
            callIndexes: [0],
            delegate: implementation,
            codeHash: '0x01',
            delegateCodeStatus: 'contract',
            delegateCodeHash: '0x02'
          }
        ]
      }
    }
    account.requests[request.handlerId] = request
    let resolveDecode
    reveal.decode.mockImplementationOnce(() => new Promise((resolve) => (resolveDecode = resolve)))

    const pending = account.revealWalletCallDetails(request)
    request.simulation.accountCodeEvidence.targets[0] = {
      ...request.simulation.accountCodeEvidence.targets[0],
      delegateCodeHash: '0x03'
    }
    resolveDecode({
      contractAddress: tokenContract,
      codeAddress: implementation,
      contractName: 'Stale Router',
      source: 'Sourcify',
      method: 'execute',
      args: []
    })
    await pending

    expect(request.callDetails).toBeUndefined()
  })

  it('applies wallet-call fee and nonce settings, then reruns both checks', async () => {
    const request = readyWalletCallsRequest('adjusted-wallet-calls')
    account.requests[request.handlerId] = request
    simulateWalletCalls.mockResolvedValueOnce({
      status: 'succeeded',
      source: 'eth_simulateV1',
      calls: request.calls.map(() => ({ status: 'succeeded', source: 'eth_simulateV1' }))
    })
    provider.fillTransaction.mockImplementation((transaction, callback) =>
      callback(null, {
        tx: { ...transaction, type: '0x2', gasFeesSource: GasFeesSource.Dapp },
        approvals: []
      })
    )
    const adjustment = {
      startingNonce: '0x9',
      calls: [
        { gasLimit: '0x6000', maxFeePerGas: '0x20', maxPriorityFeePerGas: '0x2' },
        { gasLimit: '0x7000', maxFeePerGas: '0x30', maxPriorityFeePerGas: '0x3' }
      ]
    }

    expect(account.adjustWalletCalls(request.handlerId, adjustment)).toEqual(adjustment)
    expect(request.simulation).toEqual({ status: 'pending', calls: [] })
    expect(request.preparation).toEqual({ status: 'pending' })
    expect(provider.getNonce).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1)

    expect(provider.fillTransaction.mock.calls.map(([transaction]) => transaction.nonce)).toEqual([
      '0x9',
      '0xa'
    ])
    expect(provider.fillTransaction.mock.calls.map(([transaction]) => transaction.gasLimit)).toEqual([
      '0x6000',
      '0x7000'
    ])
    expect(request.preparation.status).toBe('succeeded')
    expect(request.preparation.calls.map(({ transaction }) => transaction.nonce)).toEqual(['0x9', '0xa'])
    expect(request.simulation.status).toBe('succeeded')
  })

  it('rejects invalid or immutable wallet-call adjustments without mutation', () => {
    const request = readyWalletCallsRequest('invalid-adjusted-wallet-calls')
    account.requests[request.handlerId] = request
    const originalPreparation = request.preparation

    expect(() =>
      account.adjustWalletCalls(request.handlerId, {
        startingNonce: '0x9',
        calls: [
          { gasLimit: '0x6000', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' },
          { gasLimit: '0x7000', maxFeePerGas: '0x30', maxPriorityFeePerGas: '0x3' }
        ]
      })
    ).toThrow(/EIP-1559/)
    expect(request.preparation).toBe(originalPreparation)
    expect(request.adjustment).toBeUndefined()

    request.locked = true
    expect(() => account.adjustWalletCalls(request.handlerId, {})).toThrow(/no longer be adjusted/)
    expect(provider.fillTransaction).not.toHaveBeenCalled()
  })

  it('requires explicit consent for normalized dangerous message risks', () => {
    const request = messageRequest(['opaque-message', 'legacy-eth-sign', 'siwe-expired'])

    account.addRequest(request)

    expect(request.approvals).toHaveLength(1)
    expect(request.approvals[0]).toMatchObject({
      type: ApprovalType.SignatureRisk,
      approved: false,
      data: {
        title: 'Dangerous Message Signature',
        confirmLabel: 'Sign Anyway',
        riskCodes: 'legacy-eth-sign,siwe-expired'
      }
    })
  })

  it('keeps informational message risks on the normal one-step review path', () => {
    const request = messageRequest(['opaque-message', 'siwe-origin-unverified'])

    account.addRequest(request)

    expect(request.approvals).toEqual([])
  })

  it('requires explicit consent for typed-data domain risks', () => {
    const request = typedRequest(['domain-chain-mismatch'])

    account.addRequest(request)

    expect(request.approvals[0]).toMatchObject({
      type: ApprovalType.SignatureRisk,
      data: { title: 'Risky Typed Signature', riskCodes: 'domain-chain-mismatch' }
    })
  })

  it('requires explicit consent for normalized Permit2 authority', () => {
    const request = typedRequest([
      'permit2-transfer',
      'permit2-maximum-amount',
      'permit2-noncanonical-contract'
    ])

    account.addRequest(request)

    expect(request.approvals[0]).toMatchObject({
      type: ApprovalType.SignatureRisk,
      data: {
        title: 'Risky Typed Signature',
        riskCodes: 'permit2-transfer,permit2-maximum-amount,permit2-noncanonical-contract'
      }
    })
  })

  it('requires explicit consent for ERC-3009 direct transfer authority', () => {
    const request = typedRequest(['eip3009-transfer', 'eip3009-maximum-amount'])

    account.addRequest(request)

    expect(request.approvals[0]).toMatchObject({
      type: ApprovalType.SignatureRisk,
      data: {
        title: 'Risky Typed Signature',
        riskCodes: 'eip3009-transfer,eip3009-maximum-amount'
      }
    })
  })

  it('composes typed-data and unlimited-permit approvals independently', () => {
    const request = permitRequest(maxTokenAmount.toString(10), 'risky-unlimited-permit')
    request.context.risks = ['domain-chain-mismatch']

    account.addRequest(request)

    expect(request.approvals.map(({ type }) => type)).toEqual([
      ApprovalType.SignatureRisk,
      ApprovalType.TokenPermitRisk
    ])
  })

  it('requires explicit consent for an unlimited EIP-2612 permit', () => {
    const request = permitRequest(maxTokenAmount.toString(10))

    account.addRequest(request)

    expect(request.approvals).toHaveLength(1)
    expect(request.approvals[0]).toMatchObject({
      type: ApprovalType.TokenPermitRisk,
      approved: false,
      data: {
        title: 'Unlimited Token Permit',
        confirmLabel: 'Sign Permit Anyway'
      }
    })
  })

  it('does not require extra consent for an initially finite EIP-2612 permit', () => {
    const request = permitRequest('100', 'finite-token-permit')

    account.addRequest(request)

    expect(request.approvals).toEqual([])
  })

  it('synchronizes unlimited permit consent across safe and repeated values', () => {
    const request = permitRequest(maxTokenAmount.toString(10), 'permit-consent-lifecycle')
    account.addRequest(request)
    const approval = request.approvals[0]
    approval.approve()

    account.syncPermitApprovalRisk(request)
    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(true)

    request.permit.value = '100'
    request.typedMessage.data.message.value = '100'
    account.syncPermitApprovalRisk(request)
    expect(request.approvals).toEqual([])

    request.permit.value = maxTokenAmount.toString(10)
    request.typedMessage.data.message.value = maxTokenAmount.toString(10)
    account.syncPermitApprovalRisk(request)
    expect(request.approvals).toHaveLength(1)
    expect(request.approvals[0].approved).toBe(false)

    request.permit.value = '0'
    request.typedMessage.data.message.value = '0'
    account.syncPermitApprovalRisk(request)
    expect(request.approvals).toEqual([])
  })

  it('derives permit authority from the exact typed message sent to the signer', () => {
    const request = permitRequest(maxTokenAmount.toString(10), 'permit-signed-value')
    request.permit.value = '1'

    account.addRequest(request)

    expect(request.approvals).toHaveLength(1)
    expect(request.approvals[0].type).toBe(ApprovalType.TokenPermitRisk)
  })

  describe('recognizing requests', () => {
    it('recognizes an ERC-20 approval', (done) => {
      const request = {
        handlerId: '123456',
        type: 'transaction',
        data: {
          chainId: '0x539',
          to: '0x6887246668a3b87F54DeB3b94Ba47a6f63F32985',
          data: '0x095ea7b30000000000000000000000009bc5baf874d2da8d216ae9f137804184ee5afef40000000000000000000000000000000000000000000000000000000000011170'
        }
      }

      reveal.recog.mockResolvedValue([
        {
          id: 'erc20:approve'
        }
      ])

      accounts.update.mockImplementationOnce(() => {})
      accounts.update.mockImplementationOnce(() => {
        expect(request.recognizedActions).toHaveLength(1)
        done()
      })

      account.addRequest(request)
    })
  })

  it('keeps only the newest execution check result', async () => {
    let resolveInitial
    let resolveUpdated
    simulateTransaction
      .mockImplementationOnce(() => new Promise((resolve) => (resolveInitial = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveUpdated = resolve)))

    const request = {
      handlerId: 'simulation-version',
      type: 'transaction',
      data: { chainId: '0x1', gasLimit: '0x5208' },
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    request.data.gasLimit = '0x6000'
    account.refreshTransactionSimulation(request)
    jest.advanceTimersByTime(1)
    expect(simulateTransaction).toHaveBeenCalledTimes(2)

    resolveUpdated({ status: 'succeeded', source: 'eth_call' })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.simulation).toEqual({ status: 'succeeded', source: 'eth_call' })

    resolveInitial({ status: 'reverted', source: 'eth_simulateV1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.simulation).toEqual({ status: 'succeeded', source: 'eth_call' })
  })

  it('coalesces same-turn transaction updates before calling the RPC', async () => {
    simulateTransaction.mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
    const request = {
      handlerId: 'coalesced-simulation',
      type: 'transaction',
      data: { chainId: '0x1', gasLimit: '0x5208' },
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    request.data.gasLimit = '0x6000'
    account.refreshTransactionSimulation(request)
    jest.advanceTimersByTime(1)
    await Promise.resolve()

    expect(simulateTransaction).toHaveBeenCalledTimes(1)
    expect(simulateTransaction.mock.calls[0][0].gasLimit).toBe('0x6000')
    expect(request.simulation.status).toBe('succeeded')
  })

  it('keeps the completed execution check visible during a silent fee refresh', async () => {
    let resolveRefresh
    const completed = { status: 'succeeded', source: 'eth_call' }
    simulateTransaction.mockImplementationOnce(() => new Promise((resolve) => (resolveRefresh = resolve)))
    const request = {
      handlerId: 'silent-fee-simulation',
      type: 'transaction',
      data: { chainId: '0x1', gasLimit: '0x5208' },
      simulation: completed
    }

    account.requests[request.handlerId] = request
    account.refreshTransactionSimulation(request, false, true)
    expect(request.simulation).toBe(completed)

    jest.advanceTimersByTime(1)
    resolveRefresh({ status: 'succeeded', source: 'eth_simulateV1' })
    await jest.advanceTimersByTimeAsync(0)
    expect(request.simulation).toEqual({ status: 'succeeded', source: 'eth_simulateV1' })
  })

  it('requires explicit approval for a reported revert and invalidates it on edits', async () => {
    simulateTransaction.mockResolvedValueOnce({
      status: 'reverted',
      source: 'eth_call',
      reason: 'execution reverted: denied'
    })
    const gasApproval = { type: ApprovalType.GasLimitApproval, approved: false, data: {} }
    const request = {
      handlerId: 'simulation-approval',
      type: 'transaction',
      data: { chainId: '0x1', gasLimit: '0x5208' },
      approvals: [gasApproval],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    const approval = request.approvals[1]
    expect(request.approvals[0]).toBe(gasApproval)
    expect(approval).toMatchObject({
      type: ApprovalType.SimulationApproval,
      approved: false,
      data: {
        title: 'RPC Reports Revert',
        confirmLabel: 'Sign Anyway'
      }
    })
    expect(approval.data.message).toMatch(/execution reverted: denied/)

    approval.approve()
    expect(approval.approved).toBe(true)

    request.data.gasLimit = '0x6000'
    account.refreshTransactionSimulation(request)
    expect(request.approvals).toEqual([gasApproval])
  })

  it('requires stable explicit consent while the selected account remains delegated', async () => {
    const selectedAccount = accountState.address.toLowerCase()
    const delegation = {
      status: 'delegated',
      source: 'eth_getCode',
      account: selectedAccount,
      delegate
    }
    simulateTransaction
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call', delegation })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call', delegation })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
    const request = {
      handlerId: 'delegated-account-approval',
      type: 'transaction',
      account: selectedAccount,
      data: { chainId: '0x1', from: selectedAccount, gasLimit: '0x5208' },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    const approval = request.approvals[0]
    expect(approval).toMatchObject({
      type: ApprovalType.DelegatedAccountRisk,
      approved: false,
      data: {
        title: 'Delegated Account',
        confirmLabel: 'Sign With Delegated Account',
        account: selectedAccount,
        delegate
      }
    })
    expect(approval.data.message).toMatch(/sending this transaction does not by itself run that code/i)
    approval.approve()

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(true)

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals).toEqual([])
  })

  it('requires fresh explicit consent for reported ERC-1967 implementation changes', async () => {
    const proxy = '0x3333333333333333333333333333333333333333'
    const before = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const after = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const proxyImplementationCheck = {
      status: 'succeeded',
      source: 'debug_traceCall',
      standard: 'ERC-1967',
      slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      changes: [
        {
          proxy,
          kind: 'changed',
          beforeValue: `0x${'0'.repeat(24)}${before.slice(2)}`,
          afterValue: `0x${'0'.repeat(24)}${after.slice(2)}`,
          beforeImplementation: before,
          afterImplementation: after
        }
      ]
    }
    const changedProxyImplementation = {
      ...proxyImplementationCheck,
      changes: [
        {
          ...proxyImplementationCheck.changes[0],
          afterValue: `0x${'0'.repeat(24)}${proxy.slice(2)}`,
          afterImplementation: proxy
        }
      ]
    }
    simulateTransaction
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call', proxyImplementationCheck })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call', proxyImplementationCheck })
      .mockResolvedValueOnce({
        status: 'succeeded',
        source: 'eth_call',
        proxyImplementationCheck: {
          status: 'unavailable',
          source: 'debug_traceCall',
          standard: 'ERC-1967',
          slot: proxyImplementationCheck.slot,
          reason: 'Configured RPC does not support tracing'
        }
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        source: 'eth_call',
        proxyImplementationCheck: changedProxyImplementation
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        source: 'eth_call',
        proxyImplementationCheck: { ...proxyImplementationCheck, changes: [] }
      })
    const request = {
      handlerId: 'proxy-implementation-approval',
      type: 'transaction',
      data: { chainId: '0x1', gasLimit: '0x5208' },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    const approval = request.approvals[0]
    expect(approval).toMatchObject({
      type: ApprovalType.ProxyImplementationChangeRisk,
      approved: false,
      data: {
        title: 'ERC-1967 Implementation Slot Change',
        confirmLabel: 'Approve Upgrade Anyway',
        riskCount: 1,
        evidenceKey: `${proxy}:0x${'0'.repeat(24)}${before.slice(2)}->0x${'0'.repeat(24)}${after.slice(2)}`
      }
    })
    expect(approval.data.message).toMatch(/replace the code executed by a proxy/i)
    approval.approve()

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(true)

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(true)

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(false)
    expect(approval.data.evidenceKey).toContain(proxy.slice(2))

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals).toEqual([])
  })

  it('preserves an acknowledged override across automatic fee rechecks and removes it on success', async () => {
    simulateTransaction
      .mockResolvedValueOnce({ status: 'failed', source: 'eth_simulateV1', reason: 'RPC timeout' })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
    const request = {
      handlerId: 'preserved-simulation-approval',
      type: 'transaction',
      data: { chainId: '0x1', maxFeePerGas: '0x10' },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    const existingApproval = request.approvals[0]
    existingApproval.approve()

    expect(existingApproval.approved).toBe(true)
    expect(existingApproval.data.title).toBe('Execution Check Failed')

    account.refreshTransactionSimulation(request, true, true)
    expect(request.approvals[0]).toBe(existingApproval)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.simulation.status).toBe('succeeded')
    expect(request.approvals).toEqual([])
  })

  it('requires fresh consent when a preserved execution warning changes', async () => {
    simulateTransaction
      .mockResolvedValueOnce({ status: 'failed', source: 'eth_simulateV1', reason: 'RPC timeout' })
      .mockResolvedValueOnce({ status: 'reverted', source: 'eth_simulateV1', reason: 'denied' })
    const request = {
      handlerId: 'changed-simulation-approval',
      type: 'transaction',
      data: { chainId: '0x1', maxFeePerGas: '0x10' },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    const approval = request.approvals[0]
    approval.approve()

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals[0]).toBe(approval)
    expect(approval).toMatchObject({
      approved: false,
      data: { title: 'RPC Reports Revert' }
    })
  })

  it('requires one approval for broad token authority and invalidates it on intent edits', async () => {
    const max = (2n ** 256n - 1n).toString(10)
    const owner = accountState.address.toLowerCase()
    simulateTransaction.mockResolvedValueOnce({
      status: 'succeeded',
      source: 'eth_simulateV1',
      effects: [
        { type: 'approval', standard: 'erc20', owner, amount: max },
        { type: 'operator-approval', standard: 'erc721-or-erc1155', owner, approved: true },
        { type: 'approval', standard: 'erc20', owner, amount: '100' },
        { type: 'approval', standard: 'erc721', owner, tokenId: max },
        { type: 'operator-approval', standard: 'erc721-or-erc1155', owner, approved: false },
        {
          type: 'approval',
          standard: 'erc20',
          owner: '0x1111111111111111111111111111111111111111',
          amount: max
        }
      ]
    })
    const gasApproval = { type: ApprovalType.GasLimitApproval, approved: false, data: {} }
    const request = {
      handlerId: 'broad-token-approval',
      type: 'transaction',
      account: accountState.address,
      data: { chainId: '0x1', gasLimit: '0x5208' },
      approvals: [gasApproval],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals[0]).toBe(gasApproval)
    expect(request.approvals[1]).toMatchObject({
      type: ApprovalType.TokenApprovalRisk,
      approved: false,
      data: {
        title: 'Broad Token Approvals',
        confirmLabel: 'Approve Anyway',
        riskCount: 2
      }
    })
    expect(request.approvals[1].data.message).toMatch(/configured RPC reports 2 broad token permissions/i)

    request.approvals[1].approve()
    expect(request.approvals[1].approved).toBe(true)

    request.data.gasLimit = '0x6000'
    account.refreshTransactionSimulation(request)
    expect(request.approvals).toEqual([gasApproval])
  })

  it('preserves broad-authority consent for fee-only rechecks and removes it when no longer reported', async () => {
    const broadEffect = {
      type: 'operator-approval',
      standard: 'erc721-or-erc1155',
      owner: accountState.address.toLowerCase(),
      approved: true
    }
    simulateTransaction
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_simulateV1', effects: [broadEffect] })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_simulateV1', effects: [] })
    const request = {
      handlerId: 'preserved-token-approval',
      type: 'transaction',
      account: accountState.address,
      data: { chainId: '0x1', maxFeePerGas: '0x10' },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    const existingApproval = request.approvals[0]
    existingApproval.approve()

    account.refreshTransactionSimulation(request, true, true)
    expect(request.approvals[0]).toBe(existingApproval)
    expect(existingApproval.approved).toBe(true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals).toEqual([])
  })

  it('requires calldata-based consent when only fallback simulation is available', async () => {
    simulateTransaction.mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
    const request = {
      handlerId: 'calldata-token-approval',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, maxTokenAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals).toHaveLength(1)
    expect(request.approvals[0]).toMatchObject({
      type: ApprovalType.TokenApprovalRisk,
      approved: false,
      data: { riskCount: 1, evidence: 'calldata', confirmLabel: 'Approve Anyway' }
    })
    expect(request.approvals[0].data.message).toMatch(/does not prove the contract standard/i)
  })

  it('does not classify contract-creation initcode as token approval calldata', async () => {
    simulateTransaction.mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
    const request = {
      handlerId: 'contract-creation-selector-collision',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        data: tokenInterface.encodeFunctionData('approve', [delegate, maxTokenAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals).toEqual([])
  })

  it('does not double-count matching calldata and RPC-reported authority', async () => {
    simulateTransaction.mockResolvedValueOnce({
      status: 'succeeded',
      source: 'eth_simulateV1',
      effects: [
        {
          type: 'approval',
          standard: 'erc20',
          contract: tokenContract,
          owner: accountState.address,
          spender: delegate,
          amount: maxTokenAmount.toString(10)
        }
      ]
    })
    const request = {
      handlerId: 'deduplicated-token-approval',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, maxTokenAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals[0]).toMatchObject({
      data: { riskCount: 1, evidence: 'calldata-and-rpc' }
    })
  })

  it('counts additional simulated broad effects beyond top-level intent', async () => {
    simulateTransaction.mockResolvedValueOnce({
      status: 'succeeded',
      source: 'eth_simulateV1',
      effects: [
        {
          type: 'operator-approval',
          standard: 'erc721-or-erc1155',
          contract: tokenContract,
          owner: accountState.address,
          operator: delegate,
          approved: true
        },
        {
          type: 'approval',
          standard: 'erc20',
          contract: '0x4444444444444444444444444444444444444444',
          owner: accountState.address,
          spender: delegate,
          amount: maxTokenAmount.toString(10)
        }
      ]
    })
    const request = {
      handlerId: 'combined-token-approval',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('setApprovalForAll', [delegate, true])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals[0]).toMatchObject({
      data: { riskCount: 2, evidence: 'calldata-and-rpc' }
    })
  })

  it('preserves calldata consent for fee-only rechecks and removes it after a finite edit', async () => {
    simulateTransaction
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
    const request = {
      handlerId: 'calldata-consent-lifecycle',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, maxTokenAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    const approval = request.approvals[0]
    approval.approve()

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(true)

    request.data.data = tokenInterface.encodeFunctionData('approve', [delegate, 100])
    account.refreshTransactionSimulation(request)
    expect(request.approvals).toEqual([])
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(request.approvals).toEqual([])
  })

  it('requires zero-first consent when replacing a different nonzero allowance', async () => {
    const requestedAmount = '42'
    const allowance = {
      source: 'eth_call',
      token: tokenContract,
      owner: accountState.address.toLowerCase(),
      spender: delegate,
      currentAmount: '7',
      requestedAmount
    }
    simulateTransaction
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call', allowance })
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call', allowance })
    const request = {
      handlerId: 'existing-token-allowance',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        from: accountState.address,
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, requestedAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    const approval = request.approvals[0]
    expect(approval).toMatchObject({
      type: ApprovalType.TokenAllowanceChangeRisk,
      approved: false,
      data: {
        title: 'Existing Token Allowance',
        confirmLabel: 'Change Anyway',
        currentAmount: '7',
        requestedAmount
      }
    })
    expect(approval.data.message).toMatch(/setting the allowance to zero/i)

    approval.approve()
    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals[0]).toBe(approval)
    expect(approval.approved).toBe(true)

    request.data.data = tokenInterface.encodeFunctionData('approve', [delegate, 8])
    account.refreshTransactionSimulation(request)
    expect(request.approvals).toEqual([])
  })

  it.each([
    ['zero current allowance', '0', '42'],
    ['revocation', '7', '0'],
    ['unchanged allowance', '7', '7']
  ])('does not require zero-first consent for %s', async (_label, currentAmount, requestedAmount) => {
    simulateTransaction.mockResolvedValueOnce({
      status: 'succeeded',
      source: 'eth_call',
      allowance: {
        source: 'eth_call',
        token: tokenContract,
        owner: accountState.address,
        spender: delegate,
        currentAmount,
        requestedAmount
      }
    })
    const request = {
      handlerId: `safe-token-allowance-${currentAmount}-${requestedAmount}`,
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        from: accountState.address,
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, requestedAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals).toEqual([])
  })

  it('rejects mismatched allowance evidence and composes valid evidence with broad-authority consent', async () => {
    const requestedAmount = maxTokenAmount.toString(10)
    simulateTransaction
      .mockResolvedValueOnce({
        status: 'succeeded',
        source: 'eth_call',
        allowance: {
          source: 'eth_call',
          token: '0x4444444444444444444444444444444444444444',
          owner: accountState.address,
          spender: delegate,
          currentAmount: '7',
          requestedAmount
        }
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        source: 'eth_call',
        allowance: {
          source: 'eth_call',
          token: tokenContract,
          owner: accountState.address,
          spender: delegate,
          currentAmount: '7',
          requestedAmount
        }
      })
    const request = (handlerId) => ({
      handlerId,
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        from: accountState.address,
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, requestedAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    })
    const mismatched = request('mismatched-token-allowance')

    account.addRequest(mismatched)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(mismatched.approvals.map(({ type }) => type)).toEqual([ApprovalType.TokenApprovalRisk])

    const composed = request('composed-token-allowance')
    account.addRequest(composed)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(composed.approvals.map(({ type }) => type)).toEqual([
      ApprovalType.TokenApprovalRisk,
      ApprovalType.TokenAllowanceChangeRisk
    ])
  })

  it('requires fresh consent when a preserved broad-authority warning expands', async () => {
    const topLevelEffect = {
      type: 'approval',
      standard: 'erc20',
      contract: tokenContract,
      owner: accountState.address,
      spender: delegate,
      amount: maxTokenAmount.toString(10)
    }
    simulateTransaction
      .mockResolvedValueOnce({ status: 'succeeded', source: 'eth_call' })
      .mockResolvedValueOnce({
        status: 'succeeded',
        source: 'eth_simulateV1',
        effects: [
          topLevelEffect,
          {
            ...topLevelEffect,
            contract: '0x4444444444444444444444444444444444444444'
          }
        ]
      })
    const request = {
      handlerId: 'expanded-calldata-consent',
      type: 'transaction',
      account: accountState.address,
      data: {
        chainId: '0x1',
        to: tokenContract,
        data: tokenInterface.encodeFunctionData('approve', [delegate, maxTokenAmount])
      },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)
    const approval = request.approvals[0]
    approval.approve()

    account.refreshTransactionSimulation(request, true, true)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals[0]).toBe(approval)
    expect(approval).toMatchObject({
      approved: false,
      data: { riskCount: 2, evidence: 'calldata-and-rpc' }
    })
  })

  it('does not require broad-authority consent for finite, revoked, or ERC-721 token approvals', async () => {
    simulateTransaction.mockResolvedValueOnce({
      status: 'succeeded',
      source: 'eth_simulateV1',
      effects: [
        { type: 'approval', standard: 'erc20', amount: '100' },
        { type: 'approval', standard: 'erc20', amount: '0' },
        { type: 'approval', standard: 'erc721', tokenId: '42' },
        { type: 'operator-approval', standard: 'erc721-or-erc1155', approved: false }
      ]
    })
    const request = {
      handlerId: 'ordinary-token-approval',
      type: 'transaction',
      data: { chainId: '0x1' },
      approvals: [],
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    await jest.advanceTimersByTimeAsync(0)

    expect(request.approvals).toEqual([])
  })

  it('does not apply an execution check after its request is removed', async () => {
    let resolveSimulation
    simulateTransaction.mockImplementationOnce(() => new Promise((resolve) => (resolveSimulation = resolve)))
    const request = {
      handlerId: 'removed-simulation',
      type: 'transaction',
      data: { chainId: '0x1' },
      simulation: { status: 'pending' }
    }

    account.addRequest(request)
    jest.advanceTimersByTime(1)
    account.clearRequest(request.handlerId)
    resolveSimulation({ status: 'succeeded', source: 'eth_call' })
    await Promise.resolve()

    expect(account.requests[request.handlerId]).toBeUndefined()
  })
})

describe('#claimWalletCallsRequest', () => {
  it('rejects a watch-only batch before changing request state', () => {
    const request = readyWalletCallsRequest('watch-only-wallet-calls')
    account.lastSignerType = 'address'
    account.requests[request.handlerId] = request
    const expected = JSON.parse(JSON.stringify(request))
    accounts.update.mockClear()

    expect(() => account.claimWalletCallsRequest(request.handlerId)).toThrow(
      /watch-only accounts cannot sign/i
    )
    expect(request).toEqual(expected)
    expect(accounts.update).not.toHaveBeenCalled()
  })

  it('atomically claims a detached snapshot of the reviewed batch', () => {
    const request = readyWalletCallsRequest()
    account.requests[request.handlerId] = request
    accounts.update.mockClear()

    const snapshot = account.claimWalletCallsRequest(request.handlerId)

    expect(request).toMatchObject({ locked: true, status: 'pending', notice: 'See Signer' })
    expect(snapshot).toMatchObject({
      id: request.batchId,
      origin: request.origin,
      account: accountState.address.toLowerCase(),
      chainId: request.chainId,
      calls: request.calls,
      preparation: { maxFee: '0xa4100' }
    })
    expect(snapshot.calls).not.toBe(request.calls)
    expect(snapshot.preparation).not.toBe(request.preparation)
    expect(snapshot.preparation.calls[0].transaction).not.toBe(request.preparation.calls[0].transaction)
    expect(Object.isFrozen(snapshot.preparation.calls[0].transaction)).toBe(true)
    expect(accounts.update).toHaveBeenCalledTimes(1)

    request.calls[0].data = '0xffff'
    request.preparation.calls[0].transaction.data = '0xffff'
    expect(snapshot.calls[0].data).toBe('0xabcd')
    expect(snapshot.preparation.calls[0].transaction.data).toBe('0xabcd')
    expect(() => account.claimWalletCallsRequest(request.handlerId)).toThrow(/already been claimed/i)
  })

  it('restores an unclaimed request when publishing the claim fails', () => {
    const request = readyWalletCallsRequest('claim-store-failure')
    account.requests[request.handlerId] = request
    const expected = JSON.parse(JSON.stringify(request))
    accounts.update.mockImplementationOnce(() => {
      throw new Error('account store unavailable')
    })

    expect(() => account.claimWalletCallsRequest(request.handlerId)).toThrow(/store unavailable/)
    expect(request).toEqual(expected)

    expect(() => account.claimWalletCallsRequest(request.handlerId)).not.toThrow()
    expect(request).toMatchObject({ locked: true, status: 'pending' })
  })

  it('rejects a delegated-account batch at the main-process claim boundary', () => {
    const request = readyWalletCallsRequest('delegated-wallet-calls')
    request.simulation.delegation = {
      status: 'delegated',
      source: 'eth_getCode',
      account: request.account,
      delegate
    }
    account.requests[request.handlerId] = request
    const expected = JSON.parse(JSON.stringify(request))
    accounts.update.mockClear()

    expect(() => account.claimWalletCallsRequest(request.handlerId)).toThrow(
      'Wallet-call batches from delegated sending accounts are not supported.'
    )
    expect(request).toEqual(expected)
    expect(accounts.update).not.toHaveBeenCalled()
  })

  it.each(['failed', 'reverted', 'unavailable'])(
    'requires explicit acknowledgement for a %s simulation at the claim boundary',
    (status) => {
      const request = readyWalletCallsRequest(`acknowledge-${status}`)
      request.simulation = { status, calls: [] }
      account.requests[request.handlerId] = request
      const expected = JSON.parse(JSON.stringify(request))
      accounts.update.mockClear()

      expect(() => account.claimWalletCallsRequest(request.handlerId)).toThrow(
        /requires explicit acknowledgement/i
      )
      expect(request).toEqual(expected)
      expect(accounts.update).not.toHaveBeenCalled()

      expect(() => account.claimWalletCallsRequest(request.handlerId, true)).not.toThrow()
      expect(request).toMatchObject({ locked: true, status: 'pending' })
    }
  )

  it('fails closed for an unknown simulation status even with acknowledgement', () => {
    const request = readyWalletCallsRequest('unknown-simulation-status')
    request.simulation = { status: 'unknown', calls: [] }
    account.requests[request.handlerId] = request

    expect(() => account.claimWalletCallsRequest(request.handlerId, true)).toThrow(
      /requires explicit acknowledgement/i
    )
    expect(request.locked).toBeUndefined()
    expect(request.status).toBeUndefined()
  })

  it.each([
    ['pending simulation', (request) => (request.simulation = { status: 'pending', calls: [] })],
    ['missing simulation', (request) => (request.simulation = undefined)],
    ['pending preparation', (request) => (request.preparation = { status: 'pending' })],
    ['failed preparation', (request) => (request.preparation = { status: 'failed', reason: 'no' })],
    ['existing status', (request) => (request.status = 'error')],
    ['existing lock', (request) => (request.locked = true)],
    [
      'account ownership mismatch',
      (request) => (request.account = '0x4444444444444444444444444444444444444444')
    ],
    ['missing origin', (request) => (request.origin = '')],
    ['missing batch id', (request) => (request.batchId = '')],
    ['invalid prepared fee', (request) => (request.preparation.calls[0].maxFee = '0x1')]
  ])('rejects %s without changing request state', (_label, mutate) => {
    const request = readyWalletCallsRequest(`claim-${_label}`)
    mutate(request)
    account.requests[request.handlerId] = request
    const expected = JSON.parse(JSON.stringify(request))
    accounts.update.mockClear()

    expect(() => account.claimWalletCallsRequest(request.handlerId)).toThrow()

    expect(request).toEqual(expected)
    expect(accounts.update).not.toHaveBeenCalled()
  })

  it('rejects a request stored under a different handler identity', () => {
    const request = readyWalletCallsRequest('redirected-handler')
    account.requests['claimed-handler'] = request

    expect(() => account.claimWalletCallsRequest('claimed-handler')).toThrow(/identity/i)
    expect(request.locked).toBeUndefined()
    expect(request.status).toBeUndefined()
  })

  it('invalidates in-flight simulation and preparation results when claimed', async () => {
    let resolveSimulation
    let resolveNonce
    simulateWalletCalls.mockImplementationOnce(() => new Promise((resolve) => (resolveSimulation = resolve)))
    provider.getNonce.mockImplementationOnce((_transaction, callback) => (resolveNonce = callback))
    const request = walletCallsRequest('claim-in-flight')
    account.addRequest(request)
    jest.advanceTimersByTime(1)

    const ready = readyWalletCallsRequest(request.handlerId)
    request.simulation = ready.simulation
    request.preparation = ready.preparation
    const reviewedSimulation = request.simulation
    const reviewedPreparation = request.preparation
    account.claimWalletCallsRequest(request.handlerId)

    resolveSimulation({
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'stale result'
    })
    resolveNonce({ result: '0x9' })
    await jest.advanceTimersByTimeAsync(0)

    expect(request.simulation).toBe(reviewedSimulation)
    expect(request.preparation).toBe(reviewedPreparation)
    expect(request).toMatchObject({ locked: true, status: 'pending' })
  })

  it('rejects a missing or non-wallet-call request', () => {
    account.requests.transaction = { handlerId: 'transaction', type: 'transaction' }

    expect(() => account.claimWalletCallsRequest('missing')).toThrow(/no longer available/i)
    expect(() => account.claimWalletCallsRequest('transaction')).toThrow(/no longer available/i)
  })
})

describe('#signTransaction', () => {
  const validTransaction = (overrides = {}) => ({
    from: accountState.address,
    chainId: '0x1',
    nonce: '0x1',
    type: '0x2',
    gasLimit: '0x5208',
    to: tokenContract,
    data: '0x',
    value: '0x0',
    maxFeePerGas: '0x10',
    maxPriorityFeePerGas: '0x1',
    gasFeesSource: GasFeesSource.Frame,
    ...overrides
  })
  const addReviewedTransaction = (rawTx, evidence = accountCodeEvidence(rawTx.to)) => {
    const request = {
      handlerId: 'reviewed-transaction',
      type: 'transaction',
      data: rawTx,
      simulation: { status: 'succeeded', accountCodeEvidence: evidence }
    }
    account.requests['reviewed-transaction'] = request
    return request
  }

  it('signs once with the matching signer address index after stable account-code revalidation', async () => {
    const callback = jest.fn()
    const rawTx = validTransaction()
    const signer = {
      addresses: [delegate, accountState.address],
      signTransaction: jest.fn((_index, _transaction, cb) => cb(null, '0xsigned'))
    }
    account.signer = 'signer-id'
    signers.get.mockReturnValueOnce(signer)
    addReviewedTransaction(rawTx)

    account.signTransaction(rawTx, callback)
    await flushPromises()

    expect(inspectTransactionAccountCode).toHaveBeenCalledWith(rawTx, expect.any(Object))
    expect(signer.signTransaction).toHaveBeenCalledWith(1, rawTx, callback)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, '0xsigned')
  })

  it.each([
    ['missing from', { from: undefined }, /Missing 'from'/],
    ['invalid hex', { data: 'not-hex' }, /not a valid hex string/]
  ])('reports %s exactly once without invoking a signer', (_label, overrides, message) => {
    const callback = jest.fn()
    account.signer = 'signer-id'

    account.signTransaction(validTransaction(overrides), callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(
      expect.objectContaining({ message: expect.stringMatching(message) })
    )
    expect(signers.get).not.toHaveBeenCalled()
  })

  it('reports a signer-address mismatch once without signing at index -1', async () => {
    const callback = jest.fn()
    const rawTx = validTransaction()
    const signer = { addresses: [delegate], signTransaction: jest.fn() }
    account.signer = 'signer-id'
    signers.get.mockReturnValueOnce(signer)
    addReviewedTransaction(rawTx)

    account.signTransaction(rawTx, callback)
    await flushPromises()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/cannot sign for this address/i) })
    )
    expect(signer.signTransaction).not.toHaveBeenCalled()
  })

  it('fails closed before signing when target account code changed after review', async () => {
    const callback = jest.fn()
    const rawTx = validTransaction()
    const signer = { addresses: [accountState.address], signTransaction: jest.fn() }
    const changed = accountCodeEvidence()
    changed.targets[0] = {
      ...changed.targets[0],
      status: 'delegated',
      codeHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      delegate,
      delegateCodeStatus: 'contract',
      delegateCodeHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }
    account.signer = 'signer-id'
    signers.get.mockReturnValue(signer)
    const request = addReviewedTransaction(rawTx)
    request.locked = true
    request.status = 'pending'
    inspectTransactionAccountCode.mockResolvedValueOnce(changed)

    account.signTransaction(rawTx, callback)
    await flushPromises()

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'account-code-evidence-changed',
        message: `Delegation changed for ${tokenContract}. Request not sent.`
      })
    )
    expect(request).toMatchObject({
      locked: true,
      status: 'pending'
    })
    expect(request.notice).toBeUndefined()
    expect(signer.signTransaction).not.toHaveBeenCalled()
  })

  it('fails closed before signing when fresh target account code is unavailable', async () => {
    const callback = jest.fn()
    const rawTx = validTransaction()
    const signer = { addresses: [accountState.address], signTransaction: jest.fn() }
    const unavailable = accountCodeEvidence()
    unavailable.targets[0] = {
      role: 'target',
      callIndexes: [0],
      status: 'unavailable',
      source: 'eth_getCode',
      trust: 'configured-rpc',
      account: tokenContract,
      reasonCode: 'timeout',
      reason: 'Account code check timed out'
    }
    account.signer = 'signer-id'
    signers.get.mockReturnValue(signer)
    addReviewedTransaction(rawTx)
    inspectTransactionAccountCode.mockResolvedValueOnce(unavailable)

    account.signTransaction(rawTx, callback)
    await flushPromises()

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'account-code-evidence-unavailable',
        message: `Delegation recheck unavailable for ${tokenContract}. Request not sent.`
      })
    )
    expect(signer.signTransaction).not.toHaveBeenCalled()
  })

  it('uses the reviewed batch evidence when signing each prepared wallet call', async () => {
    const callback = jest.fn()
    const request = readyWalletCallsRequest('sign-reviewed-wallet-call')
    request.simulation.accountCodeEvidence = accountCodeEvidence()
    account.requests[request.handlerId] = request
    account.claimWalletCallsRequest(request.handlerId)
    const rawTx = { ...request.preparation.calls[0].transaction }
    const signer = {
      addresses: [accountState.address],
      signTransaction: jest.fn((_index, _transaction, cb) => cb(null, '0xsigned'))
    }
    account.signer = 'signer-id'
    signers.get.mockReturnValueOnce(signer)

    account.signTransaction(rawTx, callback)
    await flushPromises()

    expect(signer.signTransaction).toHaveBeenCalledWith(0, rawTx, callback)
    expect(callback).toHaveBeenCalledWith(null, '0xsigned')
  })

  it('rejects wallet-call evidence that belongs only to another call index', async () => {
    const callback = jest.fn()
    const request = readyWalletCallsRequest('wrong-wallet-call-evidence-index')
    const reviewed = accountCodeEvidence()
    reviewed.targets[0].callIndexes = [1]
    request.simulation.accountCodeEvidence = reviewed
    account.requests[request.handlerId] = request
    account.claimWalletCallsRequest(request.handlerId)
    const rawTx = { ...request.preparation.calls[0].transaction }
    const signer = { addresses: [accountState.address], signTransaction: jest.fn() }
    account.signer = 'signer-id'
    signers.get.mockReturnValue(signer)

    account.signTransaction(rawTx, callback)
    await flushPromises()

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 'account-code-evidence-changed' }))
    expect(signer.signTransaction).not.toHaveBeenCalled()
  })
})

describe('signer address ownership', () => {
  it.each([
    ['message', (callback) => account.signMessage('hello', callback), 'signMessage'],
    [
      'typed data',
      (callback) => account.signTypedData({ data: {}, version: 'V4' }, callback),
      'signTypedData'
    ]
  ])('does not sign %s at index -1 after reporting an ownership error', (_label, invoke, method) => {
    const callback = jest.fn()
    const signer = { addresses: [delegate], [method]: jest.fn() }
    account.signer = 'signer-id'
    signers.get.mockReturnValueOnce(signer)

    invoke(callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/cannot sign for this address/i) })
    )
    expect(signer[method]).not.toHaveBeenCalled()
  })
})
