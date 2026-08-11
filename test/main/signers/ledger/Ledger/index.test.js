import Ledger, { Status } from '../../../../../main/signers/ledger/Ledger'
import Eth from '../../../../../main/signers/ledger/Ledger/eth'
import { Derivation } from '../../../../../main/signers/Signer/derive'
import log from 'electron-log'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

jest.mock('../../../../../main/signers/ledger/Ledger/eth')
jest.mock('@ledgerhq/hw-transport-node-hid-noevents')

function runNextRequest() {
  // move forward in time to allow the queue to process one request
  jest.advanceTimersByTime(200)
}

async function connectEthApp() {
  Eth.mock.instances[0].getAppConfiguration.mockResolvedValue({ version: '2.0.1' })

  return new Promise((resolve) => {
    ledger.on('update', () => {
      if (ledger.status === Status.OK) resolve()
    })

    // connect and run initial request to derive addresses
    ledger.connect().then(runNextRequest)
  })
}

function verifyDone(done, expectations) {
  verify(done, expectations, true)
}

function verify(done, expectations, complete = false) {
  try {
    expectations()
    if (complete) done()
  } catch (e) {
    done(e)
  }
}

function verifyPromise(resolve, reject, expectations) {
  try {
    expectations()
    resolve()
  } catch (e) {
    reject(e)
  }
}

const addresses = ['0xf10326c1c6884b094e03d616cc8c7b920e3f73e0', '0xa16002db5438b5862270a9e404346e3c3b059eeb']

let ledger

beforeAll(() => {
  jest.useFakeTimers()
  log.transports.console.level = false
})

beforeEach(async () => {
  Eth.mockClear()

  ledger = new Ledger('usb-path')
  ledger.derivation = Derivation.legacy

  await ledger.open()

  Eth.mock.instances[0].deriveAddresses.mockImplementation(() => Promise.resolve(addresses))
})

afterEach(async () => {
  ledger.removeAllListeners()
  await ledger.disconnect()
})

afterAll(() => {
  jest.useRealTimers()
  log.transports.console.level = 'debug'
})

describe('#connect', () => {
  describe('when the eth app is open', () => {
    beforeEach(() => {
      Eth.mock.instances[0].getAppConfiguration.mockResolvedValue({ version: '1.9.2' })
    })

    it('sets the version', async () => {
      await ledger.connect()

      expect(ledger.appVersion).toEqual({
        major: 1,
        minor: 9,
        patch: 2
      })
    })

    it('detects that the app is locked', async () => {
      const stateFlow = []

      Eth.mock.instances[0].getAddress.mockRejectedValue({ statusCode: 27404 })

      ledger.on('update', () => {
        stateFlow.push(ledger.status)
      })

      await ledger.connect()

      expect(stateFlow).toEqual([Status.INITIAL])
      expect(ledger.status).toBe(Status.LOCKED)
      expect(ledger.eth).toBeDefined()
    })

    it('derives addresses after connecting', (done) => {
      const stateFlow = []

      ledger.on('update', () => {
        stateFlow.push(ledger.status)

        if (ledger.status === Status.OK) {
          verifyDone(done, () => {
            expect(ledger.addresses).toEqual(addresses)
            expect(stateFlow).toEqual([Status.INITIAL, Status.DERIVING, Status.OK])
          })
        }
      })

      ledger.connect().then(runNextRequest)
    })
  })

  describe('when the eth app is not open', () => {
    // these status codes all represent a different app or the Ledger main menu being open
    const statusCodes = [27904, 27906, 25873, 25871]

    statusCodes.forEach((code) => {
      it(`sets the status to wrong application and disconnects the signer when the status code is ${code}`, async () => {
        Eth.mock.instances[0].getAppConfiguration.mockRejectedValue({ statusCode: code })

        ledger.on('update', () => {
          expect(ledger.status).toEqual(Status.WRONG_APP)
        })

        await ledger.connect()

        expect(ledger.eth).not.toBeDefined()
      })
    })
  })
})

