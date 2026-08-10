import React from 'react'

import { getReceiptFeeUsd, RequestCommand } from '../../../../../app/tray/Footer/RequestCommand'
import { Time } from '../../../../../app/tray/Footer/Time'
import { act, render, screen } from '../../../../componentSetup'
import link from '../../../../../resources/link'
import {
  clearTransactionFeeDraftSafety,
  setTransactionFeeDraftSafety
} from '../../../../../resources/domain/request'

jest.mock('../../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

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
  simulation: { status: 'succeeded' },
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
    if (key === 'main.networksMeta.ethereum.1') {
      return {
        nativeCurrency: {
          symbol: 'ETH',
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
  link.rpc.mockReset()
  link.send.mockReset()
  clearTransactionFeeDraftSafety(request.handlerId)
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

it('disables explorer access without a configured explorer', () => {
  const req = transaction({
    notice: 'submitted',
    status: 'confirming',
    tx: { hash: '0x1234' }
  })
  const command = new RequestCommand({ req, signingDelay: 0 })
  command.store = commandStore({ explorer: '' })
  renderCommandResult(command, 'sentStatus')

  expect(screen.getByRole('button', { name: 'Open Explorer' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Copy Hash' }).disabled).toBe(false)
  command.componentWillUnmount()
})

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

  expect(link.rpc).toHaveBeenCalledWith('declineRequest', req, expect.any(Function))
  command.componentWillUnmount()
})

it('renders a declined transaction without monitor chrome', () => {
  const req = transaction({ status: 'declined', notice: 'Signature Declined' })
  const command = new RequestCommand({ req, signingDelay: 0 })
  command.store = commandStore()
  renderCommandResult(command, 'renderTxCommand')

  expect(screen.getByText('Transaction declined')).toBeTruthy()
  expect(screen.getByText('You declined this transaction. Nothing was signed or sent.')).toBeTruthy()
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
