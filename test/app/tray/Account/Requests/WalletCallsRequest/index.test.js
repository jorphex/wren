import { cleanup, render, screen } from '../../../../../componentSetup'
import { WalletCallsRequest } from '../../../../../../app/tray/Account/Requests/WalletCallsRequest'
import { createWalletCallsDraft } from '../../../../../../app/tray/Account/Requests/WalletCallsRequest/adjustment'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({ send: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'
const quantity = (value) => `0x${BigInt(value).toString(16)}`

function request(calls) {
  return {
    handlerId: 'wallet-calls-request',
    type: 'walletCalls',
    account,
    chainId: '0x1',
    atomic: false,
    calls,
    preparation: { status: 'pending' },
    simulation: { status: 'pending', calls: [] }
  }
}

function preparedRequest() {
  const req = request([
    { to: target, value: '0x0', data: '0xa9059cbb' },
    { to: target, value: '0x1', data: '0x095ea7b3' }
  ])
  const fees = [21_000n * 1_000_000_000n, 50_000n * 2_000_000_000n]
  req.preparation = {
    status: 'succeeded',
    maxFee: quantity(fees[0] + fees[1]),
    calls: req.calls.map((call, index) => ({
      transaction: {
        from: account,
        chainId: '0x1',
        nonce: quantity(5 + index),
        type: '0x2',
        gasLimit: quantity(index ? 50_000 : 21_000),
        maxFeePerGas: quantity(index ? 2_000_000_000 : 1_000_000_000),
        maxPriorityFeePerGas: quantity(500_000_000),
        to: call.to,
        data: call.data,
        value: call.value
      },
      maxFee: quantity(fees[index])
    }))
  }
  req.simulation = {
    status: 'succeeded',
    source: 'eth_simulateV1',
    calls: req.calls.map(() => ({ status: 'succeeded', source: 'eth_simulateV1' }))
  }
  return req
}

beforeEach(() => link.send.mockReset())

it('shows the approved hierarchy, ordered call identities, values, and disclosed calldata', async () => {
  const req = preparedRequest()
  req.callDetails = [{ label: 'USD Coin (USDC)', source: 'Token contract', method: 'transfer' }, null]
  const { user } = render(
    <WalletCallsRequest
      accountName='Main account'
      originName='example.test'
      chainData={{ chainName: 'Ethereum', nativeCurrencySymbol: 'ETH', nativeCurrencyDecimals: 18 }}
      req={req}
    />
  )

  expect(screen.getByRole('heading', { name: 'Submit 2 transactions?' })).toBeTruthy()
  expect(screen.queryByText(/Wren will submit these calls in order/)).toBeNull()
  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText('Ethereum')).toBeTruthy()
  expect(screen.getByText('Main account')).toBeTruthy()
  expect(screen.getByText('USD Coin (USDC)')).toBeTruthy()
  expect(screen.getByText('transfer call')).toBeTruthy()
  expect(screen.getByText('Contract call')).toBeTruthy()
  expect(screen.getByText('Value · 0 ETH')).toBeTruthy()
  expect(screen.getByText('Value · <0.000001 ETH')).toBeTruthy()
  expect(screen.getByText('Gas limit · 21,000')).toBeTruthy()
  expect(screen.getByText('Gas limit · 50,000')).toBeTruthy()
  expect(screen.getByText('Max rate · 1 Gwei')).toBeTruthy()
  expect(screen.getByText('Max rate · 2 Gwei')).toBeTruthy()

  await user.click(screen.getAllByRole('button', { name: /Calldata · 4 bytes/i })[0])
  expect(screen.getByText('0xa9059cbb')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: /USD Coin.*0x2222/i }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', target)
  expect(screen.getByText('Address copied')).toBeTruthy()
})

it('shows full lookalike destinations with highlighted ends and an inline warning', () => {
  const req = preparedRequest()
  req.calls = [req.calls[0]]
  req.preparation.calls = [req.preparation.calls[0]]
  req.preparation.maxFee = req.preparation.calls[0].maxFee
  req.simulation.calls = [req.simulation.calls[0]]
  req.addressSafety = {
    assessedAt: 1,
    fingerprint: 'lookalike',
    targets: [{ address: target, state: 'lookalike' }]
  }
  render(
    <WalletCallsRequest
      originName='example.test'
      chainData={{ chainName: 'Ethereum', nativeCurrencySymbol: 'ETH', nativeCurrencyDecimals: 18 }}
      req={req}
    />
  )

  expect(screen.getByRole('alert').textContent).toContain(
    'Possible address poisoning. Verify the full address. Its first and last four characters match a destination you used before.'
  )
  expect(
    screen
      .getAllByText(/^(0x)?2222$/)
      .every((segment) => segment.classList.contains('clusterAddressLookalikeEnd'))
  ).toBe(true)
  expect(screen.getByLabelText(target).classList.contains('clusterAddressRecipientComplete')).toBe(true)
})

it('renders per-transaction and aggregate maximum fees and opens a separate editor', async () => {
  const req = preparedRequest()
  const { user } = render(
    <WalletCallsRequest
      originName='example.test'
      chainData={{ chainName: 'Ethereum', nativeCurrencySymbol: 'ETH', nativeCurrencyDecimals: 18 }}
      req={req}
    />
  )

  expect(screen.getByText('Total maximum network fees')).toBeTruthy()
  expect(screen.getByText('0.000121 ETH')).toBeTruthy()
  expect(screen.getByText('2 separate transactions')).toBeTruthy()
  expect(screen.getByText('0.000021 ETH')).toBeTruthy()
  expect(screen.getByText('0.0001 ETH')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: /Adjust/i }))
  expect(link.send).toHaveBeenCalledWith('nav:update', 'panel', {
    data: { step: 'adjustWalletCalls', walletCallsDraft: createWalletCallsDraft(req) }
  })
})

