import Restore from 'react-restore'

import { Send } from '../../../../app/dash/Send'
import {
  maxSendAmount,
  queueSend,
  queueSweep,
  quoteSweep,
  resolveSendRecipient
} from '../../../../app/dash/Send/api'
import { NATIVE_CURRENCY } from '../../../../resources/constants'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen, waitFor, within } from '../../../componentSetup'

jest.mock('../../../../app/dash/Send/api', () => ({
  maxSendAmount: jest.fn(),
  queueSend: jest.fn(),
  queueSweep: jest.fn(),
  quoteSweep: jest.fn(),
  resolveSendRecipient: jest.fn()
}))
jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const secondRecipient = '0x5555555555555555555555555555555555555555'
const token = '0x3333333333333333333333333333333333333333'
const sweepRequestId = '123e4567-e89b-42d3-a456-426614174000'
const maxRequestId = '123e4567-e89b-42d3-a456-426614174001'
const retainedRequestId = '123e4567-e89b-42d3-a456-426614174002'

const baseState = () => ({
  selected: { current: account },
  windows: { dash: { nav: [{ view: 'send', data: {} }] } },
  main: {
    accounts: {
      [account]: { id: account, address: account, name: 'Garden', lastSignerType: 'ring', requests: {} }
    },
    addressBook: {},
    balances: {
      [account]: [
        {
          address: NATIVE_CURRENCY,
          balance: '0xde0b6b3a7640000',
          chainId: 1,
          decimals: 18,
          displayBalance: '1.00',
          name: 'Ether',
          symbol: 'ETH'
        },
        {
          address: token,
          balance: '0x5f5e100',
          chainId: 8453,
          decimals: 6,
          displayBalance: '100.00',
          name: 'USD Coin',
          symbol: 'USDC'
        }
      ]
    },
    networks: {
      ethereum: {
        1: {
          id: 1,
          isTestnet: false,
          name: 'Ethereum',
          on: true,
          connection: { endpoints: [{ connected: true }] }
        },
        8453: {
          id: 8453,
          isTestnet: false,
          name: 'Base',
          on: true,
          connection: { endpoints: [{ connected: true }] }
        }
      }
    },
    networksMeta: {
      ethereum: {
        1: {
          gas: { price: { levels: { fast: '1000000000' } } },
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', usd: { price: 3000 } },
          primaryColor: 'wren-chain-ethereum'
        },
        8453: {
          gas: { price: { levels: { fast: '10000000' } } },
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', usd: { price: 3000 } },
          primaryColor: 'wren-chain-base'
        }
      }
    },
    rates: { [token]: { price: 1 } }
  }
})

const renderSend = (mutate = (state) => state) => {
  const store = Restore.create(mutate(baseState()), {})
  const ConnectedSend = Restore.connect(Send, store)
  return { ...render(<ConnectedSend />), store }
}

const replaceStore = (store, mutate) => {
  const state = JSON.parse(JSON.stringify(store()))
  mutate(state)
  act(() => store.api.replaceState(state))
}

const setDashStep = (store, step, title) => {
  replaceStore(store, (state) => {
    state.windows.dash.nav.unshift({ view: 'send', data: { step, title } })
  })
}

const closeDashStep = (store) => {
  replaceStore(store, (state) => {
    state.windows.dash.nav.shift()
  })
}

beforeEach(() => {
  maxSendAmount.mockReset()
  queueSend.mockReset()
  queueSweep.mockReset()
  quoteSweep.mockReset()
  resolveSendRecipient.mockReset()
  link.send.mockReset()
  link.rpc.mockReset()
})

it('defers the network fee to authoritative request review', () => {
  renderSend()

  expect(screen.getByText('Network fee')).toBeTruthy()
  expect(screen.getByText('Calculated during review')).toBeTruthy()
  expect(screen.getByText('Wren estimates gas before anything is signed.')).toBeTruthy()
  expect(screen.queryByText(/0\.000021 ETH/)).toBeNull()
})

