import Restore from 'react-restore'

import { Send } from '../../../../app/dash/Send'
import { maxSendAmount, queueSend, resolveSendRecipient } from '../../../../app/dash/Send/api'
import { NATIVE_CURRENCY } from '../../../../resources/constants'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen, waitFor } from '../../../componentSetup'

jest.mock('../../../../app/dash/Send/api', () => ({
  maxSendAmount: jest.fn(),
  queueSend: jest.fn(),
  resolveSendRecipient: jest.fn()
}))
jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const secondRecipient = '0x5555555555555555555555555555555555555555'
const token = '0x3333333333333333333333333333333333333333'

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
  resolveSendRecipient.mockReset()
  link.send.mockReset()
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
  expect(screen.getByRole('button', { name: 'Select ETH' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Select USDC' })).toBeTruthy()
})

it('restores focus to the asset trigger after the picker closes', async () => {
  const { store, user } = renderSend()
  const trigger = screen.getByRole('button', { name: 'Choose an asset' })

  await user.click(trigger)
  setDashStep(store, 'assetPicker', 'Choose an asset')
  expect(document.activeElement).toBe(screen.getByPlaceholderText('Search assets'))

  await user.click(screen.getByRole('button', { name: 'Select ETH' }))
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

  fireEvent.click(screen.getByText('Asset'))
  expect(screen.queryByRole('button', { name: 'Select ETH' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  expect(screen.getByRole('button', { name: 'Select ETH' })).toBeTruthy()
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

  fireEvent.click(screen.getByRole('button', { name: 'Choose contact' }))
  setDashStep(store, 'contactPicker', 'Choose a contact')
  expect(screen.getByRole('region', { name: 'Choose a contact' })).toBeTruthy()
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

  fireEvent.click(screen.getByRole('button', { name: 'Choose contact' }))
  setDashStep(store, 'contactPicker', 'Choose a contact')

  expect(screen.getByText('Active accounts')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Garden/ }).textContent).toContain('Current account')
  expect(screen.getByRole('button', { name: /Meadow/ }).textContent).toContain('Active Wren account')

  fireEvent.click(screen.getByRole('button', { name: /Garden/ }))
  closeDashStep(store)
  expect(await screen.findByText('Garden · Current account')).toBeTruthy()
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
  maxSendAmount.mockResolvedValue({ success: true, amount: '500000000000000000' })
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  renderSend()

  expect(screen.getByRole('button', { name: 'Max' }).disabled).toBe(true)
  expect(screen.getByText('Available: 1.00 ETH')).toBeTruthy()
  expect(screen.getByText('Enter a recipient to enable Max so we can estimate gas.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Max' }).getAttribute('aria-describedby')).toBe('sendMaxReason')
  fireEvent.click(screen.getByRole('button', { name: 'Max' }))
  expect(maxSendAmount).not.toHaveBeenCalled()
  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Max' }))
  await waitFor(() => expect(screen.getByPlaceholderText('0.00').value).toBe('0.5'))
  expect(maxSendAmount).toHaveBeenCalledWith(1, NATIVE_CURRENCY, recipient)

  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '2' } })
  expect(screen.getByRole('alert').textContent).toContain('Amount exceeds available balance')
  expect(screen.getByRole('button', { name: 'Enter send details' }).disabled).toBe(true)
})

it('preserves an unavailable explicit asset instead of silently sending the fallback asset', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  const { store } = renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  fireEvent.click(screen.getByRole('button', { name: 'Select USDC' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Select USDC' }))
  closeDashStep(store)
  fireEvent.click(screen.getByRole('button', { name: 'Max' }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  setDashStep(store, 'assetPicker', 'Choose an asset')
  fireEvent.click(screen.getByRole('button', { name: 'Select ETH' }))
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Max' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Max' }))
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
  expect(screen.getByRole('button', { name: 'Choose contact' }).disabled).toBe(true)
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

it('keeps submitted, declined, and failed requests open until the user acts', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  queueSend.mockResolvedValue({ success: true, handlerId: 'send-request' })
  const { store } = renderSend()

  fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: recipient } })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review send' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
  await screen.findByText('Transaction queued')

  jest.useFakeTimers()
  for (const status of ['verifying', 'declined', 'error']) {
    replaceStore(store, (state) => {
      state.main.accounts[account].requests['send-request'] = { status }
    })
    act(() => jest.advanceTimersByTime(3_000))
    expect(link.send).not.toHaveBeenCalledWith('tray:action', 'closeDash')
  }
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
