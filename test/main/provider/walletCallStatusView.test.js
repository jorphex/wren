import store from '../../../main/store'
import windows from '../../../main/windows'
import {
  createWalletCallStatusViewData,
  showWalletCallStatus
} from '../../../main/provider/walletCallStatusView'

jest.mock('../../../main/store', () => ({
  __esModule: true,
  default: { showWalletCallsStatus: jest.fn() }
}))
jest.mock('../../../main/windows', () => ({
  __esModule: true,
  default: { showTray: jest.fn() }
}))

const hash = (character) => `0x${character.repeat(64)}`

const input = () => ({
  account: '0x1111111111111111111111111111111111111111',
  originName: 'example.test',
  status: {
    version: '2.0.0',
    id: 'batch-id',
    chainId: '0x1',
    status: 200,
    atomic: false,
    receipts: [
      {
        status: '0x1',
        type: '0x2',
        blockHash: hash('a'),
        blockNumber: '0x10',
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3b9aca00',
        transactionHash: hash('b'),
        logs: [
          {
            address: '0x2222222222222222222222222222222222222222',
            data: `0x${'ab'.repeat(1024)}`,
            topics: [hash('c')]
          }
        ]
      }
    ]
  }
})

beforeEach(() => {
  store.showWalletCallsStatus.mockClear()
  windows.showTray.mockClear()
})

it('creates a bounded presentation without receipt logs or block hashes', () => {
  const data = createWalletCallStatusViewData(input())

  expect(data).toEqual({
    accountId: '0x1111111111111111111111111111111111111111',
    originName: 'example.test',
    status: {
      version: '2.0.0',
      id: 'batch-id',
      chainId: '0x1',
      status: 200,
      atomic: false,
      receipts: [
        {
          status: '0x1',
          type: '0x2',
          blockNumber: '0x10',
          gasUsed: '0x5208',
          effectiveGasPrice: '0x3b9aca00',
          transactionHash: hash('b')
        }
      ]
    }
  })
  expect(JSON.stringify(data)).not.toContain('abababab')
  expect(JSON.stringify(data)).not.toContain(hash('a'))
})

it('updates navigation before summoning the tray', () => {
  const order = []
  store.showWalletCallsStatus.mockImplementation(() => order.push('state'))
  windows.showTray.mockImplementation(() => order.push('tray'))

  showWalletCallStatus(input())

  expect(store.showWalletCallsStatus).toHaveBeenCalledWith(
    '0x1111111111111111111111111111111111111111',
    expect.objectContaining({ originName: 'example.test' })
  )
  expect(order).toEqual(['state', 'tray'])
})