it('opens directly on a native asset without a connection step and exposes the asset ledger', async () => {
  const { store } = renderSend()

  expect(screen.getByRole('button', { name: 'Choose an asset' }).textContent).toContain('ETH')
  expect(screen.queryByText(/Connect Account/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  expect(link.send).toHaveBeenCalledWith('nav:update', 'dash', {
    data: { step: 'assetPicker', title: 'Choose an asset' }
  })
  setDashStep(store, 'assetPicker', 'Choose an asset')
  const selectedAsset = screen.getByRole('button', { name: 'Select ETH on Ethereum' })
  expect(selectedAsset.getAttribute('aria-pressed')).toBe('true')
  expect(within(selectedAsset).getByRole('img', { name: 'ETH asset' }).classList).toContain('assetMark-plain')
  expect(screen.getByRole('button', { name: 'Select USDC on Base' }).getAttribute('aria-pressed')).toBe(
    'false'
  )
})

it('restores focus to the asset trigger after the picker closes', async () => {
  const { store, user } = renderSend()
  const trigger = screen.getByRole('button', { name: 'Choose an asset' })

  await user.click(trigger)
  setDashStep(store, 'assetPicker', 'Choose an asset')
  expect(document.activeElement).toBe(screen.getByPlaceholderText('Search assets'))

  await user.click(screen.getByRole('button', { name: 'Select ETH on Ethereum' }))
  closeDashStep(store)

  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose an asset' }))
  )
})

it('uses the shared illustrated empty-state anatomy when no asset is sendable', () => {
  renderSend((state) => {
    state.main.balances[account] = []
    return state
  })

  expect(screen.getByText('No sendable assets on this network').closest('.wrenEmptyState')).toBeTruthy()
  expect(screen.getByText('Wren found no positive balances available to send.')).toBeTruthy()
})

it('distinguishes balance refresh and disconnected asset networks from an empty account', () => {
  const { unmount } = renderSend((state) => {
    state.main.scanning = { [account]: true }
    state.main.balances[account] = []
    return state
  })

  expect(screen.getByText('Checking balances…')).toBeTruthy()
  expect(screen.getByText('Wren is refreshing this account before showing sendable assets.')).toBeTruthy()
  unmount()

  renderSend((state) => {
    state.main.networks.ethereum[1].connection.endpoints[0].connected = false
    state.main.networks.ethereum[8453].connection.endpoints[0].connected = false
    return state
  })

  expect(screen.getByText('Asset networks unavailable')).toBeTruthy()
  expect(screen.getByText('Reconnect the networks holding these assets before sending.')).toBeTruthy()
})

it('honors the global balance privacy setting in the composer and asset picker', () => {
  const { store } = renderSend((state) => {
    state.selected.hideBalances = true
    return state
  })

  expect(screen.getByText('Available balance hidden')).toBeTruthy()
  expect(screen.queryByText('Available: 1.00 ETH')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  expect(screen.getAllByText('••••')).toHaveLength(2)
  expect(screen.queryByText('1.00')).toBeNull()
  expect(screen.queryByText('100.00')).toBeNull()
})

it('keeps the asset label inert and opens the picker from the asset control only', () => {
  const { store } = renderSend()

  fireEvent.click(screen.getByText('From'))
  expect(screen.queryByRole('button', { name: 'Select ETH on Ethereum' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  expect(screen.getByRole('button', { name: 'Select ETH on Ethereum' })).toBeTruthy()
})

it('uses a truthful chain fallback in asset option names', () => {
  const { store } = renderSend((state) => {
    delete state.main.networks.ethereum[1].name
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')

  expect(screen.getByRole('button', { name: 'Select ETH on Chain 1' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /undefined/u })).toBeNull()
})

it('chooses a saved contact from the recipient field', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  const { store } = renderSend((state) => {
    state.main.addressBook[recipient.toLowerCase()] = {
      address: recipient,
      createdAt: 1,
      name: 'Garden Friend',
      note: '',
      provenance: { status: 'saved' },
      updatedAt: 1
    }
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Choose recipient' }))
  setDashStep(store, 'contactPicker', 'Choose recipient')
  expect(screen.getByRole('region', { name: 'Choose recipient' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Garden Friend/ }))
  closeDashStep(store)

  expect(screen.getByPlaceholderText('Enter an address').value).toBe(recipient)
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  expect(link.send).toHaveBeenCalledWith('nav:back', 'dash')
})

it('lists active accounts and identifies the current recipient account', async () => {
  resolveSendRecipient.mockImplementation(async (value) => ({ success: true, address: value }))
  const secondAccount = '0x4444444444444444444444444444444444444444'
  const { store } = renderSend((state) => {
    state.main.accounts[secondAccount] = {
      id: secondAccount,
      address: secondAccount,
      name: 'Meadow',
      lastSignerType: 'trezor',
      requests: {},
      status: 'ok'
    }
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Choose recipient' }))
  setDashStep(store, 'contactPicker', 'Choose recipient')

  expect(screen.getByText('Active accounts')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Garden/ }).textContent).toContain('Current account')
  expect(screen.getByRole('button', { name: /Meadow/ }).textContent).toContain('Active Wren account')
  expect(screen.getByRole('button', { name: /Garden/ }).textContent).toContain(account)
  expect(screen.getByRole('button', { name: /Meadow/ }).textContent).toContain(secondAccount)

  fireEvent.click(screen.getByRole('button', { name: /Garden/ }))
  closeDashStep(store)
  expect(await screen.findByText('Garden · Current account')).toBeTruthy()
})

it('keeps recent recipients opt-in and separate from saved identities', () => {
  const { store } = renderSend((state) => {
    state.main.rememberRecentRecipients = false
    state.main.recentRecipientUses = [
      {
        operationId: '123e4567-e89b-42d3-a456-426614174010',
        address: secondRecipient,
        confirmedAt: Date.now()
      }
    ]
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Choose recipient' }))
  setDashStep(store, 'contactPicker', 'Choose recipient')

  expect(screen.queryByText('Recent recipients')).toBeNull()
  expect(screen.queryByText(secondRecipient)).toBeNull()
})

it('shows confirmed recent recipients with full-address provenance and canonical selection', async () => {
  resolveSendRecipient.mockImplementation(async (value) => ({ success: true, address: value }))
  const { store } = renderSend((state) => {
    state.selected.hideBalances = true
    state.main.rememberRecentRecipients = true
    state.main.recentRecipientUses = [
      {
        operationId: '123e4567-e89b-42d3-a456-426614174011',
        address: secondRecipient,
        confirmedAt: Date.now()
      },
      {
        operationId: '123e4567-e89b-42d3-a456-426614174012',
        address: account,
        confirmedAt: Date.now() - 1
      },
      {
        operationId: '123e4567-e89b-42d3-a456-426614174013',
        address: secondRecipient,
        confirmedAt: Date.now() - 2
      }
    ]
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Choose recipient' }))
  setDashStep(store, 'contactPicker', 'Choose recipient')

  expect(document.activeElement).toBe(
    screen.getByPlaceholderText('Search accounts, contacts, and recent recipients')
  )
  expect(document.activeElement.getAttribute('aria-label')).toBe('Search recipients')
  const recent = screen.getByText('Recent recipients').closest('.sendRecentRecipients')
  expect(within(recent).getAllByText(secondRecipient)).toHaveLength(1)
  expect(within(recent).queryByText(account)).toBeNull()
  expect(within(recent).getByText('Previously used on this device · verify the full address')).toBeTruthy()

  fireEvent.click(within(recent).getByRole('button', { name: new RegExp(secondRecipient) }))
  closeDashStep(store)

  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(secondRecipient))
  expect(await screen.findByText('Recent recipient · verify the full address')).toBeTruthy()
  expect(screen.getByPlaceholderText('Enter an address').value).toBe(secondRecipient)
  expect(link.send).toHaveBeenCalledWith('nav:back', 'dash')
})

it('returns an open picker to the composer when the selected account changes', () => {
  const { store } = renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  link.send.mockClear()

  replaceStore(store, (state) => {
    state.selected.current = recipient
    state.main.accounts[recipient] = {
      id: recipient,
      address: recipient,
      name: 'Meadow',
      requests: {},
      status: 'ok'
    }
  })

  expect(link.send).toHaveBeenCalledWith('nav:back', 'dash')
})

it('uses the canonical chiseled input groups for recipient and amount', () => {
  renderSend()

  expect(screen.getByPlaceholderText('Enter an address').closest('.wrenInputGroup')).toBeTruthy()
  expect(screen.getByPlaceholderText('0.00').closest('.wrenInputGroup')).toBeTruthy()
})

it('validates a recipient and amount before queueing the existing transaction review', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })

  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

  await waitFor(() =>
    expect(queueSend).toHaveBeenCalledWith({
      account,
      amount: '0.25',
      assetAddress: NATIVE_CURRENCY,
      chainId: 1,
      recipient
    })
  )
  expect(await screen.findByText('Transaction queued')).toBeTruthy()
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  const close = screen.getByRole('button', { name: 'Close' })
  expect(close.className).toContain('wrenControlGhost')
  fireEvent.click(close)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'closeDash')
})

it.each([
  ['origin-unavailable', 'Wren could not prepare Send’s local authorization. Restart Wren, then try again.'],
  ['pending-chain', 'Finish or decline the pending Send transaction before sending on another network.'],
  ['validation-failed', 'Wren could not validate this transfer. Check the recipient, amount, and network.'],
  ['send-unavailable', 'Wren could not prepare this transaction.']
])('shows truthful prequeue copy for %s', async (error, message) => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: false, error })
  renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

  expect(await screen.findByText(message)).toBeTruthy()
})

it('associates canonical recipient evidence with the field and distinguishes lookup failure', async () => {
  resolveSendRecipient.mockResolvedValueOnce({ success: true, address: recipient, name: 'friend.eth' })
  renderSend()

  const field = screen.getByPlaceholderText('Enter an address')
  fireEvent.change(field, { target: { value: 'friend.eth' } })
  expect(await screen.findByText(recipient)).toBeTruthy()
  expect(field.getAttribute('aria-describedby')).toBe('sendRecipientFeedback')
  fireEvent.click(screen.getByRole('button', { name: 'Copy recipient address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', recipient)
  expect(screen.getByRole('status').textContent).toBe('Address copied')

  resolveSendRecipient.mockResolvedValueOnce({
    success: false,
    error: 'recipient-lookup-unavailable'
  })
  fireEvent.change(field, { target: { value: 'offline.eth' } })
  expect(
    await screen.findByText('Recipient lookup is unavailable. Enter or verify the full address to continue.')
  ).toBeTruthy()
  expect(field.getAttribute('aria-invalid')).toBe('true')
})

it('queues a zero-value transaction for review', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'zero-send-request' })
  renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0' } })

  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

  await waitFor(() => expect(queueSend).toHaveBeenCalledWith(expect.objectContaining({ amount: '0' })))
})

it('uses the main-process maximum and blocks an amount above the stored balance', async () => {
  maxSendAmount.mockResolvedValue({
    success: true,
    amount: '500000000000000000',
    quoteId: 'max-quote',
    expiresAt: Date.now() + 60_000,
    reserve: {
      feeModel: 'eip1559',
      gasLimit: '21000',
      maxFeePerGas: '2000000000',
      maxPriorityFeePerGas: '1000000000',
      executionFee: '42000000000000',
      l1Fee: '0',
      total: '42000000000000'
    }
  })
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  renderSend()

  expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(true)
  expect(screen.getByText('Available: 1.00 ETH')).toBeTruthy()
  expect(screen.getByText('Enter a recipient to use Max; Wren needs it to estimate gas.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Use Max' }).getAttribute('aria-describedby')).toBe(
    'sendMaxReason'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  expect(maxSendAmount).not.toHaveBeenCalled()
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  await waitFor(() => expect(screen.getByPlaceholderText('0.00').value).toBe('0.5'))
  expect(maxSendAmount).toHaveBeenCalledWith({
    account,
    assetAddress: NATIVE_CURRENCY,
    chainId: 1,
    recipient
  })

  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '2' } })
  expect(screen.getByRole('alert').textContent).toContain('Amount exceeds available balance')
  expect(screen.getByText('Available: 1.00 ETH')).toBeTruthy()
  expect(screen.getByPlaceholderText('0.00').getAttribute('aria-describedby')).toContain('sendAmountError')
  expect(screen.getByPlaceholderText('0.00').getAttribute('aria-describedby')).toContain(
    'sendAvailableBalance'
  )
  expect(screen.getByRole('button', { name: 'Enter send details' }).disabled).toBe(true)
})

