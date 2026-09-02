import Restore from 'react-restore'

import {
  Eip7702RevokeRequest,
  RevocationFee,
  feeRequestFromRevocation,
  revokeLifecyclePresentation
} from '../../../../../../app/tray/Account/Requests/Eip7702RevokeRequest'
import link from '../../../../../../resources/link'
import { act, fireEvent, render, screen, waitFor } from '../../../../../componentSetup'

jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true })),
  rpc: jest.fn(),
  send: jest.fn()
}))

const delegate = '0x0000000000000000000000000000000000000002'
const request = (overrides = {}) => ({
  type: 'eip7702Revoke',
  handlerId: 'revoke-1',
  account: '0x0000000000000000000000000000000000000001',
  evidence: { delegate },
  ...overrides
})

beforeEach(() => {
  link.invoke.mockClear()
  link.rpc.mockReset()
  link.send.mockReset()
})

const connectedReview = (req, props = {}) => {
  const store = Restore.create(
    {
      main: {
        accounts: { [req.account]: { activeRequestId: req.handlerId } },
        networks: { ethereum: { [req.chainId]: { isTestnet: false } } },
        networksMeta: {
          ethereum: { [req.chainId]: { nativeCurrency: { symbol: 'ETH' } } }
        }
      }
    },
    {}
  )
  const ConnectedReview = Restore.connect(Eip7702RevokeRequest, store)
  return render(
    <ConnectedReview
      req={req}
      accountName='Workshop'
      accounts={{}}
      addressBook={{}}
      chainData={{ chainName: 'Ethereum' }}
      {...props}
    />
  )
}

it('presents review, queue, and signer states without overstating execution', () => {
  expect(revokeLifecyclePresentation(request(), true)).toEqual({
    kind: 'review',
    title: 'Ready to revoke',
    detail: 'Confirm this revocation with your signer.'
  })
  expect(revokeLifecyclePresentation(request(), false)).toMatchObject({ kind: 'waiting' })
  expect(revokeLifecyclePresentation(request({ status: 'pending' }), true)).toEqual({
    kind: 'signing',
    title: 'Ready to sign',
    detail: 'Confirm this revocation with your Wren software signer.'
  })
  expect(revokeLifecyclePresentation(request({ status: 'verifying', tx: { hash: '0x1' } }), true)).toEqual({
    kind: 'pending',
    title: 'Revocation transaction pending',
    detail: 'Wait for the network to confirm it.'
  })
})

it('presents ambiguous submission as monitored without claiming sent or failed', () => {
  const presentation = revokeLifecyclePresentation(
    request({
      status: 'verifying',
      mode: 'monitor',
      notice: 'Submission status unclear',
      submission: { status: 'unconfirmed' },
      tx: { hash: '0x1234', confirmations: 0 }
    }),
    true
  )

  expect(presentation).toEqual({
    kind: 'unclear',
    title: 'Submission status unclear',
    detail:
      'Wren is monitoring the expected transaction hash, and this account’s request queue is paused until its status is known.'
  })
  expect(`${presentation.title} ${presentation.detail}`.toLowerCase()).not.toContain('failed')
  expect(`${presentation.title} ${presentation.detail}`.toLowerCase()).not.toContain('sent')
})

it('requires a fresh code check before claiming that delegation is cleared', () => {
  const verified = revokeLifecyclePresentation(
    request({
      status: 'confirmed',
      tx: { hash: '0x1' },
      result: { receiptStatus: 'failed', revocationStatus: 'cleared', reason: 'code-cleared' }
    }),
    true
  )
  expect(verified.kind).toBe('verified')
  expect(verified.detail).toContain('latest RPC check reports no EIP-7702 delegation')

  const receiptOnly = revokeLifecyclePresentation(
    request({
      status: 'error',
      tx: { hash: '0x1' },
      result: { receiptStatus: 'success', revocationStatus: 'unavailable', reason: 'code-unavailable' }
    }),
    true
  )
  expect(receiptOnly.kind).toBe('unverified')
  expect(receiptOnly.detail).toBe(
    'Transaction confirmed. Wren could not verify that the delegation is cleared.'
  )
})

it('distinguishes expired evidence, no-op, and unavailable preflight results', () => {
  expect(
    revokeLifecyclePresentation(request({ status: 'error', failureReason: 'evidence-changed' }), true)
  ).toMatchObject({
    kind: 'changed',
    detail: 'Delegation details changed. Review again before signing. Request not sent.'
  })
  expect(
    revokeLifecyclePresentation(request({ status: 'error', failureReason: 'not-delegated' }), true)
  ).toMatchObject({ kind: 'skipped', detail: 'No delegation found. Nothing was sent.' })
  expect(
    revokeLifecyclePresentation(request({ status: 'error', failureReason: 'unavailable' }), true)
  ).toMatchObject({ kind: 'unavailable', detail: 'Delegation status unavailable. Nothing was sent.' })

  expect(
    revokeLifecyclePresentation(
      request({ status: 'error', failureReason: 'unavailable', notice: 'nonce changed after review' }),
      true
    )
  ).toMatchObject({ kind: 'unavailable' })
})

