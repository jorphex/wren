import {
  Deployment,
  connectedDeploymentNetworks,
  eligibleDeploymentAccounts,
  nativeQuantity
} from '../../../../app/dash/Deployment'
import { requestDashNavigation } from '../../../../app/dash/navigationGuard'
import { prepareDeployment, queueDeployment } from '../../../../app/dash/Deployment/api'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../app/dash/Deployment/api', () => ({
  deploymentByteCount: jest.requireActual('../../../../app/dash/Deployment/api').deploymentByteCount,
  prepareDeployment: jest.fn(),
  queueDeployment: jest.fn(),
  validateCreationData: jest.requireActual('../../../../app/dash/Deployment/api').validateCreationData,
  validateNativeValue: jest.requireActual('../../../../app/dash/Deployment/api').validateNativeValue
}))
jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const hardware = '0x2222222222222222222222222222222222222222'
const watch = '0x3333333333333333333333333333333333333333'
const missingSigner = '0x4444444444444444444444444444444444444444'

const signers = {
  local: { id: 'local', type: 'ring', status: 'locked' },
  ledger: { id: 'ledger', type: 'ledger', status: 'need pin' }
}

const accounts = {
  [account]: {
    id: account,
    address: account,
    name: 'Workshop',
    status: 'ok',
    signer: 'local',
    lastSignerType: 'ring'
  },
  [hardware]: {
    id: hardware,
    address: hardware,
    name: 'Ledger',
    status: 'ok',
    signer: 'ledger',
    lastSignerType: 'ledger'
  },
  [watch]: {
    id: watch,
    address: watch,
    name: 'Watch',
    status: 'ok',
    lastSignerType: 'address'
  },
  [missingSigner]: {
    id: missingSigner,
    address: missingSigner,
    name: 'Missing',
    status: 'ok',
    signer: 'gone',
    lastSignerType: 'seed'
  }
}

const networks = {
  1: {
    id: 1,
    name: 'Ethereum',
    on: true,
    connection: { endpoints: [{ connected: true }] }
  },
  10: {
    id: 10,
    name: 'Offline',
    on: true,
    connection: { endpoints: [{ connected: false }] }
  },
  8453: {
    id: 8453,
    name: 'Disabled',
    on: false,
    connection: { endpoints: [{ connected: true }] }
  }
}

const networksMeta = {
  1: { nativeCurrency: { decimals: 18, symbol: 'ETH' } },
  10: { nativeCurrency: { decimals: 18, symbol: 'ETH' } },
  8453: { nativeCurrency: { decimals: 18, symbol: 'ETH' } }
}

const inspection = {
  id: '11111111111111111111111111111111',
  preparedAt: 1_700_000_000_000,
  expiresAt: 1_700_000_060_000,
  account,
  chainId: '0x1',
  initcode: { bytes: 2, hash: `0x${'ab'.repeat(32)}` },
  value: '0x3782dace9d90000',
  gasEstimate: { status: 'succeeded', value: '0x5208', padded: true },
  simulation: { status: 'succeeded', advancedChecks: 'complete' },
  pendingNonce: {
    status: 'succeeded',
    nonce: '0x2',
    provisionalAddress: '0x5555555555555555555555555555555555555555'
  }
}

const props = (overrides = {}) => ({
  accounts,
  signers,
  currentAccount: account,
  networks,
  networksMeta,
  ...overrides
})

const fillDraft = () => {
  fireEvent.change(screen.getByLabelText('Deployment data'), { target: { value: '0x6000' } })
  fireEvent.change(screen.getByLabelText(/Optional native value/), { target: { value: '0.25' } })
}

beforeEach(() => {
  prepareDeployment.mockReset()
  queueDeployment.mockReset()
  link.rpc.mockReset()
  link.send.mockReset()
  prepareDeployment.mockResolvedValue({ success: true, inspection })
  queueDeployment.mockResolvedValue({ success: true, handlerId: 'deployment-request-1' })
})

it('includes locked software and hardware signers but excludes watch-only and missing associations', () => {
  expect(eligibleDeploymentAccounts(accounts, signers).map((item) => item.id)).toEqual([account, hardware])
  expect(connectedDeploymentNetworks(networks, networksMeta)).toEqual([
    { id: 1, name: 'Ethereum', symbol: 'ETH', decimals: 18 }
  ])

  render(<Deployment {...props()} />)
  const accountOptions = [...screen.getByLabelText('Account').options].map((option) => option.textContent)
  expect(accountOptions).toEqual(['Workshop · 0x111111…111111', 'Ledger · 0x222222…222222'])
  expect(screen.getByLabelText('Network').options).toHaveLength(1)
})

it('formats exact RPC quantities as user-readable native values', () => {
  expect(nativeQuantity('0xde0b6b3a7640000', 18, 'ETH')).toBe('1 ETH')
  expect(nativeQuantity('0x1', 18, 'ETH')).toBe('0.000000000000000001 ETH')
  expect(nativeQuantity('invalid', 18, 'ETH')).toBe('Unavailable')
})