it('clears stale native amount while quoting, exposes exact reserve evidence, and requires Max review', async () => {
  let finishMax
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  maxSendAmount.mockReturnValue(new Promise((resolve) => (finishMax = resolve)))
  queueSend.mockResolvedValue({ success: true, handlerId: maxRequestId })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.8' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))

  expect(screen.getByPlaceholderText('0.00').value).toBe('')
  expect(screen.getByText('Calculating safe maximum…')).toBeTruthy()
  expect(screen.getByPlaceholderText('Enter an address').disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Sweep assets' }).disabled).toBe(true)

  await act(async () =>
    finishMax({
      success: true,
      amount: '500000000000000000',
      quoteId: 'max-review-quote',
      expiresAt: Date.now() + 60_000,
      reserve: {
        feeModel: 'eip1559',
        gasLimit: '21000',
        maxFeePerGas: '2000000000',
        maxPriorityFeePerGas: '1000000000',
        executionFee: '42000000000000',
        l1Fee: '900000000',
        total: '42000900000000'
      }
    })
  )

  expect(screen.getByText('Maximum sendable')).toBeTruthy()
  expect(screen.getByText('42000900000000 wei')).toBeTruthy()
  expect(screen.getByText('900000000 wei')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Review maximum send' }))
  expect(queueSend).not.toHaveBeenCalled()
  expect(screen.getByText('Review maximum send')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Queue transfer' }))
  await waitFor(() =>
    expect(queueSend).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '0.5', maxQuoteId: 'max-review-quote', recipient })
    )
  )
  replaceStore(store, (state) => {
    state.main.accounts[account].requests[maxRequestId] = {
      account,
      handlerId: maxRequestId,
      type: 'transaction',
      status: 'error',
      notice: 'Maximum-send quote changed or expired. Nothing was signed or sent; request a fresh Max quote.',
      nativeMax: { quoteId: 'max-review-quote', version: 1 },
      retainedPreBroadcastError: { responderPending: true }
    }
  })
  expect(screen.getByText('Maximum send changed')).toBeTruthy()
  link.rpc.mockImplementationOnce((method, request, callback) => callback(null))
  fireEvent.click(screen.getByRole('button', { name: 'Close request' }))
  expect(link.rpc).toHaveBeenCalledWith(
    'closeFailedTransactionRequest',
    expect.objectContaining({ account, handlerId: maxRequestId, type: 'transaction' }),
    expect.any(Function)
  )
  expect(screen.queryByText('Maximum send changed')).toBeNull()
  expect(screen.queryByText('Maximum sendable')).toBeNull()
  expect(screen.getByPlaceholderText('0.00').value).toBe('')
  expect(screen.getByRole('button', { name: 'Use Max' })).toBeTruthy()
})