describe('#deriveAddress', () => {
  beforeEach(async () => {
    await connectEthApp()
  })

  it('derives hardware addresses', (done) => {
    const stateFlow = []

    ledger.on('update', () => {
      stateFlow.push(ledger.status)

      if (ledger.status === Status.DERIVING) {
        verify(done, () => expect(ledger.addresses).toHaveLength(0))
      }

      if (ledger.status === Status.OK) {
        verifyDone(done, () => {
          expect(stateFlow).toEqual([Status.DERIVING, Status.OK])
          expect(ledger.addresses).toEqual(addresses)
        })
      }
    })

    ledger.derivation = Derivation.legacy
    ledger.deriveAddresses()
    runNextRequest()
  })

  it('derives live addresses', (done) => {
    Eth.mock.instances[0].getAddress.mockImplementation((path) => {
      if (path === "44'/60'/0'/0/0") return Promise.resolve({ address: addresses[0] })
      if (path === "44'/60'/1'/0/0") return Promise.resolve({ address: addresses[1] })

      return Promise.reject('unknown path!')
    })

    const stateFlow = []

    const firstUpdateDone = new Promise((resolve) => {
      ledger.on('update', () => {
        stateFlow.push(ledger.status)

        if (ledger.status === Status.DERIVING) {
          verify(done, () => expect(ledger.addresses).toHaveLength(0))
        }

        if (ledger.status === Status.OK) {
          if (ledger.addresses.length === 2) {
            verifyDone(done, () => {
              expect(stateFlow).toEqual([Status.DERIVING, Status.OK, Status.OK])
              expect(ledger.addresses).toEqual(addresses)
            })
          } else {
            // resolve this promise to run the next request
            resolve()
          }
        }
      })

      ledger.accountLimit = 2
      ledger.derivation = Derivation.live
      ledger.deriveAddresses()

      runNextRequest()
    })

    // all this craziness is necessary to simulate the queue running multiple
    // requests, resolving their promsies, and advancing the timer to run the next request
    firstUpdateDone
      .then(() => {})
      .then(() => {})
      .then(runNextRequest)
  })
})

describe('#verifyAddress', () => {
  beforeEach(async () => {
    await connectEthApp()

    Eth.mock.instances[0].getAddress.mockImplementation(
      (path) =>
        new Promise((resolve) => {
          resolve({
            address:
              path === "44'/60'/0'/9"
                ? '0xe9d6f5779cf6936de03c0bec631f3bb3e336d98d'
                : '0xCd37a15BdfEc87D0e383E628da2399053D5948ca'
          })
        })
    )
  })

  it('verifies an address', (done) => {
    ledger.once('update', () => done('status updated unexpectedly!'))

    ledger.verifyAddress(9, '0xe9d6f5779cf6936de03c0bec631f3bb3e336d98d', false, (err, verified) => {
      verifyDone(done, () => {
        expect(verified).toBe(true)
        expect(err).toBeFalsy()
      })
    })

    runNextRequest()
  })

  const errorCases = [
    {
      testCase: 'the address does not match',
      expectedError: 'Address does not match device'
    },
    {
      testCase: 'there is a communication error',
      setup: () => Eth.mock.instances[0].getAddress.mockRejectedValue({ statusCode: -1 })
    },
    {
      testCase: 'the eth app is not initialized',
      setup: () => (ledger.eth = undefined)
    },
    {
      testCase: 'the derivation type is not initialized',
      setup: () => (ledger.derivation = undefined)
    }
  ]

  errorCases.forEach(({ testCase, setup = () => {}, expectedError = 'Verify address error' }) => {
    it(`fails if ${testCase}`, async () => {
      const statusUpdate = new Promise((resolve, reject) => {
        ledger.on('update', () => {
          verifyPromise(resolve, reject, () => expect(ledger.status).toBe(Status.NEEDS_RECONNECTION))
        })
      })

      const callback = new Promise((resolve, reject) => {
        setup()

        ledger.verifyAddress(1, '0xe9d6f5779cf6936de03c0bec631f3bb3e336d98d', false, (err, verified) => {
          verifyPromise(resolve, reject, () => {
            expect(verified).toBeUndefined()
            expect(err.message).toBe(expectedError)
          })
        })
      })

      runNextRequest()

      return Promise.all([statusUpdate, callback])
    })
  })

  it('reports user rejection without disconnecting the signer', async () => {
    Eth.mock.instances[0].getAddress.mockRejectedValue({ statusCode: 27013 })

    const callback = jest.fn()
    ledger.verifyAddress(1, addresses[0], true, callback)
    await Promise.resolve()
    await Promise.resolve()
    runNextRequest()
    await Promise.resolve()
    await Promise.resolve()
    runNextRequest()
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toMatchObject({
      code: 4001,
      message: 'Verify request rejected by user'
    })
    expect(ledger.status).toBe(Status.OK)
  })
})

const signingMethods = ['signMessage', 'signTransaction']

