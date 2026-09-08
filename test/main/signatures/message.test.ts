import { parseMessageRequest } from '../../../main/signatures/message'

const account = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const otherAccount = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const options = {
  account,
  origin: 'example.com',
  requestChainId: 1,
  now: Date.parse('2025-01-01T00:00:00Z')
}

const siweMessage = ({
  domain = 'example.com',
  address = account,
  chainId = 1,
  issuedAt = '2021-09-30T16:25:24Z',
  optionalFields = ''
} = {}) => `${domain} wants you to sign in with your Ethereum account:
${address}

I accept the ExampleOrg Terms of Service: https://example.com/tos

URI: https://${domain}/login
Version: 1
Chain ID: ${chainId}
Nonce: 32891756
Issued At: ${issuedAt}${optionalFields}`

describe('#parseMessageRequest', () => {
  it.each(['0x80', '0xc0af', '0xe282', '0xeda080', '0xf4908080'])(
    'keeps invalid UTF-8 as opaque bytes: %s',
    (rawMessage) => {
      const result = parseMessageRequest('personal_sign', [rawMessage, account], options)
      expect(result.rawMessage).toBe(rawMessage)
      expect(result.decodedMessage).toBe(rawMessage)
      expect(result.context.risks).toContain('opaque-message')
    }
  )

  it('preserves valid multibyte text in the signing preview', () => {
    const message = 'Café 日本語 🌱'
    const rawMessage = `0x${Buffer.from(message).toString('hex')}`
    const result = parseMessageRequest('personal_sign', [rawMessage, account], options)
    expect(result.rawMessage).toBe(rawMessage)
    expect(result.decodedMessage).toBe(message)
  })

  it('normalizes personal_sign standard and legacy parameter order', () => {
    const standard = parseMessageRequest('personal_sign', ['hello', account, 'password'], options)
    const legacy = parseMessageRequest('personal_sign', [account, 'hello'], options)

    expect(standard.params).toEqual([account, 'hello', 'password'])
    expect(legacy.params).toEqual([account, 'hello'])
    expect(standard.rawMessage).toBe('0x68656c6c6f')
    expect(standard.decodedMessage).toBe('hello')
    expect(standard.context).toEqual({
      method: 'personal_sign',
      requestChainId: 1,
      origin: 'example.com',
      encoding: 'utf8',
      byteLength: 5,
      risks: []
    })
  })

  it('keeps an address-sized personal message distinct from the selected account', () => {
    const result = parseMessageRequest('personal_sign', [otherAccount, account], options)

    expect(result.params).toEqual([account, otherAccount])
    expect(result.decodedMessage).toBe(otherAccount.toLowerCase())
  })

  it('prioritizes standard message-first order when the message equals the selected account', () => {
    const result = parseMessageRequest('personal_sign', [account, account], options)

    expect(result.params).toEqual([account, account])
    expect(result.rawMessage).toBe(account.toLowerCase())
  })

  it('marks eth_sign as legacy while preserving its parameter order', () => {
    const result = parseMessageRequest('eth_sign', [account, 'hello'], options)

    expect(result.params).toEqual([account, 'hello'])
    expect(result.context.risks).toEqual(['legacy-eth-sign'])
  })

  it('preserves repeated line breaks in the displayed and signed message', () => {
    const message = 'first line\n\nthird line\r\n'
    const result = parseMessageRequest('personal_sign', [message, account], options)

    expect(result.decodedMessage).toBe(message)
    expect(Buffer.from(result.rawMessage.slice(2), 'hex').toString('utf8')).toBe(message)
  })

  it('represents empty and opaque byte messages exactly', () => {
    const empty = parseMessageRequest('personal_sign', ['', account], options)
    const opaque = parseMessageRequest('personal_sign', [`0x${'ab'.repeat(32)}`, account], options)

    expect(empty).toMatchObject({
      rawMessage: '0x',
      decodedMessage: '',
      context: { encoding: 'utf8', byteLength: 0, risks: [] }
    })
    expect(opaque).toMatchObject({
      rawMessage: `0x${'ab'.repeat(32)}`,
      decodedMessage: `0x${'ab'.repeat(32)}`,
      context: { encoding: 'hex', byteLength: 32, risks: ['opaque-message'] }
    })
  })

  it.each([
    ['non-array params', 'personal_sign', null],
    ['missing params', 'personal_sign', ['hello']],
    ['too many params', 'personal_sign', ['hello', account, '', 'extra']],
    ['wrong personal account', 'personal_sign', ['hello', otherAccount]],
    ['wrong eth_sign account', 'eth_sign', [otherAccount, 'hello']],
    ['non-string message', 'eth_sign', [account, 1]],
    ['odd hex message', 'eth_sign', [account, '0x0']],
    ['invalid hex message', 'eth_sign', [account, '0xzz']],
    ['extra eth_sign param', 'eth_sign', [account, 'hello', 'extra']]
  ])('rejects %s', (_label, method, params) => {
    expect(() => parseMessageRequest(method as 'personal_sign' | 'eth_sign', params, options)).toThrow(
      /Invalid params:/
    )
  })

  it('parses a conformant SIWE message into review fields', () => {
    const result = parseMessageRequest('personal_sign', [siweMessage(), account], options)

    expect(result.context.risks).toEqual(['siwe-origin-unverified'])
    expect(result.context.siwe).toEqual({
      domain: 'example.com',
      address: account,
      statement: 'I accept the ExampleOrg Terms of Service: https://example.com/tos',
      uri: 'https://example.com/login',
      version: '1',
      chainId: '1',
      nonce: '32891756',
      issuedAt: '2021-09-30T16:25:24Z'
    })
  })

  it('reports all comparable SIWE mismatches and time risks', () => {
    const message = siweMessage({
      domain: 'evil.example',
      address: otherAccount,
      chainId: 5,
      issuedAt: '2026-01-01T00:00:00Z',
      optionalFields: '\nExpiration Time: 2024-01-01T00:00:00Z\nNot Before: 2026-01-01T00:00:00Z'
    })

    const result = parseMessageRequest('personal_sign', [message, account], options)

    expect(result.context.risks).toEqual([
      'siwe-origin-unverified',
      'siwe-origin-mismatch',
      'siwe-address-mismatch',
      'siwe-chain-mismatch',
      'siwe-expired',
      'siwe-not-yet-valid',
      'siwe-issued-in-future'
    ])
  })

  it('does not claim a SIWE domain comparison for a session-only local client', () => {
    const result = parseMessageRequest('personal_sign', [siweMessage(), account], {
      ...options,
      origin: 'Unknown/46d1d57b-7b20-41a8-a9ad-d299da51851d'
    })

    expect(result.context.risks).toEqual(['siwe-origin-unverified'])
  })

  it('preserves chain IDs larger than JavaScript safe integers exactly', () => {
    const chainId = '9007199254740993'
    const result = parseMessageRequest('personal_sign', [siweMessage({ chainId }), account], options)

    expect(result.context.siwe?.chainId).toBe(chainId)
    expect(result.context.risks).toContain('siwe-chain-mismatch')
  })

  it('warns when SIWE-looking text does not conform to ERC-4361', () => {
    const result = parseMessageRequest(
      'personal_sign',
      ['example.com wants you to sign in with your Ethereum account: malformed', account],
      options
    )

    expect(result.context.siwe).toBeUndefined()
    expect(result.context).not.toHaveProperty('siwe')
    expect(result.context.risks).toEqual(['siwe-malformed'])
  })
})