it('closes an ordinary retained pre-broadcast failure before composing another send', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: retainedRequestId })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  replaceStore(store, (state) => {
    state.main.accounts[account].requests[retainedRequestId] = {
      account,
      handlerId: retainedRequestId,
      type: 'transaction',
      status: 'error',
      notice: 'The account balance could not be verified. Nothing was signed or sent.',
      recoverableError: {
        code: 'transaction-funding-unavailable',
        message: 'The account balance could not be verified. Nothing was signed or sent.'
      },
      retainedPreBroadcastError: { responderPending: true }
    }
  })

  expect(screen.getByText('Transaction not sent')).toBeTruthy()
  expect(
    screen.getByText('The account balance could not be verified. Nothing was signed or sent.')
  ).toBeTruthy()
  link.rpc.mockImplementationOnce((method, request, callback) => callback(null))
  fireEvent.click(screen.getByRole('button', { name: 'Close request' }))
  expect(link.rpc).toHaveBeenCalledWith(
    'closeFailedTransactionRequest',
    expect.objectContaining({ account, handlerId: retainedRequestId, type: 'transaction' }),
    expect.any(Function)
  )
  expect(screen.queryByText('Transaction not sent')).toBeNull()
  expect(screen.getByPlaceholderText('0.00').value).toBe('0.25')
  expect(screen.getByRole('button', { name: 'Review send' })).toBeTruthy()
})

