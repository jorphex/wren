import log from 'electron-log'
import { fromUtf8 } from '@ethereumjs/util'
import store from '../../../main/store'
import {
  checkExistingNonceGas,
  feeTotalOverMax,
  getRawTx,
  getSignedAddress,
  resError
} from '../../../main/provider/helpers'
import { MAX_UINT256, toRpcQuantity } from '../../../resources/domain/transaction/quantity'

jest.mock('../../../main/store')

beforeAll(async () => {
  log.transports.console.level = false
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

describe('#checkExistingNonceGas', () => {
  const from = '0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'
  const nonce = '0x7'
  const monitoredRequest = (data, overrides = {}) => ({
    mode: 'monitor',
    status: 'sent',
    data: { nonce, ...data },
    ...overrides
  })
  const setRequests = (...requests) =>
    store.set(
      'main.accounts',
      from.toLowerCase(),
      'requests',
      Object.fromEntries(requests.map((request, index) => [index, request]))
    )

  beforeEach(() => store.clear())

  it('bumps a legacy replacement below the 10% threshold', () => {
    setRequests(monitoredRequest({ gasPrice: '0x65' }))
    const tx = { from, nonce, gasPrice: '0x6f' }

    checkExistingNonceGas(tx)

    expect(tx).toMatchObject({
      gasPrice: '0x70',
      gasFeesSource: 'Frame',
      feesUpdated: true
    })
  })

  it('preserves a sufficiently high legacy replacement', () => {
    setRequests(monitoredRequest({ gasPrice: '0x64' }))
    const tx = { from, nonce, gasPrice: '0x6f' }

    checkExistingNonceGas(tx)

    expect(tx).toEqual({ from, nonce, gasPrice: '0x6f' })
  })

  it('preserves the exact generated legacy replacement minimum', () => {
    setRequests(monitoredRequest({ gasPrice: '0x64' }))
    const tx = { from, nonce, gasPrice: '0x6e' }

    checkExistingNonceGas(tx)

    expect(tx).toEqual({ from, nonce, gasPrice: '0x6e' })
  })

  it('bumps large legacy quantities exactly', () => {
    const existing = 9007199254740993n
    setRequests(monitoredRequest({ gasPrice: toRpcQuantity(existing) }))
    const tx = { from, nonce, gasPrice: toRpcQuantity(existing) }

    checkExistingNonceGas(tx)

    expect(tx.gasPrice).toBe(toRpcQuantity((existing * 11n + 9n) / 10n))
  })

  it('increases a zero legacy replacement by one wei', () => {
    setRequests(monitoredRequest({ gasPrice: '0x0' }))
    const tx = { from, nonce, gasPrice: '0x0' }

    checkExistingNonceGas(tx)

    expect(tx.gasPrice).toBe('0x1')
  })

  it('bumps EIP-1559 priority and max fees exactly', () => {
    const existingPriority = 9007199254740993n
    const existingBase = 12345678901234567n
    const existingMax = existingPriority + existingBase
    setRequests(
      monitoredRequest({
        maxPriorityFeePerGas: toRpcQuantity(existingPriority),
        maxFeePerGas: toRpcQuantity(existingMax)
      })
    )
    const tx = {
      from,
      nonce,
      maxPriorityFeePerGas: toRpcQuantity(existingPriority),
      maxFeePerGas: toRpcQuantity(existingMax)
    }

    checkExistingNonceGas(tx)

    const bumpedPriority = (existingPriority * 11n + 9n) / 10n
    const bumpedBase = (existingBase * 11n + 9n) / 10n
    expect(tx).toMatchObject({
      maxPriorityFeePerGas: toRpcQuantity(bumpedPriority),
      maxFeePerGas: toRpcQuantity(bumpedPriority + bumpedBase),
      gasFeesSource: 'Frame',
      feesUpdated: true
    })
  })

  it('preserves exact generated EIP-1559 replacement minimums', () => {
    setRequests(monitoredRequest({ maxPriorityFeePerGas: '0xa', maxFeePerGas: '0x64' }))
    const tx = {
      from,
      nonce,
      maxPriorityFeePerGas: '0xb',
      maxFeePerGas: '0x6e'
    }

    checkExistingNonceGas(tx)

    expect(tx).toEqual({
      from,
      nonce,
      maxPriorityFeePerGas: '0xb',
      maxFeePerGas: '0x6e'
    })
  })

  it('ignores unrelated, errored, and malformed monitored requests', () => {
    setRequests(
      monitoredRequest({ gasPrice: '0xffff' }, { mode: 'normal' }),
      monitoredRequest({ gasPrice: '0xffff' }, { status: 'error' }),
      monitoredRequest({ gasPrice: '0xffff', nonce: '0x8' }),
      monitoredRequest({ gasPrice: '0x01' })
    )
    const tx = { from, nonce, gasPrice: '0x64' }

    expect(() => checkExistingNonceGas(tx)).not.toThrow()
    expect(tx).toEqual({ from, nonce, gasPrice: '0x64' })
  })

  it('does not overflow a maximum uint256 stored fee', () => {
    setRequests(monitoredRequest({ gasPrice: toRpcQuantity(MAX_UINT256) }))
    const tx = { from, nonce, gasPrice: toRpcQuantity(MAX_UINT256) }

    expect(() => checkExistingNonceGas(tx)).not.toThrow()
    expect(tx).toEqual({ from, nonce, gasPrice: toRpcQuantity(MAX_UINT256) })
  })

  it('leaves both EIP-1559 fields unchanged when a bump would overflow', () => {
    setRequests(
      monitoredRequest({
        maxPriorityFeePerGas: toRpcQuantity(MAX_UINT256),
        maxFeePerGas: toRpcQuantity(MAX_UINT256)
      })
    )
    const tx = {
      from,
      nonce,
      maxPriorityFeePerGas: toRpcQuantity(MAX_UINT256),
      maxFeePerGas: toRpcQuantity(MAX_UINT256)
    }

    expect(() => checkExistingNonceGas(tx)).not.toThrow()
    expect(tx).toEqual({
      from,
      nonce,
      maxPriorityFeePerGas: toRpcQuantity(MAX_UINT256),
      maxFeePerGas: toRpcQuantity(MAX_UINT256)
    })
  })
})

describe('#feeTotalOverMax', () => {
  const feePerGas = 9007199254740993n
  const gasLimit = 3n
  const tx = {
    type: '0x0',
    gasPrice: toRpcQuantity(feePerGas),
    gasLimit: toRpcQuantity(gasLimit)
  }

  it('compares an exact total above the safe-integer range at the cap boundary', () => {
    const exactTotal = feePerGas * gasLimit

    expect(feeTotalOverMax(tx, exactTotal)).toBe(false)
    expect(feeTotalOverMax(tx, exactTotal - 1n)).toBe(true)
  })

  it.each([
    { ...tx, gasPrice: '0x01' },
    { ...tx, gasLimit: '0x' },
    { ...tx, type: '0x2', maxFeePerGas: undefined, maxPriorityFeePerGas: '0x1' },
    {
      ...tx,
      type: '0x2',
      maxFeePerGas: toRpcQuantity(feePerGas),
      maxPriorityFeePerGas: '0x01'
    },
    {
      ...tx,
      type: '0x2',
      maxFeePerGas: toRpcQuantity(feePerGas),
      maxPriorityFeePerGas: toRpcQuantity(feePerGas + 1n)
    }
  ])('fails closed for malformed signing quantities', (invalidTx) => {
    expect(feeTotalOverMax(invalidTx, 50n * 10n ** 18n)).toBe(true)
  })
})

describe('#getRawTx', () => {
  it('leaves a valid value unchanged', () => {
    const tx = getRawTx({ value: '0x2540be400' })

    expect(tx.value).toBe('0x2540be400')
  })

  it('removes a leading zero from a valid value', () => {
    const tx = getRawTx({ value: '0x0a45c6' })

    expect(tx.value).toBe('0xa45c6')
  })

  it('leaves a valid zero value unchanged', () => {
    const tx = getRawTx({ value: '0x0' })

    expect(tx.value).toBe('0x0')
  })

  it('turns a zero value into the correct hex value for zero', () => {
    const tx = getRawTx({ value: '0x' })

    expect(tx.value).toBe('0x0')
  })

  it('turns an un-prefixed zero value into the correct hex value for zero', () => {
    const tx = getRawTx({ value: '0' })

    expect(tx.value).toBe('0x0')
  })

  it('turns an undefined value into the correct hex value for zero', () => {
    const tx = getRawTx({ value: undefined })

    expect(tx.value).toBe('0x0')
  })

  it('should pass through a hex nonce', () => {
    const tx = getRawTx({ nonce: '0x168' })

    expect(tx.nonce).toBe('0x168')
  })

  it('should convert a valid integer nonce into hex', () => {
    const tx = getRawTx({ nonce: '360' })

    expect(tx.nonce).toBe('0x168')
  })

  it('should pass through an undefined nonce', () => {
    const tx = getRawTx({ nonce: undefined })

    expect(tx.nonce).toBeUndefined()
    expect(tx).not.toHaveProperty('nonce')
    expect(tx).not.toHaveProperty('gasLimit')
  })

  it('omits undefined and unknown dapp fields from the normalized transaction', () => {
    const tx = getRawTx({ chainId: '0x1', gasPrice: undefined, unexpected: 'value' })

    expect(tx.chainId).toBe('0x1')
    expect(tx).not.toHaveProperty('gasPrice')
    expect(tx).not.toHaveProperty('unexpected')
  })

  it('canonicalizes every JSON-RPC transaction quantity at admission', () => {
    const tx = getRawTx({
      chainId: '0x01',
      nonce: '0x0007',
      gas: '0x005208',
      gasPrice: '0x000a',
      maxPriorityFeePerGas: '0x0002',
      maxFeePerGas: '0x0064',
      value: '0x0001'
    })

    expect(tx).toMatchObject({
      chainId: '0x1',
      nonce: '0x7',
      gasLimit: '0x5208',
      gasPrice: '0xa',
      maxPriorityFeePerGas: '0x2',
      maxFeePerGas: '0x64',
      value: '0x1',
      type: '0x0'
    })
  })

  it('normalizes a valid access list without changing its order or duplicates', () => {
    const address = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const storageKey = `0x${'BB'.repeat(32)}`

    const tx = getRawTx({
      accessList: [{ address, storageKeys: [storageKey, storageKey] }]
    })

    expect(tx.accessList).toEqual([
      {
        address: address.toLowerCase(),
        storageKeys: [storageKey.toLowerCase(), storageKey.toLowerCase()]
      }
    ])
  })

  it('rejects malformed access-list input', () => {
    expect(() =>
      getRawTx({
        accessList: [{ address: '0x1234', storageKeys: [] }]
      })
    ).toThrow(/access list.*invalid address/i)
  })

  const invalidNonces = [
    { description: 'non-numeric', nonce: 'invalid' },
    { description: 'negative integer', nonce: '-360' },
    { description: 'non-integer numeric', nonce: '3.60' }
  ]
  invalidNonces.forEach(({ description, nonce }) => {
    it(`should reject a ${description} nonce`, () => {
      expect(() => getRawTx({ nonce })).toThrow('Invalid nonce')
    })
  })
})

describe('#resError', () => {
  const request = { id: 7, jsonrpc: '2.0' }

  it('uses the JSON-RPC internal error code for generated string failures', () => {
    const res = jest.fn()

    resError('failed locally', request, res)

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({
      ...request,
      error: { message: 'failed locally', code: -32603 }
    })
  })

  it('preserves supplied error codes and data', () => {
    const res = jest.fn()
    const error = { message: 'upstream failure', code: -32042, data: { reason: 'reverted' } }

    resError(error, request, res)

    expect(res).toHaveBeenCalledTimes(1)
    expect(res).toHaveBeenCalledWith({ ...request, error })
  })

  it('preserves a supplied zero code instead of replacing it', () => {
    const res = jest.fn()

    resError({ message: 'zero', code: 0 }, request, res)

    expect(res).toHaveBeenCalledWith({ ...request, error: { message: 'zero', code: 0 } })
  })
})

describe('#getSignedAddress', () => {
  it('returns a verified address for a valid signature', () => {
    const signature =
      '0xa4ba512820eab7022d0c88b9335425b6235c184565c84fb9e451965844a185030baec17ac9565c666675525cae41e367c458c1fdf575a80f6a44197d3b48c0ba1c'
    const message = fromUtf8('Example `personal_sign` message')

    getSignedAddress(signature, message, (err, verifiedAddress) => {
      expect(err).toBeFalsy()
      expect(verifiedAddress.toLowerCase()).toBe('0x3a077715f7383ad97215d1a585778bce6a9aa8af')
    })
  })

  it('returns an error if no signature is provided', () => {
    getSignedAddress(null, 'some message', (err) => {
      expect(err).toBeTruthy()
    })
  })
})