it('disables preparation when the selected signer association disappears before checking', () => {
  const view = render(<Deployment {...props()} />)
  expect(screen.getByRole('button', { name: 'Check deployment' }).disabled).toBe(false)

  view.rerender(<Deployment {...props({ signers: { ledger: signers.ledger } })} />)

  expect(screen.getByLabelText('Account').value).toBe('')
  expect(screen.getByRole('button', { name: 'Check deployment' }).disabled).toBe(true)
  expect(screen.getByText('Select a signer-capable account to continue.')).toBeTruthy()
})

it('disables preparation when the selected configured network disconnects before checking', () => {
  const view = render(<Deployment {...props()} />)
  expect(screen.getByRole('button', { name: 'Check deployment' }).disabled).toBe(false)

  view.rerender(
    <Deployment
      {...props({
        networks: {
          ...networks,
          1: { ...networks[1], connection: { endpoints: [{ connected: false }] } }
        }
      })}
    />
  )

  expect(screen.getByLabelText('Network').value).toBe('')
  expect(screen.getByRole('button', { name: 'Check deployment' }).disabled).toBe(true)
  expect(screen.getByText('Connect and select a configured network to continue.')).toBeTruthy()
})

it('changes Wren’s active account and updates the controlled selection only after success', async () => {
  let respond
  link.rpc.mockImplementation((method, selected, callback) => {
    expect(method).toBe('setSigner')
    expect(selected).toBe(hardware)
    respond = callback
  })
  render(<Deployment {...props()} />)
  const select = screen.getByLabelText('Account')

  fireEvent.change(select, { target: { value: hardware } })
  expect(link.rpc).toHaveBeenCalledWith('setSigner', hardware, expect.any(Function))
  expect(select.value).toBe(account)

  act(() => respond(null))
  expect(select.value).toBe(hardware)
  expect(screen.getByRole('button', { name: 'Check deployment' }).disabled).toBe(true)
})

it('renders tailored validation with shared input semantics', async () => {
  const { user } = render(<Deployment {...props()} />)
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))
  expect(screen.getByText('Deployment data is required.')).toBeTruthy()
  expect(screen.getByLabelText('Deployment data').getAttribute('aria-invalid')).toBe('true')

  fireEvent.change(screen.getByLabelText('Deployment data'), { target: { value: '0x60z0' } })
  fireEvent.change(screen.getByLabelText(/Optional native value/), { target: { value: '-1' } })
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))
  expect(screen.getByText(/only hexadecimal characters/i)).toBeTruthy()
  expect(screen.getByText(/non-negative decimal value/i)).toBeTruthy()
  expect(prepareDeployment).not.toHaveBeenCalled()
})

it('prepares the exact draft and renders authoritative success evidence', async () => {
  const { user } = render(<Deployment {...props()} />)
  fillDraft()
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))

  expect(prepareDeployment).toHaveBeenCalledWith({
    account,
    chainId: 1,
    initcode: '0x6000',
    value: '0.25'
  })
  expect(await screen.findByRole('heading', { name: 'Check results' })).toBeTruthy()
  expect(screen.getByText(/Value 0.25 ETH · Canonical 0x3782dace9d90000 · Chain 1/)).toBeTruthy()
  expect(screen.getByText('2 bytes')).toBeTruthy()
  expect(screen.getByText(`0x${'ab'.repeat(32)}`)).toBeTruthy()
  expect(screen.getByText('21,000 gas · includes gas buffer')).toBeTruthy()
  expect(screen.getByText(/Simulation is evidence only/)).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.getByText(/Provisional address\. It can change/)).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Check results' }).parentElement)
})

it('confirms Back or Escape navigation before discarding a non-empty deployment', async () => {
  const view = render(<Deployment {...props()} />)
  fillDraft()
  const navigate = jest.fn()

  let navigated
  act(() => {
    navigated = requestDashNavigation('back', navigate)
  })
  expect(navigated).toBe(false)
  expect(screen.getByRole('alertdialog', { name: 'Discard this deployment?' })).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()

  await view.user.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByLabelText('Deployment data').value).toBe('0x6000')

  act(() => requestDashNavigation('close', navigate))
  await view.user.click(screen.getByRole('button', { name: 'Discard and leave' }))
  expect(navigate).toHaveBeenCalledTimes(1)
})

it('does not intercept Back or Escape while the mounted deployment workspace is inactive', () => {
  const view = render(<Deployment {...props({ active: true })} />)
  fillDraft()
  view.rerender(<Deployment {...props({ active: false })} />)
  const navigate = jest.fn()

  expect(requestDashNavigation('back', navigate)).toBe(true)
  expect(navigate).toHaveBeenCalledTimes(1)
  expect(requestDashNavigation('close', navigate)).toBe(true)
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alertdialog', { name: 'Discard this deployment?' })).toBeNull()
})