it('never leaves a submit-able amount after Max failure and lets the user explicitly edit', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  maxSendAmount.mockResolvedValueOnce({ success: false, error: 'fee-unavailable' }).mockResolvedValueOnce({
    success: true,
    amount: '400000000000000000',
    quoteId: 'editable-max',
    expiresAt: Date.now() + 60_000,
    reserve: {
      feeModel: 'legacy',
      gasLimit: '21000',
      gasPrice: '1000000000',
      executionFee: '21000000000000',
      l1Fee: '0',
      total: '21000000000000'
    }
  })
  renderSend()
  const amount = screen.getByPlaceholderText('0.00')
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(amount, { target: { value: '0.75' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  expect(await screen.findByText('Fee estimate unavailable')).toBeTruthy()
  expect(amount.value).toBe('')
  expect(screen.getByRole('button', { name: 'Enter send details' }).disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  await screen.findByText('Maximum sendable')
  fireEvent.click(screen.getByRole('button', { name: 'Edit amount' }))
  await waitFor(() => expect(document.activeElement).toBe(amount))
  expect(amount.value).toBe('')
  expect(screen.queryByText('Maximum sendable')).toBeNull()
})

it('trusts a valid bound native Max quote over a stale lower cached scanner balance', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  maxSendAmount.mockResolvedValue({
    success: true,
    amount: '500000000000000000',
    quoteId: 'fresh-over-stale',
    expiresAt: Date.now() + 60_000,
    reserve: {
      feeModel: 'legacy',
      gasLimit: '21000',
      gasPrice: '1000000000',
      executionFee: '21000000000000',
      l1Fee: '0',
      total: '21000000000000'
    }
  })
  queueSend.mockResolvedValue({ success: true, handlerId: 'fresh-max-request' })
  renderSend((state) => {
    state.main.balances[account][0].balance = '0x16345785d8a0000'
    state.main.balances[account][0].displayBalance = '0.10'
    return state
  })

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  await screen.findByText('Maximum sendable')
  expect(screen.queryByText('Amount exceeds available balance')).toBeNull()
  expect(screen.getByRole('button', { name: 'Review maximum send' }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Review maximum send' }))
  fireEvent.click(screen.getByRole('button', { name: 'Queue transfer' }))
  await waitFor(() =>
    expect(queueSend).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '0.5', maxQuoteId: 'fresh-over-stale' })
    )
  )
})

it('preserves a configured zero-decimal native asset when formatting Max', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  maxSendAmount.mockResolvedValue({
    success: true,
    amount: '5',
    quoteId: 'zero-decimal-max',
    expiresAt: Date.now() + 60_000,
    reserve: {
      feeModel: 'legacy',
      gasLimit: '0x1',
      gasPrice: '0x1',
      executionFee: '1',
      l1Fee: '0',
      total: '1'
    }
  })
  renderSend((state) => {
    state.main.networksMeta.ethereum[1].nativeCurrency.decimals = 0
    state.main.balances[account][0].balance = '0x6'
    state.main.balances[account][0].displayBalance = '6'
    return state
  })

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  await screen.findByText('Maximum sendable')
  expect(screen.getByPlaceholderText('0.00').value).toBe('5')
})

