import Restore from 'react-restore'

import { canApproveWalletCalls, Footer } from '../../../../app/tray/Footer'
import { render, screen } from '../../../componentSetup'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

beforeEach(() => {
  link.rpc.mockReset()
  link.send.mockReset()
})

let resizeCallback
const disconnectResizeObserver = jest.fn()

beforeAll(() => {
  global.ResizeObserver = class {
    constructor(callback) {
      resizeCallback = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {
      disconnectResizeObserver()
    }
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

const request = (overrides = {}) => ({
  type: 'walletCalls',
  handlerId: 'wallet-call-request',
  simulation: { status: 'succeeded' },
  preparation: { status: 'succeeded' },
  ...overrides
})

const renderRequestFooter = (req, signerType = 'ledger') => {
  const account = req.account || '0x0000000000000000000000000000000000000001'
  const store = Restore.create(
    {
      main: {
        accounts: {
          [account]: { lastSignerType: signerType, requests: { [req.handlerId]: req } }
        }
      },
      windows: {
        panel: {
          footer: { height: 80 },
          nav: [
            {
              view: 'requestView',
              data: { accountId: account, requestId: req.handlerId, step: 'confirm' }
            }
          ]
        }
      }
    },
    {}
  )
  const ConnectedFooter = Restore.connect(Footer, store)
  return render(<ConnectedFooter />)
}

it('allows a fully reviewed wallet-call batch to be submitted', () => {
  expect(canApproveWalletCalls(request(), undefined, 'ledger')).toBe(true)
})

it('blocks wallet-call submission for watch-only or unknown account types', () => {
  expect(canApproveWalletCalls(request(), undefined, 'address')).toBe(false)
  expect(canApproveWalletCalls(request(), undefined, 'Address')).toBe(false)
  expect(canApproveWalletCalls(request())).toBe(false)
})

it('blocks only the wallet-call request with an action already in flight', () => {
  const pending = request({ handlerId: 'pending-request' })
  const next = request({ handlerId: 'next-request' })

  expect(canApproveWalletCalls(pending, 'pending-request', 'ledger')).toBe(false)
  expect(canApproveWalletCalls(next, 'pending-request', 'ledger')).toBe(true)
})

it.each([
  ['missing simulation', { simulation: undefined }],
  ['pending simulation', { simulation: { status: 'pending' } }],
  ['delegated sender', { simulation: { status: 'succeeded', delegation: { status: 'delegated' } } }],
  ['pending preparation', { preparation: { status: 'pending' } }],
  ['failed preparation', { preparation: { status: 'failed', reason: 'unavailable' } }],
  ['claimed request', { locked: true }],
  ['request with status', { status: 'error' }],
  ['different request type', { type: 'transaction' }]
])('blocks submission for %s', (_label, overrides) => {
  expect(canApproveWalletCalls(request(overrides), undefined, 'ledger')).toBe(false)
})

it('exposes native wallet-call decisions and locks actions once submitted', async () => {
  const req = request({ account: '0x0000000000000000000000000000000000000001' })
  const { user } = renderRequestFooter(req)
  const decline = screen.getByRole('button', { name: 'Decline' })
  const submit = screen.getByRole('button', { name: 'Submit Batch' })

  expect(decline.disabled).toBe(false)
  expect(submit.disabled).toBe(false)
  await user.click(submit)

  expect(link.rpc).toHaveBeenCalledWith('approveRequest', req, expect.any(Function))
  expect(decline.disabled).toBe(true)
  expect(submit.disabled).toBe(true)
})

it('renders watch-only wallet-call submission as a disabled native button', () => {
  renderRequestFooter(request(), 'address')

  expect(screen.getByRole('button', { name: 'Decline' }).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'Watch-only' }).disabled).toBe(true)
})

it.each([
  ['access', 'Approve', ['tray:giveAccess', expect.anything(), true]],
  [
    'addChain',
    'Review',
    [
      'tray:action',
      'navDash',
      expect.objectContaining({
        view: 'chains',
        data: expect.objectContaining({
          requestReference: expect.objectContaining({ handlerId: 'native-footer-action' })
        })
      })
    ]
  ]
])('routes the native %s review action without changing its payload', async (type, label, expected) => {
  const req = {
    type,
    handlerId: 'native-footer-action',
    account: '0x0000000000000000000000000000000000000001',
    chain: { id: 8453 }
  }
  const { user } = renderRequestFooter(req)

  await user.keyboard('{Tab}')
  await user.keyboard('{Tab}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: label }))
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith(...expected)
})

describe('asset suggestion lifecycle', () => {
  const account = '0x0000000000000000000000000000000000000001'
  const handlerId = '11111111-1111-4111-8111-111111111111'
  const assetRequest = {
    type: 'addToken',
    handlerId,
    account,
    token: {
      address: '0x0000000000000000000000000000000000000002',
      chainId: 1,
      decimals: 6,
      logoURI: '',
      name: 'Test Token',
      symbol: 'TEST'
    }
  }

  const renderFooter = () => {
    return renderRequestFooter(assetRequest, 'address')
  }

  it('declines once through the asset-suggestion lifecycle', async () => {
    const { user } = renderFooter()

    await user.click(screen.getByRole('button', { name: 'Decline' }))

    expect(link.send.mock.calls.filter(([channel]) => channel === 'tray:addToken')).toEqual([
      ['tray:addToken', false, { account, handlerId }]
    ])
    expect(link.send).not.toHaveBeenCalledWith('tray:rejectRequest', expect.anything())
  })

  it('keeps the suggestion pending while opening token review', async () => {
    const { user } = renderFooter()

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          address: assetRequest.token.address,
          chain: { id: 1 },
          requestReference: { account, handlerId },
          tokenData: {
            decimals: 6,
            logoURI: '',
            name: 'Test Token',
            symbol: 'TEST'
          }
        }
      }
    })
    expect(link.send).not.toHaveBeenCalledWith('tray:resolveRequest', expect.anything(), null)
  })

  it('reports each footer height once and disconnects its observer', () => {
    const view = renderFooter()
    link.send.mockClear()

    resizeCallback()
    resizeCallback()

    expect(
      link.send.mock.calls.filter(
        ([channel, action]) => channel === 'tray:action' && action === 'setFooterHeight'
      )
    ).toEqual([['tray:action', 'setFooterHeight', 'panel', 0]])

    view.unmount()
    expect(disconnectResizeObserver).toHaveBeenCalled()
  })
})

it('keys request commands by request identity', () => {
  const account = '0x0000000000000000000000000000000000000001'
  const handlerId = '22222222-2222-4222-8222-222222222222'
  const req = { type: 'sign', account, handlerId }
  const footer = new Footer({})
  footer.store = (...path) => {
    if (path[0] === 'windows.panel.nav') {
      return [{ view: 'requestView', data: { accountId: account, requestId: handlerId, step: 'confirm' } }]
    }
    if (path[0] === 'main.accounts' && path.length === 2) return { lastSignerType: 'seed' }
    if (path[0] === 'main.accounts' && path.length === 4) return req
    return undefined
  }

  expect(footer.renderFooter().key).toBe(handlerId)
})
