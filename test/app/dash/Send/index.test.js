import Restore from 'react-restore'

import { Send } from '../../../../app/dash/Send'
import { maxSendAmount, queueSend, resolveSendRecipient } from '../../../../app/dash/Send/api'
import { NATIVE_CURRENCY } from '../../../../resources/constants'
import { act, fireEvent, render, screen, waitFor } from '../../../componentSetup'

jest.mock('../../../../app/dash/Send/api', () => ({
  maxSendAmount: jest.fn(),
  queueSend: jest.fn(),
  resolveSendRecipient: jest.fn()
}))

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const token = '0x3333333333333333333333333333333333333333'

const baseState = () => ({
  selected: { current: account },
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

beforeEach(() => {
  maxSendAmount.mockReset()
  queueSend.mockReset()
  resolveSendRecipient.mockReset()
})

it('opens directly on a native asset without a connection step and exposes the asset ledger', async () => {
  renderSend()

  expect(screen.getByRole('button', { name: 'Choose an asset' }).textContent).toContain('ETH')
  expect(screen.queryByText(/Connect Account/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  expect(screen.getByRole('button', { name: 'Select ETH' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Select USDC' })).toBeTruthy()
})

it('uses the shared illustrated empty-state anatomy when no asset is sendable', () => {
  renderSend((state) => {
    state.main.balances[account] = []
    return state
  })

  expect(screen.getByText('No sendable assets on this network').closest('.wrenEmptyState')).toBeTruthy()
})

it('keeps the asset label inert and opens the picker from the asset control only', () => {
  renderSend()

  fireEvent.click(screen.getByText('Asset'))
  expect(screen.queryByRole('button', { name: 'Select ETH' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  expect(screen.getByRole('button', { name: 'Select ETH' })).toBeTruthy()
})

it('chooses a saved contact from the recipient field', async () => {
  resolveSendRecipient.mockResolvedValue({ success: true, address: recipient })
  renderSend((state) => {
    state.main.addressBook[recipient.toLowerCase()] = {
      address: recipient,
      createdAt: 1,
      name: 'Garden Friend',
      note: '',
      updatedAt: 1
    }
    return state
  })

  fireEvent.click(screen.getByRole('button', { name: 'Choose contact' }))
  expect(screen.getByRole('heading', { name: 'Choose a contact' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Garden Friend/ }))

  expect(screen.getByPlaceholderText('Enter an address').value).toBe(recipient)
  await waitFor(() => expect(resolveSendRecipient).toHaveBeenCalledWith(recipient))
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

  expect(screen.getByRole('button', { name: 'Max' }).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'Max' }).getAttribute('aria-disabled')).toBe('true')
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
  fireEvent.click(screen.getByRole('button', { name: 'Select USDC' }))
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
  renderSend()

  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select USDC' }))
  fireEvent.click(screen.getByRole('button', { name: 'Max' }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select ETH' }))
  await act(async () => finishMax({ success: true, amount: '50000000' }))

  expect(screen.getByPlaceholderText('0.00').value).toBe('')
})

it('ignores a delayed native Max result after the recipient changes', async () => {
  const secondRecipient = '0x5555555555555555555555555555555555555555'
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