it('quotes and queues an explicit same-chain non-atomic Sweep with full review evidence', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  quoteSweep.mockResolvedValue({
    success: true,
    quote: {
      quoteId: 'sweep-quote',
      expiresAt: Date.now() + 60_000,
      account,
      chainId: 8453,
      recipient,
      assets: [{ address: token, balance: '100000000' }],
      native: { selected: false, balance: '0', value: '0' },
      maximumFee: '987654321',
      calls: [{ to: token, data: '0xa9059cbb', value: '0x0' }],
      execution: 'sequential-non-atomic'
    }
  })
  queueSweep.mockResolvedValue({ success: true, handlerId: sweepRequestId })
  const { store } = renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Sweep assets' }))
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  fireEvent.change(screen.getByLabelText('Network'), { target: { value: '8453' } })
  const tokenCheckbox = screen.getByRole('checkbox', { name: /USDC/ })
  fireEvent.click(tokenCheckbox)
  expect(tokenCheckbox.closest('label').classList.contains('sendSweepAssetSelected')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 transfer' }))

  await waitFor(() =>
    expect(quoteSweep).toHaveBeenCalledWith({
      account,
      chainId: 8453,
      recipient,
      tokens: [token],
      includeNative: false
    })
  )
  expect(await screen.findByText('Sequential execution — not atomic')).toBeTruthy()
  expect(screen.getByText(token)).toBeTruthy()
  expect(screen.getByText('100000000')).toBeTruthy()
  expect(screen.getByText(/No bridge or batch contract is used/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Copy full token 1 address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', token)
  fireEvent.click(screen.getByRole('button', { name: 'Queue 1 transfer' }))
  await waitFor(() =>
    expect(queueSweep).toHaveBeenCalledWith({
      quoteId: 'sweep-quote',
      account,
      chainId: 8453,
      recipient
    })
  )
  replaceStore(store, (state) => {
    state.main.accounts[account].requests[sweepRequestId] = {
      account,
      handlerId: sweepRequestId,
      type: 'walletCalls',
      status: 'error',
      notice: 'Sweep changed; close this review and create a fresh Sweep.',
      recoverableError: { code: 'managed-sweep-changed', message: 'Sweep changed' }
    }
  })
  expect(screen.getByText('Sweep changed; close this review and create a fresh Sweep.')).toBeTruthy()
  link.rpc.mockImplementationOnce((method, request, callback) => callback(new Error('close failed')))
  fireEvent.click(screen.getByRole('button', { name: 'Close request' }))
  expect(link.rpc).toHaveBeenCalledWith(
    'closeFailedWalletCallsRequest',
    expect.objectContaining({ account, handlerId: sweepRequestId, type: 'walletCalls' }),
    expect.any(Function)
  )
  expect(screen.getByRole('alert').textContent).toContain('Could not close the stale Sweep request')
  expect(screen.getByText('Sweep changed; close this review and create a fresh Sweep.')).toBeTruthy()

  link.rpc.mockImplementationOnce((method, request, callback) => callback(null))
  fireEvent.click(screen.getByRole('button', { name: 'Close request' }))
  expect(screen.queryByText('Sweep changed; close this review and create a fresh Sweep.')).toBeNull()
  expect(screen.queryByText('Sequential execution — not atomic')).toBeNull()
  expect(screen.getByRole('button', { name: 'Review 1 transfer' })).toBeTruthy()
  expect(quoteSweep).toHaveBeenCalledTimes(1)
})

it('uses the shared network field and selects all available assets within one Sweep', () => {
  renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Sweep assets' }))
  const network = screen.getByLabelText('Network')
  expect(network.classList.contains('wrenInput')).toBe(true)
  fireEvent.change(network, { target: { value: '8453' } })
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }))

  expect(screen.getByRole('checkbox', { name: /USDC/ }).checked).toBe(true)
  expect(screen.getByText(/1 selected · 16 per sweep/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy()
})

it('makes the authoritative 16-call Sweep limit explicit when more assets are available', () => {
  renderSend((state) => {
    for (let index = 0; index < 17; index += 1) {
      const address = `0x${String(index + 16).padStart(40, '0')}`
      state.main.balances[account].push({
        address,
        balance: '0x1',
        chainId: 8453,
        decimals: 18,
        displayBalance: '1.00',
        name: `Token ${index + 1}`,
        symbol: `T${index + 1}`
      })
    }
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Sweep assets' }))
  fireEvent.change(screen.getByLabelText('Network'), { target: { value: '8453' } })
  fireEvent.click(screen.getByRole('button', { name: 'Select first 16' }))

  const choices = screen.getAllByRole('checkbox')
  expect(choices.filter((choice) => choice.checked)).toHaveLength(16)
  expect(choices.slice(0, 16).every((choice) => choice.checked)).toBe(true)
  expect(choices.filter((choice) => !choice.checked).every((choice) => choice.disabled)).toBe(true)
  expect(screen.getByText(/16 selected · 16 per sweep/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy()
})

it('clears a consumed Sweep review after any queue failure', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  quoteSweep.mockResolvedValue({
    success: true,
    quote: {
      quoteId: 'consumed-sweep-quote',
      expiresAt: Date.now() + 60_000,
      account,
      chainId: 8453,
      recipient,
      assets: [{ address: token, balance: '100000000' }],
      native: { selected: false, balance: '0', value: '0' },
      maximumFee: '987654321',
      calls: [{ to: token, data: '0xa9059cbb', value: '0x0' }],
      execution: 'sequential-non-atomic'
    }
  })
  queueSweep.mockResolvedValue({ success: false, error: 'sweep-unavailable' })
  renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Sweep assets' }))
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  fireEvent.change(screen.getByLabelText('Network'), { target: { value: '8453' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /USDC/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 transfer' }))
  await screen.findByText('Sequential execution — not atomic')
  fireEvent.click(screen.getByRole('button', { name: 'Queue 1 transfer' }))

  await waitFor(() => expect(queueSweep).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.queryByText('Sequential execution — not atomic')).toBeNull())
  expect(screen.getByRole('button', { name: 'Review 1 transfer' })).toBeTruthy()
})

it('masks Sweep amounts and encoded calldata and disables amount copy under balance privacy', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  quoteSweep.mockResolvedValue({
    success: true,
    quote: {
      quoteId: 'private-sweep',
      expiresAt: Date.now() + 60_000,
      account,
      chainId: 8453,
      recipient,
      assets: [{ address: token, balance: '100000000' }],
      native: { selected: false, balance: '0', value: '0' },
      maximumFee: '987654321',
      calls: [{ to: token, data: '0xa9059cbb-secret-amount', value: '0x0' }],
      execution: 'sequential-non-atomic'
    }
  })
  renderSend((state) => {
    state.selected.hideBalances = true
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Sweep assets' }))
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  fireEvent.change(screen.getByLabelText('Network'), { target: { value: '8453' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /USDC/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 transfer' }))
  await screen.findByText('Sequential execution — not atomic')

  expect(screen.queryByText('100000000')).toBeNull()
  expect(screen.queryByText(/a9059cbb-secret-amount/)).toBeNull()
  expect(screen.getByText('Amount copy and calldata are hidden while balance privacy is on.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy full token 1 amount' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Copy full token 1 address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', token)
})

it('ignores a stale Sweep quote after selection changes', async () => {
  let finishQuote
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  quoteSweep.mockReturnValue(new Promise((resolve) => (finishQuote = resolve)))
  const { store } = renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Sweep assets' }))
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  fireEvent.change(screen.getByLabelText('Network'), { target: { value: '8453' } })
  const usdc = screen.getByRole('checkbox', { name: /USDC/ })
  fireEvent.click(usdc)
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 transfer' }))
  replaceStore(store, (state) => {
    state.selected.current = secondRecipient
    state.main.accounts[secondRecipient] = {
      id: secondRecipient,
      address: secondRecipient,
      name: 'Changed account',
      lastSignerType: 'ring',
      requests: {}
    }
    state.main.balances[secondRecipient] = state.main.balances[account]
  })
  await act(async () =>
    finishQuote({
      success: true,
      quote: {
        quoteId: 'stale-sweep',
        expiresAt: Date.now() + 60_000,
        assets: [{ address: token, balance: '100000000' }],
        native: { selected: false },
        maximumFee: '1',
        calls: [{ to: token, data: '0x', value: '0x0' }]
      }
    })
  )
  expect(screen.queryByText('Sequential execution — not atomic')).toBeNull()
  expect(queueSweep).not.toHaveBeenCalled()
})

it('preserves an unavailable explicit asset instead of silently sending the fallback asset', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  const { store } = renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  fireEvent.click(screen.getByRole('button', { name: 'Select USDC on Base' }))
  closeDashStep(store)
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))

  replaceStore(store, (state) => {
    state.main.balances[account] = state.main.balances[account].filter((asset) => asset.address !== token)
  })

  expect(screen.getByText(/This asset is no longer available/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Review send' })).toBeNull()
  expect(queueSend).not.toHaveBeenCalled()
})

it('ignores a delayed Max result after the selected asset changes', async () => {
  let finishMax
  maxSendAmount.mockReturnValue(new Promise((resolve) => (finishMax = resolve)))
  const { store } = renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  fireEvent.click(screen.getByRole('button', { name: 'Select USDC on Base' }))
  closeDashStep(store)
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  fireEvent.click(screen.getByRole('button', { name: 'Select ETH on Ethereum' }))
  closeDashStep(store)
  await act(async () => finishMax({ success: true, amount: '50000000' }))

  expect(screen.getByPlaceholderText('0.00').value).toBe('')
})

it('ignores a delayed native Max result after the recipient changes', async () => {
  let finishMax
  resolveSendRecipient.mockImplementation(async (value) => ({ success: true, address: value }))
  maxSendAmount.mockReturnValue(new Promise((resolve) => (finishMax = resolve)))
  renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }))
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: secondRecipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(secondRecipient))
  await act(async () => finishMax({ success: true, amount: '500000000000000000' }))

  expect(screen.getByPlaceholderText('0.00').value).toBe('')
})

it('retains a terminal request state after the core request is removed', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = { status: 'declined' }
  })
  expect(screen.getByText('Transaction declined')).toBeTruthy()

  replaceStore(store, (state) => {
    delete state.main.accounts[account].requests['send-request']
  })
  expect(screen.getByText('Transaction declined')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})

it('keeps a submitted transaction visible without treating it as final success', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = { status: 'verifying' }
  })

  expect(screen.getByText('Transaction submitted')).toBeTruthy()
  expect(
    screen.getByText(
      'Your transaction has been sent to the network and is waiting for confirmation. You can close this panel; Wren will keep tracking it.'
    )
  ).toBeTruthy()
  expect(screen.queryByText('Transaction queued')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('Transaction submitted')
  const close = screen.getByRole('button', { name: 'Close' })
  expect(close.className).toContain('wrenControlGhost')
  fireEvent.click(close)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'closeDash')
})

it('distinguishes an unconfirmed submission from a validated network response', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = {
      status: 'verifying',
      submission: { status: 'unconfirmed' }
    }
  })

  const status = screen.getByRole('status')
  expect(status.getAttribute('aria-live')).toBe('polite')
  expect(status.textContent).toContain('Submission status unconfirmed')
  expect(status.textContent).toContain('network response was not confirmed')
  expect(status.textContent).not.toContain('Transaction submitted')
})