it('fails closed for failed, malformed, mismatched, or stale preparation', () => {
  const failed = request([{ to: target, value: '0x0', data: '0x' }])
  failed.preparation = { status: 'failed', reason: 'RPC fee lookup failed' }
  render(<WalletCallsRequest originName='example.test' req={failed} />)
  expect(screen.getByRole('alert').textContent).toMatch(/RPC fee lookup failed/)
  cleanup()

  const mismatched = preparedRequest()
  mismatched.preparation.calls[0].transaction.to = account
  render(<WalletCallsRequest originName='example.test' req={mismatched} />)
  expect(screen.getByRole('alert').textContent).toMatch(/no longer match/i)
  cleanup()

  const malformed = preparedRequest()
  malformed.preparation.maxFee = '0x02'
  render(<WalletCallsRequest originName='example.test' req={malformed} />)
  expect(screen.getByRole('alert').textContent).toMatch(/fee evidence is invalid/i)
})

it('warns about non-atomic partial execution only when there is more than one transaction', () => {
  render(
    <WalletCallsRequest
      originName='example.test'
      chainData={{ chainName: 'Ethereum' }}
      req={request([
        { to: target, value: '0x0', data: '0x' },
        { to: target, value: '0x1', data: '0x' }
      ])}
    />
  )

  expect(screen.getByText('Partial execution possible')).toBeTruthy()
  expect(screen.getByText(/earlier transaction can succeed/i)).toBeTruthy()
  expect(screen.queryByText('Submit Batch')).toBeNull()

  cleanup()
  render(
    <WalletCallsRequest
      originName='example.test'
      chainData={{ chainName: 'Ethereum' }}
      req={request([{ to: target, value: '0x0', data: '0x' }])}
    />
  )
  expect(screen.queryByText('Partial execution possible')).toBeNull()
})

it('blocks delegated-account submission and reports unavailable delegation checks', () => {
  const delegated = preparedRequest()
  delegated.simulation.delegation = {
    status: 'delegated',
    source: 'eth_getCode',
    account,
    delegate: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  }
  render(<WalletCallsRequest originName='example.test' req={delegated} />)
  expect(
    screen.getByText(/Wallet-call batches from delegated sending accounts are not supported/)
  ).toBeTruthy()
  cleanup()

  const unavailable = preparedRequest()
  unavailable.simulation.accountCodeEvidence = {
    source: 'configured-rpc',
    sender: {
      status: 'unavailable',
      role: 'sender',
      account,
      reason: 'Account code check timed out'
    },
    targets: []
  }
  render(<WalletCallsRequest originName='example.test' req={unavailable} />)
  expect(screen.getByText(/Sending account delegation check unavailable/)).toBeTruthy()
  expect(screen.getByText(/Account code check timed out/)).toBeTruthy()
  expect(screen.queryByText(/Wallet-call batches from delegated sending accounts/)).toBeNull()
})

