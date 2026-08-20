import React from 'react'

import { getReceiptFeeUsd, RequestCommand } from '../../../../../app/tray/Footer/RequestCommand'
import { transactionLifecyclePresentation } from '../../../../../app/tray/Footer/RequestCommand/TxBar'
import { Time } from '../../../../../app/tray/Footer/Time'
import { act, render, screen } from '../../../../componentSetup'
import link from '../../../../../resources/link'
import {
  clearTransactionFeeDraftSafety,
  setTransactionFeeDraftSafety
} from '../../../../../resources/domain/request'
import { WREN_DEPLOY_ORIGIN, originIdForName } from '../../../../../resources/domain/origin'

jest.mock('../../../../../resources/link', () => ({ invoke: jest.fn(), rpc: jest.fn(), send: jest.fn() }))

const request = {
  account: '0x0000000000000000000000000000000000000001',
  handlerId: '22222222-2222-4222-8222-222222222222'
}

const transaction = (overrides = {}) => ({
  ...request,
  type: 'transaction',
  data: {
    chainId: '0x1',
    type: '0x2',
    gasLimit: '0x5208',
    maxFeePerGas: '0x3b9aca00'
  },
  simulation: {
    status: 'succeeded',
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: {
        status: 'no-code',
        source: 'eth_getCode',
        trust: 'configured-rpc',
        account: request.account,
        codeHash: `0x${'00'.repeat(32)}`,
        role: 'sender'
      },
      targets: []
    }
  },
  ...overrides
})

const commandStore = ({
  explorer = 'https://example.test',
  isTestnet = true,
  muteExplorerWarning = true,
  muteSignerWarning = true,
  muteGasWarning = true,
  nativePrice
} = {}) => {
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'main.networks.ethereum.1') return { isTestnet, explorer }
    if (key === 'main.networks.ethereum.1.name') return 'Ethereum'
    if (key === 'main.networksMeta.ethereum.1') {
      return {
        nativeCurrency: {
          symbol: 'ETH',
          decimals: 18,
          ...(nativePrice === undefined ? {} : { usd: { price: nativePrice } })
        }
      }
    }
    if (key === 'main.mute.explorerWarning') return muteExplorerWarning
    if (key === 'main.mute.signerCompatibilityWarning') return muteSignerWarning
    if (key === 'main.mute.gasFeeWarning') return muteGasWarning
    return undefined
  }
  store.notify = jest.fn()
  return store
}

class RequestCommandHarness extends RequestCommand {
  constructor(props) {
    super(props)
    this.store = props.testStore
  }

  render() {
    return this[this.props.renderMethod]()
  }
}

const renderMountedCommand = (req, renderMethod, testStore, signingDelay = 1500) =>
  render(
    <RequestCommandHarness
      req={req}
      renderMethod={renderMethod}
      signingDelay={signingDelay}
      testStore={testStore}
    />
  )

const renderCommandResult = (command, method) => {
  const view = render(command[method]())
  return {
    ...view,
    rerenderCommand: () => view.rerender(command[method]())
  }
}

beforeEach(() => {
  link.invoke.mockReset()
  link.rpc.mockReset()
  link.send.mockReset()
  clearTransactionFeeDraftSafety(request.handlerId)
})

it('opens source verification only for a confirmed managed deployment', async () => {
  const operationId = '33333333-3333-4333-8333-333333333333'
  const req = transaction({
    activityId: operationId,
    origin: originIdForName(WREN_DEPLOY_ORIGIN),
    status: 'confirmed',
    deployment: { inspectionId: 'a'.repeat(32) },
    tx: {
      hash: `0x${'a'.repeat(64)}`,
      confirmations: 1,
      receipt: {
        blockNumber: '0x1',
        gasUsed: '0x5208',
        status: '0x1',
        contractAddress: `0x${'2'.repeat(40)}`
      }
    }
  })
  const address = `0x${'2'.repeat(40)}`
  link.invoke.mockResolvedValue({ success: true, operationId, chainId: 1, address })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore())

  expect(document.querySelector('.requestNoticeTransactionDeploymentStatus')).toBeTruthy()

  await view.user.click(screen.getByRole('button', { name: 'Verify source' }))

  expect(link.invoke).toHaveBeenCalledWith('tray:continueContractVerification', {
    account: req.account,
    handlerId: req.handlerId
  })
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'contracts',
    data: { mode: 'verify', operationId, chainId: 1, address }
  })
  view.unmount()
})

