import link from '../../../../resources/link'
import { Inspector } from '../../../../app/dash/Inspector'
import { inspectReadOnlyInput } from '../../../../app/dash/Inspector/api'
import { fireEvent, render, screen, waitFor } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ invoke: jest.fn(), send: jest.fn() }))

const inspection = {
  kind: 'transaction',
  source: 'direct',
  normalized: {
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    chainId: '0x1',
    value: '0x0',
    data: '0xa9059cbb'
  },
  decode: {
    status: 'decoded',
    source: 'bundled-abi',
    selector: '0xa9059cbb',
    method: 'transfer(address,uint256)',
    arguments: ['0x3333333333333333333333333333333333333333', '1']
  },
  evidence: [{ kind: 'calldata', status: 'available', source: 'local' }],
  missingContext: []
}

beforeEach(() => {
  link.invoke.mockReset()
  link.send.mockReset()
  link.invoke.mockResolvedValue({ success: true, inspection })
})

it('states its non-signing safety contract and focuses the local editor', () => {
  render(<Inspector />)

  expect(screen.getByRole('heading', { name: 'Inspector' })).toBeTruthy()
  expect(screen.getByText('Read-only')).toBeTruthy()
  expect(screen.getByLabelText('Unsigned transaction JSON').classList.contains('wrenInput')).toBe(true)
  expect(document.activeElement).toBe(screen.getByLabelText('Unsigned transaction JSON'))
  expect(screen.getByRole('button', { name: 'Inspect' }).disabled).toBe(true)
})

it('sends the strict transaction request and renders evidence without a commit action', async () => {
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), {
    target: { value: '{"to":"0x2"}' }
  })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', {
    kind: 'transaction',
    input: '{"to":"0x2"}'
  })
  expect(await screen.findByRole('heading', { name: 'Inspection result' })).toBeTruthy()
  expect(screen.getByText('Calldata interpretation')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /sign|broadcast|queue/i })).toBeNull()
  expect(screen.getByText('Method')).toBeTruthy()
  expect(screen.getByText('Arguments')).toBeTruthy()
  expect(screen.getByText('transfer(address,uint256)')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^(sign|send|broadcast)/i })).toBeNull()
})

it('clears raw input, evidence, and errors when changing modes', async () => {
  const { user } = render(<Inspector />)
  const editor = screen.getByLabelText('Unsigned transaction JSON')
  fireEvent.change(editor, { target: { value: '{"to":"0x2"}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))
  expect(await screen.findByText('Inspection result')).toBeTruthy()

  await user.click(screen.getByRole('tab', { name: 'Calldata' }))

  expect(screen.getByRole('textbox', { name: 'Calldata' }).value).toBe('')
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Calldata' }))
  expect(screen.queryByText('Inspection result')).toBeNull()
})

it('supports arrow, Home, and End navigation across inspection tabs', () => {
  render(<Inspector />)
  const transaction = screen.getByRole('tab', { name: 'Transaction' })
  transaction.focus()

  fireEvent.keyDown(transaction, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'JSON-RPC' }))
  fireEvent.keyDown(document.activeElement, { key: 'Home' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Transaction' }))
  fireEvent.keyDown(document.activeElement, { key: 'End' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'JSON-RPC' }))
})

it('does not retain raw input after the view closes and remounts', () => {
  const view = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), {
    target: { value: '{"private":"component-local"}' }
  })
  view.unmount()
  render(<Inspector />)

  expect(screen.getByLabelText('Unsigned transaction JSON').value).toBe('')
})

it('sends only populated calldata context fields', async () => {
  const { user } = render(<Inspector />)
  await user.click(screen.getByRole('tab', { name: 'Calldata' }))
  await user.type(screen.getByRole('textbox', { name: 'Calldata' }), '0x1234')
  await user.type(screen.getByLabelText(/Chain ID/), '0x1')
  await user.type(screen.getByLabelText(/Target/), '0x2222222222222222222222222222222222222222')
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', {
    kind: 'calldata',
    data: '0x1234',
    chainId: '0x1',
    to: '0x2222222222222222222222222222222222222222'
  })
})