it('shows delegated execution evidence on each affected target', async () => {
  const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const req = preparedRequest()
  req.simulation.accountCodeEvidence = {
    source: 'configured-rpc',
    sender: { status: 'no-code', role: 'sender', account },
    targets: [
      {
        status: 'delegated',
        role: 'target',
        account: target,
        callIndexes: [0, 1],
        delegate,
        delegateCodeStatus: 'contract'
      }
    ]
  }

  const { user } = render(<WalletCallsRequest originName='example.test' req={req} />)
  expect(screen.getAllByText(/Target delegates execution to/)).toHaveLength(2)
  expect(screen.getAllByRole('status')).toHaveLength(2)

  await user.click(screen.getAllByRole('button', { name: /Calldata/ })[0])
  expect(screen.getByText(new RegExp(`This call runs code from ${delegate}`))).toBeTruthy()
})

it('qualifies empty delegate bytecode instead of implying that execution is impossible', async () => {
  const delegate = '0x0000000000000000000000000000000000000001'
  const req = preparedRequest()
  req.simulation.accountCodeEvidence = {
    source: 'configured-rpc',
    sender: { status: 'no-code', role: 'sender', account },
    targets: [
      {
        status: 'delegated',
        role: 'target',
        account: target,
        callIndexes: [0],
        delegate,
        delegateCodeStatus: 'no-code'
      }
    ]
  }

  const { user } = render(<WalletCallsRequest originName='example.test' req={req} />)
  expect(screen.getByText(/RPC returned empty code/)).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: /Calldata/ })[0])
  expect(screen.getByText(/precompiles can execute without bytecode/i)).toBeTruthy()
})

it('keeps compact reverting-call evidence and qualified token effects', () => {
  const req = preparedRequest()
  req.simulation = {
    status: 'reverted',
    source: 'eth_simulateV1',
    calls: [
      {
        status: 'succeeded',
        source: 'eth_simulateV1',
        effects: [
          { type: 'transfer', standard: 'erc20', token: target, from: account, to: target, amount: '5' }
        ]
      },
      {
        status: 'reverted',
        source: 'eth_simulateV1',
        gasUsed: '0x5208',
        reason: 'execution reverted: denied'
      }
    ]
  }

  render(<WalletCallsRequest originName='example.test' req={req} />)
  expect(screen.getByText(/Simulation: reverted · gas used 21,000 · execution reverted: denied/)).toBeTruthy()
  expect(screen.getByText('ERC-20 Send')).toBeTruthy()
})

it('edits the batch nonce and transaction fee fields only in the draft', async () => {
  const req = preparedRequest()
  const draft = createWalletCallsDraft(req)
  const { user } = render(
    <WalletCallsRequest
      step='adjustWalletCalls'
      requestData={{ walletCallsDraft: draft }}
      originName='example.test'
      chainData={{ chainName: 'Ethereum', nativeCurrencySymbol: 'ETH', nativeCurrencyDecimals: 18 }}
      req={req}
    />
  )

  expect(screen.queryByText('Nonce 5')).toBeNull()
  expect(screen.queryByText('Nonce 6')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Decrease starting nonce' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Increase starting nonce' })).toBeNull()
  expect(screen.getAllByText('Gas limit')).toHaveLength(2)
  expect(screen.getAllByText('Max fee')).toHaveLength(2)
  expect(screen.getAllByText('Priority fee')).toHaveLength(2)
  expect(screen.queryByText('EIP-1559')).toBeNull()
  const startingNonce = screen.getByLabelText('Starting nonce')
  const gasLimit = screen.getAllByLabelText(/gas limit$/i)[0]
  const maxFee = screen.getAllByLabelText(/maximum fee per gas$/i)[0]
  const priorityFee = screen.getAllByLabelText(/priority fee$/i)[0]

  expect(startingNonce.classList.contains('wrenInput')).toBe(true)
  expect(gasLimit.classList.contains('wrenInput')).toBe(true)
  expect(maxFee.classList.contains('wrenInput')).toBe(true)
  expect(maxFee.parentElement.classList.contains('wrenInputGroup')).toBe(true)
  expect(priorityFee.classList.contains('wrenInput')).toBe(true)
  expect(priorityFee.parentElement.classList.contains('wrenInputGroup')).toBe(true)

  await user.clear(startingNonce)
  await user.type(startingNonce, '9')

  expect(req.preparation.calls[0].transaction.nonce).toBe('0x5')
  expect(link.send).toHaveBeenLastCalledWith(
    'nav:update',
    'panel',
    expect.objectContaining({ data: expect.objectContaining({ walletCallsAdjustmentError: '' }) }),
    false
  )
})
