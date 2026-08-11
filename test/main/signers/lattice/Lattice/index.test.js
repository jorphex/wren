import Lattice, { Status } from '../../../../../main/signers/lattice/Lattice'
import { Client } from 'gridplus-sdk'
import log from 'electron-log'
import { Derivation } from '../../../../../main/signers/Signer/derive'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'
import { USER_REJECTED_REQUEST } from '../../../../../main/signers/errors'

jest.mock('gridplus-sdk')

let lattice

beforeAll(() => {
  log.transports.console.level = false
  jest.useFakeTimers()
})

afterAll(() => {
  log.transports.console.level = 'debug'
  jest.useRealTimers()
})

beforeEach(() => {
  lattice = new Lattice('L8geF2', 'Gridplus-test', 'ABCXYZ')
  lattice.derivation = Derivation.standard
  lattice.on('error', jest.fn())
})

function deferred() {
  let resolve, reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('#connect', () => {
  const baseUrl = 'https://gridplus.io',
    privateKey = 'supersecretkey'

  let connectFn, pairingStatus

  beforeEach(() => {
    pairingStatus = false
    connectFn = jest.fn()

    Client.mockImplementation((opts) => {
      expect(opts.name).toBe('Frame-ABCXYZ')
      expect(opts.baseUrl).toBe('https://gridplus.io')
      expect(opts.privKey).toBe('supersecretkey')

      return {
        connect: connectFn,
        getFwVersion: () => ({ major: 0, minor: 13, fix: 4 }),
        getAppName: () => 'frame-test'
      }
    })

    connectFn.mockImplementation(async (deviceId) => {
      if (deviceId === 'L8geF2') {
        return pairingStatus
      }

      throw new Error('connection error!')
    })
  })

  it('emits an update with connecting status', (done) => {
    lattice.once('update', () => {
      try {
        expect(lattice.status).toBe('connecting')
        done()
      } catch (e) {
        done(e)
      }
    })

    lattice.connect(baseUrl, privateKey)
  })

  it('connects when not paired', async () => {
    pairingStatus = false

    const paired = await lattice.connect(baseUrl, privateKey)

    expect(paired).toBe(false)
  })

  it('emits an update if not yet paired', (done) => {
    pairingStatus = false

    const stateFlow = []
    lattice.on('update', () => {
      stateFlow.push(lattice.status)

      if (stateFlow.length === 2) {
        try {
          expect(stateFlow[0]).toBe('connecting')
          expect(stateFlow[1]).toBe(Status.READY_FOR_PAIRING)
          done()
        } catch (e) {
          done(e)
        }
      }
    })

    lattice.connect(baseUrl, privateKey)
  })

  it('emits a connect event', (done) => {
    pairingStatus = true

    lattice.once('connect', (paired) => {
      try {
        expect(paired).toBe(true)
        done()
      } catch (e) {
        done(e)
      }
    })

    lattice.connect(baseUrl, privateKey)
  })

  it('emits an error event when device is locked', async () => {
    connectFn.mockRejectedValue(new Error('Error from device: Device Locked'))

    const handler = new Promise((resolve, reject) => {
      lattice.once('connect', () => reject(new Error('should not be connected!')))

      lattice.once('error', () => {
        try {
          expect(lattice.status).toBe('locked')
          resolve()
        } catch (e) {
          reject(e)
        }
      })
    })

    try {
      await lattice.connect(baseUrl, privateKey)
      throw new Error('should have failed to connect!')
    } catch (e) {
      expect(e.message.toLowerCase()).toMatch(/device locked/)
    }

    return handler
  })

  it('emits an error event when device returns invalid request', async () => {
    connectFn.mockRejectedValue(new Error('Error from device: Invalid Request'))

    const handler = new Promise((resolve, reject) => {
      lattice.once('connect', () => reject('should not be connected!'))

      lattice.once('error', () => {
        try {
          expect(lattice.status).toBe(Status.UNKNOWN_ERROR)
          resolve()
        } catch (e) {
          reject(e)
        }
      })
    })

    try {
      await lattice.connect(baseUrl, privateKey)
      throw new Error('should have failed to connect!')
    } catch (e) {
      expect(e.message.toLowerCase()).toMatch(/invalid request/)
    }

    return handler
  })

  it('sets the version', async () => {
    await lattice.connect(baseUrl, privateKey)

    expect(lattice.appVersion).toStrictEqual({
      major: 0,
      minor: 13,
      patch: 4
    })
  })

  it('allows only the latest concurrent connection to update state', async () => {
    const first = deferred()
    const second = deferred()
    const firstClient = {
      connect: jest.fn(() => first.promise),
      getFwVersion: () => ({ major: 0, minor: 10, fix: 1 })
    }
    const secondClient = {
      connect: jest.fn(() => second.promise),
      getFwVersion: () => ({ major: 1, minor: 2, fix: 3 })
    }
    Client.mockImplementationOnce(() => firstClient).mockImplementationOnce(() => secondClient)

    const connectEvents = jest.fn()
    lattice.on('connect', connectEvents)

    const firstConnect = lattice.connect('https://first.example', 'first-key')
    const secondConnect = lattice.connect('https://second.example', 'second-key')

    second.resolve(true)
    await expect(secondConnect).resolves.toBe(true)

    first.resolve(false)
    await expect(firstConnect).rejects.toThrow(/connection changed/)

    expect(lattice.connection).toBe(secondClient)
    expect(lattice.appVersion).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(connectEvents).toHaveBeenCalledTimes(1)
    expect(connectEvents).toHaveBeenCalledWith(true)
  })

  it('does not publish a late connection after close', async () => {
    const pending = deferred()
    Client.mockImplementationOnce(() => ({
      connect: jest.fn(() => pending.promise),
      getFwVersion: () => ({ major: 1, minor: 0, fix: 0 })
    }))
    const connectEvents = jest.fn()
    lattice.on('connect', connectEvents)

    const connecting = lattice.connect(baseUrl, privateKey)
    lattice.close()
    pending.resolve(true)

    await expect(connecting).rejects.toThrow(/connection changed/)
    expect(connectEvents).not.toHaveBeenCalled()
    expect(lattice.connection).toBe(null)
  })
})

describe('#pair', () => {
  const pairingCode = 'JG7F9XS3'

  beforeEach(() => {
    lattice.connection = {
      pair: jest.fn(async (code) => {
        if (code === pairingCode) return true
        throw new Error('Error from device: Pairing failed')
      })
    }
  })

  it('emits an update with pairing status', (done) => {
    lattice.once('update', () => {
      try {
        expect(lattice.status).toBe(Status.PAIRING)
        done()
      } catch (e) {
        done(e)
      }
    })

    lattice.pair(pairingCode)
  })

  it('emits a paired event', (done) => {
    lattice.once('paired', (hasActiveWallet) => {
      try {
        expect(hasActiveWallet).toBe(true)
        done()
      } catch (e) {
        done(e)
      }
    })

    lattice.pair(pairingCode)
  })

  it('returns whether a wallet is active or not', async () => {
    lattice.connection.pair.mockResolvedValue(false)

    const hasActiveWallet = await lattice.pair(pairingCode)

    expect(hasActiveWallet).toBe(false)
    expect(lattice.status).toBe(Status.NO_ACTIVE_WALLET)
  })

  it('does not write the pairing code to logs', async () => {
    const info = jest.spyOn(log, 'info').mockImplementation(() => {})

    try {
      await lattice.pair(pairingCode)
      expect(JSON.stringify(info.mock.calls)).not.toContain(pairingCode)
    } finally {
      info.mockRestore()
    }
  })

  it('emits an error event on failure', async () => {
    const handler = new Promise((resolve, reject) => {
      lattice.once('paired', () => reject('should not be paired!'))

      lattice.once('error', () => {
        try {
          expect(lattice.status).toBe(Status.PAIRING_FAILED)
          resolve()
        } catch (e) {
          reject(e)
        }
      })
    })

    try {
      await lattice.pair('SDFJOSJD')
      throw new Error('should have failed to connect!')
    } catch (e) {
      expect(e.message.toLowerCase()).toMatch(/pairing failed/)
    }

    return handler
  })

  it('serializes concurrent pairing prompts', async () => {
    const first = deferred()
    const second = deferred()
    lattice.connection.pair
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const firstPair = lattice.pair('FIRST')
    const secondPair = lattice.pair('SECOND')
    await Promise.resolve()
    await Promise.resolve()

    expect(lattice.connection.pair).toHaveBeenCalledTimes(1)

    first.resolve(true)
    await expect(firstPair).resolves.toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(lattice.connection.pair).toHaveBeenCalledTimes(2)

    second.resolve(true)
    await expect(secondPair).resolves.toBe(true)
  })

  it('normalizes a declined pairing request without emitting a device error', async () => {
    lattice.connection.pair.mockRejectedValue({
      name: 'LatticeResponseError',
      responseCode: 132,
      errorMessage: 'Request declined by user'
    })
    const errorHandler = jest.fn()
    lattice.removeAllListeners('error')
    lattice.on('error', errorHandler)

    await expect(lattice.pair(pairingCode)).rejects.toMatchObject({ code: USER_REJECTED_REQUEST })
    expect(lattice.status).toBe(Status.READY_FOR_PAIRING)
    expect(errorHandler).not.toHaveBeenCalled()
  })

  it('invalidates an active pairing prompt when a new connection starts', async () => {
    const pairing = deferred()
    const connecting = deferred()
    lattice.connection.pair.mockImplementationOnce(() => pairing.promise)
    Client.mockImplementationOnce(() => ({
      connect: jest.fn(() => connecting.promise),
      getFwVersion: () => ({ major: 1, minor: 0, fix: 0 })
    }))
    const pairedHandler = jest.fn()
    lattice.on('paired', pairedHandler)

    const pairingRequest = lattice.pair(pairingCode)
    await Promise.resolve()
    await Promise.resolve()
    const connectionRequest = lattice.connect('https://replacement.example', 'replacement-key')

    await expect(pairingRequest).rejects.toThrow(/connection changed/)
    pairing.resolve(true)
    connecting.resolve(false)
    await expect(connectionRequest).resolves.toBe(false)

    expect(pairedHandler).not.toHaveBeenCalled()
    expect(lattice.status).toBe(Status.READY_FOR_PAIRING)
  })
})

describe('#deriveAddresses', () => {
  beforeEach(() => {
    lattice.accountLimit = 5
    lattice.derivation = Derivation.standard

    lattice.connection = {
      getAppName: () => 'frame-test',
      getAddresses: jest.fn(async (opts) => {
        return Array(opts.n)
          .fill()
          .map((_, i) => `addr${opts.startPath[4] + i}`)
      })
    }
  })

  it('derives addresses using standard derivation', async () => {
    // 44'/60'/0'/0/<index>
    lattice.derivation = Derivation.standard

    await lattice.deriveAddresses()

    expect(lattice.connection.getAddresses).toHaveBeenCalledWith(
      expect.objectContaining({
        startPath: [0x80000000 + 44, 0x80000000 + 60, 0x80000000, 0, 0]
      })
    )
  })

  it('derives addresses using legacy derivation', async () => {
    // 44'/60'/0'/<index>
    lattice.derivation = Derivation.legacy
    lattice.accountLimit = 10
    lattice.addresses = ['addr1', 'addr2', 'addr3', 'addr4', 'addr5']

    await lattice.deriveAddresses()

    expect(lattice.connection.getAddresses).toHaveBeenCalledWith(
      expect.objectContaining({
        startPath: [0x80000000 + 44, 0x80000000 + 60, 0x80000000, 5]
      })
    )
  })

  it('derives addresses using live derivation', async () => {
    // 44'/60'/<index>'/0/0
    lattice.derivation = Derivation.live

    await lattice.deriveAddresses()

    const expectedIndexes = [0, 1, 2, 3, 4]

    expect(lattice.connection.getAddresses).toHaveBeenCalledTimes(expectedIndexes.length)

    expectedIndexes.forEach((n) => {
      expect(lattice.connection.getAddresses).toHaveBeenNthCalledWith(
        n + 1,
        expect.objectContaining({
          startPath: [0x80000000 + 44, 0x80000000 + 60, 0x80000000 + n, 0, 0]
        })
      )
    })
  })

  it('emits an update with deriving status', (done) => {
    lattice.once('update', () => {
      try {
        expect(lattice.status).toBe(Status.DERIVING)
        done()
      } catch (e) {
        done(e)
      }
    })

    lattice.deriveAddresses()
  })

  it('derives new addresses', async () => {
    await lattice.deriveAddresses()

    expect(lattice.status).toBe(Status.OK)
    expect(lattice.addresses).toStrictEqual(['0xaddr0', '0xaddr1', '0xaddr2', '0xaddr3', '0xaddr4'])
  })

  it('derives addresses when the limit has increased', async () => {
    lattice.addresses = [0, 1, 2, 3, 4].map((l) => `addr${l}`)
    lattice.accountLimit = 10

    await lattice.deriveAddresses()

    expect(lattice.status).toBe(Status.OK)
    expect(lattice.addresses).toStrictEqual([
      '0xaddr0',
      '0xaddr1',
      '0xaddr2',
      '0xaddr3',
      '0xaddr4',
      '0xaddr5',
      '0xaddr6',
      '0xaddr7',
      '0xaddr8',
      '0xaddr9'
    ])
  })

  it('derives no addresses when enough have already been derived', async () => {
    lattice.addresses = Array(10)
      .fill()
      .map((_, i) => `addr${i + 10}`)
    lattice.accountLimit = 5

    await lattice.deriveAddresses()

    expect(lattice.connection.getAddresses).not.toHaveBeenCalled()
    expect(lattice.addresses.length).toBe(10)
  })

  it('retries on failure', async () => {
    let requestNum = 0

    lattice.connection.getAddresses.mockImplementation(async () => {
      if ((requestNum += 1) === 1) {
        throw new Error('Error from device: Getting addresses failed')
      }
      return ['addr1', 'addr2', 'addr3', 'addr4', 'addr5']
    })

    const errorHandler = jest.fn()
    lattice.on('error', errorHandler)

    const deriving = lattice.deriveAddresses()
    await jest.advanceTimersByTimeAsync(3000)
    await deriving

    expect(errorHandler).not.toHaveBeenCalled()
    expect(lattice.addresses).toHaveLength(5)
  })

  it('emits an error event on failure', (done) => {
    lattice.connection.getAddresses.mockImplementation(async () => {
      throw new Error('Error from device: Getting addresses failed')
    })

    lattice.on('update', () => {
      if (lattice.status === Status.OK) done('should not have derived!')
    })

    lattice.once('error', () => {
      try {
        expect(lattice.addresses).toHaveLength(0)
        expect(lattice.status.toLowerCase()).toMatch(/error/)
        done()
      } catch (e) {
        done(e)
      }
    })

    lattice.deriveAddresses(Derivation.standard, 0)
  })

  it('discards a stale derivation when a newer derivation starts', async () => {
    const first = deferred()
    lattice.connection.getAddresses
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async (opts) =>
        Array(opts.n)
          .fill()
          .map((_, i) => `legacy${opts.startPath[3] + i}`)
      )

    const standard = lattice.deriveAddresses(Derivation.standard, 0)
    await Promise.resolve()
    await Promise.resolve()
    const legacy = lattice.deriveAddresses(Derivation.legacy, 0)

    first.resolve(['standard0', 'standard1', 'standard2', 'standard3', 'standard4'])
    await standard
    await legacy

    expect(lattice.derivation).toBe(Derivation.legacy)
    expect(lattice.addresses).toEqual(['0xlegacy0', '0xlegacy1', '0xlegacy2', '0xlegacy3', '0xlegacy4'])
  })

  it('uses the derivation and account limit captured before awaiting the device', async () => {
    const addresses = deferred()
    lattice.connection.getAddresses.mockImplementationOnce(() => addresses.promise)

    const deriving = lattice.deriveAddresses(Derivation.standard, 0)
    await Promise.resolve()
    await Promise.resolve()
    lattice.derivation = Derivation.legacy
    lattice.accountLimit = 10
    addresses.resolve(['addr0', 'addr1', 'addr2', 'addr3', 'addr4'])
    await deriving

    expect(lattice.connection.getAddresses).toHaveBeenCalledTimes(1)
    expect(lattice.connection.getAddresses).toHaveBeenCalledWith(
      expect.objectContaining({ startPath: [0x8000002c, 0x8000003c, 0x80000000, 0, 0], n: 5 })
    )
    expect(lattice.addresses).toHaveLength(5)
  })

  it('does not commit addresses after disconnect', async () => {
    const addresses = deferred()
    lattice.connection.getAddresses.mockImplementationOnce(() => addresses.promise)

    const deriving = lattice.deriveAddresses(Derivation.standard, 0)
    await Promise.resolve()
    await Promise.resolve()
    lattice.disconnect()
    await deriving

    addresses.resolve(['late0', 'late1', 'late2', 'late3', 'late4'])
    await Promise.resolve()
    await Promise.resolve()

    expect(lattice.connection).toBe(null)
    expect(lattice.addresses).toEqual([])
    expect(lattice.status).toBe('disconnected')
  })
})