it('accepts decimal chain context without rewriting it in the renderer', async () => {
  const { user } = render(<Inspector />)
  await user.click(screen.getByRole('tab', { name: 'Calldata' }))
  expect(screen.getByPlaceholderText('1 or 0x1')).toBeTruthy()
  await user.type(screen.getByRole('textbox', { name: 'Calldata' }), '0x1234')
  await user.type(screen.getByLabelText(/Chain ID/), '1')
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', {
    kind: 'calldata',
    data: '0x1234',
    chainId: '1'
  })
})

it('does not trim invalid whitespace from chain context before validation', async () => {
  const { user } = render(<Inspector />)
  await user.click(screen.getByRole('tab', { name: 'Calldata' }))
  await user.type(screen.getByRole('textbox', { name: 'Calldata' }), '0x1234')
  fireEvent.change(screen.getByLabelText(/Chain ID/), { target: { value: ' 1' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', {
    kind: 'calldata',
    data: '0x1234',
    chainId: ' 1'
  })
})

it('keeps RPC sharing details beside the action and omits them for local typed data', () => {
  render(<Inspector />)
  expect(screen.getByText('Uses your configured RPC').closest('details').open).toBe(false)
  fireEvent.click(screen.getByRole('tab', { name: 'EIP-712' }))
  expect(screen.queryByText('Uses your configured RPC')).toBeNull()
})

it('sends typed-data version and optional chain context', async () => {
  const { user } = render(<Inspector />)
  await user.click(screen.getByRole('tab', { name: 'EIP-712' }))
  fireEvent.change(screen.getByLabelText('Typed data JSON'), {
    target: { value: '{"domain":{}}' }
  })
  await user.selectOptions(screen.getByLabelText('Typed-data version'), 'V3')
  await user.type(screen.getByLabelText(/Chain ID/), '0x1')
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', {
    kind: 'typed-data',
    input: '{"domain":{}}',
    chainId: '0x1',
    version: 'V3'
  })
})

it('sends supported JSON-RPC intent as inert input', async () => {
  const { user } = render(<Inspector />)
  await user.click(screen.getByRole('tab', { name: 'JSON-RPC' }))
  fireEvent.change(screen.getByLabelText('JSON-RPC request'), {
    target: { value: '{"method":"eth_call"}' }
  })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', {
    kind: 'json-rpc',
    input: '{"method":"eth_call"}'
  })
})

it('bounds failures and keeps them in an assertive status', async () => {
  link.invoke.mockResolvedValueOnce({ success: false, error: 'x'.repeat(500) })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toHaveLength(240)
  expect(alert.textContent).toBe('x'.repeat(240))
})

it('ignores an obsolete inspection after switching modes', async () => {
  let resolve
  link.invoke.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))
  expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true')

  await user.click(screen.getByRole('tab', { name: 'Calldata' }))
  resolve({ success: true, inspection })
  await waitFor(() => expect(screen.queryByText('Inspection result')).toBeNull())
})

it('discloses missing context and evidence sources rather than implying certainty', async () => {
  link.invoke.mockResolvedValueOnce({
    success: true,
    inspection: {
      ...inspection,
      normalized: { to: inspection.normalized.to, data: inspection.normalized.data },
      missingContext: ['from', 'chainId'],
      evidence: [
        {
          kind: 'simulation',
          status: 'unavailable',
          source: 'configured-rpc',
          reason: 'No chain was provided.'
        }
      ]
    }
  })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect((await screen.findAllByText('Not established')).length).toBeGreaterThan(0)
  expect(screen.getByText('sender, requested chain')).toBeTruthy()
  expect(screen.getByText('simulation: unavailable')).toBeTruthy()
  expect(screen.getByText('configured-rpc')).toBeTruthy()
  expect(screen.getByText('No chain was provided.')).toBeTruthy()
})

it('copies evidence through the bounded renderer clipboard channel', async () => {
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))
  await user.click(await screen.findByRole('button', { name: 'Copy target' }))

  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', inspection.normalized.to)
  expect(screen.getByRole('status').textContent).toContain('Target copied.')
})