signingMethods.forEach((signingMethod) => {
  const signType = signingMethod.substring(4).toLowerCase()

  describe(`#${signingMethod}`, () => {
    beforeEach(async () => {
      await connectEthApp()
    })

    it(`signs a ${signType}`, (done) => {
      Eth.mock.instances[0][signingMethod].mockImplementation(
        (path) =>
          new Promise((resolve) => {
            resolve(
              path === "44'/60'/0'/3"
                ? '0x724e7dfa6ee0fd0dd84c5d8a84eb57be29ff20ed253b3249de2e3d6b119d7b1e6a211ce0c48f93c5e399ac8cd7c6fe56e36fa960b6da92de2c435814928f2f8c1b'
                : '0xf257b7f96ad7cbf11b80c2085dc76d10ede662fb2c77dc7fbd9f574d78d9da6d08cb1a99c7d97ac87b9d7f5a4e3ae052ba3a11888fdfeefe6a169a0547c1b2e01b'
            )
          })
      )

      ledger.once('update', () => done('Ledger unexpectedly updated!'))

      ledger[signingMethod](3, 'hello, Frame!', (err, signature) => {
        verifyDone(done, () => {
          expect(ledger.status).toBe(Status.OK)
          expect(err).toBeFalsy()
          expect(signature).toBe(
            '0x724e7dfa6ee0fd0dd84c5d8a84eb57be29ff20ed253b3249de2e3d6b119d7b1e6a211ce0c48f93c5e399ac8cd7c6fe56e36fa960b6da92de2c435814928f2f8c1b'
          )
        })
      })

      runNextRequest()
    })

    it('fails if the signing request is rejected by the user', (done) => {
      Eth.mock.instances[0][signingMethod].mockRejectedValue({ statusCode: 27013 })

      ledger.once('update', () => done('Ledger unexpectedly updated!'))
      ledger.once('close', () => done('Ledger unexpectedly closed!'))

      ledger[signingMethod](3, 'hello, Frame!', (err, signature) => {
        verifyDone(done, () => {
          expect(ledger.status).toBe(Status.OK)
          expect(signature).toBeUndefined()
          expect(err.message).toBe('Sign request rejected by user')
          expect(err.code).toBe(4001)
        })
      })

      runNextRequest()
    })

    const errorCases = [
      {
        testCase: 'there is a communication error',
        setup: () => Eth.mock.instances[0][signingMethod].mockRejectedValue({ statusCode: -1 })
      },
      {
        testCase: 'the eth app is not initialized',
        setup: () => (ledger.eth = undefined)
      },
      {
        testCase: 'the derivation type is not initialized',
        setup: () => (ledger.derivation = undefined)
      }
    ]

    errorCases.forEach(({ testCase, setup = () => {} }) => {
      it(`fails if ${testCase}`, async () => {
        const statusUpdate = new Promise((resolve, reject) => {
          ledger.on('update', () => {
            verifyPromise(resolve, reject, () => expect(ledger.status).toBe(Status.NEEDS_RECONNECTION))
          })
        })

        const callback = new Promise((resolve, reject) => {
          setup()

          ledger[signingMethod](3, 'hello, Frame!', (err, signature) => {
            verifyPromise(resolve, reject, () => {
              expect(signature).toBeUndefined()
              expect(err.message).toBe(`Sign ${signType} error`)
            })
          })
        })

        runNextRequest()

        return Promise.all([statusUpdate, callback])
      })
    })
  })
})

