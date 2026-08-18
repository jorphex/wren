import { screen, render } from '../../../../componentSetup'
import { WalletCallsStatus } from '../../../../../app/tray/Account/WalletCallsStatus'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({ invoke: jest.fn(), send: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const transactionHash = `0x${'a'.repeat(64)}`

const status = (overrides = {}) => ({
  version: '2.0.0',
  id: 'batch-id',
  chainId: '0x1',
  status: 100,
  atomic: false,
  ...overrides
})

beforeEach(() => {
  link.invoke.mockReset()
  link.send.mockReset()
})

it('renders pending batch identity without approval controls', () => {
  render(
    <WalletCallsStatus
      accountId={account}
      accountName='Workshop'
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status()}
    />
  )

  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText('Ethereum · 1')).toBeTruthy()
  expect(screen.getByTitle(account)).toBeTruthy()
  expect(screen.getByText(/Workshop · 0x111111/)).toBeTruthy()
  expect(screen.getByTitle('batch-id')).toBeTruthy()
  expect(screen.getByText('Pending')).toBeTruthy()
  expect(screen.getByText(/Non-atomic:/i)).toBeTruthy()
  expect(screen.getByText(/Receipts will appear/i)).toBeTruthy()
  expect(screen.queryByText('Approve')).toBeNull()
  expect(screen.queryByText('Submit Batch')).toBeNull()
})

it.each([
  [200, 'Confirmed'],
  [400, 'Failed'],
  [500, 'Reverted'],
  [600, 'Partially executed']
])('renders status %i as %s', (code, label) => {
  render(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status({ status: code })}
    />
  )

  expect(screen.getByText(label)).toBeTruthy()
})

it('renders bounded transaction evidence in receipt order', () => {
  render(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status({
        status: 600,
        receipts: [
          {
            status: '0x1',
            type: '0x2',
            blockNumber: '0x10',
            gasUsed: '0x5208',
            effectiveGasPrice: '0x3b9aca00',
            transactionHash
          },
          {
            status: '0x0',
            blockNumber: '0x11',
            gasUsed: '0x42',
            transactionHash: `0x${'b'.repeat(64)}`
          }
        ]
      })}
    />
  )

  expect(screen.getByText('Transaction 1')).toBeTruthy()
  expect(screen.getByText('Transaction 2')).toBeTruthy()
  expect(screen.getByText('0xaaaaaaaa…aaaaaaaa')).toBeTruthy()
  expect(screen.getByText('16')).toBeTruthy()
  expect(screen.getByText('21,000')).toBeTruthy()
  expect(screen.getByText('0.000021 ETH')).toBeTruthy()
  expect(screen.getByText(/EIP-1559 effective rate/)).toBeTruthy()
  expect(screen.getByText('Confirmed')).toBeTruthy()
  expect(screen.getByText('Reverted')).toBeTruthy()
})

it('renders persisted partial Sweep counts without implying unsent calls resume', () => {
  render(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='Wren Send'
      status={status({
        status: 600,
        callCount: 3,
        submittedCount: 1,
        confirmedCount: 1,
        receipts: []
      })}
    />
  )

  expect(
    screen.getByText(
      '1 of 3 submitted; 1 confirmed; 2 not submitted. Unsent calls do not resume automatically.'
    )
  ).toBeTruthy()
  expect(screen.queryByText(/Transaction 1/)).toBeNull()
})

it('keeps generic external Wallet Calls status copy when persisted counts are absent or invalid', () => {
  const { rerender } = render(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status({ status: 600 })}
    />
  )
  expect(
    screen.getByText('Some transactions succeeded while others reverted or were not submitted.')
  ).toBeTruthy()

  rerender(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status({ status: 600, callCount: 1, submittedCount: 2, confirmedCount: 2 })}
    />
  )
  expect(
    screen.getByText('Some transactions succeeded while others reverted or were not submitted.')
  ).toBeTruthy()

  rerender(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status({ status: 600, callCount: 0, submittedCount: 0, confirmedCount: 0 })}
    />
  )
  expect(
    screen.getByText('Some transactions succeeded while others reverted or were not submitted.')
  ).toBeTruthy()

  rerender(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      originName='example.test'
      status={status({ status: 600, callCount: 17, submittedCount: 1, confirmedCount: 1 })}
    />
  )
  expect(
    screen.getByText('Some transactions succeeded while others reverted or were not submitted.')
  ).toBeTruthy()
})

it('does not present an unknown status as pending and only rereads it on refresh', async () => {
  link.invoke.mockResolvedValueOnce({ success: true })
  const unknown = status({ status: 999 })
  const { user } = render(
    <WalletCallsStatus
      accountId={account}
      chainName='Ethereum'
      nativeCurrency={{ symbol: 'ETH', decimals: 18 }}
      origin='example.test'
      originName='example.test'
      status={unknown}
    />
  )

  expect(screen.getByText('Status unavailable')).toBeTruthy()
  expect(screen.getByText('Wren cannot verify the current status of this wallet call.')).toBeTruthy()
  expect(screen.queryByText('Pending')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(link.invoke).toHaveBeenCalledWith('tray:refreshWalletCallsStatus', {
    account,
    id: unknown.id,
    origin: 'example.test'
  })
  expect(link.send).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(link.send).toHaveBeenCalledWith('nav:back', 'panel')
})
