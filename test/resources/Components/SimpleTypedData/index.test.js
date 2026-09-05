import { screen, render } from '../../../componentSetup'
import {
  getTypedDataDeviceWarning,
  getTypedDataReviewPresentation,
  SimpleTypedData
} from '../../../../resources/Components/SimpleTypedData'

const typedData = {
  types: {
    EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
    Message: [
      { name: 'enabled', type: 'bool' },
      { name: 'count', type: 'uint256' },
      { name: 'note', type: 'string' }
    ]
  },
  primaryType: 'Message',
  domain: { chainId: 1 },
  message: {
    enabled: false,
    count: 0,
    note: '',
    label: 'false',
    optional: null,
    values: [false, 0, null]
  }
}

const request = (overrides = {}) => ({
  type: 'signTypedData',
  origin: 'origin-id',
  typedMessage: { data: typedData, version: 'V4' },
  context: { requestChainId: 1, domainChainId: '1', risks: [] },
  ...overrides
})

it('shows complete EIP-712 signing context and declarations', () => {
  render(<SimpleTypedData chainName='Ethereum' originName='example.test' req={request()} />)

  expect(screen.getByText('Review structured message')).toBeTruthy()
  expect(screen.queryByText('Typed-data structure recognized')).toBeNull()
  expect(screen.getByText('request Network')).toBeTruthy()
  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText('Ethereum (1)')).toBeTruthy()
  expect(screen.getByText(/EIP-712.*V4/)).toBeTruthy()
  expect(screen.getAllByText('Message').length).toBeGreaterThan(0)
  expect(screen.getByText('Domain')).toBeTruthy()
  expect(screen.getByText('Message: Message')).toBeTruthy()
  expect(screen.getByText('Type definitions')).toBeTruthy()
  expect(screen.getByText('EIP712Domain')).toBeTruthy()
})

it('renders false, zero, null, empty strings, and array positions explicitly', () => {
  render(<SimpleTypedData req={request()} />)

  expect(screen.getAllByText('false').length).toBeGreaterThan(0)
  expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  expect(screen.getAllByText('null').length).toBeGreaterThan(0)
  expect(screen.getByText('""')).toBeTruthy()
  expect(screen.getByText('"false"')).toBeTruthy()
  expect(screen.getAllByText('[0]').length).toBeGreaterThan(0)
})

it('shows the exact request and domain chains in a mismatch warning', () => {
  const req = request({
    context: { requestChainId: 5, domainChainId: '1', risks: ['domain-chain-mismatch'] }
  })

  render(<SimpleTypedData chainName='Goerli' originName='example.test' req={req} />)

  expect(screen.getByRole('alert').textContent).toBe('Domain chain 1 does not match request chain 5.')
})

it('shows missing domain binding warnings', () => {
  render(
    <SimpleTypedData req={request({ context: { requestChainId: 1, risks: ['domain-chain-missing'] } })} />
  )

  expect(screen.getByRole('alert').textContent).toMatch(/does not declare a domain chain ID/)
})