describe('#signTypedData', () => {
  beforeEach(async () => {
    await connectEthApp()
  })

  it('signs v4 typed data', (done) => {
    Eth.mock.instances[0].signTypedData.mockImplementation(
      (path) =>
        new Promise((resolve) => {
          resolve(
            path === "44'/60'/0'/5"
              ? '0x724e7dfa6ee0fd0dd84c5d8a84eb57be29ff20ed253b3249de2e3d6b119d7b1e6a211ce0c48f93c5e399ac8cd7c6fe56e36fa960b6da92de2c435814928f2f8c1b'
              : '0xf257b7f96ad7cbf11b80c2085dc76d10ede662fb2c77dc7fbd9f574d78d9da6d08cb1a99c7d97ac87b9d7f5a4e3ae052ba3a11888fdfeefe6a169a0547c1b2e01b'
          )
        })
    )

    ledger.once('update', () => done('Ledger unexpectedly updated!'))

    ledger.signTypedData(5, { version: SignTypedDataVersion.V4, data: 'typed data' }, (err, signature) => {
      verifyDone(done, () => {
        expect(ledger.status).toBe(Status.OK)
        expect(err).toBeFalsy()
        expect(signature).toBe(
          '0x724e7dfa6ee0fd0dd84c5d8a84eb57be29ff20ed253b3249de2e3d6b119d7b1e6a211ce0c48f93c5e399ac8cd7c6fe56e36fa960b6da92de2c435814928f2f8c1b'
        )
      })
    })

    runNextRequest()
  })

  it('fails if the signing request is rejected by the user', (done) => {
    Eth.mock.instances[0].signTypedData.mockRejectedValue({ statusCode: 27013 })

    ledger.once('update', () => done('Ledger unexpectedly updated!'))
    ledger.once('close', () => done('Ledger unexpectedly closed!'))

    ledger.signTypedData(5, { version: SignTypedDataVersion.V4, data: 'typed data' }, (err, signature) => {
      verifyDone(done, () => {
        expect(ledger.status).toBe(Status.OK)
        expect(signature).toBeUndefined()
        expect(err.message).toBe('Sign request rejected by user')
        expect(err.code).toBe(4001)
      })
    })

    runNextRequest()
  })

  it('fails if the signing request is invalid', (done) => {
    Eth.mock.instances[0].signTypedData.mockRejectedValue({
      statusCode: 99901,
      message: 'Invalid typed data'
    })

    ledger.once('update', () => done('Ledger unexpectedly updated!'))
    ledger.once('close', () => done('Ledger unexpectedly closed!'))

    ledger.signTypedData(5, { version: SignTypedDataVersion.V4, data: 'typed data' }, (err, signature) => {
      verifyDone(done, () => {
        expect(ledger.status).toBe(Status.OK)
        expect(signature).toBeUndefined()
        expect(err.message).toMatch(/Sign message error/)
      })
    })

    runNextRequest()
  })

  const errorCases = [
    {
      testCase: 'there is a communication error',
      setup: () => Eth.mock.instances[0].signTypedData.mockRejectedValue({ statusCode: -1 })
    },
    {
      testCase: 'the eth app is not initialized',
      setup: () => (ledger.eth = undefined)
    },
    {
      testCase: 'the derivation type is not initialized',
      setup: () => (ledger.derivation = undefined)
    }
  ]

  errorCases.forEach(({ testCase, setup = () => {} }) => {
    it(`fails if ${testCase}`, async () => {
      const statusUpdate = new Promise((resolve, reject) => {
        ledger.on('update', () => {
          verifyPromise(resolve, reject, () => expect(ledger.status).toBe(Status.NEEDS_RECONNECTION))
        })
      })

      const callback = new Promise((resolve, reject) => {
        setup()

        ledger.signTypedData(
          5,
          { version: SignTypedDataVersion.V4, data: 'typed data' },
          (err, signature) => {
            verifyPromise(resolve, reject, () => {
              expect(signature).toBeUndefined()
              expect(err.message).toMatch(/Sign message error/)
            })
          }
        )
      })

      runNextRequest()

      return Promise.all([statusUpdate, callback])
    })
  })
})

