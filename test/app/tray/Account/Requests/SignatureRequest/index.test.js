import { cleanup, screen, render } from '../../../../../componentSetup'
import SignatureRequest from '../../../../../../app/tray/Account/Requests/SignatureRequest'

const account = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const request = (overrides = {}) => ({
  type: 'sign',
  account,
  handlerId: 'message-request',
  data: {
    rawMessage: '0x68656c6c6f2c20776f726c6421',
    decodedMessage: 'hello, world!',
    context: {
      method: 'personal_sign',
      requestChainId: 1,
      origin: 'example.test',
      encoding: 'utf8',
      byteLength: 13,
      risks: []
    }
  },
  ...overrides
})

it('shows the complete signing context and exact message', () => {
  render(
    <SignatureRequest
      req={request()}
      originName='example.test'
      chainData={{ requestChainName: 'Ethereum' }}
    />
  )

  expect(screen.getByText('Message Signing Review')).toBeTruthy()
  expect(screen.getByText('example.test')).toBeTruthy()
  expect(screen.getByText(account)).toBeTruthy()
  expect(screen.getByText('Ethereum (1)')).toBeTruthy()
  expect(screen.getByText('personal_sign')).toBeTruthy()
  expect(screen.getByText('UTF-8 text')).toBeTruthy()
  expect(screen.getByText('hello, world!')).toBeTruthy()
})

it('renders empty and opaque messages unambiguously', () => {
  const req = request({
    data: {
      rawMessage: '0x',
      decodedMessage: '',
      context: {
        method: 'personal_sign',
        requestChainId: 1,
        origin: 'example.test',
        encoding: 'utf8',
        byteLength: 0,
        risks: []
      }
    }
  })

  render(<SignatureRequest req={req} />)
  expect(screen.getByText('""')).toBeTruthy()

  const hex = `0x${'ab'.repeat(32)}`
  cleanup()
  render(
    <SignatureRequest
      req={request({
        data: {
          rawMessage: hex,
          decodedMessage: hex,
          context: {
            method: 'personal_sign',
            requestChainId: 1,
            origin: 'example.test',
            encoding: 'hex',
            byteLength: 32,
            risks: ['opaque-message']
          }
        }
      })}
    />
  )

  expect(screen.getByText('Opaque hex')).toBeTruthy()
  expect(screen.getByText(hex)).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toMatch(/opaque hexadecimal data/)
})

it('shows every SIWE field and security warning', () => {
  const siwe = {
    scheme: 'https',
    domain: 'evil.example',
    address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    statement: 'Sign in to continue',
    uri: 'https://evil.example/login',
    version: '1',
    chainId: '5',
    nonce: '32891756',
    issuedAt: '2026-01-01T00:00:00Z',
    expirationTime: '2024-01-01T00:00:00Z',
    notBefore: '2026-01-01T00:00:00Z',
    requestId: 'request-1',
    resources: ['https://evil.example/terms']
  }
  const risks = [
    'siwe-origin-unverified',
    'siwe-origin-mismatch',
    'siwe-address-mismatch',
    'siwe-chain-mismatch',
    'siwe-expired',
    'siwe-not-yet-valid',
    'siwe-issued-in-future'
  ]
  const req = request({
    data: {
      rawMessage: '0x00',
      decodedMessage: 'exact SIWE message',
      context: {
        method: 'personal_sign',
        requestChainId: 1,
        origin: 'example.test',
        encoding: 'utf8',
        byteLength: 18,
        risks,
        siwe
      }
    }
  })

  render(<SignatureRequest req={req} chainData={{ requestChainName: 'Ethereum' }} />)

  expect(screen.getByText('Sign-In Request')).toBeTruthy()
  expect(screen.getByText('"evil.example"')).toBeTruthy()
  expect(screen.getByText('"Sign in to continue"')).toBeTruthy()
  expect(screen.getByText('"request-1"')).toBeTruthy()
  expect(screen.getByText('"https://evil.example/terms"')).toBeTruthy()
  expect(screen.getByText('Exact Signed Message')).toBeTruthy()
  expect(screen.getByText('exact SIWE message')).toBeTruthy()
  expect(screen.getAllByRole('alert')).toHaveLength(risks.length)
})

it('makes legacy eth_sign and malformed SIWE warnings explicit', () => {
  const req = request({
    data: {
      rawMessage: '0x00',
      decodedMessage: 'malformed',
      context: {
        method: 'eth_sign',
        requestChainId: 1,
        origin: 'example.test',
        encoding: 'utf8',
        byteLength: 9,
        risks: ['legacy-eth-sign', 'siwe-malformed']
      }
    }
  })

  render(<SignatureRequest req={req} />)

  expect(screen.getByText('eth_sign (EIP-191-prefixed by Wren)')).toBeTruthy()
  expect(screen.getAllByRole('alert')[0].textContent).toMatch(/Dangerous legacy eth_sign/)
  expect(screen.getAllByRole('alert')[1].textContent).toMatch(/does not conform to ERC-4361/)
})
