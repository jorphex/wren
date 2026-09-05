import Restore from 'react-restore'

import store from '../../../../../../main/store'
import { act, screen, render } from '../../../../../componentSetup'
import TxRequestComponent from '../../../../../../app/tray/Account/Requests/TransactionRequest'
import { TransactionRequest } from '../../../../../../app/tray/Account/Requests/TransactionRequest'
import {
  DeploymentReviewEvidence,
  TxMain
} from '../../../../../../app/tray/Account/Requests/TransactionRequest/TxMainNew'
import TxRecipientComponent from '../../../../../../app/tray/Account/Requests/TransactionRequest/TxRecipient'
import { TxFee } from '../../../../../../app/tray/Account/Requests/TransactionRequest/TxFee'
import {
  getYearnIntentLines,
  TxSending as TxAction
} from '../../../../../../app/tray/Account/Requests/TransactionRequest/TxAction'
import {
  getAllowancePresentation,
  getAccessListPresentation,
  getCallTracePresentation,
  getDelegationPresentation,
  getExpectedAssetChanges,
  getExpectedNativeBalanceChange,
  getNativeBalanceChangesPresentation,
  getProxyImplementationChangesPresentation,
  getReviewStatusPresentation,
  getSimulationEffectsPresentation,
  getSimulationPresentation,
  ApproveOverview,
  BalanceChanges,
  ReplacementAssessment,
  ReplacementNotice,
  TransactionDataRow,
  YearnOverview
} from '../../../../../../app/tray/Account/Requests/TransactionRequest/TxMainNew/overview'
import {
  SimulationAllowance,
  SimulationCallTrace,
  SimulationDelegation,
  SimulationEffects,
  SimulationNativeBalanceChanges,
  SimulationProxyImplementationChanges
} from '../../../../../../app/tray/Account/Requests/TransactionRequest/ViewData/effects'
import {
  SimpleTxJSON,
  ViewData,
  projectRawTransaction
} from '../../../../../../app/tray/Account/Requests/TransactionRequest/ViewData'
import NonceControl, {
  displayTransactionNonce
} from '../../../../../../app/tray/Account/Requests/TransactionRequest/NonceControl'
import {
  canApproveTransaction,
  getRequiredRequestApproval,
  isNoSignerError,
  RequestCommand
} from '../../../../../../app/tray/Footer/RequestCommand'
import TxApproval from '../../../../../../app/tray/Footer/RequestCommand/TxApproval'
import link from '../../../../../../resources/link'
import { erc20Interface } from '../../../../../../resources/contracts'
import { FRAME_SEND_DISPLAY_NAME, FRAME_SEND_ORIGIN } from '../../../../../../resources/domain/origin'
import { TxClassification } from '../../../../../../main/accounts/types'

jest.mock('../../../../../../main/store/persist')
jest.mock('../../../../../../resources/link', () => ({ invoke: jest.fn(), rpc: jest.fn(), send: jest.fn() }))

const TxRequest = Restore.connect(TxRequestComponent, store)
const TxRecipient = Restore.connect(TxRecipientComponent, store)

const account = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'

function addRequest(req, activeRequestId) {
  const currentRequestId = arguments.length > 1 ? activeRequestId : req.handlerId
  store.updateAccount({
    id: account,
    name: 'Test Account',
    activeRequestId: currentRequestId,
    requests: {
      [req.handlerId]: req
    }
  })
}