it.each([
  ['reverted', 'Simulation reverted. Check the data and network state.'],
  ['unavailable', 'Simulation unavailable. Check your RPC or continue without simulation.'],
  ['failed', 'Simulation unavailable. Check your RPC or continue without simulation.']
])('keeps review available when simulation is %s', async (status, message) => {
  prepareDeployment.mockResolvedValue({
    success: true,
    inspection: {
      ...inspection,
      gasEstimate: { status: 'unavailable' },
      simulation: { status },
      pendingNonce: { status: 'unavailable' }
    }
  })
  const { user } = render(<Deployment {...props()} />)
  fillDraft()
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))

  expect(await screen.findByText(message)).toBeTruthy()
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Review deployment' }).disabled).toBe(false)
  expect(screen.queryByText('Provisional CREATE address')).toBeNull()
})

it('invalidates frozen evidence after an edit', async () => {
  const { user } = render(<Deployment {...props()} />)
  fillDraft()
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))
  expect(await screen.findByText('Check results')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Edit and recheck' }))
  expect(screen.queryByText('Check results')).toBeNull()
  expect(screen.getByText(/changed\. Check deployment again/)).toBeTruthy()
  expect(screen.getByLabelText('Deployment data').value).toBe('0x6000')
})

it('ignores a stale preparation response after account context changes', async () => {
  let resolvePreparation
  prepareDeployment.mockReturnValue(
    new Promise((resolve) => {
      resolvePreparation = resolve
    })
  )
  const view = render(<Deployment {...props()} />)
  fillDraft()
  fireEvent.click(screen.getByRole('button', { name: 'Check deployment' }))
  expect(screen.getByText('Checking…')).toBeTruthy()

  view.rerender(<Deployment {...props({ currentAccount: hardware })} />)
  await act(async () => resolvePreparation({ success: true, inspection }))

  expect(screen.queryByText('Check results')).toBeNull()
})

it('queues the frozen draft and hands the request to native review', async () => {
  const { user } = render(<Deployment {...props()} />)
  fillDraft()
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))
  await user.click(await screen.findByRole('button', { name: 'Review deployment' }))

  const draft = { account, chainId: 1, initcode: '0x6000', value: '0.25' }
  expect(queueDeployment).toHaveBeenCalledWith(inspection.id, draft)
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'closeDash'],
    [
      'nav:forward',
      'panel',
      {
        view: 'requestView',
        data: { step: 'confirm', accountId: account, requestId: 'deployment-request-1' }
      }
    ]
  ])
})

it.each(['queue-unavailable', 'inspection-expired', 'inspection-unavailable'])(
  'consumes stale evidence and focuses a bounded retry alert for %s',
  async (error) => {
    queueDeployment.mockResolvedValue({ success: false, error })
    const { user } = render(<Deployment {...props()} />)
    fillDraft()
    await user.click(screen.getByRole('button', { name: 'Check deployment' }))
    await user.click(await screen.findByRole('button', { name: 'Review deployment' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Could not queue native review. Nothing was signed or broadcast. Run “Check deployment” again.'
    )
    expect(document.activeElement).toBe(alert)
    expect(screen.queryByText('Check results')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check deployment' })).toBeTruthy()
    expect(link.send).not.toHaveBeenCalled()
  }
)

it('explains when a deployment is already awaiting review on another network', async () => {
  queueDeployment.mockResolvedValue({ success: false, error: 'deployment-pending' })
  const { user } = render(<Deployment {...props()} />)
  fillDraft()
  await user.click(screen.getByRole('button', { name: 'Check deployment' }))
  await user.click(await screen.findByRole('button', { name: 'Review deployment' }))

  expect((await screen.findByRole('alert')).textContent).toBe(
    'A deployment is already waiting for review on another network. Finish or decline it, then check this deployment again.'
  )
})

it('keeps only format-sensitive field guidance and exposes polite busy status', async () => {
  let resolvePreparation
  prepareDeployment.mockReturnValue(new Promise((resolve) => (resolvePreparation = resolve)))
  render(<Deployment {...props()} />)
  fillDraft()
  fireEvent.click(screen.getByRole('button', { name: 'Check deployment' }))

  expect(screen.getByLabelText('Deployment data').getAttribute('aria-describedby')).toContain(
    'deployment-initcode-helper'
  )
  expect(screen.getByLabelText('Account').hasAttribute('aria-describedby')).toBe(false)
  expect(screen.getByLabelText('Network').hasAttribute('aria-describedby')).toBe(false)
  expect(screen.getByLabelText('Optional native value').getAttribute('aria-describedby')).toBe(
    'deployment-value-error'
  )
  expect(screen.getByRole('status').textContent).toBe('Checking…')
  expect(screen.getByLabelText('Deployment data').disabled).toBe(true)

  await act(async () => resolvePreparation({ success: true, inspection }))
  expect(await screen.findByText('Check results')).toBeTruthy()
})
