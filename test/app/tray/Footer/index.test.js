import Restore from 'react-restore'

import { canApproveWalletCalls, Footer } from '../../../../app/tray/Footer'
import { render, screen } from '../../../componentSetup'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({
  invoke: jest.fn(),
  rpc: jest.fn(),
  send: jest.fn()
}))

beforeEach(() => {
  link.rpc.mockReset()
  link.send.mockReset()
  link.invoke.mockReset()
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
  calls: [{ to: '0x2222222222222222222222222222222222222222', value: '0x0', data: '0x' }],
  simulation: { status: 'succeeded' },
  preparation: { status: 'succeeded' },
  ...overrides
})

const renderRequestFooter = (req, signerType = 'ledger', crumbData = {}) => {
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
              data: { accountId: account, requestId: req.handlerId, step: 'confirm', ...crumbData }
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

it('requires an explicit acknowledgement before a failed simulation can be submitted', () => {
  const failed = request({ simulation: { status: 'failed' } })

  expect(canApproveWalletCalls(failed, undefined, 'ledger')).toBe(false)
  expect(canApproveWalletCalls(failed, undefined, 'ledger', true)).toBe(true)
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

it.each([
  [
    'failed',
    'Simulation failed',
    'Wren could not verify what this wallet call may do. Review the call details before deciding.'
  ],
  [
    'reverted',
    'Simulation reverted',
    'The simulated call reverted. The result may differ from an onchain submission.'
  ],
  ['unavailable', 'Simulation unavailable', 'Wren could not run a simulation for this wallet call.']
])('guards a %s simulation with a separate acknowledgement', async (status, title, detail) => {
  const req = request({
    account: '0x0000000000000000000000000000000000000001',
    simulation: { status }
  })
  const { user } = renderRequestFooter(req)

  await user.click(screen.getByRole('button', { name: 'Submit Batch' }))

  expect(screen.getByText(title)).toBeTruthy()
  expect(screen.getByText(detail)).toBeTruthy()
  const acknowledgement = screen.getByRole('checkbox', {
    name: 'I understand this batch is not simulation-confirmed and want to continue.'
  })
  const proceed = screen.getByRole('button', { name: 'Continue without simulation' })
  expect(document.activeElement).toBe(acknowledgement)
  expect(proceed.disabled).toBe(true)
  expect(link.rpc).not.toHaveBeenCalled()

  await user.click(acknowledgement)
  expect(proceed.disabled).toBe(false)
  await user.click(proceed)

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith(
    'approveRequest',
    req,
    { walletCallsSimulationAcknowledged: true },
    expect.any(Function)
  )
})

it('returns from the simulation acknowledgement without submitting', async () => {
  const { user } = renderRequestFooter(request({ simulation: { status: 'failed' } }))
  const submit = screen.getByRole('button', { name: 'Submit Batch' })

  await user.click(submit)
  await user.click(screen.getByRole('button', { name: 'Back' }))

  expect(screen.queryByText('Simulation failed')).toBeNull()
  expect(screen.getByRole('button', { name: 'Submit Batch' })).toBe(document.activeElement)
  expect(link.rpc).not.toHaveBeenCalled()
})

it('clears acknowledgement when a fresh simulation replaces its evidence', () => {
  const previousSimulation = { status: 'failed' }
  const acknowledgement = {
    checked: true,
    handlerId: 'wallet-call-request',
    simulation: previousSimulation
  }
  const footer = new Footer({})
  footer.state.walletCallsAcknowledgement = acknowledgement
  footer.setState = jest.fn()
  footer.store = jest.fn((...path) => {
    if (path.join('.') === 'windows.panel.nav') {
      return [{ data: { accountId: '0x0000000000000000000000000000000000000001' } }]
    }
    return { simulation: { status: 'failed' } }
  })

  footer.componentDidUpdate({}, { walletCallsAcknowledgement: acknowledgement })

  expect(footer.setState).toHaveBeenCalledWith({ walletCallsAcknowledgement: undefined })
})

it('renders neutral terminal feedback after declining a wallet call', async () => {
  const { user } = renderRequestFooter(request({ status: 'declined' }))

  expect(screen.getByText('Request declined')).toBeTruthy()
  expect(screen.getByText('You declined this wallet call. Nothing was submitted.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Submit Batch' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(link.send).toHaveBeenCalledWith('nav:back', 'panel')
})

it('renders watch-only wallet-call submission as a disabled native button', () => {
  renderRequestFooter(request(), 'address')

  expect(screen.getByRole('button', { name: 'Decline' }).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'Watch-only' }).disabled).toBe(true)
})

it('applies a valid wallet-call draft through the bounded IPC action', async () => {
  const account = '0x0000000000000000000000000000000000000001'
  const req = request({
    account,
    chainId: '0x1',
    preparation: {
      status: 'succeeded',
      maxFee: '0x52080',
      calls: [
        {
          transaction: {
            nonce: '0x5',
            type: '0x2',
            gasLimit: '0x5208',
            maxFeePerGas: '0x10',
            maxPriorityFeePerGas: '0x1'
          },
          maxFee: '0x52080'
        }
      ]
    }
  })
  const walletCallsDraft = {
    startingNonce: '9',
    calls: [{ mode: 'eip1559', gasLimit: '24576', maxFeePerGas: '32', maxPriorityFeePerGas: '2' }]
  }
  link.invoke.mockResolvedValueOnce({ success: true })
  const { user } = renderRequestFooter(req, 'ledger', {
    step: 'adjustWalletCalls',
    walletCallsDraft
  })

  await user.click(screen.getByRole('button', { name: 'Apply changes' }))

  expect(link.invoke).toHaveBeenCalledWith('tray:adjustWalletCalls', {
    account,
    handlerId: req.handlerId,
    adjustment: {
      startingNonce: '0x9',
      calls: [{ gasLimit: '0x6000', maxFeePerGas: '0x773594000', maxPriorityFeePerGas: '0x77359400' }]
    }
  })
  expect(link.send).toHaveBeenCalledWith('nav:back', 'panel')
})

it.each([
  ['access', 'Allow access', ['tray:giveAccess', expect.anything(), true]],
  [
    'addChain',
    'Review network',
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

    await user.click(screen.getByRole('button', { name: 'Review token' }))

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