it('announces a confirmed transaction, keeps it open, and offers the unsaved destination', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = { status: 'confirmed' }
  })

  expect(screen.getByRole('status').textContent).toContain('Transaction confirmed')
  expect(screen.getByText(recipient)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save contact' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Close' }).className).toContain('wrenControlLarge')
  jest.useFakeTimers()
  act(() => jest.advanceTimersByTime(30_000))
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'closeDash')

  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', recipient)
  expect(screen.getByText('Address copied')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Close' }).className).toContain('wrenControlSecondary')
  expect(screen.getByRole('button', { name: 'Save contact' }).className).toContain('wrenControlGhost')
  fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'addressBook',
    data: { screen: 'edit', seed: recipient }
  })
})

it('binds confirmation and contact actions to the queued recipient while queueing is pending', async () => {
  let finishQueue
  resolveSendRecipient.mockImplementation(async (value) => ({ success: true, address: value }))
  queueSend.mockReturnValue(new Promise((resolve) => (finishQueue = resolve)))
  const { store } = renderSend()

  const recipientField = screen.getByPlaceholderText('Enter an address')
  fireEvent.change(recipientField, { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

  expect(recipientField.disabled).toBe(true)
  expect(screen.getByPlaceholderText('0.00').disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Choose an asset' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Choose recipient' }).disabled).toBe(true)
  // Testing Library can dispatch an impossible browser change to a disabled field;
  // the receipt must still stay bound to the submitted snapshot.
  fireEvent.change(recipientField, { target: { value: secondRecipient } })

  await act(async () => finishQueue({ success: true, handlerId: 'send-request' }))
  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = { status: 'confirmed' }
  })

  expect(screen.getByText(recipient)).toBeTruthy()
  expect(screen.queryByText(secondRecipient)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', recipient)
  fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'addressBook',
    data: { screen: 'edit', seed: recipient }
  })
})