describe('confirm', () => {
  it('groups and copies exact prepared creation identities while labeling the address provisional', async () => {
    const hash = `0x${'ab'.repeat(32)}`
    const provisionalAddress = '0x1111111111111111111111111111111111111111'
    link.invoke.mockResolvedValue({ success: true })
    const { user } = render(
      <DeploymentReviewEvidence
        deployment={{
          initcodeBytes: 4,
          initcodeHash: hash,
          pendingNonce: '0x5',
          provisionalAddress
        }}
      />
    )

    expect(screen.getByRole('group', { name: 'Deployment details' })).toBeTruthy()
    expect(screen.getByText('Contract code')).toBeTruthy()
    expect(screen.getByText('4 bytes')).toBeTruthy()
    expect(screen.getByText(hash)).toBeTruthy()
    expect(screen.getByText(provisionalAddress)).toBeTruthy()
    expect(screen.getByText(/Provisional address.*pending nonce 5.*may change before signing/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Copy deployment initcode hash' }))
    expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: hash })
    expect(await screen.findByText('Hash copied')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Copy provisional deployment address' }))
    expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', {
      secret: false,
      value: provisionalAddress
    })
    expect(await screen.findByText('Address copied')).toBeTruthy()
  })

  it('copies the displayed sender identity from the main review', () => {
    const txMain = new TxMain({})
    txMain.setState = jest.fn()
    link.send.mockClear()

    txMain.copyFromAddress(account)

    expect(link.send).toHaveBeenCalledWith('tray:clipboardData', account)
    expect(txMain.setState).toHaveBeenCalledWith({ copied: true })
    txMain.componentWillUnmount()
  })

  it('shows the recipient for a zero-value EOA transaction', () => {
    const recipient = '0x1111111111111111111111111111111111111111'

    render(
      <TxRecipient
        i={0}
        req={{
          data: { to: recipient, value: '0x0' },
          recipientType: 'external'
        }}
      />
    )

    expect(screen.getByText('Recipient Account')).toBeTruthy()
    expect(screen.getByLabelText(recipient).classList.contains('clusterAddressRecipientComplete')).toBe(true)
  })

  it('does not present an in-flight contract method lookup as a decode failure', () => {
    const recipient = '0x1111111111111111111111111111111111111111'

    render(
      <TxRecipient
        i={0}
        req={{
          calldataDecodeStatus: 'pending',
          data: { to: recipient, value: '0x0' },
          recipientType: 'contract'
        }}
      />
    )

    expect(screen.getByText('Identifying contract method…')).toBeTruthy()
    expect(screen.queryByText('Contract method not decoded')).toBeNull()
  })

  it('keeps a native-transfer recipient in the shared transaction details ledger', () => {
    const recipient = '0x1111111111111111111111111111111111111111'

    render(
      <TxRecipient
        i={0}
        req={{
          data: { to: recipient, value: '0x1' },
          recipientType: 'external'
        }}
      />
    )

    expect(screen.getByText('To')).toBeTruthy()
    expect(screen.getByLabelText(recipient).classList.contains('clusterAddressRecipientComplete')).toBe(true)
    expect(screen.getByRole('button', { name: 'Copy transaction recipient address' })).toBeTruthy()
  })

  it('shows quiet prior-use age and escalates a different full-address lookalike', () => {
    const previous = '0x1111111111111111111111111111111111111111'
    const { unmount } = render(
      <TxRecipient
        i={0}
        req={{
          data: { to: previous, value: '0x1' },
          recipientType: 'external',
          addressSafety: {
            assessedAt: 40 * 24 * 60 * 60 * 1000,
            fingerprint: 'previous',
            targets: [{ address: previous, state: 'previous', lastSubmittedAt: 0 }]
          }
        }}
      />
    )

    expect(screen.getByText('Previously submitted to this address · 40 days ago')).toBeTruthy()
    unmount()

    const lookalike = `0x1234${'b'.repeat(32)}abcd`
    render(
      <TxRecipient
        i={0}
        req={{
          data: { to: lookalike, value: '0x1' },
          recipientType: 'external',
          addressSafety: {
            assessedAt: 1,
            fingerprint: 'lookalike',
            targets: [{ address: lookalike, state: 'lookalike' }]
          }
        }}
      />
    )

    expect(screen.getByRole('alert').textContent).toContain(
      'Possible address poisoning. Verify the full address. Its first and last four characters match a destination you used before.'
    )
    expect(screen.getByText(/^0x1234$/i).classList.contains('clusterAddressLookalikeEnd')).toBe(true)
    expect(screen.getByText(/^abcd$/i).classList.contains('clusterAddressLookalikeEnd')).toBe(true)
  })

  it('does not expose a recipient copy target for contract creation', () => {
    render(
      <TxRecipient
        i={0}
        req={{
          data: { value: '0x0' },
          recipientType: ''
        }}
      />
    )

    expect(screen.queryByRole('button', { name: 'Copy transaction recipient address' })).toBeNull()
  })

  it('announces a copied transaction recipient without replacing its visible identity', async () => {
    const recipient = '0x1111111111111111111111111111111111111111'
    const { user } = render(
      <TxRecipient
        i={0}
        req={{
          data: { to: recipient, value: '0x0' },
          recipientType: 'external'
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Copy transaction recipient address' }))

    expect(link.send).toHaveBeenCalledWith('tray:clipboardData', recipient)
    expect(screen.getByText('Transaction recipient address copied')).toBeTruthy()
    expect(screen.getByLabelText(recipient).classList.contains('clusterAddressRecipientComplete')).toBe(true)
    expect(
      screen.getByText('Address copied').classList.contains('transactionReviewCopyFeedbackVisible')
    ).toBe(true)
  })

  it('expands fee adjustment inside the transaction details ledger', async () => {
    class TxFeeHarness extends TxFee {
      store(...path) {
        const key = path.join('.')
        if (key === 'main.networks.ethereum.1') return { isTestnet: false }
        if (key === 'main.networksMeta.ethereum.1') {
          return { nativeCurrency: { symbol: 'ETH', usd: 2000 } }
        }
      }
    }
    const ConnectedTxFee = Restore.connect(TxFeeHarness, store)

    const { user } = render(
      <ConnectedTxFee
        i={0}
        req={{
          account,
          handlerId: 'inline-fee-request',
          data: {
            chainId: '0x1',
            gasLimit: '0x5208',
            maxFeePerGas: '0x6fc23ac00',
            maxPriorityFeePerGas: '0x77359400',
            type: '0x2'
          }
        }}
      />
    )

    const adjust = screen.getByRole('button', { name: 'Adjust' })
    expect(adjust.getAttribute('aria-expanded')).toBe('false')
    await user.click(adjust)

    expect(adjust.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Base Fee Cap (GWEI)')).toBeTruthy()
    expect(screen.getByLabelText('Max Priority Fee (GWEI)')).toBeTruthy()
    expect(screen.getByLabelText('Gas Limit (UNITS)')).toBeTruthy()
    expect(link.send).not.toHaveBeenCalledWith('nav:update', 'panel', {
      data: { step: 'adjustFee' }
    })
  })

  it('shows a saved contact label with full recipient evidence', () => {
    const recipient = '0x1111111111111111111111111111111111111111'
    store.saveAddressBookEntry({
      mode: 'add',
      address: recipient,
      name: 'Yearn Treasury',
      note: 'Operations'
    })

    render(
      <TxRecipient
        i={0}
        req={{
          data: { to: recipient, value: '0x0' },
          recipientType: 'external'
        }}
      />
    )

    expect(screen.getByText('Yearn Treasury')).toBeTruthy()
    expect(screen.getByText('Saved contact')).toBeTruthy()
    expect(screen.getAllByText(recipient)).toHaveLength(2)
    store.removeAddressBookEntry(recipient)
  })

  it('recognizes an existing Wren account without hiding the recipient address', () => {
    const recipient = '0x1111111111111111111111111111111111111111'
    store.updateAccount({ id: recipient, name: 'Frame Savings' })

    render(
      <TxRecipient
        i={0}
        req={{
          data: { to: recipient, value: '0x0' },
          recipientType: 'external'
        }}
      />
    )

    expect(screen.getByText('Frame Savings')).toBeTruthy()
    expect(screen.getByText('Wren account')).toBeTruthy()
    expect(screen.getAllByText(recipient)).toHaveLength(2)
    store.removeAccount(recipient)
  })

  it('identifies an allowlisted Yearn recipient without an external ABI', () => {
    const recipient = '0x1111111111111111111111111111111111111111'

    render(
      <TxRecipient
        i={0}
        req={{
          data: { to: recipient, value: '0x0' },
          recipientType: 'contract',
          recognizedActions: [
            {
              id: 'yearn:deposit',
              data: { action: 'deposit', vaultName: 'USDC Horizon yVault' }
            }
          ]
        }}
      />
    )

    expect(screen.getByText('Calling Yearn Contract')).toBeTruthy()
    expect(screen.getByText('Yearn vault deposit')).toBeTruthy()
    expect(screen.getByText('Allowlisted vault: USDC Horizon yVault')).toBeTruthy()
    expect(screen.queryByText(/unknown action/i)).toBeNull()
  })

  it('renders a confirming transaction', () => {
    const req = {
      handlerId: 'test-req',
      type: 'transaction',
      status: 'confirming',
      data: {
        chainId: '0x89'
      },
      classification: TxClassification.NATIVE_TRANSFER
    }

    addRequest(req)

    render(<TxRequest req={req} step='confirm' />)

    const notice = screen.getByText('confirming')
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toBe('confirming')
  })

  it('shows exact FIFO context while reviewing one of several pending signatures', () => {
    const req = {
      account,
      handlerId: 'queued-review',
      type: 'transaction',
      data: { chainId: '0x89' },
      classification: TxClassification.NATIVE_TRANSFER
    }

    addRequest(req)
    render(
      <TxRequest req={req} step='confirm' queueContext={{ position: 1, total: 3, pendingSignatures: 3 }} />
    )

    expect(document.querySelector('.transactionReviewQueueContext').textContent).toBe(
      '3 pending signaturesCurrent request 1 of 3 · oldest pending'
    )
  })

  it('labels a queued transaction read-only and blocks its mutation routes', () => {
    const req = {
      account,
      handlerId: 'queued-review',
      type: 'transaction',
      data: { chainId: '0x89' },
      classification: TxClassification.NATIVE_TRANSFER
    }

    addRequest(req, 'earlier-request')
    const { rerender } = render(
      <TxRequest req={req} step='confirm' queueContext={{ position: 2, total: 3, pendingSignatures: 3 }} />
    )

    expect(document.querySelector('.transactionReviewQueueContext').textContent).toBe(
      '3 pending signaturesQueued request 2 of 3 · waiting for earlier requests'
    )
    expect(screen.queryByRole('button', { name: 'Adjust' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decrease nonce' })).toBeNull()

    rerender(
      <TxRequest
        req={req}
        step='adjustApproval'
        queueContext={{ position: 2, total: 3, pendingSignatures: 3 }}
      />
    )
    expect(document.querySelector('.transactionReviewQueueContext')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit .* approval/i })).toBeNull()
  })

  it.each([undefined, null])(
    'keeps a transaction read-only when the active request id is %s',
    (activeRequestId) => {
      const req = {
        account,
        handlerId: 'unclaimed-review',
        type: 'transaction',
        data: { chainId: '0x89' },
        classification: TxClassification.NATIVE_TRANSFER
      }

      addRequest(req, activeRequestId)
      render(<TxRequest req={req} step='confirm' />)

      expect(screen.getByText('Read-only')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Adjust' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Decrease nonce' })).toBeNull()
    }
  )

  it('keeps a declined transaction document visible and inert without error styling', () => {
    const req = {
      handlerId: 'declined-req',
      type: 'transaction',
      status: 'declined',
      data: { chainId: '0x89' },
      classification: TxClassification.NATIVE_TRANSFER
    }

    addRequest(req)
    render(<TxRequest req={req} step='confirm' />)

    const request = screen.getByText('declined').closest('.signerRequest')
    expect(request).toBeTruthy()
    expect(request.classList.contains('signerRequestError')).toBe(false)
    expect(request.getAttribute('aria-disabled')).toBe('true')
    expect(request.hasAttribute('inert')).toBe(true)
  })

  it('shows the friendly built-in Send source on transaction review', () => {
    const originId = 'frame-send-origin'
    const req = {
      handlerId: 'frame-send-request',
      type: 'transaction',
      origin: originId,
      data: { chainId: '0x89', value: '0x0' },
      classification: TxClassification.NATIVE_TRANSFER
    }

    store.initOrigin(originId, {
      name: FRAME_SEND_ORIGIN,
      chain: { id: 137, type: 'ethereum' },
      sessionOnly: false
    })
    addRequest(req)

    render(<TxRequest req={req} step='confirm' />)

    expect(screen.getByText(FRAME_SEND_DISPLAY_NAME)).toBeTruthy()
    expect(screen.queryByText(FRAME_SEND_ORIGIN)).toBeNull()
    store.removeOrigin(originId)
  })

  it('renders a transaction notice', () => {
    const req = {
      handlerId: 'test-req',
      type: 'transaction',
      status: 'confirming',
      notice: 'insufficient funds for gas',
      recipientType: 'external',
      data: {
        chainId: '0x89'
      },
      classification: TxClassification.NATIVE_TRANSFER
    }

    addRequest(req)

    render(<TxRequest req={req} step='confirm' />)

    const notice = screen.getByRole('alert')
    expect(notice.textContent).toMatch(/insufficient funds for gas/i)
  })

  it('shows a qualified RPC execution warning', () => {
    const req = {
      handlerId: 'test-simulation',
      type: 'transaction',
      data: { chainId: '0x89' },
      simulation: { status: 'reverted', source: 'eth_simulateV1' },
      classification: TxClassification.NATIVE_TRANSFER
    }

    addRequest(req)
    render(<TxRequest req={req} step='confirm' />)

    expect(screen.getByText('Simulation reverted')).toBeTruthy()
  })
})

describe('approval editing', () => {
  const approvalAction = {
    id: 'erc20:approve',
    data: {
      amount: '1000000',
      decimals: 6,
      spender: { address: '0x1111111111111111111111111111111111111111', ens: '' },
      symbol: 'USDC'
    }
  }
  class TxActionHarness extends TxAction {
    store(...path) {
      const key = path.join('.')
      if (key === 'main.networks.ethereum.1.name') return 'Ethereum'
      if (key === 'main.addressBook' || key === 'main.accounts') return {}
    }
  }

  const renderApprovalAction = (status) =>
    render(
      <TxActionHarness
        action={approvalAction}
        chain={{ id: 1, type: 'ethereum' }}
        i={0}
        req={{
          data: { chainId: '0x1', to: '0x2222222222222222222222222222222222222222' },
          status
        }}
      />
    )

  it('opens the exact approval editor from native keyboard input', async () => {
    const { user } = renderApprovalAction()
    const editor = screen.getByRole('button', { name: 'Edit USDC approval' })

    editor.focus()
    await user.keyboard('{Enter}')

    expect(link.send).toHaveBeenCalledWith('nav:update', 'panel', {
      data: { step: 'adjustApproval', actionId: 'erc20:approve', requestedAmountHex: '1000000' }
    })
  })

  it('keeps a submitted approval value non-interactive', () => {
    renderApprovalAction('signed')

    expect(screen.queryByRole('button', { name: 'Edit USDC approval' })).toBeNull()
    expect(screen.getByText('Spend limit')).toBeTruthy()
    expect(screen.getByText('1 USDC')).toBeTruthy()
    expect(screen.getByText('Spender')).toBeTruthy()
  })

  it('keeps a queued approval value non-interactive while preserving inspection', () => {
    render(
      <TxActionHarness
        action={approvalAction}
        chain={{ id: 1, type: 'ethereum' }}
        i={0}
        readOnly
        req={{ data: { chainId: '0x1', to: '0x2222222222222222222222222222222222222222' } }}
      />
    )

    expect(screen.queryByRole('button', { name: 'Edit USDC approval' })).toBeNull()
    expect(screen.getByText('Spend limit')).toBeTruthy()
    expect(screen.getByText('1 USDC')).toBeTruthy()
    expect(screen.getByText('Spender')).toBeTruthy()
  })

  it('announces a copied approval spender without replacing its visible identity', async () => {
    const { user } = renderApprovalAction()

    await user.click(screen.getByRole('button', { name: 'Copy token approval spender address' }))

    expect(link.send).toHaveBeenCalledWith('tray:clipboardData', approvalAction.data.spender.address)
    expect(screen.getByText('Approval spender address copied')).toBeTruthy()
  })

  it('forwards the exact account, request, action, amount, and callback to the bridge', () => {
    const callback = jest.fn()
    const req = {
      account,
      handlerId: 'approval-request',
      payload: {
        params: [
          {
            data: erc20Interface.encodeFunctionData('approve', [
              '0x1111111111111111111111111111111111111111',
              1n
            ])
          }
        ]
      },
      recognizedActions: [{ id: 'erc20:approve', data: { amount: '1' } }]
    }
    const component = new TransactionRequest({ req })
    component.store = jest.fn(() => [{ data: { actionId: 'erc20:approve' } }])

    component.renderTokenSpend().props.updateRequest('42', callback)

    expect(link.rpc).toHaveBeenCalledWith(
      'updateRequest',
      account,
      req.handlerId,
      { amount: '42' },
      'erc20:approve',
      callback
    )
  })
})

describe('address lookalike decision', () => {
  class AddressSafetyCommand extends RequestCommand {
    store(...path) {
      const key = path.join('.')
      if (key === 'windows.panel.nav') return [{ data: { step: 'confirm' } }]
      if (key === 'main.networks.ethereum.1.isTestnet') return false
      if (key === 'main.networks.ethereum.1.name') return 'Ethereum'
      if (key === 'main.networksMeta.ethereum.1') {
        return { nativeCurrency: { symbol: 'ETH', usd: { price: 1 } } }
      }
      if (key.startsWith('main.mute.')) return true
    }
  }

  it('keeps the transaction visible and uses the standard signing actions for a lookalike warning', () => {
    const req = {
      handlerId: 'lookalike-request',
      account,
      type: 'transaction',
      data: {
        chainId: '0x1',
        gasLimit: '0x5208',
        gasPrice: '0x1',
        to: '0x1234bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbabcd'
      },
      addressSafety: {
        assessedAt: 1,
        fingerprint: 'a'.repeat(64),
        targets: [{ address: '0x1234bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbabcd', state: 'lookalike' }]
      },
      simulation: {
        status: 'succeeded',
        accountCodeEvidence: { sender: { status: 'no-code' }, targets: [] }
      },
      approvals: []
    }
    render(<AddressSafetyCommand req={req} signingDelay={0} />)
    act(() => jest.advanceTimersByTime(0))

    expect(screen.queryByText('Verify this destination address')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.queryByRole('button', { name: /checked the address/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(false)
  })
})

describe('simulation review', () => {
  it('groups the declared send and predicted receipt in one balance-change ledger', () => {
    const token = '0x3333333333333333333333333333333333333333'
    render(
      <BalanceChanges
        account={account}
        currencyRate={{ price: 3200 }}
        isTestnet={false}
        req={{
          classification: 'CONTRACT_CALL',
          data: { value: '0xde0b6b3a7640000' }
        }}
        simulation={{
          status: 'succeeded',
          source: 'eth_simulateV1',
          effects: [
            {
              type: 'transfer',
              standard: 'erc20',
              token,
              from: '0x2222222222222222222222222222222222222222',
              to: account.toLowerCase(),
              amount: '5000000'
            }
          ]
        }}
        symbol='ETH'
        tokenFor={() => ({ decimals: 6, name: 'USD Coin', symbol: 'USDC' })}
      />
    )

    expect(screen.getByText('Estimated changes')).toBeTruthy()
    expect(screen.getByText('USD Coin')).toBeTruthy()
    const outgoingDirection = screen.getByText('You send')
    const incomingDirection = screen.getByText('You receive')
    expect(outgoingDirection.className).toBe('transactionReviewScreenReaderOnly')
    expect(incomingDirection.className).toBe('transactionReviewScreenReaderOnly')
    expect(screen.queryByText('$3,200.00')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByText(/RPC simulation/i)).toBeNull()
    const outgoing = outgoingDirection.closest('.transactionReviewAssetChangeOutgoing')
    const incoming = incomingDirection.closest('.transactionReviewAssetChangeIncoming')
    expect(outgoing.compareDocumentPosition(incoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('places the selected account native trace alongside token balance changes', () => {
    const otherAccount = '0x2222222222222222222222222222222222222222'
    const token = '0x3333333333333333333333333333333333333333'
    const simulation = {
      status: 'succeeded',
      source: 'eth_simulateV1',
      effects: [
        {
          type: 'transfer',
          standard: 'erc20',
          token,
          from: account.toLowerCase(),
          to: '0x0000000000000000000000000000000000000000',
          amount: '7'
        }
      ],
      nativeBalanceChanges: {
        status: 'succeeded',
        source: 'debug_traceCall',
        changes: [
          { account: otherAccount, before: '0', after: '1', change: '1' },
          { account: account.toLowerCase(), before: '1', after: '8', change: '7' }
        ]
      }
    }

    expect(getExpectedNativeBalanceChange(simulation, account)).toEqual(
      simulation.nativeBalanceChanges.changes[1]
    )
    render(
      <BalanceChanges
        account={account}
        req={{ classification: 'CONTRACT_CALL', data: { value: '0x0' } }}
        simulation={simulation}
        symbol='ETH'
        tokenFor={() => ({ decimals: 0, name: 'Wrapped Ether', symbol: 'WETH' })}
      />
    )

    const outgoing = screen.getByText('You burn').closest('.transactionReviewAssetChangeOutgoing')
    const incoming = screen.getByText('You receive').closest('.transactionReviewAssetChangeIncoming')
    expect(outgoing.compareDocumentPosition(incoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByTestId('display-value').map(({ textContent }) => textContent)).toEqual([
      '7WETH',
      '<0.000001ETH'
    ])
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('exposes contract data as a named disclosure in the main review', async () => {
    link.send.mockClear()
    const { user } = render(<TransactionDataRow method='deposit' />)

    expect(screen.getByText('Contract data')).toBeTruthy()
    expect(screen.getByText('deposit ›')).toBeTruthy()
    const disclosures = screen.getAllByRole('button', { name: 'View transaction data' })
    await user.click(disclosures.at(-1))
    expect(link.send).toHaveBeenCalledWith('nav:update', 'panel', { data: { step: 'viewData' } })
  })

  it('keeps one stable review status and prioritizes the highest-risk evidence', () => {
    expect(
      getReviewStatusPresentation([
        { className: '_txMainTagGood', label: 'Simulation completed' },
        { className: '_txMainTagWarning', label: 'Balance preview may be incomplete' },
        { className: '_txMainTagBad', label: 'RPC reports broad token approval' }
      ])
    ).toEqual({
      className: '_txMainTagBad',
      label: 'RPC reports broad token approval'
    })
  })

  it('renders a trusted Yearn action summary with its decoded amount', () => {
    render(
      <YearnOverview
        action='withdraw'
        asset={{
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          chainId: 8453,
          symbol: 'USDC'
        }}
        vaultName='USDC Horizon yVault'
        amountRaw='12500000'
        symbol='USDC'
        decimals={6}
      />
    )

    expect(screen.getByText('Withdraw from Yearn')).toBeTruthy()
    expect(screen.getByText(/12.5/)).toBeTruthy()
    expect(screen.getByText(/USDC/)).toBeTruthy()
    expect(screen.getByRole('img', { name: 'USDC asset' })).toBeTruthy()
  })

  it('derives Yearn intent changes from recognized calldata without calling them simulation', () => {
    expect(
      getYearnIntentLines('deposit', {
        amountRaw: '12500000',
        decimals: 6,
        symbol: 'USDC',
        vaultName: 'USDC Horizon yVault'
      })
    ).toEqual(['Send 12.5 USDC', 'Receive USDC Horizon yVault shares at execution rate'])
    expect(
      getYearnIntentLines('withdraw', {
        amountRaw: '2500000',
        amountType: 'assets',
        decimals: 6,
        symbol: 'USDC'
      })
    ).toEqual(['Receive 2.5 USDC', 'Burn the shares required at execution'])
  })

  it('does not describe an unlimited Yearn approval as exact', () => {
    render(
      <YearnOverview
        action='approve'
        vaultName='USDC Horizon yVault'
        amountRaw='115792089237316195423570985008687907853269984665640564039457584007913129639935'
        symbol='USDC'
        decimals={6}
      />
    )

    expect(screen.getByText('Unlimited Yearn approval')).toBeTruthy()
    expect(screen.queryByText('Approve Yearn vault')).toBeNull()
  })

  it('handles watch-only compatibility failures as missing signers', () => {
    expect(isNoSignerError('No signer')).toBe(true)
    expect(isNoSignerError('Watch-only accounts cannot sign')).toBe(true)
    expect(isNoSignerError('Signer unavailable')).toBe(false)
  })

  it('summarizes execution outcomes without exposing implementation-specific RPC names', () => {
    expect(getSimulationPresentation({ status: 'succeeded', source: 'eth_call' })).toEqual({
      className: '_txMainTagGood',
      label: 'Basic simulation complete'
    })
    expect(getSimulationPresentation({ status: 'failed', source: 'eth_simulateV1' })).toEqual({
      className: '_txMainTagBad',
      label: 'Simulation failed'
    })
  })

  it('blocks approval while execution or delegation evidence is not ready', () => {
    const readyEvidence = {
      source: 'configured-rpc',
      sender: { status: 'no-code' },
      targets: []
    }
    expect(canApproveTransaction(true, { status: 'pending' })).toBe(false)
    expect(canApproveTransaction(true, { status: 'reverted', accountCodeEvidence: readyEvidence })).toBe(true)
    expect(canApproveTransaction(true, { status: 'failed', accountCodeEvidence: readyEvidence })).toBe(true)
    expect(canApproveTransaction(true)).toBe(false)
    expect(canApproveTransaction(false, { status: 'succeeded' })).toBe(false)
    expect(
      canApproveTransaction(true, {
        status: 'succeeded',
        advancedChecks: { status: 'pending' },
        accountCodeEvidence: readyEvidence
      })
    ).toBe(false)
    expect(
      canApproveTransaction(true, {
        status: 'succeeded',
        accountCodeEvidence: {
          sender: { status: 'no-code' },
          targets: [{ status: 'unavailable' }]
        }
      })
    ).toBe(false)
    expect(
      canApproveTransaction(true, {
        status: 'succeeded',
        accountCodeEvidence: {
          sender: { status: 'no-code' },
          targets: [{ status: 'delegated', delegateCodeStatus: 'contract' }]
        }
      })
    ).toBe(true)
  })

  it('renders and confirms an outcome-specific simulation override', async () => {
    const req = { handlerId: 'simulation-override' }
    const approval = {
      type: 'approveSimulationOverride',
      data: {
        title: 'RPC Reports Revert',
        message: 'The configured RPC reports a revert.',
        confirmLabel: 'Sign Anyway'
      }
    }

    const { user } = render(<TxApproval req={req} approval={approval} />)

    expect(screen.getByText('RPC Reports Revert')).toBeTruthy()
    expect(screen.getByText('The configured RPC reports a revert.')).toBeTruthy()
    expect(document.querySelector('.approveTransactionWarning .cluster')).toBeNull()
    expect(document.querySelector('.approveTransactionWarningActions')).toBeTruthy()
    const decline = screen.getByRole('button', { name: 'Decline' })
    expect(decline.classList.contains('_txActionButtonBad')).toBe(false)
    expect(screen.getByRole('button', { name: 'Sign Anyway' }).classList).toContain('_txActionButtonGood')
    await user.click(screen.getByRole('button', { name: 'Sign Anyway' }))
    expect(link.rpc).toHaveBeenCalledWith(
      'confirmRequestApproval',
      req,
      approval.type,
      {},
      expect.any(Function)
    )
  })

  it('exposes the approval rejection as a native decision', async () => {
    const req = { handlerId: 'simulation-rejection' }
    const approval = {
      type: 'approveSimulationOverride',
      data: { title: 'RPC Reports Revert', message: 'The configured RPC reports a revert.' }
    }
    const { user } = render(<TxApproval req={req} approval={approval} />)

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Decline' }))
    await user.keyboard('{Enter}')

    expect(link.rpc).toHaveBeenCalledWith('declineRequest', req, expect.any(Function))
  })

  it('renders and confirms broad token authority consent', async () => {
    const req = { handlerId: 'broad-token-approval' }
    const approval = {
      type: 'approveBroadTokenAuthority',
      data: {
        title: 'Broad Token Approval',
        message: 'This request asks for broad access. Check the spender and limit.',
        confirmLabel: 'Approve Anyway'
      }
    }

    const { user } = render(<TxApproval req={req} approval={approval} />)

    expect(screen.getByText('Broad Token Approval')).toBeTruthy()
    expect(screen.getByText(approval.data.message)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Approve Anyway' }))
    expect(link.rpc).toHaveBeenCalledWith(
      'confirmRequestApproval',
      req,
      approval.type,
      {},
      expect.any(Function)
    )
  })

  it('selects an unconfirmed permit warning only before submission', () => {
    const approval = { type: 'approveUnlimitedTokenPermit', approved: false }
    const approved = { type: 'alreadyApproved', approved: true }

    expect(getRequiredRequestApproval({ type: 'signErc20Permit', approvals: [approved, approval] })).toBe(
      approval
    )
    expect(
      getRequiredRequestApproval({ type: 'signErc20Permit', status: 'pending', approvals: [approval] })
    ).toBe(false)
  })

  it('advances through composed signature approvals in order', () => {
    const signatureRisk = { type: 'approveDangerousSignature', approved: false }
    const permitRisk = { type: 'approveUnlimitedTokenPermit', approved: false }
    const req = { type: 'signErc20Permit', approvals: [signatureRisk, permitRisk] }

    expect(getRequiredRequestApproval(req)).toBe(signatureRisk)
    signatureRisk.approved = true
    expect(getRequiredRequestApproval(req)).toBe(permitRisk)
    permitRisk.approved = true
    expect(getRequiredRequestApproval(req)).toBeUndefined()
  })

  it('renders and confirms unlimited permit consent through the shared warning UI', async () => {
    const req = { handlerId: 'unlimited-token-permit', type: 'signErc20Permit' }
    const approval = {
      type: 'approveUnlimitedTokenPermit',
      approved: false,
      data: {
        title: 'Unlimited Token Permit',
        message:
          'This EIP-2612 signature authorizes the displayed spender to use the maximum uint256 token amount.',
        confirmLabel: 'Sign Permit Anyway'
      }
    }

    const { user } = render(<TxApproval req={req} approval={approval} />)

    expect(screen.getByText('Unlimited Token Permit')).toBeTruthy()
    expect(screen.getByText(approval.data.message)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sign Permit Anyway' }))
    expect(link.rpc).toHaveBeenCalledWith(
      'confirmRequestApproval',
      req,
      approval.type,
      {},
      expect.any(Function)
    )
  })

  it('qualifies RPC-reported effects and highlights broad approvals', () => {
    const account = '0x1111111111111111111111111111111111111111'
    const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const max = (2n ** 256n - 1n).toString(10)
    const simulation = {
      status: 'succeeded',
      source: 'eth_simulateV1',
      effectsTruncated: true,
      effects: [
        {
          type: 'transfer',
          standard: 'erc20',
          token,
          from: account,
          to: '0x2222222222222222222222222222222222222222',
          amount: '10'
        },
        {
          type: 'approval',
          standard: 'erc20',
          token,
          owner: account,
          spender: '0x3333333333333333333333333333333333333333',
          amount: max
        }
      ]
    }

    expect(getSimulationEffectsPresentation(simulation, account)).toEqual({
      broadApproval: true,
      truncated: true
    })
    expect(getExpectedAssetChanges(simulation, account)).toEqual([simulation.effects[0]])

    render(<SimulationEffects account={account} simulation={simulation} />)

    expect(screen.getByText('Token effects')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/preview may be incomplete/i)
    expect(screen.getByText('ERC-20 Send')).toBeTruthy()
    expect(screen.getByText('ERC-20 Unlimited Approval')).toBeTruthy()
    expect(screen.getAllByText(token)).toHaveLength(2)
    expect(screen.getByRole('alert').textContent).toMatch(/Partial .*preview/i)
  })

  it('keeps a normal token approval on one concise headline', () => {
    render(<ApproveOverview amount='890000000' decimals={6} symbol='USDC' />)

    expect(screen.getByText('Approve')).toBeTruthy()
    expect(screen.getByTestId('display-value').textContent).toBe('890USDC')
    expect(document.querySelector('.transactionReviewApprovalSummary').textContent).toBe('Approve890USDC')
  })

  it('does not claim effects for an eth_call fallback', () => {
    const simulation = { status: 'succeeded', source: 'eth_call' }

    expect(getSimulationEffectsPresentation(simulation, '0x1')).toBeNull()
    render(<SimulationEffects account='0x1' simulation={simulation} />)
    expect(screen.queryByText('RPC-Reported Effects')).toBeNull()
  })

  it('summarizes and renders qualified native balance changes in Wei', () => {
    const evidence = {
      status: 'succeeded',
      source: 'debug_traceCall',
      truncated: true,
      changes: [
        { account: account.toLowerCase(), before: '10', after: '7', change: '-3' },
        {
          account: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          before: '0',
          after: '3',
          change: '3'
        }
      ]
    }

    expect(getNativeBalanceChangesPresentation({ nativeBalanceChanges: evidence })).toEqual({
      className: '_txMainTagWarning',
      label: '2 RPC-reported native balance changes (truncated)'
    })
    render(<SimulationNativeBalanceChanges simulation={{ nativeBalanceChanges: evidence }} />)

    expect(screen.getByText('RPC-Reported Native Balance Changes')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/configured RPC/i)
    expect(screen.getByRole('note').textContent).toMatch(/may omit gas fees/i)
    expect(screen.getByText('Native Balance Decrease')).toBeTruthy()
    expect(screen.getByText('Native Balance Increase')).toBeTruthy()
    expect(screen.getByText('-3')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/Partial .*preview/i)
  })

  it('shows unavailable native balance evidence without changing execution status', () => {
    const evidence = {
      status: 'unavailable',
      source: 'debug_traceCall',
      reason: 'Configured RPC does not support native balance-change tracing'
    }

    expect(getNativeBalanceChangesPresentation({ nativeBalanceChanges: evidence })).toEqual({
      className: '_txMainTagWarning',
      label: 'Native balance-change preview unavailable'
    })
    render(
      <SimulationNativeBalanceChanges simulation={{ status: 'succeeded', nativeBalanceChanges: evidence }} />
    )

    expect(screen.getByRole('note').textContent).toMatch(/could not derive/i)
    expect(screen.getByRole('note').textContent).toMatch(/does not support/i)
    expect(screen.queryByText(/Native Balance Increase/i)).toBeNull()
    expect(
      getNativeBalanceChangesPresentation({ nativeBalanceChanges: evidence }, { suppressUnavailable: true })
    ).toBeNull()
  })

  it('does not suppress an actual native balance trace failure', () => {
    const evidence = {
      status: 'failed',
      source: 'debug_traceCall',
      reason: 'Malformed trace response'
    }

    expect(
      getNativeBalanceChangesPresentation({ nativeBalanceChanges: evidence }, { suppressUnavailable: true })
    ).toEqual({ className: '_txMainTagWarning', label: 'Native balance-change preview failed' })
  })

  it('renders a successful empty native balance diff without claiming a change', () => {
    const evidence = { status: 'succeeded', source: 'debug_traceCall', changes: [] }

    expect(getNativeBalanceChangesPresentation({ nativeBalanceChanges: evidence })).toEqual({
      className: '_txMainTagGood',
      label: '0 RPC-reported native balance changes'
    })
    render(<SimulationNativeBalanceChanges simulation={{ nativeBalanceChanges: evidence }} />)

    expect(screen.getByText('No native balance changes were reported.')).toBeTruthy()
    expect(screen.queryByText(/Native Balance Increase/i)).toBeNull()
  })

  it('prominently summarizes and details ERC-1967 implementation changes', () => {
    const proxy = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const before = '0xcccccccccccccccccccccccccccccccccccccccc'
    const after = '0xdddddddddddddddddddddddddddddddddddddddd'
    const evidence = {
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

    expect(getProxyImplementationChangesPresentation({ proxyImplementationCheck: evidence })).toEqual({
      className: '_txMainTagBad',
      label: 'RPC reports 1 net ERC-1967 implementation slot change'
    })
    render(<SimulationProxyImplementationChanges simulation={{ proxyImplementationCheck: evidence }} />)

    expect(screen.getByText('RPC-Reported ERC-1967 Implementation Slot Changes')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/Implementation changed/i)
    expect(screen.getByRole('alert').textContent).toMatch(/asset authority may change/i)
    expect(screen.getByText('Proxy Implementation Slot Changed')).toBeTruthy()
    expect(screen.getByText(proxy)).toBeTruthy()
    expect(screen.getByText(before)).toBeTruthy()
    expect(screen.getByText(after)).toBeTruthy()
  })

  it('omits absent proxy implementation-change evidence', () => {
    expect(getProxyImplementationChangesPresentation(undefined)).toBeNull()
    expect(
      getProxyImplementationChangesPresentation({
        proxyImplementationCheck: { status: 'succeeded', source: 'debug_traceCall', changes: [] }
      })
    ).toBeNull()
    render(<SimulationProxyImplementationChanges simulation={{ status: 'succeeded' }} />)
    expect(screen.queryByText('RPC-Reported ERC-1967 Implementation Slot Changes')).toBeNull()
  })

  it('shows an inconclusive ERC-1967 check without claiming safety', () => {
    const proxyImplementationCheck = {
      status: 'unavailable',
      source: 'debug_traceCall',
      standard: 'ERC-1967',
      slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      reason: 'Configured RPC does not support tracing'
    }

    expect(getProxyImplementationChangesPresentation({ proxyImplementationCheck })).toEqual({
      className: '_txMainTagWarning',
      label: 'ERC-1967 implementation-slot check unavailable'
    })
    render(<SimulationProxyImplementationChanges simulation={{ proxyImplementationCheck }} />)

    expect(screen.getByText('ERC-1967 Implementation Slot Check')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/could not derive net/i)
    expect(screen.getByRole('note').textContent).toMatch(/does not support tracing/i)
    expect(
      getProxyImplementationChangesPresentation({ proxyImplementationCheck }, { suppressUnavailable: true })
    ).toBeNull()
  })

  it('summarizes and renders bounded configured-RPC execution traces', () => {
    const target = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const created = '0xcccccccccccccccccccccccccccccccccccccccc'
    const evidence = {
      source: 'debug_traceCall',
      truncated: true,
      calls: [
        {
          type: 'DELEGATECALL',
          depth: 1,
          from: account.toLowerCase(),
          to: target,
          value: '0',
          inputBytes: 36,
          selector: '0xabcdef01',
          failure: 'execution reverted'
        },
        {
          type: 'CREATE2',
          depth: 2,
          from: target,
          to: created,
          value: '3',
          inputBytes: 128
        }
      ]
    }

    expect(getCallTracePresentation({ callTrace: evidence })).toEqual({
      className: '_txMainTagBad',
      label: '2 RPC-reported execution traces (1 creation, 1 failed) (truncated)'
    })
    render(<SimulationCallTrace simulation={{ callTrace: evidence }} />)

    expect(screen.getByText('RPC-Reported Execution Trace')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/Call trace/i)
    expect(screen.getByRole('note').textContent).toMatch(/Raw input and return data omitted/i)
    expect(screen.getByText('DELEGATECALL Internal Call')).toBeTruthy()
    expect(screen.getByText('CREATE2 Contract Creation')).toBeTruthy()
    expect(screen.getByText('0xabcdef01')).toBeTruthy()
    expect(screen.getByText('execution reverted')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/Partial execution trace/i)
  })

  it('omits an empty call-trace presentation', () => {
    expect(getCallTracePresentation(undefined)).toBeNull()
    expect(getCallTracePresentation({ callTrace: { source: 'debug_traceCall', calls: [] } })).toBeNull()
    render(<SimulationCallTrace simulation={{ callTrace: { source: 'debug_traceCall', calls: [] } }} />)
    expect(screen.queryByText('RPC-Reported Execution Trace')).toBeNull()
  })

  it.each([
    ['0', '42', '_txMainTagWarning', 'no current token allowance'],
    ['7', '0', '_txMainTagGood', 'existing token allowance will be revoked'],
    ['7', '7', '_txMainTagGood', 'allowance already matches request'],
    ['7', '42', '_txMainTagBad', 'a different nonzero token allowance']
  ])('summarizes current allowance %s and request %s', (currentAmount, requestedAmount, className, label) => {
    expect(getAllowancePresentation({ allowance: { currentAmount, requestedAmount } })).toEqual({
      className,
      label: `RPC reports ${label}`
    })
  })

  it('renders qualified current allowance details in raw units', () => {
    const allowance = {
      source: 'eth_call',
      token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      owner: account,
      spender: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      currentAmount: '7',
      requestedAmount: '42'
    }

    render(<SimulationAllowance simulation={{ status: 'succeeded', allowance }} />)

    expect(screen.getByText('RPC-Reported Current Allowance')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/Allowance at review time/i)
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('omits allowance presentation when no valid evidence is attached', () => {
    expect(getAllowancePresentation({ status: 'succeeded' })).toBeNull()
    render(<SimulationAllowance simulation={{ status: 'succeeded' }} />)
    expect(screen.queryByText('RPC-Reported Current Allowance')).toBeNull()
  })

  it('prominently summarizes and details delegated recipient execution', () => {
    const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const simulation = {
      status: 'succeeded',
      accountCodeEvidence: {
        source: 'configured-rpc',
        sender: { status: 'no-code', account: account.toLowerCase(), role: 'sender' },
        targets: [
          {
            status: 'delegated',
            account: recipient,
            role: 'target',
            callIndexes: [0],
            delegate,
            delegateCodeStatus: 'contract'
          }
        ]
      }
    }

    expect(getDelegationPresentation(simulation)).toEqual({
      className: '_txMainTagBad',
      label: `Recipient delegates execution to ${delegate}.`
    })
    render(<SimulationDelegation simulation={simulation} />)

    expect(screen.getByText('Account Delegation Check')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(`Recipient delegates execution to ${delegate}.`)
    expect(screen.getByText(/transaction to this address runs code/i)).toBeTruthy()
    expect(screen.getByText(recipient)).toBeTruthy()
    expect(screen.getByText(delegate)).toBeTruthy()
    expect(screen.getByText('configured RPC · eth_getCode')).toBeTruthy()
  })

  it('describes a delegated sender without claiming outbound execution uses the delegate', () => {
    const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const simulation = {
      status: 'succeeded',
      accountCodeEvidence: {
        source: 'configured-rpc',
        sender: { status: 'delegated', account: account.toLowerCase(), role: 'sender', delegate },
        targets: []
      }
    }

    expect(getDelegationPresentation(simulation)).toEqual({
      className: '_txMainTagBad',
      label: `Sending account delegated to ${delegate}`
    })
    render(<SimulationDelegation simulation={simulation} />)
    expect(screen.getByRole('alert').textContent).toMatch(/sending this transaction does not by itself/i)
    expect(screen.queryByText(/transactions from this account execute/i)).toBeNull()
  })

  it('shows an unavailable recipient delegation check without claiming delegation', () => {
    const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const simulation = {
      status: 'succeeded',
      accountCodeEvidence: {
        source: 'configured-rpc',
        sender: { status: 'no-code', account: account.toLowerCase(), role: 'sender' },
        targets: [
          {
            status: 'unavailable',
            account: recipient,
            role: 'target',
            callIndexes: [0],
            reason: 'RPC returned invalid account code'
          }
        ]
      }
    }

    expect(getDelegationPresentation(simulation)).toEqual({
      className: '_txMainTagWarning',
      label: 'Recipient delegation check unavailable'
    })
    render(<SimulationDelegation simulation={simulation} />)
    expect(screen.getByRole('note').textContent).toMatch(/recipient delegation check unavailable/i)
    expect(screen.queryByText(/recipient delegates execution/i)).toBeNull()
  })

  it('warns that nested delegation stops after the first delegate', () => {
    const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const simulation = {
      accountCodeEvidence: {
        sender: { status: 'no-code', role: 'sender', account: account.toLowerCase() },
        targets: [
          {
            status: 'delegated',
            role: 'target',
            account: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            callIndexes: [0],
            delegate,
            delegateCodeStatus: 'delegated'
          }
        ]
      }
    }

    expect(getDelegationPresentation(simulation)).toEqual({
      className: '_txMainTagWarning',
      label: `Target delegates to ${delegate}; nested delegation is not followed`
    })
    render(<SimulationDelegation simulation={simulation} />)
    expect(screen.getAllByText(/Nested delegation is not followed/i)).toBeTruthy()
  })

  it('does not treat empty delegate bytecode as proof that nothing can execute', () => {
    const delegate = '0x0000000000000000000000000000000000000001'
    const simulation = {
      accountCodeEvidence: {
        sender: { status: 'no-code', role: 'sender', account: account.toLowerCase() },
        targets: [
          {
            status: 'delegated',
            role: 'target',
            account: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            callIndexes: [0],
            delegate,
            delegateCodeStatus: 'no-code'
          }
        ]
      }
    }

    expect(getDelegationPresentation(simulation)).toEqual({
      className: '_txMainTagWarning',
      label: `Target delegates to ${delegate}; RPC returned empty code`
    })
    render(<SimulationDelegation simulation={simulation} />)
    expect(screen.getByText(/No delegate bytecode/i)).toBeTruthy()
    expect(screen.getByText(/empty account or a precompile/i)).toBeTruthy()
  })

  it('summarizes and renders a complete ordered access list', () => {
    const firstAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const secondAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const firstKey = `0x${'11'.repeat(32)}`
    const secondKey = `0x${'22'.repeat(32)}`
    const accessList = [
      { address: firstAddress, storageKeys: [firstKey, secondKey] },
      { address: secondAddress, storageKeys: [] }
    ]

    expect(getAccessListPresentation({ accessList })).toEqual({
      className: '_txMainTagWarning',
      label: 'Access list: 2 addresses, 2 storage keys'
    })
    render(
      <ViewData
        req={{
          account,
          data: { chainId: '0x1', type: '0x2', accessList },
          simulation: { status: 'succeeded' }
        }}
      />
    )

    const rendered = document.querySelector('.simpleJsonStructuredValue').textContent
    expect(rendered.indexOf(firstAddress)).toBeLessThan(rendered.indexOf(secondAddress))
    expect(rendered.indexOf(firstKey)).toBeLessThan(rendered.indexOf(secondKey))
    expect(rendered).toBe(JSON.stringify(accessList, null, 2))
  })

  it('labels selector-only method suggestions without presenting decoded arguments', () => {
    render(
      <ViewData
        req={{
          account,
          data: { chainId: '0x1', to: account, data: `0xa9059cbb${'00'.repeat(64)}` },
          suggestedData: {
            method: 'transfer',
            signature: 'transfer(address,uint256)',
            source: 'bundled-selector-directory'
          },
          simulation: { status: 'succeeded' }
        }}
      />
    )

    expect(document.querySelector('.decodedDataConfidencePossible').textContent).toBe(
      'Possible method: transfer(address,uint256)'
    )
    expect(screen.getByText('Selector match only. Arguments are not decoded.')).toBeTruthy()
    expect(screen.queryByText('Inputs')).toBeNull()
  })

  it('labels an in-flight contract method lookup in raw-data review', () => {
    render(
      <ViewData
        req={{
          account,
          calldataDecodeStatus: 'pending',
          data: { chainId: '0x1', to: account, data: '0x12345678' },
          simulation: { status: 'succeeded' }
        }}
      />
    )

    expect(screen.getByText('Identifying contract method…')).toBeTruthy()
    expect(screen.queryByText('Contract method not identified')).toBeNull()
  })

  it('distinguishes verified and retained method details', () => {
    render(
      <ViewData
        req={{
          account,
          data: { chainId: '0x1', to: account, data: '0x12345678' },
          decodedData: {
            source: 'Sourcify',
            contractName: 'Verified Router',
            confidence: 'verified-abi',
            retained: true,
            method: 'execute',
            args: []
          },
          simulation: { status: 'succeeded' }
        }}
      />
    )

    expect(screen.getByText(/Method verified/)).toBeTruthy()
    expect(screen.getByText(/retained from an earlier decode/)).toBeTruthy()
  })

  it('groups decoded, permission, execution, and raw contract evidence without hiding warnings', () => {
    const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const delegate = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const recipient = '0xcccccccccccccccccccccccccccccccccccccccc'

    render(
      <ViewData
        req={{
          account,
          data: { chainId: '0x1', to: recipient, data: '0x1234', type: '0x2' },
          decodedData: {
            source: 'local',
            contractName: 'Example Contract',
            method: 'execute',
            args: [{ name: 'recipient', type: 'address', value: recipient }]
          },
          simulation: {
            status: 'succeeded',
            source: 'eth_simulateV1',
            effects: [
              {
                type: 'transfer',
                standard: 'erc20',
                token,
                from: account,
                to: recipient,
                amount: '1'
              }
            ],
            allowance: {
              token,
              owner: account,
              spender: recipient,
              currentAmount: '0',
              requestedAmount: '1'
            },
            delegation: { status: 'delegated', source: 'eth_getCode', account, delegate },
            callTrace: {
              calls: [
                {
                  type: 'CALL',
                  depth: 1,
                  from: account,
                  to: recipient,
                  value: '0',
                  inputBytes: 4,
                  failure: 'execution reverted'
                }
              ]
            }
          }
        }}
      />
    )

    expect(screen.getByRole('region', { name: 'Actions' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Permissions' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Execution' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Raw data' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Execution' }).open).toBe(true)
    expect(screen.getByRole('region', { name: 'Raw data' }).open).toBe(false)
    expect(screen.getByText('Example Contract')).toBeTruthy()
    expect(screen.getByText('RPC-Reported Current Allowance')).toBeTruthy()
    expect(screen.getByText('RPC-Reported Execution Trace')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/sending this transaction does not by itself/i)
    expect(screen.getByText('0x1234')).toBeTruthy()
    expect(screen.getByText('0x2')).toBeTruthy()
  })

  it('collapses routine execution and raw evidence until requested', () => {
    render(
      <ViewData
        req={{
          account,
          data: { chainId: '0x1', to: account, data: '0x1234' },
          simulation: {
            status: 'succeeded',
            callTrace: {
              calls: [
                {
                  type: 'CALL',
                  depth: 1,
                  from: account,
                  to: account,
                  value: '0',
                  inputBytes: 4
                }
              ]
            }
          }
        }}
      />
    )

    expect(screen.getByRole('region', { name: 'Execution' }).open).toBe(false)
    expect(screen.getByRole('region', { name: 'Raw data' }).open).toBe(false)
  })

  it('keeps unavailable supporting checks available without opening a warning-heavy panel', () => {
    render(
      <ViewData
        req={{
          account,
          data: { chainId: '0x1', to: account, data: '0x12345678' },
          simulation: {
            status: 'succeeded',
            advancedChecks: { status: 'partly-unavailable' },
            proxyImplementationCheck: {
              status: 'unavailable',
              source: 'debug_traceCall',
              standard: 'ERC-1967',
              slot: `0x${'00'.repeat(32)}`,
              reason: 'Configured RPC does not support tracing'
            }
          }
        }}
      />
    )

    expect(screen.getByRole('region', { name: 'Execution' }).open).toBe(false)
    expect(screen.getByText(/Some supporting checks could not be completed/)).toBeTruthy()
    expect(screen.getByText('ERC-1967 Implementation Slot Check')).toBeTruthy()
  })
})

describe('transaction nonce presentation', () => {
  const nonceRequest = (overrides = {}) => ({
    account,
    handlerId: 'nonce-request',
    data: { nonce: '0x5' },
    payload: { params: [{ nonce: '0x5' }] },
    ...overrides
  })

  it('sends exact adjustment and reset payloads for mutable requests', async () => {
    const req = nonceRequest({ data: { nonce: '0x6' } })
    link.send.mockClear()
    const { user } = render(<NonceControl req={req} />)

    await user.click(screen.getByRole('button', { name: 'Decrease nonce' }))
    await user.click(screen.getByRole('button', { name: 'Increase nonce' }))
    await user.click(screen.getByRole('button', { name: 'Reset nonce' }))

    const reference = { account, handlerId: 'nonce-request' }
    expect(link.send).toHaveBeenNthCalledWith(1, 'tray:adjustNonce', reference, -1)
    expect(link.send).toHaveBeenNthCalledWith(2, 'tray:adjustNonce', reference, 1)
    expect(link.send).toHaveBeenNthCalledWith(3, 'tray:resetNonce', reference)
  })

  it('shows the exact main-review nonce and keeps its step controls available', () => {
    render(<NonceControl req={nonceRequest()} />)

    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decrease nonce' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Increase nonce' })).toBeTruthy()
    expect(displayTransactionNonce('0x20000000000000')).toBe('9007199254740992')
  })

  it('shows reset only when the nonce differs from the original transaction', () => {
    const { rerender } = render(<NonceControl req={nonceRequest()} />)

    expect(screen.queryByRole('button', { name: 'Reset nonce' })).toBeNull()

    rerender(<NonceControl req={nonceRequest({ payload: { params: [{}] } })} />)
    expect(screen.getByRole('button', { name: 'Reset nonce' })).toBeTruthy()
  })

  it('keeps the raw transaction nonce read-only', () => {
    render(<SimpleTxJSON json={{ nonce: 5 }} />)

    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /nonce/i })).toBeNull()
  })

  it('projects only signable transaction fields into raw data', () => {
    expect(
      projectRawTransaction({
        chainId: '0x1',
        to: account,
        data: '0x1234',
        gas: '0x5208',
        gasFeesSource: 'Frame',
        feesUpdated: true,
        recipientType: 'contract'
      })
    ).toEqual({ nonce: 'TBD', chainId: '0x1', to: account, data: '0x1234', gas: '0x5208' })
  })

  it('keeps a queued transaction nonce read-only', () => {
    render(<NonceControl req={nonceRequest()} readOnly />)

    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Decrease nonce' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Increase nonce' })).toBeNull()
  })

  it('decodes large transaction quantities without losing display precision', () => {
    const decoded = new ViewData({}).decodeRawTx({
      chainId: '0x1',
      nonce: '0x20000000000000',
      data: '0x1234'
    })

    expect(decoded).toEqual({
      chainId: '1',
      nonce: '9007199254740992',
      data: '0x1234'
    })
  })

  it.each([
    ['locked', { locked: true }],
    ['submitted', { status: 'pending' }]
  ])('does not expose nonce mutation for a %s request', (_, state) => {
    render(<NonceControl req={nonceRequest(state)} />)

    expect(screen.queryByRole('button', { name: 'Decrease nonce' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Increase nonce' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset nonce' })).toBeNull()
  })
})

describe('replacement status', () => {
  it.each([
    ['cancel', /only cancels it if this transaction confirms first/i],
    ['speed', /uses the same nonce and must confirm first/i]
  ])('explains %s replacement semantics in review', (kind, message) => {
    render(<ReplacementNotice replacement={{ kind, originalHash: `0x${'a'.repeat(64)}` }} />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toMatch(message)
  })

  it('maps a below-minimum fee assessment to the existing transaction-card notice', () => {
    const req = { data: { nonce: '0x7', gasPrice: '0x6d' } }
    const requests = {
      existing: { mode: 'monitor', status: 'sent', data: { nonce: '0x7', gasPrice: '0x64' } }
    }

    expect(new TxMain({}).getReplacementStatus(req, requests)).toEqual({
      replacement: true,
      possible: false,
      reason: 'gas-price-too-low',
      notice: 'gas price too low'
    })
  })

  it('accepts the exact generated replacement minimum in transaction review', () => {
    const req = { data: { nonce: '0x7', gasPrice: '0x6e' } }
    const requests = {
      existing: { mode: 'monitor', status: 'sent', data: { nonce: '0x7', gasPrice: '0x64' } }
    }

    expect(new TxMain({}).getReplacementStatus(req, requests)).toEqual({
      replacement: true,
      possible: true,
      notice: ''
    })
  })

  it.each([
    ['valid', { replacement: true, possible: true }, 'status', 'Valid replacement'],
    [
      'invalid',
      { replacement: true, possible: false, notice: 'gas price too low' },
      'alert',
      'gas price too low'
    ]
  ])('announces a %s replacement assessment', (_label, status, role, message) => {
    render(<ReplacementAssessment status={status} />)
    const announcement = screen.getByRole(role)
    expect(announcement.textContent).toContain(message)
    if (role === 'status') expect(announcement.getAttribute('aria-live')).toBe('polite')
  })
})