it('keeps an unavailable verification handoff visible and retryable', async () => {
  const req = transaction({
    activityId: '33333333-3333-4333-8333-333333333333',
    origin: originIdForName(WREN_DEPLOY_ORIGIN),
    status: 'confirmed',
    deployment: { inspectionId: 'a'.repeat(32) },
    tx: {
      hash: `0x${'a'.repeat(64)}`,
      receipt: {
        blockNumber: '0x1',
        gasUsed: '0x5208',
        status: '0x1',
        contractAddress: `0x${'2'.repeat(40)}`
      }
    }
  })
  link.invoke.mockResolvedValue({ success: false, error: 'invalid-operation' })
  const view = renderMountedCommand(req, 'sentStatus', commandStore())

  await view.user.click(screen.getByRole('button', { name: 'Verify source' }))

  expect((await screen.findByRole('alert')).textContent).toMatch(/could not be opened/i)
  expect(screen.getByRole('button', { name: 'Verify source' }).disabled).toBe(false)
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'navDash', expect.anything())
  view.unmount()
})

it.each([
  ['ordinary confirmation', {}],
  ['managed transaction without deployment evidence', { origin: originIdForName(WREN_DEPLOY_ORIGIN) }],
  [
    'managed deployment without a confirmed contract address',
    {
      activityId: '33333333-3333-4333-8333-333333333333',
      origin: originIdForName(WREN_DEPLOY_ORIGIN),
      deployment: { inspectionId: 'a'.repeat(32) }
    }
  ]
])('does not offer source verification for %s', (_label, overrides) => {
  const req = transaction({
    status: 'confirmed',
    tx: { hash: `0x${'a'.repeat(64)}`, receipt: { blockNumber: '0x1', gasUsed: '0x5208' } },
    ...overrides
  })
  const view = renderMountedCommand(req, 'sentStatus', commandStore())

  expect(screen.queryByRole('button', { name: 'Verify source' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  view.unmount()
})

const commandWithStore = () => {
  const command = new RequestCommand({ signingDelay: 1500 })
  command.setState = jest.fn()
  command.store = { notify: jest.fn() }
  return command
}

it('cancels delayed request state updates when unmounted', () => {
  const command = new RequestCommand({ signingDelay: 1500 })
  command.setState = jest.fn()
  command.scheduleTimer('txHashCopiedTimer', () => command.setState({ txHashCopied: false }), 3000)
  command.scheduleTimer('signerLockedTimer', () => command.setState({ signerLocked: false }), 3000)

  command.componentWillUnmount()
  jest.runOnlyPendingTimers()

  expect(command.setState).not.toHaveBeenCalled()
})

it('fails closed when signer compatibility cannot be determined', () => {
  const command = commandWithStore()

  expect(command.handleSignerCompatibilityFailure('Unexpected signer failure', undefined, request)).toBe(true)
  expect(command.store.notify).toHaveBeenCalledWith('signerUnavailableWarning', { req: request })
  command.componentWillUnmount()
})

it('preserves specific missing and locked signer handling', () => {
  const missing = commandWithStore()
  expect(missing.handleSignerCompatibilityFailure('No signer', undefined, request)).toBe(true)
  expect(missing.store.notify).toHaveBeenCalledWith('noSignerWarning', { req: request })
  missing.componentWillUnmount()

  const locked = commandWithStore()
  expect(locked.handleSignerCompatibilityFailure('Signer unavailable', undefined, request)).toBe(true)
  expect(locked.setState).toHaveBeenCalledWith({ signerLocked: true })
  expect(locked.store.notify).not.toHaveBeenCalled()
  locked.componentWillUnmount()
})

it('continues only with a valid compatibility result', () => {
  const command = commandWithStore()
  expect(
    command.handleSignerCompatibilityFailure(
      null,
      { compatible: true, signer: 'ring', tx: 'london' },
      request
    )
  ).toBe(false)
  expect(command.store.notify).not.toHaveBeenCalled()
  command.componentWillUnmount()
})

it('uses native disabled decisions until the transaction signing delay completes', async () => {
  const req = transaction()
  const view = renderMountedCommand(req, 'signOrDecline', commandStore())

  expect(screen.getByText('Ready for review')).toBeTruthy()
  expect(screen.getByText('Verify on your signer before approving.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Decline' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true)

  act(() => jest.advanceTimersByTime(1499))
  expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true)
  act(() => jest.advanceTimersByTime(1))
  link.rpc.mockImplementation((method, ...args) => {
    const callback = args.at(-1)
    if (method === 'signerCompatibility') callback(null, { compatible: true })
  })
  await view.user.click(screen.getByRole('button', { name: 'Sign transaction' }))

  expect(link.rpc.mock.calls.map(([method]) => method)).toEqual(['signerCompatibility', 'approveRequest'])
  view.unmount()
})

it('keeps an approval RPC failure visible and allows another attempt', async () => {
  const req = transaction()
  const view = renderMountedCommand(req, 'signOrDecline', commandStore(), 0)
  act(() => jest.advanceTimersByTime(0))
  link.rpc.mockImplementation((method, ...args) => {
    const callback = args.at(-1)
    if (method === 'signerCompatibility') callback(null, { compatible: true })
    if (method === 'approveRequest') callback('Request account is no longer selected')
  })

  await view.user.click(screen.getByRole('button', { name: 'Sign transaction' }))

  expect(screen.getByRole('alert').textContent).toMatch(/still pending/i)
  expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(false)
  view.unmount()
})

it('fails closed without dispatching an unknown request action', () => {
  const command = new RequestCommand({ req: transaction(), signingDelay: 0 })
  command.store = commandStore()
  command.mounted = true
  command.setState = jest.fn((update) => Object.assign(command.state, update))

  command.runRequestAction('unknownRequestAction', transaction())

  expect(link.rpc).not.toHaveBeenCalled()
  expect(command.setState).toHaveBeenLastCalledWith({
    requestActionPending: false,
    requestActionError: 'Wren could not update this request. It is still pending.'
  })
  command.componentWillUnmount()
})

it('retains a recoverable pre-sign failure with explicit recheck and close actions', async () => {
  const req = transaction({
    status: 'error',
    notice: `Delegation recheck unavailable for ${request.account}. Request not sent.`,
    recoverableError: {
      code: 'account-code-evidence-unavailable',
      message: `Delegation recheck unavailable for ${request.account}. Request not sent.`
    },
    retainedPreBroadcastError: { responderPending: true }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore(), 0)

  const alert = screen.getByRole('alert')
  expect(alert.textContent).toMatch(/safety check unavailable/i)
  expect(alert.firstElementChild.classList.contains('requestActionContextIconAlert')).toBe(true)
  expect(screen.getByText('The safety check could not be repeated. Nothing was signed or sent.')).toBeTruthy()
  expect(screen.queryByText(/Delegation recheck unavailable/)).toBeNull()
  await view.user.click(screen.getByRole('button', { name: 'Recheck' }))

  expect(link.rpc).toHaveBeenCalledWith(
    'retryTransactionRequest',
    { account: request.account, handlerId: request.handlerId, type: 'transaction' },
    expect.any(Function)
  )
  view.unmount()
})

it('shows exact funding recovery amounts with copy, receive QR, and recheck actions', async () => {
  const quantity = (value) => `0x${value.toString(16)}`
  const req = transaction({
    status: 'error',
    notice: 'More funds needed.',
    recoverableError: {
      code: 'transaction-funding-insufficient',
      message: 'More funds needed.',
      data: {
        available: quantity(10n ** 18n),
        required: quantity(15n * 10n ** 17n),
        missing: quantity(5n * 10n ** 17n),
        value: '0x0',
        maximumFee: quantity(15n * 10n ** 17n)
      }
    },
    retainedPreBroadcastError: { responderPending: true }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore(), 0)

  expect(screen.getByRole('alert').textContent).toMatch(/more funds needed/i)
  expect(screen.getByText('1 ETH')).toBeTruthy()
  expect(screen.getByText('1.5 ETH')).toBeTruthy()
  expect(screen.getByText('0.5 ETH')).toBeTruthy()

  await view.user.click(screen.getByRole('button', { name: 'Copy address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', request.account)

  await view.user.click(screen.getByRole('button', { name: 'Show receive QR' }))
  expect(
    screen.getByRole('img', { name: 'QR code for funding account address' }).getAttribute('data-qr-payload')
  ).toBe(request.account)

  await view.user.click(screen.getByRole('button', { name: 'Recheck' }))
  expect(link.rpc).toHaveBeenCalledWith(
    'retryTransactionRequest',
    { account: request.account, handlerId: request.handlerId, type: 'transaction' },
    expect.any(Function)
  )
  view.unmount()
})

it('closes a retained pre-sign failure only through the explicit close action', async () => {
  const req = transaction({
    status: 'error',
    notice: 'Delegation changed. Request not sent.',
    recoverableError: {
      code: 'account-code-evidence-changed',
      message: 'Delegation changed. Request not sent.'
    },
    retainedPreBroadcastError: { responderPending: true }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore(), 0)

  await view.user.click(screen.getByRole('button', { name: 'Close request' }))

  expect(link.rpc).toHaveBeenCalledWith(
    'closeFailedTransactionRequest',
    { account: request.account, handlerId: request.handlerId, type: 'transaction' },
    expect.any(Function)
  )
  view.unmount()
})

it('retains a terminal pre-sign failure with its real notice and Close only', async () => {
  const req = transaction({
    status: 'error',
    notice: 'Trezor is disconnected.',
    retainedPreBroadcastError: { responderPending: false }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore(), 0)

  expect(screen.getByRole('alert').textContent).toMatch(/signing did not complete/i)
  expect(screen.getByText('Trezor is disconnected. No transaction was sent.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Recheck' })).toBeNull()

  await view.user.click(screen.getByRole('button', { name: 'Close request' }))

  expect(link.rpc).toHaveBeenCalledWith(
    'closeFailedTransactionRequest',
    { account: request.account, handlerId: request.handlerId, type: 'transaction' },
    expect.any(Function)
  )
  view.unmount()
})

it('keeps signing disabled while simulation is pending after decline becomes available', () => {
  const command = new RequestCommand({
    req: transaction({ simulation: { status: 'pending' } }),
    signingDelay: 0
  })
  command.store = commandStore()
  command.state.allowInput = true
  renderCommandResult(command, 'signOrDecline')

  expect(screen.getByRole('button', { name: 'Decline' }).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'Checking' }).disabled).toBe(true)
  command.componentWillUnmount()
})

it('shows successful core execution while keeping signing disabled for required additional checks', () => {
  const req = transaction({
    simulation: {
      ...transaction().simulation,
      status: 'succeeded',
      advancedChecks: { status: 'pending' }
    }
  })
  const command = new RequestCommand({ req, signingDelay: 0 })
  command.store = commandStore()
  command.state.allowInput = true
  renderCommandResult(command, 'signOrDecline')

  expect(screen.getByText('Final checks')).toBeTruthy()
  expect(screen.getByText('Wren is checking transaction details.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Finishing checks' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Decline' }).disabled).toBe(false)
  command.componentWillUnmount()
})

it('enters a stable pending lifecycle even when software signing has no notice text', () => {
  const req = transaction({
    notice: '',
    status: 'pending',
    signingProgress: { phase: 'waiting-for-signer', startedAt: Date.now(), signerType: 'seed' }
  })
  const command = new RequestCommand({ req, signingDelay: 0 })
  command.store = commandStore()
  renderCommandResult(command, 'renderTxCommand')

  expect(screen.getByText('Waiting for signer')).toBeTruthy()
  expect(screen.getByText('Review and approve the transaction on your signer.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Sign transaction' })).toBeNull()
  command.componentWillUnmount()
})

it('escalates truthful Trezor waiting guidance and keeps cancellation available', async () => {
  const req = transaction({
    status: 'pending',
    signingProgress: {
      phase: 'waiting-for-signer',
      startedAt: Date.now(),
      signerType: 'trezor',
      signerName: 'Trezor Safe 5'
    }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore(), 0)

  expect(screen.getByText('Waiting for Trezor')).toBeTruthy()
  expect(document.querySelector('.requestActionContextIconSign')).toBeTruthy()
  act(() => jest.advanceTimersByTime(5000))
  expect(screen.getByText('Still waiting for Trezor')).toBeTruthy()
  act(() => jest.advanceTimersByTime(5000))
  expect(screen.getByText('Still waiting for Trezor')).toBeTruthy()
  expect(screen.getByText('Check that your Trezor is connected and showing this transaction.')).toBeTruthy()

  await view.user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(link.rpc).toHaveBeenCalledWith(
    'declineRequest',
    { account: req.account, handlerId: req.handlerId, type: 'transaction' },
    expect.any(Function)
  )
  view.unmount()
})

it('keeps signing disabled while a fee field has an uncommitted or invalid draft', () => {
  const req = transaction()
  const view = renderMountedCommand(req, 'signOrDecline', commandStore(), 0)
  act(() => jest.advanceTimersByTime(0))

  expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(false)

  act(() => setTransactionFeeDraftSafety(req.handlerId, false))
  expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true)

  act(() => setTransactionFeeDraftSafety(req.handlerId, true))
  expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(false)
  view.unmount()
})

it('uses native disabled decisions for signatures until input is allowed', async () => {
  const req = { ...request, type: 'sign' }
  const view = renderMountedCommand(req, 'renderSignDataCommand', commandStore())

  expect(screen.getByRole('button', { name: 'Decline' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Sign message' }).disabled).toBe(true)

  act(() => jest.advanceTimersByTime(1500))
  link.rpc.mockImplementation((method, ...args) => {
    if (method === 'signerCompatibility') args.at(-1)(null, { compatible: true })
  })
  await view.user.click(screen.getByRole('button', { name: 'Sign message' }))

  expect(link.rpc.mock.calls.map(([method]) => method)).toEqual(['signerCompatibility', 'approveRequest'])
  view.unmount()
})

it('preserves the signer-compatibility warning before approval', async () => {
  const req = transaction()
  const store = commandStore({ muteSignerWarning: false })
  const compatibility = { compatible: false, reason: 'blind signing required' }
  const view = renderMountedCommand(req, 'signOrDecline', store, 0)
  act(() => jest.advanceTimersByTime(0))
  link.rpc.mockImplementation((method, ...args) => {
    if (method === 'signerCompatibility') args.at(-1)(null, compatibility)
  })

  await view.user.click(screen.getByRole('button', { name: 'Sign transaction' }))

  expect(store.notify).toHaveBeenCalledWith('signerCompatibilityWarning', {
    req,
    compatibility,
    chain: { type: 'ethereum', id: 1 }
  })
  expect(link.rpc.mock.calls.map(([method]) => method)).toEqual(['signerCompatibility'])
})

it.each([
  ['unknown', {}, '0.00'],
  ['high', { isTestnet: false, nativePrice: 3000, maxFeePerGas: '0x38d7ea4c68000' }, '63000.00']
])('preserves the %s-fee warning before approval', async (_label, options, feeUSD) => {
  const { maxFeePerGas, ...storeOptions } = options
  const req = transaction({
    data: {
      ...transaction().data,
      ...(maxFeePerGas ? { maxFeePerGas } : {})
    }
  })
  const store = commandStore({ ...storeOptions, muteGasWarning: false })
  const view = renderMountedCommand(req, 'signOrDecline', store, 0)
  act(() => jest.advanceTimersByTime(0))
  link.rpc.mockImplementation((method, ...args) => {
    if (method === 'signerCompatibility') args.at(-1)(null, { compatible: true })
  })

  await view.user.click(screen.getByRole('button', { name: 'Sign transaction' }))

  expect(store.notify).toHaveBeenCalledWith('gasFeeWarning', {
    req,
    feeUSD,
    currentSymbol: 'ETH'
  })
  expect(link.rpc.mock.calls.map(([method]) => method)).toEqual(['signerCompatibility'])
})

it('omits explorer access without a configured explorer while preserving hash copy', async () => {
  const req = transaction({
    notice: 'submitted',
    status: 'confirming',
    tx: { hash: '0x1234' }
  })
  const view = renderMountedCommand(req, 'sentStatus', commandStore({ explorer: '' }))

  await view.user.click(screen.getByRole('button', { name: 'View details' }))
  expect(screen.queryByRole('button', { name: 'Open Explorer' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Copy Hash' }).disabled).toBe(false)
  view.unmount()
})

it.each([
  ['sending', 'Sending', 'Wren is sending the transaction to the network.'],
  ['verifying', 'Submitted', 'Wren sent the transaction to the network.'],
  ['confirming', 'Confirming', 'The transaction was sent. Wren is waiting for network confirmation.'],
  ['confirmed', 'Confirmed', 'The transaction is confirmed on Ethereum.'],
  ['error', 'Transaction failed', 'The network did not confirm this transaction.']
])('maps %s to truthful lifecycle copy', (status, title, detail) => {
  expect(transactionLifecyclePresentation(transaction({ status }), 'Ethereum')).toMatchObject({
    title,
    detail
  })
})

it('presents an ambiguous one-shot broadcast without claiming network acceptance', () => {
  const req = transaction({
    status: 'verifying',
    submission: { status: 'unconfirmed' },
    tx: { hash: `0x${'a'.repeat(64)}`, confirmations: 0 }
  })

  expect(transactionLifecyclePresentation(req, 'Ethereum')).toMatchObject({
    title: 'Submission unconfirmed',
    detail:
      'Wren made one broadcast attempt, but the RPC has not confirmed acceptance yet. Wren is checking the network and will not automatically resubmit.',
    steps: ['Broadcast once', 'Checking', 'Confirming', 'Confirmed']
  })
})

it('keeps transaction monitor evidence and actions stable without hover substitution', async () => {
  const req = transaction({
    notice: 'Verifying',
    status: 'verifying',
    tx: { hash: `0x${'a'.repeat(64)}`, confirmations: 2 }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore())

  expect(screen.getAllByText('Submitted')).toHaveLength(2)
  expect(document.querySelector('.txLifecycleMark svg').getAttribute('width')).toBe('20')
  expect(screen.getByText('Wren sent the transaction to the network.')).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Transaction progress' })).toBeTruthy()
  expect(screen.getByText('Confirmations')).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Speed Up' })).toBeTruthy()

  await view.user.click(screen.getByRole('button', { name: 'View details' }))
  expect(screen.getByRole('button', { name: 'Open Explorer' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy Hash' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Speed Up' })).toBeTruthy()
  expect(screen.queryByLabelText('Show signing status')).toBeNull()
  view.unmount()
})

it('shows truthful unconfirmed-submission evidence without replacement actions', async () => {
  const hash = `0x${'b'.repeat(64)}`
  const req = transaction({
    notice: 'Submission unconfirmed; checking network',
    status: 'verifying',
    mode: 'monitor',
    submission: { status: 'unconfirmed' },
    tx: { hash, confirmations: 0 }
  })
  const view = renderMountedCommand(req, 'renderTxCommand', commandStore())

  const status = document.querySelector('.txLifecycle')
  expect(status.getAttribute('role')).toBe('status')
  expect(status.getAttribute('aria-live')).toBe('polite')
  expect(status.textContent).toContain('Submission unconfirmed')
  expect(status.textContent).toContain('Wren made one broadcast attempt')
  expect(status.textContent).toContain('will not automatically resubmit')
  expect(screen.getByText('Expected transaction hash')).toBeTruthy()
  expect(screen.getByText('RPC acceptance')).toBeTruthy()
  expect(screen.getByText('Unconfirmed')).toBeTruthy()
  expect(screen.queryByText('Confirmations')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Speed Up' })).toBeNull()
  expect(link.rpc).not.toHaveBeenCalledWith(
    'replaceTransactionRequest',
    expect.anything(),
    expect.anything(),
    expect.any(Function)
  )

  await view.user.click(screen.getByRole('button', { name: 'View details' }))
  expect(screen.getByRole('button', { name: 'Open Explorer' })).toBeTruthy()
  await view.user.click(screen.getByRole('button', { name: 'Copy Hash' }))
  expect(screen.getByText('Expected transaction hash copied')).toBeTruthy()
  expect(link.send).toHaveBeenCalledWith('tray:copyTxHash', hash)
  view.unmount()
})

it.each(['cancel', 'speed'])(
  'queues %s through the bounded RPC and reports admission failures',
  async (kind) => {
    const req = transaction({
      notice: 'Verifying',
      status: 'verifying',
      tx: { hash: `0x${'a'.repeat(64)}`, confirmations: 0 }
    })
    link.rpc.mockImplementation((_method, _reference, _kind, callback) => callback(new Error('stale')))
    const view = renderMountedCommand(req, 'renderTxCommand', commandStore())

    await view.user.click(screen.getByRole('button', { name: kind === 'cancel' ? 'Cancel' : 'Speed Up' }))

    expect(link.rpc).toHaveBeenCalledWith(
      'replaceTransactionRequest',
      { account: req.account, handlerId: req.handlerId, type: 'transaction' },
      kind,
      expect.any(Function)
    )
    expect(screen.getByRole('alert').textContent).toMatch(/could not be replaced/i)
    expect(link.send).not.toHaveBeenCalledWith('nav:back', 'panel')
    view.unmount()
  }
)

it('calculates receipt fees without losing integer precision', () => {
  const receipt = {
    blockNumber: '0x1',
    gasUsed: '0x20000000000001',
    effectiveGasPrice: '0x3b9aca00'
  }
  expect(getReceiptFeeUsd(receipt, transaction().data, 2000)).toBe('18014398509.48')
})

it('keeps the pending signature cancellation action keyboard accessible', async () => {
  const req = { ...request, type: 'sign', notice: 'See Signer', status: 'pending' }
  const command = new RequestCommand({ req, signingDelay: 1500 })
  command.store = commandStore()
  const view = renderCommandResult(command, 'renderSignDataCommand')

  await view.user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await view.user.keyboard('{Enter}')

  expect(link.rpc).toHaveBeenCalledWith(
    'declineRequest',
    { handlerId: req.handlerId, account: req.account, type: req.type },
    expect.any(Function)
  )
  command.componentWillUnmount()
})

it('renders a declined transaction without monitor chrome', () => {
  const req = transaction({ status: 'declined', notice: 'Signature Declined' })
  const command = new RequestCommand({ req, signingDelay: 0 })
  command.store = commandStore()
  renderCommandResult(command, 'renderTxCommand')

  expect(screen.getByText('Transaction declined')).toBeTruthy()
  expect(screen.getByText('Nothing was signed or sent.')).toBeTruthy()
  expect(screen.queryByLabelText('Show signing status')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
  expect(screen.queryByText('Signature Declined')).toBeNull()
  command.componentWillUnmount()
})

it('renders a declined signature without a failure symbol', () => {
  const req = { ...request, type: 'sign', status: 'declined', notice: 'Signature Declined' }
  const command = new RequestCommand({ req, signingDelay: 0 })
  command.store = commandStore()
  renderCommandResult(command, 'renderSignDataCommand')

  expect(screen.getByText('Request declined')).toBeTruthy()
  expect(screen.getByText('Nothing was signed or sent.')).toBeTruthy()
  expect(document.querySelector('.requestNoticeInnerSymbol')).toBeNull()
  expect(screen.queryByText('Signature Declined')).toBeNull()
  command.componentWillUnmount()
})

it('stops the completed-transaction clock when unmounted', () => {
  const ref = React.createRef()
  const clearIntervalSpy = jest.spyOn(global, 'clearInterval')
  const view = render(<Time ref={ref} time={Date.now()} />)
  const clock = ref.current.clock

  view.unmount()
  expect(clearIntervalSpy).toHaveBeenCalledWith(clock)
  clearIntervalSpy.mockRestore()
})