it('falls back to the persisted origin identity and shows invalid domain chain warnings', () => {
  render(
    <SimpleTypedData req={request({ context: { requestChainId: 1, risks: ['domain-chain-invalid'] } })} />
  )

  expect(screen.getByText('origin-id')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toMatch(/cannot be compared/)
})

it('shows legacy V1 fields and warnings', () => {
  render(
    <SimpleTypedData
      req={request({
        typedMessage: {
          version: 'V1',
          data: [{ name: 'enabled', type: 'bool', value: false }]
        },
        context: { requestChainId: 1, risks: ['legacy-v1'] }
      })}
    />
  )

  expect(screen.getByRole('alert').textContent).toMatch(/Legacy V1 typed data/)
  expect(screen.getByText('Signed Fields')).toBeTruthy()
  expect(screen.getByText('false')).toBeTruthy()
})

it('shows normalized Permit2 authority before the raw typed data', () => {
  const permit2 = {
    kind: 'allowance',
    primaryType: 'PermitSingle',
    verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    canonicalContract: true,
    spender: '0x3333333333333333333333333333333333333333',
    deadline: '1900000000',
    permissions: [
      {
        token: '0x1111111111111111111111111111111111111111',
        amount: '100',
        expiration: '2000000000'
      }
    ],
    batch: false,
    witness: false,
    grantsAuthority: true,
    maximumAmount: false
  }

  render(
    <SimpleTypedData
      req={request({
        context: {
          requestChainId: 1,
          domainChainId: '1',
          permit2,
          risks: ['permit2-allowance']
        }
      })}
    />
  )

  expect(screen.getByText('Permission')).toBeTruthy()
  expect(screen.getByText('Permit2 authority')).toBeTruthy()
  expect(screen.getByText('Standing allowance')).toBeTruthy()
  expect(screen.getByText(permit2.spender)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy Permit2 spender address' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy Permit2 contract address' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy permission 1 token address' })).toBeTruthy()
  expect(screen.getByText(permit2.permissions[0].token)).toBeTruthy()
  const warning = screen.getByText(/creates standing token allowances/)
  expect(warning).toBeTruthy()
  expect(
    screen.getByText('Permission').compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(screen.queryByText(/Recognition describes structure, not safety/)).toBeNull()
  expect(screen.getByText('Type definitions').closest('details').open).toBe(false)
})

it('shows normalized ERC-3009 transfer authority', () => {
  const eip3009 = {
    kind: 'receive',
    primaryType: 'ReceiveWithAuthorization',
    verifyingContract: '0x3333333333333333333333333333333333333333',
    authorizer: '0x1111111111111111111111111111111111111111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '100',
    validAfter: '0',
    validBefore: '2000000000',
    nonce: `0x${'ab'.repeat(32)}`,
    grantsAuthority: true,
    maximumAmount: false
  }
  render(
    <SimpleTypedData
      req={request({
        context: {
          requestChainId: 1,
          domainChainId: '1',
          eip3009,
          risks: ['eip3009-transfer']
        }
      })}
    />
  )

  expect(screen.getByText('ERC-3009 Authorization')).toBeTruthy()
  expect(screen.getByText('Recipient-submitted transfer')).toBeTruthy()
  expect(screen.getByText(eip3009.to)).toBeTruthy()
  expect(screen.getByText(/directly authorizes/)).toBeTruthy()
  expect(screen.getByText(/recipient must submit/)).toBeTruthy()
})

it('uses the same complete view for specialized permit requests', () => {
  render(<SimpleTypedData req={request({ type: 'signErc20Permit' })} />)

  expect(screen.getByText('Review structured message')).toBeTruthy()
  expect(screen.getByText('Type definitions')).toBeTruthy()
})

it('warns when the selected device displays only typed-data hashes', () => {
  const deviceWarning = getTypedDataDeviceWarning({
    model: 'Trezor One',
    signingCapabilities: { typedDataHashOnly: true }
  })

  render(<SimpleTypedData deviceWarning={deviceWarning} req={request()} />)

  const warning = screen.getByLabelText('Device signing warning')
  const signingContext = screen.getByText('Signing Context')

  expect(warning).toBeTruthy()
  expect(warning.compareDocumentPosition(signingContext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe(
    'Trezor One will display only the EIP-712 domain and message hashes. Verify every structured field in Wren before approving on-device.'
  )
})

it('explains how to expand structured data on supported Trezor devices', () => {
  const deviceWarning = getTypedDataDeviceWarning({
    type: 'trezor',
    model: 'Trezor Safe 7',
    signingCapabilities: { typedDataHashOnly: false }
  })

  render(<SimpleTypedData deviceWarning={deviceWarning} req={request()} />)

  expect(screen.getByRole('alert').textContent).toBe(
    'Trezor Safe 7 may summarize EIP-712 structures on-device. Open the device menu and choose Show full message to inspect every value before signing.'
  )
})

it('does not warn when device-specific review behavior is not known', () => {
  expect(
    getTypedDataDeviceWarning({
      type: 'ledger',
      model: 'Ledger Flex',
      signingCapabilities: { typedDataHashOnly: false }
    })
  ).toBeUndefined()
})

it('uses authority-specific summaries without presenting recognition as approval', () => {
  expect(
    getTypedDataReviewPresentation({ permit2: { kind: 'allowance' } }, { version: 'V4', data: typedData })
  ).toEqual({
    eyebrow: 'Permit2 allowance',
    title: 'Authorize token spending',
    help: 'This signature can grant spending authority without a transaction.',
    status: 'Permit2 structure recognized'
  })
})