it('distinguishes contract creation from missing target context', async () => {
  link.invoke.mockResolvedValueOnce({
    success: true,
    inspection: {
      ...inspection,
      normalized: { ...inspection.normalized, to: null },
      missingContext: []
    }
  })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(await screen.findByText('Contract creation')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Copy target' })).toBeNull()
})

it('does not offer clipboard actions for values beyond the IPC text bound', async () => {
  link.invoke.mockResolvedValueOnce({
    success: true,
    inspection: {
      ...inspection,
      normalized: { ...inspection.normalized, data: `0x${'aa'.repeat(2050)}` }
    }
  })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(await screen.findByText('Inspection result')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Copy calldata' })).toBeNull()
})

it('renders bounded simulation evidence instead of only its availability status', async () => {
  link.invoke.mockResolvedValueOnce({
    success: true,
    inspection: {
      ...inspection,
      simulation: {
        status: 'reverted',
        source: 'eth_call',
        reason: 'Allowance is too low',
        effects: [{ type: 'approval', amount: '10' }],
        accountCode: [{ role: 'target', status: 'contract' }],
        proxyImplementation: { status: 'succeeded', changes: [] },
        callTrace: { calls: [], truncated: false }
      }
    }
  })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(await screen.findByRole('heading', { name: 'Simulation' })).toBeTruthy()
  expect(screen.getByText('Allowance is too low')).toBeTruthy()
  expect(screen.getByText(/"type": "approval"/)).toBeTruthy()
  expect(screen.getByText(/"role": "target"/)).toBeTruthy()
})

it('renders unknown selectors without empty method or argument rows', async () => {
  link.invoke.mockResolvedValueOnce({
    success: true,
    inspection: {
      ...inspection,
      decode: {
        status: 'unknown',
        source: 'bundled-standard-abi',
        selector: '0x12345678',
        reason: "Selector is not in Wren's bundled standard ABI set"
      }
    }
  })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(await screen.findByText('Unknown function')).toBeTruthy()
  expect(screen.getByText('Selector 0x12345678 could not be decoded locally.')).toBeTruthy()
  expect(screen.getByText('0x12345678')).toBeTruthy()
  expect(screen.queryByText('Method')).toBeNull()
  expect(screen.queryByText('Arguments')).toBeNull()
})

it('renders exact typed data, domain, risks, and recognized authority', async () => {
  const typedData = JSON.stringify({
    domain: { name: 'Workshop', chainId: 1 },
    types: { Mail: [{ name: 'contents', type: 'string' }] },
    primaryType: 'Mail',
    message: { contents: 'hello' }
  })
  link.invoke.mockResolvedValueOnce({
    success: true,
    inspection: {
      kind: 'typed-data',
      source: 'direct',
      normalized: {
        version: 'V4',
        primaryType: 'Mail',
        signer: '0x1111111111111111111111111111111111111111',
        typedData,
        domain: { name: 'Workshop', chainId: '1' }
      },
      typedContext: {
        requestChainId: 1,
        domainChainId: '1',
        risks: ['permit2-allowance'],
        authority: {
          standard: 'permit2',
          kind: 'permit',
          verifyingContract: '0x2222222222222222222222222222222222222222',
          grantsAuthority: true,
          maximumAmount: false
        }
      },
      evidence: [{ kind: 'typed-data', status: 'available', source: 'local' }],
      missingContext: []
    }
  })
  const { user } = render(<Inspector />)
  await user.click(screen.getByRole('tab', { name: 'EIP-712' }))
  fireEvent.change(screen.getByLabelText('Typed data JSON'), { target: { value: typedData } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect(await screen.findByRole('heading', { name: 'Inspection result' })).toBeTruthy()
  expect(screen.getAllByText(typedData)).toHaveLength(2)
  expect(screen.getByText('Permit2 allowance: this message can grant token spending authority.')).toBeTruthy()
  expect(screen.getByText(/"standard": "permit2"/)).toBeTruthy()
  expect(screen.getByText(/"contents": "hello"/)).toBeTruthy()
})

it('rejects malformed invoke responses before rendering evidence', async () => {
  link.invoke.mockResolvedValueOnce({ success: true })
  const { user } = render(<Inspector />)
  fireEvent.change(screen.getByLabelText('Unsigned transaction JSON'), { target: { value: '{}' } })
  await user.click(screen.getByRole('button', { name: 'Inspect' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Inspector evidence was unavailable.')
})

it('uses the shared inspector invoke boundary', async () => {
  await expect(inspectReadOnlyInput({ kind: 'transaction', input: '{}' })).resolves.toEqual({
    success: true,
    inspection
  })
  expect(link.invoke).toHaveBeenCalledWith('inspector:inspect', { kind: 'transaction', input: '{}' })
})
