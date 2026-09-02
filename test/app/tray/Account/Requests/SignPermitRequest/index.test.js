import { act, screen, render } from '../../../../../componentSetup'
import SignPermitRequest from '../../../../../../app/tray/Account/Requests/SignPermitRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true })),
  rpc: jest.fn(),
  send: jest.fn()
}))

jest.mock(
  '../../../../../../resources/Components/RingIcon',
  () =>
    function RingIconMock() {
      return <div />
    }
)

const typedData = {
  types: {
    EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  },
  primaryType: 'Permit',
  domain: { chainId: 1 },
  message: {
    owner: '0x0000000000000000000000000000000000000001',
    spender: '0x0000000000000000000000000000000000000002',
    value: '1',
    nonce: '0',
    deadline: '2000000000'
  }
}

const req = {
  account: '0x0000000000000000000000000000000000000001',
  type: 'signErc20Permit',
  status: 'pending',
  handlerId: 'permit-request',
  context: { requestChainId: 5, domainChainId: '1', risks: ['domain-chain-mismatch'] },
  typedMessage: { data: typedData, version: 'V4' },
  permit: {
    spender: {
      address: typedData.message.spender,
      ens: '',
      type: 'external'
    },
    value: typedData.message.value,
    deadline: typedData.message.deadline
  },
  tokenData: { symbol: 'TEST', decimals: 18 }
}

const chainData = {
  chainName: 'Ethereum',
  requestChainName: 'Goerli',
  chainColor: 'good'
}

it('shows domain mismatch warnings in the specialized permit overview', () => {
  render(<SignPermitRequest chainData={chainData} originName='example.test' req={req} />)

  expect(screen.getByRole('alert').textContent).toBe('Domain chain 1 does not match request chain 5.')
})

it('shows a live local label without hiding the permit spender address', () => {
  const spender = req.permit.spender.address
  render(
    <SignPermitRequest
      addressBook={{
        [spender]: {
          address: spender,
          name: 'Yearn Router',
          note: '',
          provenance: { status: 'saved' },
          createdAt: 1,
          updatedAt: 1
        }
      }}
      chainData={chainData}
      originName='example.test'
      req={req}
    />
  )

  expect(screen.getByText('Yearn Router')).toBeTruthy()
  expect(screen.getByText('Saved contact')).toBeTruthy()
  expect(screen.getAllByText(spender)).not.toHaveLength(0)
})

it('recognizes a Wren account as the permit spender', () => {
  const spender = req.permit.spender.address
  render(
    <SignPermitRequest
      accounts={{ [spender]: { name: 'Frame Deployer' } }}
      chainData={chainData}
      originName='example.test'
      req={req}
    />
  )

  expect(screen.getByText('Frame Deployer')).toBeTruthy()
  expect(screen.getByText('Wren account')).toBeTruthy()
  expect(screen.getAllByText(spender)).not.toHaveLength(0)
})

it('labels the raw permit view with the resolved request chain', () => {
  render(<SignPermitRequest chainData={chainData} originName='example.test' req={req} step='viewRaw' />)

  expect(screen.getByText('Goerli (5)')).toBeTruthy()
  expect(screen.getByText('Type Definitions')).toBeTruthy()
})

it('preserves raw-data navigation and spender copying on named controls', async () => {
  const { user } = render(<SignPermitRequest chainData={chainData} originName='example.test' req={req} />)

  expect(screen.getByText('Review ›')).toBeTruthy()
  expect(screen.getByText('Adjust')).toBeTruthy()
  expect(screen.getByText('Copy')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'View raw permit data' }))
  await user.click(screen.getByRole('button', { name: 'Copy permit spender address' }))

  expect(link.send).toHaveBeenCalledWith('nav:update', 'panel', { data: { step: 'viewRaw' } })
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', {
    secret: false,
    value: req.permit.spender.address
  })
  expect(await screen.findByText('Permit spender address copied')).toBeTruthy()
})

it.each([undefined, 'viewRaw'])('warns about hash-only device review in the %s permit view', (step) => {
  render(
    <SignPermitRequest
      chainData={chainData}
      originName='example.test'
      req={req}
      signer={{
        model: 'Trezor One',
        signingCapabilities: { typedDataHashOnly: true }
      }}
      step={step}
    />
  )

  expect(screen.getByLabelText('Device signing warning').textContent).toMatch(
    /Trezor One will display only the EIP-712 domain and message hashes/
  )
})

it('sends only a normalized amount request from the permit editor', async () => {
  const editableRequest = {
    ...req,
    status: undefined,
    payload: { params: [typedData.message.owner, { message: { value: '1' } }] },
    permit: {
      ...req.permit,
      verifyingContract: {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ens: '',
        type: 'contract'
      }
    },
    tokenData: { ...req.tokenData, name: 'Test Token' }
  }
  const { user } = render(
    <SignPermitRequest
      chainData={chainData}
      originName='example.test'
      req={editableRequest}
      step='adjustPermit'
    />
  )

  const unlimited = screen.getByRole('button', { name: 'Unlimited' })
  await user.click(unlimited)

  expect(link.rpc).toHaveBeenCalledWith(
    'updateRequest',
    req.account,
    req.handlerId,
    { amount: (2n ** 256n - 1n).toString(10) },
    null,
    expect.any(Function)
  )

  expect(unlimited.getAttribute('aria-pressed')).toBe('true')
  const callback = link.rpc.mock.calls.at(-1)[5]
  await act(async () => callback(new Error('update rejected')))
  expect(screen.getByRole('button', { name: 'Requested' }).getAttribute('aria-pressed')).toBe('true')
  expect(unlimited.getAttribute('aria-pressed')).toBe('false')
})

it('shows and allows editing a zero-decimal token permit', async () => {
  const zeroDecimalRequest = {
    ...req,
    status: undefined,
    payload: { params: [typedData.message.owner, { message: { value: '1' } }] },
    permit: {
      ...req.permit,
      value: '1',
      verifyingContract: {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ens: '',
        type: 'contract'
      }
    },
    tokenData: { ...req.tokenData, decimals: 0, name: 'Whole Token', symbol: 'WHOLE' }
  }
  const { user } = render(
    <SignPermitRequest
      chainData={chainData}
      originName='example.test'
      req={zeroDecimalRequest}
      step='overview'
    />
  )

  expect(screen.getAllByText('1 WHOLE')).toHaveLength(2)
  const editor = screen.getByRole('button', { name: 'Edit permit amount' })
  editor.focus()
  await user.keyboard('{Enter}')
  expect(link.send).toHaveBeenCalledWith('nav:update', 'panel', {
    data: { step: 'adjustPermit', tokenData: zeroDecimalRequest.tokenData }
  })

  render(
    <SignPermitRequest
      chainData={chainData}
      originName='example.test'
      req={zeroDecimalRequest}
      step='adjustPermit'
    />
  )
  expect(screen.getByRole('button', { name: 'Custom' })).toBeTruthy()
})