describe('request lifecycle', () => {
  beforeEach(async () => {
    await connectEthApp()
  })

  it('settles active work once when disconnected and ignores its stale result', async () => {
    let resolveSignature
    Eth.mock.instances[0].signMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignature = resolve
        })
    )

    const callback = jest.fn()
    ledger.signMessage(0, 'hello', callback)
    runNextRequest()
    await Promise.resolve()

    await ledger.disconnect()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toBe('Ledger disconnected before request completed')
    expect(ledger.status).toBe(Status.DISCONNECTED)

    resolveSignature('0xstale')
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(ledger.status).toBe(Status.DISCONNECTED)
  })

  it('serializes reconnection and ignores results from the old transport', async () => {
    let resolveOldSignature
    const oldEth = Eth.mock.instances[0]
    oldEth.signMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOldSignature = resolve
        })
    )

    const callback = jest.fn()
    ledger.signMessage(0, 'hello', callback)
    runNextRequest()
    await Promise.resolve()

    await ledger.disconnect()
    await ledger.open()

    const reconnectedEth = Eth.mock.instances[1]
    reconnectedEth.getAppConfiguration.mockResolvedValue({ version: '2.0.1' })
    reconnectedEth.getAddress.mockResolvedValue({ address: addresses[0] })
    reconnectedEth.deriveAddresses.mockResolvedValue(addresses)

    await ledger.connect()
    await Promise.resolve()
    await Promise.resolve()
    runNextRequest()
    await Promise.resolve()
    await Promise.resolve()

    expect(ledger.status).toBe(Status.OK)
    expect(ledger.addresses).toEqual(addresses)

    resolveOldSignature('0xstale')
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toBe('Ledger disconnected before request completed')
    expect(ledger.status).toBe(Status.OK)
    expect(ledger.addresses).toEqual(addresses)
  })

  it('keeps queued signing work when the derivation changes', async () => {
    const callback = jest.fn()
    Eth.mock.instances[0].signMessage.mockResolvedValue('0xsigned')

    ledger.signMessage(0, 'hello', callback)
    ledger.derivation = Derivation.standard
    ledger.deriveAddresses()

    await Promise.resolve()
    await Promise.resolve()
    runNextRequest()
    await Promise.resolve()
    await Promise.resolve()
    runNextRequest()
    await Promise.resolve()
    await Promise.resolve()
    runNextRequest()
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, '0xsigned')
    expect(Eth.mock.instances[0].deriveAddresses).toHaveBeenLastCalledWith(Derivation.standard)
  })

  it('does not let stale derivation results restore addresses after disconnect', async () => {
    let resolveAddresses
    Eth.mock.instances[0].deriveAddresses.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAddresses = resolve
        })
    )

    ledger.addresses = []
    ledger.deriveAddresses()
    runNextRequest()
    await Promise.resolve()

    await ledger.disconnect()
    resolveAddresses(addresses)
    await Promise.resolve()
    await Promise.resolve()

    expect(ledger.status).toBe(Status.DISCONNECTED)
    expect(ledger.addresses).toEqual([])
  })

  it('closes the transport, cancels queued work, and stops device access', async () => {
    const callback = jest.fn()
    const eth = Eth.mock.instances[0]
    const addressCalls = eth.getAddress.mock.calls.length

    ledger.signMessage(0, 'hello', callback)
    await ledger.close()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toBe('Ledger closed before request completed')
    expect(eth.close).toHaveBeenCalledTimes(1)
    expect(ledger.status).toBe(Status.DISCONNECTED)

    ledger.deriveAddresses()
    const afterCloseCallback = jest.fn()
    ledger.signMessage(0, 'after close', afterCloseCallback)
    jest.advanceTimersByTime(10000)
    await Promise.resolve()

    expect(afterCloseCallback).toHaveBeenCalledTimes(1)
    expect(eth.getAddress).toHaveBeenCalledTimes(addressCalls)
  })
})

describe('status transitions', () => {
  const allowed = {
    [Status.INITIAL]: [
      Status.INITIAL,
      Status.LOADING,
      Status.DERIVING,
      Status.LOCKED,
      Status.WRONG_APP,
      Status.DISCONNECTED,
      Status.NEEDS_RECONNECTION
    ],
    [Status.LOADING]: [
      Status.LOADING,
      Status.INITIAL,
      Status.DERIVING,
      Status.LOCKED,
      Status.WRONG_APP,
      Status.DISCONNECTED,
      Status.NEEDS_RECONNECTION
    ],
    [Status.DERIVING]: [
      Status.DERIVING,
      Status.OK,
      Status.LOADING,
      Status.LOCKED,
      Status.WRONG_APP,
      Status.DISCONNECTED,
      Status.NEEDS_RECONNECTION
    ],
    [Status.OK]: [
      Status.OK,
      Status.DERIVING,
      Status.LOCKED,
      Status.WRONG_APP,
      Status.DISCONNECTED,
      Status.NEEDS_RECONNECTION
    ],
    [Status.LOCKED]: [
      Status.LOCKED,
      Status.INITIAL,
      Status.WRONG_APP,
      Status.DISCONNECTED,
      Status.NEEDS_RECONNECTION
    ],
    [Status.WRONG_APP]: [Status.WRONG_APP, Status.INITIAL, Status.DISCONNECTED],
    [Status.DISCONNECTED]: [Status.DISCONNECTED, Status.INITIAL],
    [Status.NEEDS_RECONNECTION]: [Status.NEEDS_RECONNECTION, Status.INITIAL, Status.DISCONNECTED]
  }

  it('accepts only the explicit transition matrix, including recovery paths', () => {
    Object.values(Status).forEach((from) => {
      Object.values(Status).forEach((to) => {
        ledger.status = from

        expect(ledger.updateStatus(to)).toBe(allowed[from].includes(to))
        expect(ledger.status).toBe(allowed[from].includes(to) ? to : from)
      })
    })
  })
})
