import Restore from 'react-restore'

import store from '../../../main/store'
import { act, render, screen, within } from '../../componentSetup'
import TransactionRequest from '../../../app/tray/Account/Requests/TransactionRequest'
import Footer from '../../../app/tray/Footer'
import link from '../../../resources/link'
import { erc20Interface } from '../../../resources/contracts'

jest.mock('../../../main/store/persist')
jest.mock('../../../resources/link', () => ({ invoke: jest.fn(), rpc: jest.fn(), send: jest.fn() }))

const account = '0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5'
const token = '0x1111111111111111111111111111111111111111'
const spender = '0x2222222222222222222222222222222222222222'
const fingerprint = 'a'.repeat(64)
const transaction = (overrides = {}) => ({
  type: 'transaction',
  account,
  handlerId: 'hierarchy-review',
  origin: 'hierarchy-app',
  classification: 'CONTRACT_CALL',
  recipientType: 'contract',
  data: {
    from: account,
    to: token,
    chainId: '0x1',
    value: '0x0',
    gasLimit: '0x5208',
    gasPrice: '0x77359400',
    type: '0x0',
    nonce: '0x7',
    data: '0x'
  },
  payload: { params: [{ nonce: '0x7', data: '0x' }] },
  simulation: {
    status: 'succeeded',
    source: 'eth_simulateV1',
    accountCodeEvidence: { source: 'configured-rpc', sender: { status: 'no-code' }, targets: [] }
  },
  approvals: [],
  recognizedActions: [],
  ...overrides
})

const Review = Restore.connect(TransactionRequest, store)
const Decision = Restore.connect(Footer, store)

const setRequest = (req, activeRequestId = req.handlerId) => {
  store.updateAccount({
    id: account,
    name: 'Review account',
    lastSignerType: 'ring',
    activeRequestId,
    requests: { [req.handlerId]: req }
  })
  store.navReplace('panel', [
    { view: 'requestView', data: { accountId: account, requestId: req.handlerId, step: 'confirm' } }
  ])
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => {
  delete global.ResizeObserver
})
beforeEach(() => {
  link.rpc.mockReset()
  link.send.mockReset()
  link.invoke.mockReset()
})

it('keeps nonce controls out of ordinary review and reachable in advanced details', async () => {
  const req = transaction()
  setRequest(req)
  const { user } = render(<Review req={req} step='confirm' />)
  expect(screen.getByRole('button', { name: 'Increase nonce' }).closest('details')?.open).toBe(false)
  await user.click(screen.getByText('Advanced details'))
  await user.click(screen.getByRole('button', { name: 'Increase nonce' }))
  expect(link.send).toHaveBeenCalledWith('tray:adjustNonce', { account, handlerId: req.handlerId }, 1)
  expect(screen.getByRole('button', { name: 'View transaction data' })).toBeTruthy()
})

it('keeps signing controls stable while a separate, request-bound acknowledgement is required', async () => {
  const approval = {
    type: 'tokenApprovalRisk',
    approved: false,
    data: {
      title: 'Broad Token Approval',
      message: 'This request asks for broad token access.',
      confirmLabel: 'Accept token access',
      consentFingerprint: fingerprint
    }
  }
  const req = transaction({ approvals: [approval] })
  setRequest(req)
  const { user } = render(
    <>
      <Review req={req} step='confirm' />
      <Decision />
    </>
  )
  act(() => jest.advanceTimersByTime(1600))
  const sign = screen.getByRole('button', { name: 'Sign transaction' })
  expect(sign.disabled).toBe(true)
  const accept = screen.getByRole('button', { name: 'Accept token access' })
  expect(accept.closest('.accountViewMain, .approveTransaction')).toBeTruthy()
  await user.click(accept)
  expect(link.rpc).toHaveBeenCalledWith(
    'confirmRequestApproval',
    expect.objectContaining({ account, handlerId: req.handlerId }),
    approval.type,
    { consentFingerprint: fingerprint },
    expect.any(Function)
  )
  expect(sign.disabled).toBe(true)
  expect(link.rpc.mock.calls.some(([method]) => method === 'approveRequest')).toBe(false)
})

it('shows and copies the request account beside signing controls without a second sender block', async () => {
  const req = transaction()
  setRequest(req)
  link.invoke.mockResolvedValue({ success: true })
  const { user } = render(
    <>
      <Review req={req} step='confirm' />
      <Decision />
    </>
  )
  const summary = screen.getByRole('group', { name: 'Signing account and fee' })
  expect(within(summary).getByText('Review account')).toBeTruthy()
  expect(within(summary).getByRole('button', { name: 'Copy signing account address' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Copy transaction sender address' })).toBeNull()
  expect(screen.queryByText('Ready for review')).toBeNull()
  await user.click(within(summary).getByRole('button', { name: 'Copy signing account address' }))
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: account })
})

it('groups an exact approval with its spender and labels its target as the token contract', () => {
  const req = transaction({
    recognizedActions: [
      {
        id: 'erc20:approve',
        type: 'erc20:approve',
        data: { amount: '890000000', decimals: 6, symbol: 'USDC', spender: { address: spender } }
      }
    ]
  })
  req.data.data = erc20Interface.encodeFunctionData('approve', [spender, 890000000])
  req.payload.params[0].data = req.data.data
  setRequest(req)
  render(<Review req={req} step='confirm' />)
  const permission = document.querySelector('.transactionReviewTokenApproval')
  expect(within(permission).getByRole('button', { name: 'Copy token approval spender address' })).toBeTruthy()
  expect(within(permission).getByText('890 USDC')).toBeTruthy()
  expect(screen.getByText('Token contract')).toBeTruthy()
  expect(screen.queryByText('Approve')).toBeNull()
})