it('opens an existing confirmed recipient contact without creating a duplicate', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend((state) => {
    state.main.addressBook[recipient.toLowerCase()] = {
      address: recipient,
      createdAt: 1,
      name: 'Garden Friend',
      note: '',
      provenance: { status: 'saved' },
      updatedAt: 1
    }
    return state
  })

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')
  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = { status: 'confirmed' }
  })

  expect(screen.getByText('Garden Friend')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'View contact' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'addressBook',
    data: { screen: 'edit', address: recipient }
  })
})

it('focuses each request-state heading once and announces only failures assertively', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')
  const queuedHeading = screen.getByRole('heading', { name: 'Transaction queued' })
  expect(queuedHeading.tabIndex).toBe(-1)
  expect(document.activeElement).toBe(queuedHeading)

  jest.useFakeTimers()
  for (const { request, heading, role, live } of [
    {
      request: { status: 'verifying' },
      heading: 'Transaction submitted',
      role: 'status',
      live: 'polite'
    },
    {
      request: { status: 'verifying', submission: { status: 'unconfirmed' } },
      heading: 'Submission status unconfirmed',
      role: 'status',
      live: 'polite'
    },
    { request: { status: 'declined' }, heading: 'Transaction declined', role: 'status', live: 'polite' },
    { request: { status: 'error' }, heading: 'Transaction failed', role: 'alert', live: 'assertive' },
    { request: { status: 'confirmed' }, heading: 'Transaction confirmed', role: 'status', live: 'polite' }
  ]) {
    replaceStore(store, (state) => {
      state.main.accounts[account].requests['send-request'] = request
    })
    act(() => jest.advanceTimersByTime(3_000))
    expect(link.send).not.toHaveBeenCalledWith('tray:action', 'closeDash')
    const announcement = screen.getByRole(role)
    expect(announcement.getAttribute('aria-live')).toBe(live)
    const stateHeading = screen.getByRole('heading', { name: heading })
    expect(stateHeading.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(stateHeading)
    if (heading === 'Transaction submitted') {
      const close = screen.getByRole('button', { name: 'Close' })
      close.focus()
      for (const equivalentStatus of ['success', 'sent', 'confirming']) {
        replaceStore(store, (state) => {
          state.main.accounts[account].requests['send-request'] = { status: equivalentStatus }
        })
        expect(screen.getByRole('heading', { name: 'Transaction submitted' })).toBeTruthy()
        expect(document.activeElement).toBe(close)
      }
    }
  }

  const close = screen.getByRole('button', { name: 'Close' })
  close.focus()
  replaceStore(store, (state) => {
    state.main.rates[token].price = 1.01
  })
  expect(document.activeElement).toBe(close)
})

it('closes the dashboard directly from confirmed success instead of returning to the send form', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  replaceStore(store, (state) => {
    state.main.accounts[account].requests['send-request'] = { status: 'confirmed' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'closeDash')
  expect(screen.queryByPlaceholderText('Enter an address')).toBeNull()
})

it('ignores a delayed queue result after the selected account changes', async () => {
  const secondAccount = '0x4444444444444444444444444444444444444444'
  let finishQueue
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockReturnValue(new Promise((resolve) => (finishQueue = resolve)))
  const { store } = renderSend((state) => {
    state.main.accounts[secondAccount] = {
      id: secondAccount,
      address: secondAccount,
      name: 'Meadow',
      lastSignerType: 'ring',
      requests: {}
    }
    state.main.balances[secondAccount] = state.main.balances[account]
    return state
  })

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

  replaceStore(store, (state) => {
    state.selected.current = secondAccount
  })
  await act(async () => finishQueue({ success: true, handlerId: 'old-account-request' }))

  expect(screen.queryByText('Transaction queued')).toBeNull()
  expect(screen.getByPlaceholderText('0.00').value).toBe('')
})

it('blocks watch-only accounts before the request pipeline', () => {
  renderSend((state) => {
    state.main.accounts[account].lastSignerType = 'watch'
    return state
  })

  expect(screen.getByRole('alert').textContent).toContain('Watch-only accounts cannot sign')
  expect(screen.getByRole('button', { name: 'Enter send details' }).disabled).toBe(true)
})

it('reports missing selected accounts and assets as quiet availability states', () => {
  const { unmount } = renderSend((state) => {
    state.selected.current = ''
    return state
  })
  expect(screen.getByText('Select an account to send')).toBeTruthy()
  unmount()

  renderSend((state) => {
    state.main.balances[account] = []
    return state
  })
  expect(screen.getByText('No sendable assets on this network')).toBeTruthy()
})