it('labels the bounded execution fee without inventing an Optimism L1 fee', () => {
  const fee = new RevocationFee({
    req: request({
      chainId: 10,
      fees: {
        gasLimit: '0xb3b0',
        maxFeePerGas: '0x3b9aca00',
        maxPriorityFeePerGas: '0x0'
      }
    })
  })
  fee.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.networks.ethereum.10') return { isTestnet: false }
    if (key === 'main.networksMeta.ethereum.10.nativeCurrency') return { symbol: 'ETH' }
  }
  render(fee.render())

  expect(screen.getByText('Maximum execution fee')).toBeTruthy()
  expect(screen.getByText('Network-added L1 data fees are not included.')).toBeTruthy()
  expect(document.body.textContent).not.toContain('NaN')
})

it('adapts revocation fees as EIP-1559 and never exposes the legacy gas-price editor', async () => {
  const req = request({
    chainId: 1,
    evidence: { delegate, codeHash: `0x${'11'.repeat(32)}`, latestNonce: '0x3' },
    fees: {
      gasLimit: '0xb3b0',
      maxFeePerGas: '0x3b9aca00',
      maxPriorityFeePerGas: '0x0'
    }
  })
  expect(feeRequestFromRevocation(req).data.type).toBe('0x2')
  const { user } = connectedReview(req)

  await user.click(screen.getByRole('button', { name: 'Adjust' }))
  const baseFee = screen.getByLabelText('Base Fee (GWEI)')
  const priorityFee = screen.getByLabelText('Max Priority Fee (GWEI)')
  expect(screen.queryByLabelText('Gas Price (GWEI)')).toBeNull()

  fireEvent.change(baseFee, { target: { value: '8' } })
  fireEvent.change(priorityFee, { target: { value: '4' } })
  act(() => jest.advanceTimersByTime(500))

  expect(link.rpc).toHaveBeenCalledWith(
    'setBaseFee',
    req.account,
    `0x${BigInt(8e9).toString(16)}`,
    req.handlerId,
    expect.any(Function)
  )
  expect(link.rpc).toHaveBeenCalledWith(
    'setPriorityFee',
    req.account,
    `0x${BigInt(4e9).toString(16)}`,
    req.handlerId,
    expect.any(Function)
  )
  expect(link.rpc.mock.calls.some(([method]) => method === 'setGasPrice')).toBe(false)
})

it('renders directly copyable evidence without authorization or signature material', async () => {
  const account = '0x0000000000000000000000000000000000000001'
  const req = request({
    account,
    chainId: 1,
    evidence: {
      delegate,
      codeHash: `0x${'11'.repeat(32)}`,
      latestNonce: '0x3'
    },
    fees: {
      gasLimit: '0xb3b0',
      maxFeePerGas: '0x3b9aca00',
      maxPriorityFeePerGas: '0x0'
    }
  })
  const { user } = connectedReview(req, {
    addressBook: {
      [delegate.toLowerCase()]: {
        address: delegate,
        name: 'Delegate contract',
        note: '',
        provenance: { status: 'saved' },
        createdAt: 1,
        updatedAt: 1
      }
    }
  })

  expect(screen.getByRole('heading', { name: 'Remove delegated access?' })).toBeTruthy()
  expect(screen.getByText('This account will stop using the current delegate.')).toBeTruthy()
  expect(screen.getByText('Delegate contract')).toBeTruthy()
  expect(screen.getByText('Address book · Saved contact')).toBeTruthy()
  const evidenceDisclosure = screen.getByRole('button', { name: /Delegation evidence/ })
  expect(evidenceDisclosure.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('button', { name: 'Copy delegation code hash' })).toBeNull()
  await user.click(evidenceDisclosure)
  expect(evidenceDisclosure.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Configured RPC · eth_getCode')).toBeTruthy()
  expect(screen.getByText('Transaction nonce').nextElementSibling.textContent).toBe('3')
  const accountCopy = screen.getByRole('button', { name: 'Copy account address' })
  const delegateCopy = screen.getByRole('button', { name: 'Copy current delegate address' })
  const codeHashCopy = screen.getByRole('button', { name: 'Copy delegation code hash' })

  await user.click(accountCopy)
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: account })
  await waitFor(() => expect(accountCopy.textContent).toContain('Copied'))
  await user.click(delegateCopy)
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: delegate })
  await waitFor(() => expect(delegateCopy.textContent).toContain('Copied'))
  await user.click(codeHashCopy)
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', {
    secret: false,
    value: req.evidence.codeHash
  })
  await waitFor(() => expect(codeHashCopy.textContent).toContain('Copied'))
  expect(document.body.textContent.toLowerCase()).not.toContain('authorization signature')
  expect(document.body.textContent.toLowerCase()).not.toContain('raw transaction')
})