describe('#verifyAddress', () => {
  beforeEach(() => {
    lattice.addresses = ['addr1', 'addr2', 'addr3', 'addr4', 'addr5']
    lattice.accountLimit = 5
    lattice.connection = { getAddresses: jest.fn(), getAppName: () => 'frame-test' }
  })

  it('verifies a matching address', (done) => {
    lattice.verifyAddress(2, 'addr3', false, (err, result) => {
      try {
        expect(err).toBe(null)
        expect(result).toBe(true)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('identifies a non-matching address', (done) => {
    lattice.verifyAddress(2, 'addrX', false, (err, result) => {
      try {
        expect(err.message.toLowerCase()).toBe('address does not match device')
        expect(result).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('fails if deriving addresses fails', (done) => {
    lattice.addresses = []
    lattice.connection.getAddresses = async () => {
      throw new Error('error!')
    }

    lattice.verifyAddress(2, 'addr3', false, (err, result) => {
      try {
        expect(err.message.toLowerCase()).toContain('could not derive addresses: error!')
        expect(result).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})

describe('#signMessage', () => {
  beforeEach(() => {
    lattice.connection = {
      sign: jest.fn(async (opts) => {
        if (
          opts.currency === 'ETH_MSG' &&
          opts.data.protocol === 'signPersonal' &&
          opts.data.payload &&
          opts.data.signerPath[4] === 4
        ) {
          return {
            sig: {
              r: '0x9af6cb',
              s: '0xabcd04',
              v: 28n
            }
          }
        }

        throw new Error('invalid message!')
      })
    }
  })

  it('signs a valid message', (done) => {
    lattice.signMessage(4, 'sign this please', (err, res) => {
      try {
        expect(err).toBe(null)
        expect(res).toBe('0x9af6cbabcd041c')
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('returns an error on failure', (done) => {
    // wrong index, mock function expects 4, not 3
    lattice.signMessage(3, 'sign this please', (err, res) => {
      try {
        expect(err.message).toBe('invalid message!')
        expect(res).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('rejects an incomplete signature response', (done) => {
    lattice.connection.sign.mockResolvedValue({ sig: { r: '0x1', s: '0x2' } })

    lattice.signMessage(4, 'sign this please', (err, res) => {
      try {
        expect(err.message).toBe('Lattice returned an incomplete signature')
        expect(res).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('normalizes a device rejection to provider code 4001', (done) => {
    lattice.connection.sign.mockRejectedValue({
      name: 'LatticeResponseError',
      responseCode: 132,
      errorMessage: 'Request declined by user'
    })

    lattice.signMessage(4, 'sign this please', (err, res) => {
      try {
        expect(err.code).toBe(USER_REJECTED_REQUEST)
        expect(res).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('preserves non-rejection device errors', (done) => {
    const deviceError = new Error('relay unavailable')
    lattice.connection.sign.mockRejectedValue(deviceError)

    lattice.signMessage(4, 'sign this please', (err, res) => {
      try {
        expect(err).toBe(deviceError)
        expect(res).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('settles once with a disconnect error when a pending prompt is invalidated', async () => {
    const pending = deferred()
    lattice.connection.sign.mockImplementationOnce(() => pending.promise)
    const callback = jest.fn()

    lattice.signMessage(4, 'sign this please', callback)
    await Promise.resolve()
    await Promise.resolve()
    lattice.disconnect()
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toMatch(/disconnected/)

    pending.resolve({ sig: { r: '0x1', s: '0x2', v: 27 } })
    await Promise.resolve()
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent signing prompts', async () => {
    const first = deferred()
    const second = deferred()
    lattice.connection.sign
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const firstCallback = jest.fn()
    const secondCallback = jest.fn()
    const firstSigning = lattice.signMessage(4, 'first', firstCallback)
    const secondSigning = lattice.signMessage(4, 'second', secondCallback)
    await Promise.resolve()
    await Promise.resolve()

    expect(lattice.connection.sign).toHaveBeenCalledTimes(1)

    first.resolve({ sig: { r: '0x1', s: '0x2', v: 27 } })
    await firstSigning
    await Promise.resolve()
    expect(lattice.connection.sign).toHaveBeenCalledTimes(2)

    second.resolve({ sig: { r: '0x3', s: '0x4', v: 28 } })
    await secondSigning
    expect(firstCallback).toHaveBeenCalledTimes(1)
    expect(secondCallback).toHaveBeenCalledTimes(1)
  })
})

describe('#signTypedData', () => {
  beforeEach(() => {
    lattice.connection = {
      sign: jest.fn(async (opts) => {
        if (
          opts.currency === 'ETH_MSG' &&
          opts.data.protocol === 'eip712' &&
          opts.data.payload &&
          opts.data.signerPath[4] === 2
        ) {
          return {
            sig: {
              r: '0x3ea8cd',
              s: '0xabcd04',
              v: 27n
            }
          }
        }

        throw new Error('invalid message!')
      })
    }
  })

  it('signs a valid typed data message', (done) => {
    lattice.signTypedData(2, { version: SignTypedDataVersion.V4, data: 'typed data' }, (err, res) => {
      try {
        expect(err).toBe(null)
        expect(res).toBe('0x3ea8cdabcd041b')
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('returns an error on failure', (done) => {
    // wrong index, mock function expects 2, not 3
    lattice.signTypedData(3, { version: SignTypedDataVersion.V4, data: 'typed data' }, (err, res) => {
      try {
        expect(err.message).toBe('invalid message!')
        expect(res).toBe(undefined)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})

describe('#signTransaction', () => {
  const tx = {
    chainId: '0x89'
  }

  const expectedSignature = {
    sig: {
      r: '0x3ea8cd',
      s: '0x96f7a0',
      v: 0n
    }
  }

  beforeEach(() => {
    lattice.appVersion = { major: 1, minor: 1, patch: 0 }
    lattice.connection = { sign: jest.fn(), getFwVersion: async () => ({ major: 1, minor: 3, fix: 5 }) }
  })

  it('signs a legacy transaction', (done) => {
    // Lattice expects the type to be undefined for legacy transactions,
    // sending a type of zero if EIP-1559 is enabled will cause an error
    const txToSign = { ...tx, type: '0x0' }

    lattice.connection.sign.mockImplementation(async (opts) => {
      try {
        expect(opts.currency).toBe('ETH')
        expect(opts.data.type).toBe(undefined)
        expect(opts.data.signerPath[4]).toBe(4)
        expect(parseInt(opts.data.chainId)).toBe(137)

        return {
          sig: {
            ...expectedSignature.sig,
            v: 27n
          }
        }
      } catch (e) {
        done(e)
      }
    })

    lattice.signTransaction(4, txToSign, (err, res) => {
      try {
        expect(err).toBe(null)
        expect(res).toBe('0xcf8080808080801b833ea8cd8396f7a0')
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('signs a post eip-1559 transaction', (done) => {
    const accessList = [
      {
        address: '0x0000000000000000000000000000000000000001',
        storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000002']
      }
    ]
    const txToSign = { ...tx, type: '0x2', accessList }

    lattice.connection.sign.mockImplementation(async (opts) => {
      try {
        expect(opts.currency).toBe('ETH')
        expect(opts.data.type).toBe(2)
        expect(opts.data.accessList).toEqual(accessList)
        expect(opts.data.signerPath[4]).toBe(4)
        expect(parseInt(opts.data.chainId)).toBe(137)

        return expectedSignature
      } catch (e) {
        done(e)
      }
    })

    lattice.signTransaction(4, txToSign, (err, res) => {
      try {
        expect(err).toBe(null)
        expect(res).toBe(
          '0x02f84c818980808080808080f838f7940000000000000000000000000000000000000001e1a0000000000000000000000000000000000000000000000000000000000000000280833ea8cd8396f7a0'
        )
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('uses the downgraded legacy type in the device payload', (done) => {
    lattice.appVersion = { major: 0, minor: 10, patch: 0 }
    const txToSign = {
      ...tx,
      type: '0x2',
      maxFeePerGas: '0x2',
      maxPriorityFeePerGas: '0x1'
    }

    lattice.connection.sign.mockImplementation(async (opts) => {
      try {
        expect(opts.currency).toBe('ETH')
        expect(opts.data.type).toBe(undefined)
        expect(opts.data.gasPrice).toBe(2)

        return {
          sig: {
            ...expectedSignature.sig,
            v: 27n
          }
        }
      } catch (e) {
        done(e)
      }
    })

    lattice.signTransaction(4, txToSign, (err) => {
      try {
        expect(err).toBe(null)
        done()
      } catch (e) {
        done(e)
      }
    })
  })

  it('uses the ETH currency for modern generic transaction signing', (done) => {
    lattice.connection.getFwVersion = () => ({ major: 0, minor: 15, fix: 0 })
    const txToSign = { ...tx, type: '0x0' }

    lattice.connection.sign.mockImplementation(async (opts) => {
      try {
        expect(opts.currency).toBe('ETH')
        expect(opts.data.payload).toBeTruthy()
        expect(opts.data.signerPath[4]).toBe(4)

        return {
          sig: {
            ...expectedSignature.sig,
            v: 27n
          }
        }
      } catch (e) {
        done(e)
      }
    })

    lattice.signTransaction(4, txToSign, (err, res) => {
      try {
        expect(err).toBe(null)
        expect(res).toBe('0xcf8080808080801b833ea8cd8396f7a0')
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})

describe('#disconnect', () => {
  it('emits an update if Lattice was connected', () => {
    lattice.status = Status.OK

    const updateHandler = jest.fn()
    lattice.once('update', updateHandler)

    lattice.disconnect()

    expect(lattice.status).toBe('disconnected')
    expect(updateHandler).toHaveBeenCalled()
  })

  it('does not change an error status', () => {
    lattice.status = 'some error'

    const updateHandler = jest.fn()
    lattice.once('update', updateHandler)

    lattice.disconnect()

    expect(lattice.status).toBe('some error')
    expect(updateHandler).not.toHaveBeenCalled()
  })

  it('removes the connection', () => {
    lattice.connection = 'a connection'

    lattice.disconnect()

    expect(lattice.connection).toBeFalsy()
  })

  it('clears addresses', () => {
    lattice.addresses = ['addr1', 'addr2', 'etc']

    lattice.disconnect()

    expect(lattice.addresses).toHaveLength(0)
  })

  it('normalizes an interrupted operation state to disconnected', () => {
    lattice.status = Status.PAIRING

    lattice.disconnect()

    expect(lattice.status).toBe('disconnected')
  })
})

describe('#close', () => {
  it('emits a close event', () => {
    const updateHandler = jest.fn()
    lattice.once('close', updateHandler)

    lattice.close()

    expect(updateHandler).toHaveBeenCalled()
  })

  it('removes all listeners', () => {
    lattice.on('close', jest.fn())

    lattice.close()

    expect(lattice.listenerCount('close')).toBe(0)
  })

  it('disconnects', () => {
    lattice.connection = 'a connection'

    lattice.close()

    expect(lattice.connection).toBeFalsy()
  })
})

describe('#summary', () => {
  it('only returns addresses up to the address limit', () => {
    lattice.addresses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    lattice.accountLimit = 5

    expect(lattice.summary().addresses).toHaveLength(5)
  })
})
