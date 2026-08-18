import log from 'electron-log'
import { addHexPrefix, intToHex } from '@ethereumjs/util'
import BigNumber from 'bignumber.js'

import store from '../../../main/store'
import provider from '../../../main/provider'
import Accounts from '../../../main/accounts'
import signers from '../../../main/signers'
import { signerCompatibility, maxFee } from '../../../main/transaction'
import { toRpcQuantity } from '../../../resources/domain/transaction/quantity'
import { GasFeesSource } from '../../../resources/domain/transaction'
import { ApprovalType } from '../../../resources/constants'
import { gweiToHex } from '../../util'
import { bindRequestSignal } from '../../../main/provider/requestSignal'
import { snapshotPreparedWalletCallExecutionInput } from '../../../main/provider/walletCallPreparedExecution'
import { SignerUserRejectedError } from '../../../main/signers/errors'
import nav from '../../../main/windows/nav'
import { computeAddress, SigningKey, Transaction } from 'ethers'
import { signEip7702RevokeRequest } from '../../../main/transaction/eip7702'
import { createAccountPermission } from '../../../main/provider/permissions'
import operationLifecycleLedger from '../../../main/operationLifecycle'
import { observeOperationLifecycles } from '../../../main/operationLifecycle/events'
import { OperationLifecycleProjection } from '../../../main/operationLifecycle/projection'
import { MAX_OPERATION_LIFECYCLE_AGE_MS } from '../../../main/store/state/types/operationLifecycle'
import {
  TransactionFundingError,
  WalletCallFundingError,
  TRANSACTION_FUNDING_ERROR,
  WALLET_CALL_FUNDING_ERROR
} from '../../../resources/domain/transaction/funding'

jest.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return true
    }
  }
}))

jest.mock('../../../main/provider', () => ({
  send: jest.fn(),
  sendTransaction: jest.fn(),
  assertTransactionFunding: jest.fn(),
  getL1GasCost: jest.fn(),
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  connection: { connections: { ethereum: {} }, send: jest.fn() }
}))
jest.mock('../../../main/signers', () => ({ get: jest.fn() }))
jest.mock('../../../main/windows', () => ({
  broadcast: jest.fn(),
  isAnyWrenVisible: jest.fn(() => true),
  showTray: jest.fn()
}))
jest.mock('../../../main/windows/nav', () => ({ on: jest.fn(), forward: jest.fn() }))
jest.mock('../../../main/externalData')
jest.mock('../../../main/transaction')

jest.mock('../../../main/store/persist')

jest.mock('../../../main/nebula', () =>
  jest.fn(() => ({ ready: () => true, ens: { lookupAddress: jest.fn() } }))
)

const account = {
  id: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
  name: 'Seed Account',
  lastSignerType: 'seed',
  address: '0x22dd63c3619818fdbc262c78baee43cb61e9cccf',
  status: 'ok',
  signer: '3935336131653838663031303266613139373335616337626261373962343231',
  requests: {},
  ensName: null,
  tokens: {},
  created: '12819530:1626189153547'
}

const account2 = {
  id: '0xef8f1bbe054ad30c6af774ed7a7c70a74ef77ac5',
  name: 'Ledger Account',
  lastSignerType: 'ledger',
  address: '0xef8f1bbe054ad30c6af774ed7a7c70a74ef77ac5',
  status: 'ok',
  active: false,
  signer: '',
  requests: {},
  ensName: '',
  created: '15315799:1660153882707'
}

let request

beforeAll(() => {
  log.transports.console.level = false
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

beforeEach((done) => {
  maxFee.mockReturnValue(2n * 10n ** 18n)

  const from = '0x22dd63c3619818fdbc262c78baee43cb61e9cccf'
  const nonce = '0xa'
  request = {
    handlerId: 1,
    origin: '0r161n',
    type: 'transaction',
    data: {
      from,
      chainId: '0x1',
      gasLimit: intToHex(21000),
      gasPrice: gweiToHex(30),
      type: '0x2',
      maxPriorityFeePerGas: gweiToHex(1),
      maxFeePerGas: gweiToHex(9),
      nonce
    },
    payload: {
      jsonrpc: '2.0',
      id: 7,
      method: 'eth_signTransaction',
      params: [{ from, nonce }]
    }
  }

  Accounts.add(account2.address, 'Test Account 2', { type: account2.lastSignerType })
  Accounts.add(account.address, 'Test Account 1', account, (err, account) => {
    Accounts.setSigner(account.address, done)
  })
})

afterEach(() => {
  Object.values(Accounts.accounts).forEach((account) => {
    Object.keys(account.requests).forEach((id) => {
      Accounts.removeRequest(account, id)
    })
  })
})

it('sets the account signer', () => {
  expect(Accounts.current().address).toBe('0x22dd63c3619818fdbc262c78baee43cb61e9cccf')
})

it('rejects renaming an unknown account', () => {
  expect(() => Accounts.rename('0xmissing', 'Missing')).toThrow(/could not find account/i)
})

it('does not log an account address when creating an account', () => {
  const address = '0x1111111111111111111111111111111111111111'
  const info = jest.spyOn(log, 'info').mockImplementation()

  try {
    Accounts.add(address, 'Private Account', { type: 'ring' })

    expect(info).toHaveBeenCalledWith('Account not found, creating account')
    expect(info.mock.calls.flat().join(' ')).not.toContain(address)
    expect(store('main.accounts', address)).toMatchObject({
      id: address,
      name: 'Private Account',
      active: false
    })
  } finally {
    Accounts.remove(address)
    info.mockRestore()
  }
})

describe('#updatePendingFees', () => {
  beforeEach(() => {
    request.data.gasFeesSource = GasFeesSource.Frame

    store.setGasFees('ethereum', parseInt(request.data.chainId), {
      maxBaseFeePerGas: gweiToHex(9),
      maxPriorityFeePerGas: gweiToHex(2)
    })
  })

  it('updates the pending fees for a transaction', () => {
    Accounts.addRequest(request)
    const refresh = jest.spyOn(Accounts.current(), 'refreshTransactionSimulation')
    Accounts.updatePendingFees(parseInt(request.data.chainId))

    expect(request.data.maxFeePerGas).toBe(gweiToHex(11))
    expect(request.data.maxPriorityFeePerGas).toBe(gweiToHex(2))
    expect(refresh).toHaveBeenCalledWith(request, false, true)
  })

  it('does not update a transaction with gas fees provided by a dapp', () => {
    request.data.gasFeesSource = GasFeesSource.Dapp

    Accounts.addRequest(request)
    Accounts.updatePendingFees(parseInt(request.data.chainId))

    expect(request.data.maxFeePerGas).toBe(gweiToHex(9))
    expect(request.data.maxPriorityFeePerGas).toBe(gweiToHex(1))
  })

  it('does not update a transaction if gas fees have been updated by the user', () => {
    request.feesUpdatedByUser = true

    Accounts.addRequest(request)
    Accounts.updatePendingFees(parseInt(request.data.chainId))

    expect(request.data.maxFeePerGas).toBe(gweiToHex(9))
    expect(request.data.maxPriorityFeePerGas).toBe(gweiToHex(1))
  })

  it('refreshes pending wallet-call preparation only for the updated chain', () => {
    const currentAccount = Accounts.current()
    const refresh = jest.spyOn(currentAccount, 'refreshWalletCallsPreparation').mockImplementation()
    const matching = {
      handlerId: 'wallet-calls-mainnet',
      type: 'walletCalls',
      account: currentAccount.id,
      chainId: '0x1',
      status: undefined
    }
    const otherChain = { ...matching, handlerId: 'wallet-calls-other', chainId: '0xa' }
    const pending = { ...matching, handlerId: 'wallet-calls-sending', status: 'pending' }
    currentAccount.requests[matching.handlerId] = matching
    currentAccount.requests[otherChain.handlerId] = otherChain
    currentAccount.requests[pending.handlerId] = pending

    Accounts.updatePendingFees(1)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(matching)
    refresh.mockRestore()
  })

  it('awaits a fresh Optimism L1 data-fee estimate for the updated L2 chain', async () => {
    request.data.chainId = '0xa'
    store.setGasFees('ethereum', 10, {
      maxBaseFeePerGas: gweiToHex(9),
      maxPriorityFeePerGas: gweiToHex(2)
    })
    provider.getL1GasCost.mockResolvedValueOnce(123n)
    Accounts.addRequest(request)

    await Accounts.updatePendingFees(10)

    expect(provider.getL1GasCost).toHaveBeenCalledWith(request.data)
    expect(request.chainData).toEqual({ optimism: { l1Fees: '0x7b' } })
  })
})

describe('#setBaseFee', () => {
  beforeEach(() => {
    Accounts.addRequest(request, jest.fn())
  })

  const setBaseFee = (baseFee, requestId = 1, userUpdate = false) =>
    Accounts.setBaseFee(baseFee, requestId, userUpdate)

  it('does not set an undefined base fee', () => {
    expect(() => setBaseFee(undefined)).toThrow()
  })

  it('does not set an invalid base fee', () => {
    expect(() => setBaseFee('wrong')).toThrow()
  })

  it('does not set a negative base fee', () => {
    expect(() => setBaseFee('-0x12a05f200')).toThrow()
  })

  it('does not set a base fee for an inactive account', () => {
    Accounts.setSigner(undefined, jest.fn())

    expect(() => setBaseFee('0x1dcd65000')).toThrow(/no account selected/i)
  })

  it('fails to find the request', () => {
    expect(() => setBaseFee('0x1dcd65000', 2)).toThrow(/could not find transaction/i)
  })

  it('does not set a base fee on a non-transaction request', () => {
    request.type = 'message'

    expect(() => setBaseFee('0x1dcd65000')).toThrow()
  })

  it('does not set a base fee on a legacy transaction', () => {
    request.data.type = '0x0'

    expect(() => setBaseFee('0x1dcd65000')).toThrow(/legacy transaction/)
  })

  it('does not set a base fee on a locked request', () => {
    request.locked = true

    expect(() => setBaseFee('0x1dcd65000')).toThrow()
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(request.data.maxFeePerGas)
  })

  it('does not set a base fee on an automatic update if fees were manually set by the user', () => {
    request.feesUpdatedByUser = true

    expect(() => setBaseFee('0x1dcd65000')).toThrow()
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(request.data.maxFeePerGas)
  })

  it('applies automatic base fee update', () => {
    request.data.maxFeePerGas = gweiToHex(10)
    request.data.maxPriorityFeePerGas = gweiToHex(2)

    const updatedBaseFee = 6 // gwei

    setBaseFee(gweiToHex(updatedBaseFee))

    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(intToHex(2e9 + updatedBaseFee * 1e9))
  })

  it('applies user-initiated base fee update', () => {
    request.data.maxFeePerGas = gweiToHex(10)
    request.data.maxPriorityFeePerGas = gweiToHex(2)

    setBaseFee(gweiToHex(6), 1, true)

    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(gweiToHex(8))
  })

  it('does not update if the base fee has not changed', () => {
    request.data.maxFeePerGas = gweiToHex(10)
    request.data.maxPriorityFeePerGas = gweiToHex(2)

    setBaseFee(gweiToHex(8))

    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(gweiToHex(10))
  })

  it('caps the base fee at 9999 gwei', () => {
    const highBaseFee = gweiToHex(10200)
    const maxBaseFee = 9999e9
    const expectedMaxFee = intToHex(maxBaseFee + parseInt(request.data.maxPriorityFeePerGas))

    setBaseFee(highBaseFee)

    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(expectedMaxFee)
  })

  it('does not exceed the max allowable fee', () => {
    const maxTotal = 2e18 // 2 ETH
    const gasLimit = 1e7
    const maxTotalFee = maxTotal / gasLimit
    const highBaseFee = intToHex(maxTotalFee + 10e9) // add 10 gwei to exceed the maximum limit

    request.data.gasLimit = intToHex(gasLimit)
    maxFee.mockReturnValue(BigInt(maxTotal))

    setBaseFee(highBaseFee)

    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(intToHex(maxTotalFee))
  })

  it('reduces an existing priority fee that already consumes the cap', () => {
    request.data.gasLimit = '0xa'
    request.data.maxPriorityFeePerGas = '0xf'
    request.data.maxFeePerGas = '0x14'
    maxFee.mockReturnValue(100n)

    setBaseFee('0x1')

    expect(Accounts.current().requests[1].data.maxPriorityFeePerGas).toBe('0xa')
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe('0xa')
  })

  it('supports fee updates when the gas limit is zero', () => {
    request.data.gasLimit = '0x0'

    expect(() => setBaseFee(gweiToHex(9999))).not.toThrow()
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(gweiToHex(10000))
  })

  it('updates the feesUpdatedByUser flag', () => {
    request.data.maxFeePerGas = gweiToHex(10)
    request.data.maxPriorityFeePerGas = gweiToHex(2)

    setBaseFee(gweiToHex(10), 1, true)

    expect(Accounts.current().requests[1].feesUpdatedByUser).toBe(true)
  })
})

describe('#setPriorityFee', () => {
  beforeEach(() => {
    Accounts.addRequest(request, jest.fn())
  })

  const setPriorityFee = (fee, requestId = 1, userUpdate = false) =>
    Accounts.setPriorityFee(fee, requestId, userUpdate)

  it('does not set an undefined priority fee', () => {
    expect(() => setPriorityFee(undefined)).toThrow()
  })

  it('does not set an invalid priority fee', () => {
    expect(() => setPriorityFee('incorrect')).toThrow()
  })

  it('does not set a negative priority fee', () => {
    expect(() => setPriorityFee('-0x12a05f200')).toThrow()
  })

  it('does not set a priority fee if no account is active', () => {
    Accounts.setSigner(undefined, jest.fn())

    expect(() => setPriorityFee('0x12a05f200')).toThrow(/no account selected/i)
  })

  it('fails to find the request', () => {
    expect(() => setPriorityFee('0x12a05f200', 2)).toThrow(/could not find transaction/i)
  })

  it('does not set a priority fee on a non-transaction request', () => {
    request.type = 'message'

    expect(() => setPriorityFee('0x12a05f200')).toThrow()
  })

  it('does not set a priority fee on a legacy transaction', () => {
    request.data.type = '0x0'

    expect(() => setPriorityFee('0x12a05f200')).toThrow(/legacy transaction/)
  })

  it('does not set a priority fee on a locked request', () => {
    request.locked = true

    expect(() => setPriorityFee('0x12a05f200')).toThrow()
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(request.data.maxFeePerGas)
  })

  it('does not set a priority fee on an automatic update if fees were manually set by the user', () => {
    request.feesUpdatedByUser = true

    expect(() => setPriorityFee('0x12a05f200')).toThrow()
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(request.data.maxFeePerGas)
  })

  it('sets a valid priority fee', () => {
    const priorityFee = 2e9 // 2 gwei
    const priorityFeeChange = priorityFee - parseInt(request.data.maxPriorityFeePerGas)
    const expectedMaxFee = intToHex(priorityFeeChange + parseInt(request.data.maxFeePerGas))

    setPriorityFee(intToHex(priorityFee))

    expect(Accounts.current().requests[1].data.maxPriorityFeePerGas).toBe(intToHex(priorityFee))
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(expectedMaxFee)
  })

  it('does not update if the priority fee has not changed', () => {
    request.data.maxFeePerGas = gweiToHex(10)
    request.data.maxPriorityFeePerGas = gweiToHex(2)

    setPriorityFee(gweiToHex(2))

    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(gweiToHex(10))
    expect(Accounts.current().requests[1].data.maxPriorityFeePerGas).toBe(gweiToHex(2))
  })

  it('caps the priority fee at 9999 gwei', () => {
    const highPriorityFee = gweiToHex(10200)
    const maxPriorityFee = 9999e9
    const priorityFeeChange = maxPriorityFee - parseInt(request.data.maxPriorityFeePerGas)
    const expectedMaxFee = intToHex(priorityFeeChange + parseInt(request.data.maxFeePerGas))

    setPriorityFee(highPriorityFee)

    expect(Accounts.current().requests[1].data.maxPriorityFeePerGas).toBe(intToHex(maxPriorityFee))
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(expectedMaxFee)
  })

  it('does not exceed the max allowable fee', () => {
    const maxTotal = 2e18 // 2 ETH
    const gasLimit = 1e7
    const maxTotalFee = maxTotal / gasLimit

    request.data.gasLimit = intToHex(gasLimit)
    request.data.maxFeePerGas = gweiToHex(190)
    request.data.maxPriorityFeePerGas = gweiToHex(40)
    maxFee.mockReturnValue(BigInt(maxTotal))

    const highPriorityFee = intToHex(60e9) // add 20 gwei to the above to exceed the maximum limit
    const expectedPriorityFee =
      maxTotalFee - (parseInt(request.data.maxFeePerGas) - parseInt(request.data.maxPriorityFeePerGas))

    setPriorityFee(highPriorityFee)

    expect(Accounts.current().requests[1].data.maxPriorityFeePerGas).toBe(intToHex(expectedPriorityFee))
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe(intToHex(maxTotalFee))
  })

  it('reduces an existing base fee that already consumes the cap', () => {
    request.data.gasLimit = '0xa'
    request.data.maxPriorityFeePerGas = '0x5'
    request.data.maxFeePerGas = '0x14'
    maxFee.mockReturnValue(100n)

    setPriorityFee('0x1')

    expect(Accounts.current().requests[1].data.maxPriorityFeePerGas).toBe('0x0')
    expect(Accounts.current().requests[1].data.maxFeePerGas).toBe('0xa')
  })

  it('updates the feesUpdatedByUser flag', () => {
    setPriorityFee('0x12a05f200', 1, true)

    expect(Accounts.current().requests[1].feesUpdatedByUser).toBe(true)
  })
})

describe('#setGasPrice', () => {
  beforeEach(() => {
    Accounts.addRequest(request, jest.fn())
    request.data.type = '0x0'
  })

  const setGasPrice = (price, requestId = 1, userUpdate = false) =>
    Accounts.setGasPrice(price, requestId, userUpdate)

  it('does not set an undefined gas price', () => {
    expect(() => setGasPrice(undefined)).toThrow()
  })

  it('does not set an invalid gas price', () => {
    expect(() => setGasPrice(Number.NaN)).toThrow()
  })

  it('does not set a negative gas price', () => {
    expect(() => setGasPrice('-0x23')).toThrow()
  })

  it('does not set a gas price if no account is active', () => {
    Accounts.setSigner(undefined, jest.fn())

    expect(() => setGasPrice('0x23')).toThrow(/no account selected/i)
  })

  it('fails to find the request', () => {
    expect(() => setGasPrice('0x23', 2)).toThrow(/could not find transaction/i)
  })

  it('does not set a gas price on a non-transaction request', () => {
    request.type = 'message'

    expect(() => setGasPrice('0x23')).toThrow()
  })

  it('does not set a gas price on an EIP-1559 transaction', () => {
    request.data.type = '0x2'

    expect(() => setGasPrice('0x23')).toThrow(/EIP-1559 transaction/)
  })

  it('does not set a gas price on a locked request', () => {
    request.locked = true

    expect(() => setGasPrice('0x23')).toThrow()
    expect(Accounts.current().requests[1].data.gasPrice).toBe(request.data.gasPrice)
  })

  it('does not set a gas price on an automatic update if fees were manually set by the user', () => {
    request.feesUpdatedByUser = true

    expect(() => setGasPrice('0x23')).toThrow()
    expect(Accounts.current().requests[1].data.gasPrice).toBe(request.data.gasPrice)
  })

  it('sets a valid gas price', () => {
    setGasPrice('0x23')

    expect(Accounts.current().requests[1].data.gasPrice).toBe('0x23')
  })

  it('does not update if the gas price has not changed', () => {
    request.data.gasPrice = gweiToHex(10)

    setGasPrice(gweiToHex(10))

    expect(Accounts.current().requests[1].data.gasPrice).toBe(gweiToHex(10))
  })

  it('does not exceed the max gas price', () => {
    const maxTotal = 2e18 // 2 ETH
    const gasLimit = 1e7
    const maxTotalFee = maxTotal / gasLimit
    const highPrice = intToHex(maxTotalFee + 10e9) // 250 gwei

    request.data.gasLimit = intToHex(gasLimit)
    maxFee.mockReturnValue(BigInt(maxTotal))

    setGasPrice(highPrice)

    expect(Accounts.current().requests[1].data.gasPrice).toBe(intToHex(maxTotalFee))
  })

  it('caps the gas price at 9999 gwei', () => {
    const maxPrice = gweiToHex(9999)
    const highPrice = gweiToHex(10200)

    setGasPrice(highPrice)

    expect(Accounts.current().requests[1].data.gasPrice).toBe(maxPrice)
  })

  it('limits an exact total above the safe-integer range', () => {
    const gasLimit = 12_500_000n
    const requestedPrice = 9_999n * 1_000_000_000n
    request.data.gasLimit = toRpcQuantity(gasLimit)
    request.data.gasPrice = toRpcQuantity(requestedPrice - 2n)
    maxFee.mockReturnValue(requestedPrice * gasLimit - 1n)

    setGasPrice(toRpcQuantity(requestedPrice))

    expect(Accounts.current().requests[1].data.gasPrice).toBe(toRpcQuantity(requestedPrice - 1n))
  })

  it('updates the feesUpdatedByUser flag', () => {
    request.data.gasPrice = gweiToHex(30)

    setGasPrice(gweiToHex(45), 1, true)

    expect(Accounts.current().requests[1].feesUpdatedByUser).toBe(true)
  })
})

describe('#setGasLimit', () => {
  beforeEach(() => {
    Accounts.addRequest(request, jest.fn())
  })

  const setGasLimit = (limit, requestId = 1, userUpdate = false) =>
    Accounts.setGasLimit(limit, requestId, userUpdate)

  it('does not set an undefined gas limit', () => {
    expect(() => setGasLimit(undefined)).toThrow()
  })

  it('does not set an invalid gas limit', () => {
    expect(() => setGasLimit(Number.NaN)).toThrow()
  })

  it('does not set a negative gas limit', () => {
    expect(() => setGasLimit('-0x61a8')).toThrow()
  })

  it('does not set a gas limit if no account is active', () => {
    Accounts.setSigner(undefined, jest.fn())

    expect(() => setGasLimit('0x61a8')).toThrow(/no account selected/i)
  })

  it('fails to find the request', () => {
    expect(() => setGasLimit('0x61a8', 2)).toThrow(/could not find transaction/i)
  })

  it('does not set a gas limit on a non-transaction request', () => {
    request.type = 'message'

    expect(() => setGasLimit('0x61a8')).toThrow()
  })

  it('does not set a gas limit on a locked request', () => {
    request.locked = true

    expect(() => setGasLimit('0x61a8')).toThrow()
    expect(Accounts.current().requests[1].data.gasLimit).toBe(request.data.gasLimit)
  })

  it('does not set a gas limit on an automatic update if fees were manually set by the user', () => {
    request.feesUpdatedByUser = true

    expect(() => setGasLimit('0x61a8')).toThrow()
    expect(Accounts.current().requests[1].data.gasLimit).toBe(request.data.gasLimit)
  })

  it('sets a valid gas limit', () => {
    const simulation = jest.spyOn(Accounts.current(), 'refreshTransactionSimulation')

    setGasLimit('0x61a8', 1, true)

    expect(Accounts.current().requests[1].data.gasLimit).toBe('0x61a8')
    expect(simulation).toHaveBeenCalledWith(Accounts.current().requests[1], true, false)
  })

  it('does not exceed the max fee for pre-EIP-1559 transactions', () => {
    const maxTotalFee = 2e18 // 2 ETH
    const gasPrice = 400e9 // 400 gwei
    const maxLimit = maxTotalFee / gasPrice
    const gasLimit = intToHex(maxLimit + 1e5) // add 10000 to exceed the maximum limit

    request.data.type = '0x0'
    request.data.gasPrice = intToHex(gasPrice)
    maxFee.mockReturnValue(BigInt(maxTotalFee))

    setGasLimit(gasLimit)

    expect(Accounts.current().requests[1].data.gasLimit).toBe(intToHex(maxLimit))
  })

  it('does not exceed the max fee for post-EIP-1559 transactions', () => {
    const maxTotalFee = 2e18 // 2 ETH
    const maxFeePerGas = 400e9 // 400 gwei
    const maxLimit = maxTotalFee / maxFeePerGas
    const gasLimit = intToHex(maxLimit + 1e5) // add 10000 to exceed the maximum limit

    request.data.type = '0x2'
    request.data.maxFeePerGas = intToHex(maxFeePerGas)
    maxFee.mockReturnValue(BigInt(maxTotalFee))

    setGasLimit(gasLimit)

    expect(Accounts.current().requests[1].data.gasLimit).toBe(intToHex(maxLimit))
  })

  it('caps the gas limit at 12.5e6', () => {
    const maxLimit = intToHex(12.5e6)
    const highLimit = intToHex(13e6)

    setGasLimit(highLimit)

    expect(Accounts.current().requests[1].data.gasLimit).toBe(maxLimit)
  })

  it('supports gas-limit updates with a zero fee', () => {
    request.data.type = '0x0'
    request.data.gasPrice = '0x0'

    expect(() => setGasLimit('0x61a8')).not.toThrow()
    expect(Accounts.current().requests[1].data.gasLimit).toBe('0x61a8')
  })

  it('updates the feesUpdatedByUser flag', () => {
    setGasLimit('0x61a8', 1, true)

    expect(Accounts.current().requests[1].feesUpdatedByUser).toBe(true)
  })
})

describe('#adjustNonce', () => {
  let onChainNonce

  beforeEach(() => {
    provider.send = jest.fn((payload, cb) => {
      expect(payload).toEqual(
        expect.objectContaining({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_getTransactionCount',
          params: ['0x22dd63c3619818fdbc262c78baee43cb61e9cccf', 'pending']
        })
      )

      cb({ result: onChainNonce })
    })

    onChainNonce = '0x0'
    Accounts.addRequest(request, jest.fn())
  })

  const adjustNonce = (nonceAdjust, requestId = 1) => Accounts.adjustNonce(requestId, nonceAdjust)

  it('does not allow an invalid adjustment', () => {
    adjustNonce(2)

    expect(Accounts.current().requests[1].data.nonce).toBe(request.data.nonce)
  })

  it('does not adjust a request if no account is active', () => {
    adjustNonce(1)

    expect(Accounts.current().requests[1].data.nonce).toBe(request.data.nonce)
  })

  it('adjusts the provided nonce up one increment', () => {
    const expectedNonce = addHexPrefix((parseInt(request.data.nonce) + 1).toString(16))

    adjustNonce(1)

    expect(Accounts.current().requests[1].data.nonce).toBe(expectedNonce)
  })

  it('adjusts the provided nonce down one increment', () => {
    const expectedNonce = addHexPrefix((parseInt(request.data.nonce) - 1).toString(16))

    adjustNonce(-1)

    expect(Accounts.current().requests[1].data.nonce).toBe(expectedNonce)
  })

  it('adjusts nonces above the safe integer range without losing precision', () => {
    request.data.nonce = '0x20000000000000'

    adjustNonce(1)

    expect(request.data.nonce).toBe('0x20000000000001')
  })

  it('keeps nonce adjustments inside the RPC quantity range', () => {
    request.data.nonce = '0x' + 'f'.repeat(64)

    adjustNonce(1)

    expect(request.data.nonce).toBe('0x' + 'f'.repeat(64))
  })

  it('gets the latest nonce from the chain', () => {
    onChainNonce = '0x5'

    delete request.data.nonce

    adjustNonce(1)

    expect(Accounts.current().requests[1].data.nonce).toBe(onChainNonce)
  })

  it('gets the latest nonce from the chain and adjusts it down one increment', () => {
    onChainNonce = '0x5'
    const expectedNonce = addHexPrefix((parseInt(onChainNonce) - 1).toString(16))

    delete request.data.nonce

    adjustNonce(-1)

    expect(Accounts.current().requests[1].data.nonce).toBe(expectedNonce)
  })

  it.each([
    ['repeated increases', '0x5', [1, 1, 1], '0x7'],
    ['mixed adjustments', '0x5', [-1, 1, 1], '0x6'],
    ['zero-boundary adjustments', '0x0', [-1, 1], '0x1'],
    ['large nonces', '0x20000000000000', [1, 1], '0x20000000000001']
  ])(
    'coalesces %s while loading the nonce and applies them in order',
    (_, chainNonce, adjustments, expected) => {
      let respond
      provider.send = jest.fn((payload, cb) => {
        respond = cb
      })
      delete request.data.nonce
      const refresh = jest.spyOn(Accounts.current(), 'refreshTransactionSimulation')

      adjustments.forEach((value) => adjustNonce(value))

      expect(provider.send).toHaveBeenCalledTimes(1)
      expect(request.data.nonce).toBeUndefined()

      respond({ result: chainNonce })

      expect(request.data.nonce).toBe(expected)
      expect(refresh.mock.calls.filter(([, publishPending]) => publishPending === undefined)).toHaveLength(1)
      refresh.mockRestore()
    }
  )

  it('discards a pending nonce lookup when the request becomes locked', () => {
    let respond
    provider.send = jest.fn((payload, cb) => {
      respond = cb
    })
    delete request.data.nonce
    const refresh = jest.spyOn(Accounts.current(), 'refreshTransactionSimulation')

    adjustNonce(1)
    Accounts.lockRequest(1)
    respond({ result: '0x5' })

    expect(request.data.nonce).toBeUndefined()
    expect(refresh.mock.calls.filter(([, publishPending]) => publishPending === undefined)).toHaveLength(0)
    refresh.mockRestore()
  })

  it('clears a pending nonce lookup when the request is removed directly', () => {
    provider.send = jest.fn()
    delete request.data.nonce

    adjustNonce(1)
    expect(Accounts.pendingNonceAdjustments.size).toBe(1)

    Accounts.current().clearRequest(1)

    expect(Accounts.pendingNonceAdjustments.size).toBe(0)
  })

  it('clears pending nonce lookups when their account is removed', () => {
    provider.send = jest.fn()
    delete request.data.nonce

    adjustNonce(1)
    expect(Accounts.pendingNonceAdjustments.size).toBe(1)

    Accounts.remove(account.id)

    expect(Accounts.pendingNonceAdjustments.size).toBe(0)
  })

  it('clears all pending nonce lookups when accounts close', () => {
    provider.send = jest.fn()
    delete request.data.nonce
    const dataScanner = Accounts.dataScanner
    Accounts.dataScanner = { close: jest.fn() }

    try {
      adjustNonce(1)
      expect(Accounts.pendingNonceAdjustments.size).toBe(1)

      Accounts.close()

      expect(Accounts.pendingNonceAdjustments.size).toBe(0)
    } finally {
      Accounts.dataScanner = dataScanner
    }
  })

  it.each([
    ['locked', { locked: true }],
    ['submitted', { status: 'pending' }]
  ])('does not adjust a %s request', (_, state) => {
    Object.assign(request, state)
    const initialNonce = request.data.nonce
    const refresh = jest.spyOn(Accounts.current(), 'refreshTransactionSimulation')

    adjustNonce(1)

    expect(request.data.nonce).toBe(initialNonce)
    expect(refresh.mock.calls.filter(([, publishPending]) => publishPending === undefined)).toHaveLength(0)
    refresh.mockRestore()
  })
})

describe('#resetNonce', () => {
  beforeEach(() => {
    provider.send = jest.fn((payload, cb) => {
      expect(payload).toEqual(
        expect.objectContaining({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_getTransactionCount',
          params: ['0x22dd63c3619818fdbc262c78baee43cb61e9cccf', 'pending']
        })
      )
      cb({ result: '0x3' })
    })
    request.data.nonce = '0x5'
    Accounts.addRequest(request, jest.fn())
  })

  const resetNonce = (requestId = 1) => Accounts.resetNonce(requestId)

  it('it will un-set the nonce when not present inside the tx request payload', () => {
    delete request.payload.params[0].nonce
    resetNonce()
    expect(request.data.nonce).toBe(undefined)
  })

  it('it will revert to the nonce inside the tx request payload when present', () => {
    request.payload.params[0].nonce = '0x' + BigNumber(request.data.nonce).minus(1).toString(16)
    resetNonce()
    expect(request.data.nonce).toBe(request.payload.params[0].nonce)
  })

  it.each([
    ['locked', { locked: true }],
    ['submitted', { status: 'pending' }]
  ])('does not reset a %s request', (_, state) => {
    Object.assign(request, state)
    const initialNonce = request.data.nonce
    const refresh = jest.spyOn(Accounts.current(), 'refreshTransactionSimulation')

    resetNonce()

    expect(request.data.nonce).toBe(initialNonce)
    expect(refresh.mock.calls.filter(([, publishPending]) => publishPending === undefined)).toHaveLength(0)
    refresh.mockRestore()
  })
})

describe('#resolveRequest', () => {
  it('does nothing with an unknown request', () => {
    Accounts.addRequest(request, () => {
      throw new Error('unexpected callback!')
    })

    Accounts.resolveRequest({ payload: {}, handlerId: '-1' })

    expect(Object.keys(Accounts.current().requests)).toHaveLength(1)
  })

  it('resolves a request with a callback', (done) => {
    Accounts.addRequest(request, () => done())

    Accounts.resolveRequest(request)

    try {
      expect(Object.keys(Accounts.current().requests)).toHaveLength(0)
    } catch (e) {
      done(e)
    }
  })

  it('resolves a request with no callback', () => {
    Accounts.addRequest(request)

    Accounts.resolveRequest(request)

    expect(Object.keys(Accounts.current().requests)).toHaveLength(0)
  })

  it('resolves from the explicit account while another account remains current', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = {
      ...request,
      handlerId: 'explicit-resolution',
      account: account2.address,
      data: { ...request.data, from: account2.address }
    }
    targetAccount.addRequest(explicit)

    expect(Accounts.resolveRequestForAccount(account2.address.toUpperCase(), explicit.handlerId)).toBe(true)

    expect(Accounts.current().id).toBe(account.address)
    expect(targetAccount.requests[explicit.handlerId]).toBeUndefined()
  })

  it('treats an already settled explicit request as a no-op', () => {
    expect(Accounts.resolveRequestForAccount(account2.address, 'missing-request')).toBe(false)
  })
})

describe('#updateRequest', () => {
  it('reruns simulation only after an accepted transaction action update', () => {
    const activeAccount = Accounts.current()
    const update = jest.fn().mockReturnValue(true)
    const simulation = jest.spyOn(activeAccount, 'refreshTransactionSimulation')
    request.recognizedActions = [{ id: 'erc20:approve', update }]
    activeAccount.requests[request.handlerId] = request
    activeAccount.activeReviewHandlerId = request.handlerId

    const updated = Accounts.updateRequest(request.handlerId, { amount: '42' }, 'erc20:approve')

    expect(updated).toBe(true)
    expect(update).toHaveBeenCalledWith(request, { amount: '42' })
    expect(simulation).toHaveBeenCalledWith(request)
  })

  it('does not simulate a rejected, locked, or submitted transaction update', () => {
    const activeAccount = Accounts.current()
    const update = jest.fn().mockReturnValue(false)
    const simulation = jest.spyOn(activeAccount, 'refreshTransactionSimulation')
    request.recognizedActions = [{ id: 'erc20:approve', update }]
    activeAccount.requests[request.handlerId] = request
    activeAccount.activeReviewHandlerId = request.handlerId

    expect(Accounts.updateRequest(request.handlerId, { amount: '-1' }, 'erc20:approve')).toBe(false)
    request.locked = true
    expect(Accounts.updateRequest(request.handlerId, { amount: '1' }, 'erc20:approve')).toBe(false)
    request.locked = false
    request.status = 'pending'
    expect(Accounts.updateRequest(request.handlerId, { amount: '1' }, 'erc20:approve')).toBe(false)

    expect(update).toHaveBeenCalledTimes(1)
    expect(simulation).not.toHaveBeenCalled()
  })

  it('contains transaction action update failures without mutation or simulation', () => {
    const activeAccount = Accounts.current()
    const update = jest.fn(() => {
      throw new Error('invalid action state')
    })
    const simulation = jest.spyOn(activeAccount, 'refreshTransactionSimulation')
    request.recognizedActions = [{ id: 'erc20:approve', update }]
    activeAccount.requests[request.handlerId] = request
    activeAccount.activeReviewHandlerId = request.handlerId

    expect(Accounts.updateRequest(request.handlerId, { amount: '42' }, 'erc20:approve')).toBe(false)
    expect(simulation).not.toHaveBeenCalled()
  })

  it('updates only the amount fields of an active permit request', () => {
    const activeAccount = Accounts.current()
    const update = jest.spyOn(activeAccount, 'update')
    const permitRequest = {
      handlerId: 'permit-update',
      type: 'signErc20Permit',
      account: activeAccount.address,
      typedMessage: {
        data: {
          domain: { chainId: 1, verifyingContract: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          message: { owner: activeAccount.address, spender: account2.address, value: '1' }
        }
      },
      permit: { owner: activeAccount.address, spender: { address: account2.address }, value: '1' },
      tokenData: { symbol: 'TKN' }
    }
    activeAccount.requests[permitRequest.handlerId] = permitRequest
    activeAccount.activeReviewHandlerId = permitRequest.handlerId

    const updated = Accounts.updateRequest(
      permitRequest.handlerId,
      {
        amount: '42',
        account: account2.address,
        permit: { owner: account2.address },
        typedMessage: { data: { domain: { chainId: 999 } } },
        tokenData: { symbol: 'EVIL' }
      },
      null
    )

    expect(updated).toBe(true)
    expect(permitRequest.typedMessage.data.message.value).toBe('42')
    expect(permitRequest.typedMessage.data.domain.chainId).toBe(1)
    expect(permitRequest.permit.value).toBe('42')
    expect(permitRequest.permit.owner).toBe(activeAccount.address)
    expect(permitRequest.account).toBe(activeAccount.address)
    expect(permitRequest.tokenData.symbol).toBe('TKN')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('ignores invalid and submitted permit amount updates without mutation', () => {
    const activeAccount = Accounts.current()
    const update = jest.spyOn(activeAccount, 'update')
    const permitRequest = {
      handlerId: 'invalid-permit-update',
      type: 'signErc20Permit',
      typedMessage: { data: { message: { value: '1' } } },
      permit: { value: '1' }
    }
    activeAccount.requests[permitRequest.handlerId] = permitRequest
    activeAccount.activeReviewHandlerId = permitRequest.handlerId
    update.mockClear()

    Accounts.updateRequest(permitRequest.handlerId, { amount: '1e2' }, null)
    permitRequest.status = 'pending'
    Accounts.updateRequest(permitRequest.handlerId, { amount: '42' }, null)

    expect(permitRequest.typedMessage.data.message.value).toBe('1')
    expect(permitRequest.permit.value).toBe('1')
    expect(update).not.toHaveBeenCalled()
  })

  it('does not partially mutate malformed permit request state', () => {
    const activeAccount = Accounts.current()
    const update = jest.spyOn(activeAccount, 'update')
    const permitRequest = {
      handlerId: 'malformed-permit-update',
      type: 'signErc20Permit',
      typedMessage: { data: { message: { value: '1' } } }
    }
    activeAccount.requests[permitRequest.handlerId] = permitRequest
    activeAccount.activeReviewHandlerId = permitRequest.handlerId
    update.mockClear()

    Accounts.updateRequest(permitRequest.handlerId, { amount: '42' }, null)

    expect(permitRequest.typedMessage.data.message.value).toBe('1')
    expect(update).not.toHaveBeenCalled()
  })

  it('adds, confirms, and removes unlimited permit consent in main-owned state', () => {
    const activeAccount = Accounts.current()
    const permitRequest = {
      handlerId: 'permit-approval-lifecycle',
      type: 'signErc20Permit',
      typedMessage: { data: { message: { value: '1' } } },
      permit: { value: '1' },
      approvals: []
    }
    activeAccount.requests[permitRequest.handlerId] = permitRequest
    activeAccount.activeReviewHandlerId = permitRequest.handlerId
    const max = (2n ** 256n - 1n).toString(10)

    Accounts.updateRequest(permitRequest.handlerId, { amount: max }, null)

    expect(permitRequest.approvals).toHaveLength(1)
    expect(permitRequest.approvals[0]).toMatchObject({
      type: ApprovalType.TokenPermitRisk,
      approved: false
    })

    Accounts.confirmRequestApproval(permitRequest.handlerId, ApprovalType.TokenPermitRisk, {})
    expect(permitRequest.approvals[0].approved).toBe(true)

    Accounts.updateRequest(permitRequest.handlerId, { amount: '0' }, null)
    expect(permitRequest.approvals).toEqual([])
  })

  it('does not confirm a permit approval after submission starts', () => {
    const activeAccount = Accounts.current()
    const approve = jest.fn()
    const permitRequest = {
      handlerId: 'submitted-permit-approval',
      type: 'signErc20Permit',
      status: 'pending',
      approvals: [{ type: ApprovalType.TokenPermitRisk, approved: false, approve }]
    }
    activeAccount.requests[permitRequest.handlerId] = permitRequest
    activeAccount.activeReviewHandlerId = permitRequest.handlerId

    Accounts.confirmRequestApproval(permitRequest.handlerId, ApprovalType.TokenPermitRisk, {})

    expect(approve).not.toHaveBeenCalled()
  })

  it('rejects approval confirmation for a forged queued request reference', () => {
    const activeAccount = Accounts.current()
    const active = { handlerId: 'active-approval', type: 'transaction' }
    const approve = jest.fn()
    const queued = {
      handlerId: 'queued-approval',
      type: 'transaction',
      approvals: [{ type: ApprovalType.TokenPermitRisk, approved: false, approve }]
    }
    activeAccount.requests[active.handlerId] = active
    activeAccount.requests[queued.handlerId] = queued
    activeAccount.activeReviewHandlerId = active.handlerId

    expect(() => Accounts.confirmRequestApproval(queued.handlerId, ApprovalType.TokenPermitRisk, {})).toThrow(
      'Request is waiting for review'
    )
    expect(approve).not.toHaveBeenCalled()
  })

  it('rejects forged queued action, nonce, and user fee mutations', () => {
    const activeAccount = Accounts.current()
    const active = {
      ...request,
      handlerId: 'active-mutation',
      account: activeAccount.id,
      data: { ...request.data }
    }
    const actionUpdate = jest.fn().mockReturnValue(true)
    const queued = {
      ...request,
      handlerId: 'queued-mutation',
      account: activeAccount.id,
      data: { ...request.data, type: '0x0', gasPrice: '0x1' },
      recognizedActions: [{ id: 'erc20:approve', update: actionUpdate }]
    }
    activeAccount.requests[active.handlerId] = active
    activeAccount.requests[queued.handlerId] = queued
    activeAccount.activeReviewHandlerId = active.handlerId
    const initialData = { ...queued.data }

    expect(Accounts.updateRequest(queued.handlerId, { amount: '42' }, 'erc20:approve')).toBe(false)
    expect(() => Accounts.updateNonce(queued.handlerId, '0x9')).toThrow('Request is waiting for review')
    Accounts.adjustNonce(queued.handlerId, 1)
    Accounts.resetNonce(queued.handlerId)
    expect(() => Accounts.setGasPrice('0x2', queued.handlerId, true, activeAccount.id)).toThrow(
      'Request is waiting for review'
    )

    expect(actionUpdate).not.toHaveBeenCalled()
    expect(queued.data).toEqual(initialData)
  })
})

describe('#addRequestForAccount', () => {
  it('assigns deterministic independent FIFO order to 20 requests across 3 accounts', () => {
    const account3Address = '0x3333333333333333333333333333333333333333'
    Accounts.add(account3Address, 'Test Account 3', { type: 'ring' })
    const accountIds = [account.address, account2.address, account3Address]
    const expectedByAccount = new Map(accountIds.map((id) => [id, []]))
    const now = jest.spyOn(Date, 'now').mockReturnValue(100)
    nav.forward.mockClear()

    try {
      for (let index = 0; index < 20; index += 1) {
        const accountId = accountIds[index % accountIds.length]
        const queued = {
          handlerId: `stress-${index}`,
          type: 'access',
          account: accountId,
          origin: 'stress-origin',
          payload: { id: index, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }
        }
        Accounts.addRequestForAccount(accountId, queued)
        expectedByAccount.get(accountId).push(queued)
      }

      expectedByAccount.forEach((requests, accountId) => {
        const queueIndexes = requests.map(({ queueIndex }) => queueIndex)
        expect(
          queueIndexes.every((value, index) => index === 0 || value === queueIndexes[index - 1] + 1)
        ).toBe(true)
        expect(
          Object.values(Accounts.accounts[accountId].requests)
            .sort((a, b) => a.queueIndex - b.queueIndex)
            .map(({ handlerId }) => handlerId)
        ).toEqual(requests.map(({ handlerId }) => handlerId))
      })

      const activeAccountRequestViews = nav.forward.mock.calls
        .map(([, crumb]) => crumb)
        .filter(({ view }) => view === 'requestView')
      expect(activeAccountRequestViews).toHaveLength(1)
      expect(activeAccountRequestViews[0].data.requestId).toBe('stress-0')
    } finally {
      now.mockRestore()
      Accounts.remove(account3Address)
    }
  })

  it('admits through the explicit account while another account remains current', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicitRequest = { ...request, handlerId: 'explicit-request', account: account2.address }
    const add = jest.spyOn(targetAccount, 'addRequest').mockImplementation((candidate) => {
      targetAccount.requests[candidate.handlerId] = candidate
    })

    expect(Accounts.addRequestForAccount(account2.address.toUpperCase(), explicitRequest)).toBe(true)
    expect(Accounts.current().id).toBe(account.address)
    expect(add).toHaveBeenCalledWith(explicitRequest, undefined)
    add.mockRestore()
  })

  it.each([
    ['unknown account', '0x3333333333333333333333333333333333333333', account2.address, /locate/],
    ['wrong owner', account2.address, account.address, /belong/]
  ])('rejects %s before account admission', (_label, accountId, owner, message) => {
    const targetAccount = Accounts.accounts[account2.address]
    const add = jest.spyOn(targetAccount, 'addRequest')

    expect(() =>
      Accounts.addRequestForAccount(accountId, {
        ...request,
        handlerId: `rejected-${_label}`,
        account: owner
      })
    ).toThrow(message)
    expect(add).not.toHaveBeenCalled()
    add.mockRestore()
  })

  it('rejects duplicate handlers and account insertion that does not store the exact request', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const duplicate = { ...request, handlerId: 'duplicate-request', account: account2.address }
    targetAccount.requests[duplicate.handlerId] = duplicate

    expect(() => Accounts.addRequestForAccount(account2.address, duplicate)).toThrow(/already in use/)

    delete targetAccount.requests[duplicate.handlerId]
    const add = jest.spyOn(targetAccount, 'addRequest').mockImplementation(() => {})
    expect(() => Accounts.addRequestForAccount(account2.address, duplicate)).toThrow(/did not admit/)
    add.mockRestore()
  })

  it('clears a partially stored request before propagating an insertion failure', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const partial = { ...request, handlerId: 'partial-request', account: account2.address }
    const add = jest.spyOn(targetAccount, 'addRequest').mockImplementation((candidate) => {
      targetAccount.requests[candidate.handlerId] = candidate
      throw new Error('request UI failed')
    })
    const clear = jest.spyOn(targetAccount, 'clearRequest').mockImplementation((handlerId) => {
      delete targetAccount.requests[handlerId]
    })

    expect(() => Accounts.addRequestForAccount(account2.address, partial)).toThrow(/request UI failed/)
    expect(clear).toHaveBeenCalledWith(partial.handlerId)
    expect(targetAccount.requests[partial.handlerId]).toBeUndefined()
    add.mockRestore()
    clear.mockRestore()
  })

  it('reports both insertion and cleanup failures', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const partial = { ...request, handlerId: 'unclean-request', account: account2.address }
    const add = jest.spyOn(targetAccount, 'addRequest').mockImplementation((candidate) => {
      targetAccount.requests[candidate.handlerId] = candidate
      throw new Error('request UI failed')
    })
    const clear = jest.spyOn(targetAccount, 'clearRequest').mockImplementation(() => {
      throw new Error('request cleanup failed')
    })

    expect(() => Accounts.addRequestForAccount(account2.address, partial)).toThrow(
      /admission failed: request UI failed; cleanup failed: request cleanup failed/
    )
    add.mockRestore()
    clear.mockRestore()
  })
})

describe('#rejectRequest', () => {
  it('uses the main-process payload rather than renderer-returned request data', () => {
    const response = jest.fn()
    Accounts.addRequest(request, response)

    Accounts.rejectRequest(
      { ...request, payload: { id: 'tampered', jsonrpc: '2.0' } },
      { code: 4001, message: 'User rejected the request' }
    )

    expect(response).toHaveBeenCalledWith({
      id: request.payload.id,
      jsonrpc: request.payload.jsonrpc,
      error: { code: 4001, message: 'User rejected the request' }
    })
    expect(Object.keys(Accounts.current().requests)).toHaveLength(0)
  })

  it('rejects from the explicit account while another account remains current', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const response = jest.fn()
    const explicit = {
      ...request,
      handlerId: 'explicit-rejection',
      account: account2.address,
      data: { ...request.data, from: account2.address }
    }
    targetAccount.addRequest(explicit, response)

    expect(
      Accounts.rejectRequestForAccount(account2.address.toUpperCase(), explicit.handlerId, {
        code: 4001,
        message: 'User rejected the request'
      })
    ).toBe(true)

    expect(Accounts.current().id).toBe(account.address)
    expect(response).toHaveBeenCalledWith({
      id: request.payload.id,
      jsonrpc: request.payload.jsonrpc,
      error: { code: 4001, message: 'User rejected the request' }
    })
    expect(targetAccount.requests[explicit.handlerId]).toBeUndefined()
  })

  it('does not reject a request through the wrong account identity', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const response = jest.fn()
    const explicit = {
      ...request,
      handlerId: 'wrong-account-rejection',
      account: account2.address,
      data: { ...request.data, from: account2.address }
    }
    targetAccount.addRequest(explicit, response)

    expect(() =>
      Accounts.rejectRequestForAccount(account.address, explicit.handlerId, {
        code: 4001,
        message: 'User rejected the request'
      })
    ).toThrow(/locate account request/i)
    expect(response).not.toHaveBeenCalled()
    expect(targetAccount.requests[explicit.handlerId]).toBe(explicit)
  })
})

describe('account-bound request transitions', () => {
  const targetRequest = (handlerId, type = 'transaction') => ({
    ...request,
    handlerId,
    type,
    account: account2.address,
    data: { ...request.data, from: account2.address }
  })

  it('updates pending and error state on the originating account after selection changes', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('account-bound-error')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }

    Accounts.setRequestPending(explicit)
    Accounts.setRequestError(explicit.handlerId, new Error('Device declined'), account2.address)

    expect(Accounts.current().id).toBe(account.address)
    expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
      status: 'error',
      notice: 'Device declined',
      retainedPreBroadcastError: { responderPending: false }
    })
  })

  it.each([
    ['string errors', 'Device unavailable', 'Device unavailable'],
    ['message-shaped errors', { message: 'Signer unavailable' }, 'Signer unavailable'],
    ['null errors', null, 'Unknown Error']
  ])('normalizes %s without breaking request error handling', (_label, error, notice) => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest(`normalized-error-${notice.replaceAll(' ', '-').toLowerCase()}`)
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }

    Accounts.setRequestPending(explicit)
    expect(() => Accounts.setRequestError(explicit.handlerId, error, account2.address)).not.toThrow()
    expect(targetAccount.requests[explicit.handlerId]).toMatchObject({ status: 'error', notice })
  })

  it('presents an on-device rejection as a neutral declined request', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('account-bound-device-decline')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }

    Accounts.setRequestPending(explicit)
    Accounts.setRequestError(
      explicit.handlerId,
      new SignerUserRejectedError('Sign request rejected by user'),
      account2.address
    )

    expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
      status: 'declined',
      notice: 'Request declined',
      mode: 'monitor'
    })
  })

  it('retains a recoverable pre-sign safety failure as the active review', () => {
    jest.useFakeTimers()
    try {
      const targetAccount = Accounts.accounts[account2.address]
      const explicit = targetRequest('recoverable-account-code-failure')
      targetAccount.addRequest(explicit)
      explicit.simulation = { status: 'succeeded', calls: [] }
      Accounts.setRequestPending(explicit)
      Accounts.lockRequest(explicit.handlerId, account2.address)

      Accounts.setRequestError(
        explicit.handlerId,
        Object.assign(new Error('Delegation recheck unavailable. Request not sent.'), {
          code: 'account-code-evidence-unavailable',
          data: { role: 'target', account: account2.address }
        }),
        account2.address
      )
      jest.advanceTimersByTime(30_000)

      expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
        status: 'error',
        locked: true,
        recoverableError: {
          code: 'account-code-evidence-unavailable',
          data: { role: 'target', account: account2.address }
        },
        retainedPreBroadcastError: { responderPending: true }
      })
      expect(targetAccount.summary().activeRequestId).toBe(explicit.handlerId)
    } finally {
      jest.useRealTimers()
    }
  })

  it('retains exact insufficient-funding evidence before any signing attempt', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('recoverable-funding-failure')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    Accounts.lockRequest(explicit.handlerId, account2.address)

    Accounts.setRequestError(
      explicit.handlerId,
      new TransactionFundingError(
        TRANSACTION_FUNDING_ERROR,
        'The account needs more funds. Nothing was signed or sent.',
        { available: '0x5', required: '0x9', missing: '0x4', value: '0x1', maximumFee: '0x8' }
      ),
      account2.address
    )

    expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
      status: 'error',
      locked: true,
      recoverableError: {
        code: TRANSACTION_FUNDING_ERROR,
        data: { available: '0x5', required: '0x9', missing: '0x4' }
      },
      retainedPreBroadcastError: { responderPending: true }
    })
    expect(targetAccount.summary().activeRequestId).toBe(explicit.handlerId)
  })

  it('refreshes fees and keeps updated funding evidence when recheck is still short', async () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('funding-still-short')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    Accounts.lockRequest(explicit.handlerId, account2.address)
    Accounts.setRequestError(
      explicit.handlerId,
      new TransactionFundingError(TRANSACTION_FUNDING_ERROR, 'More funds needed.', {
        available: '0x1',
        required: '0x9',
        missing: '0x8',
        value: '0x1',
        maximumFee: '0x8'
      }),
      account2.address
    )
    const feeRefresh = jest.spyOn(Accounts, 'updatePendingFees').mockImplementation()
    provider.assertTransactionFunding.mockRejectedValueOnce(
      new TransactionFundingError(TRANSACTION_FUNDING_ERROR, 'More funds are still needed.', {
        available: '0x4',
        required: '0xa',
        missing: '0x6',
        value: '0x1',
        maximumFee: '0x9'
      })
    )

    await expect(Accounts.retryFailedTransaction(explicit.handlerId, account2.address)).rejects.toThrow(
      /still needed/i
    )

    expect(feeRefresh).toHaveBeenCalledWith(1)
    expect(explicit).toMatchObject({
      status: 'error',
      locked: true,
      recoverableError: {
        code: TRANSACTION_FUNDING_ERROR,
        data: { available: '0x4', required: '0xa', missing: '0x6' }
      }
    })
    feeRefresh.mockRestore()
  })

  it('returns a funded request to fresh fee and simulation review', async () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('funding-recovered')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    Accounts.lockRequest(explicit.handlerId, account2.address)
    Accounts.setRequestError(
      explicit.handlerId,
      new TransactionFundingError(TRANSACTION_FUNDING_ERROR, 'More funds needed.', {
        available: '0x1',
        required: '0x9',
        missing: '0x8',
        value: '0x1',
        maximumFee: '0x8'
      }),
      account2.address
    )
    const feeRefresh = jest.spyOn(Accounts, 'updatePendingFees').mockImplementation()
    const simulationRefresh = jest.spyOn(targetAccount, 'refreshTransactionSimulation')
    provider.assertTransactionFunding.mockResolvedValueOnce({ missing: '0x0' })

    await expect(Accounts.retryFailedTransaction(explicit.handlerId, account2.address)).resolves.toBe(true)

    expect(explicit.locked).toBeUndefined()
    expect(explicit.status).toBeUndefined()
    expect(explicit.recoverableError).toBeUndefined()
    expect(explicit.retainedPreBroadcastError).toBeUndefined()
    expect(simulationRefresh).toHaveBeenCalledWith(explicit, true, false)
    feeRefresh.mockRestore()
    simulationRefresh.mockRestore()
  })

  it('rechecks fresh simulation evidence before a recoverable request can be signed again', async () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('retry-account-code-failure')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    Accounts.lockRequest(explicit.handlerId, account2.address)
    Accounts.setRequestError(
      explicit.handlerId,
      Object.assign(new Error('Delegation changed. Request not sent.'), {
        code: 'account-code-evidence-changed'
      }),
      account2.address
    )
    const refresh = jest.spyOn(targetAccount, 'refreshTransactionSimulation')

    await expect(Accounts.retryFailedTransaction(explicit.handlerId, account2.address)).resolves.toBe(true)

    expect(explicit.locked).toBeUndefined()
    expect(explicit.status).toBeUndefined()
    expect(explicit.notice).toBeUndefined()
    expect(explicit.recoverableError).toBeUndefined()
    expect(explicit.retainedPreBroadcastError).toBeUndefined()
    expect(explicit.data.nonce).toBe(explicit.payload.params[0].nonce)
    expect(explicit.simulation).toEqual({ status: 'pending' })
    expect(refresh).toHaveBeenCalledWith(explicit, true, false)
    expect(targetAccount.summary().activeRequestId).toBe(explicit.handlerId)
    refresh.mockRestore()
  })

  it('drops a wallet-filled nonce before rechecking a recoverable request', async () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('retry-wallet-filled-nonce')
    explicit.payload = {
      ...explicit.payload,
      params: [{ ...explicit.payload.params[0] }]
    }
    delete explicit.payload.params[0].nonce
    explicit.data = { ...explicit.data, nonce: '0x9' }
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    Accounts.lockRequest(explicit.handlerId, account2.address)
    Accounts.setRequestError(
      explicit.handlerId,
      Object.assign(new Error('Delegation changed. Request not sent.'), {
        code: 'account-code-evidence-changed'
      }),
      account2.address
    )
    const refresh = jest.spyOn(targetAccount, 'refreshTransactionSimulation')

    await expect(Accounts.retryFailedTransaction(explicit.handlerId, account2.address)).resolves.toBe(true)

    expect(explicit.data.nonce).toBeUndefined()
    expect(refresh).toHaveBeenCalledWith(explicit, true, false)
    refresh.mockRestore()
  })

  it('closes a recoverable pre-sign failure with the original responder and advances the queue', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const response = jest.fn()
    const explicit = targetRequest('close-account-code-failure')
    const next = targetRequest('request-after-account-code-failure', 'sign')
    targetAccount.addRequest(explicit, response)
    targetAccount.addRequest(next)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    Accounts.setRequestError(
      explicit.handlerId,
      Object.assign(new Error('Delegation recheck unavailable. Request not sent.'), {
        code: 'account-code-evidence-unavailable'
      }),
      account2.address
    )

    expect(Accounts.closeFailedTransaction(explicit.handlerId, account2.address)).toBe(true)

    expect(targetAccount.requests[explicit.handlerId]).toBeUndefined()
    expect(targetAccount.summary().activeRequestId).toBe(next.handlerId)
    expect(response).toHaveBeenCalledWith({
      id: request.payload.id,
      jsonrpc: request.payload.jsonrpc,
      error: {
        code: -32603,
        message: 'Delegation recheck unavailable. Request not sent.',
        data: { reason: 'account-code-evidence-unavailable' }
      }
    })
  })

  it('retains a terminal pre-sign failure until Close without responding twice', () => {
    jest.useFakeTimers()
    try {
      const targetAccount = Accounts.accounts[account2.address]
      const response = jest.fn()
      const explicit = targetRequest('trezor-disconnected-before-signing')
      const next = targetRequest('request-after-trezor-disconnect', 'sign')
      targetAccount.addRequest(explicit, response)
      targetAccount.addRequest(next)
      explicit.simulation = { status: 'succeeded', calls: [] }
      Accounts.setRequestPending(explicit)
      response({
        id: request.payload.id,
        jsonrpc: request.payload.jsonrpc,
        error: { code: -32603, message: 'Trezor is disconnected' }
      })

      Accounts.setRequestError(explicit.handlerId, new Error('Trezor is disconnected'), account2.address)
      jest.advanceTimersByTime(30_000)

      expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
        status: 'error',
        notice: 'Trezor is disconnected',
        retainedPreBroadcastError: { responderPending: false }
      })
      expect(targetAccount.summary().activeRequestId).toBe(explicit.handlerId)
      expect(response).toHaveBeenCalledTimes(1)

      expect(Accounts.closeFailedTransaction(explicit.handlerId, account2.address)).toBe(true)

      expect(targetAccount.requests[explicit.handlerId]).toBeUndefined()
      expect(targetAccount.summary().activeRequestId).toBe(next.handlerId)
      expect(response).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('claims a request for approval only once', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('single-approval-claim')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }

    expect(Accounts.setRequestPending(explicit)).toBe(true)
    expect(() => Accounts.setRequestPending(explicit)).toThrow(/already pending or complete/i)
    expect(targetAccount.requests[explicit.handlerId].status).toBe('pending')
  })

  it('rejects forged approval and decline actions for a queued request', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const active = targetRequest('active-review', 'sign')
    const queued = targetRequest('queued-review', 'sign')
    targetAccount.addRequest(active)
    targetAccount.addRequest(queued)

    expect(() => Accounts.setRequestPending(queued)).toThrow(/waiting for review/i)
    expect(Accounts.declineRequest(queued.handlerId, account2.address)).toBe(false)
    expect(() => Accounts.getActiveRequestForAccount(account2.address, queued.handlerId)).toThrow(
      /waiting for review/i
    )
    expect(queued.status).toBeUndefined()
    expect(targetAccount.requests[active.handlerId]).toBe(active)
  })

  it('settles access on its originating account rather than the selected account', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const response = jest.fn()
    const explicit = {
      ...targetRequest('account-bound-access', 'access'),
      origin: '8073729a-5e59-53b7-9e69-5d9bcff94087',
      permission: createAccountPermission({
        account: account2.address,
        chains: [1],
        handlerId: '8073729a-5e59-53b7-9e69-5d9bcff94087',
        origin: 'account-bound.example'
      })
    }
    store.initOrigin(explicit.origin, {
      name: 'account-bound.example',
      chain: { type: 'ethereum', id: 1 }
    })
    targetAccount.addRequest(explicit, response)

    expect(Accounts.setAccess(explicit, true)).toBe(true)

    expect(Accounts.current().id).toBe(account.address)
    expect(targetAccount.requests[explicit.handlerId]).toBeUndefined()
    expect(response).toHaveBeenCalledWith({
      id: request.payload.id,
      jsonrpc: request.payload.jsonrpc,
      result: undefined
    })
  })

  it('declines on the originating account while another account is selected', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('account-bound-decline')
    targetAccount.addRequest(explicit)

    Accounts.declineRequest(explicit.handlerId, account2.address)

    expect(Accounts.current().id).toBe(account.address)
    expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
      status: 'declined',
      notice: 'Transaction declined'
    })
  })

  it('does not repeat delayed decline cleanup after the request was already cleared', () => {
    jest.useFakeTimers()
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('decline-cleared-before-timer')
    const remove = jest.spyOn(Accounts, 'removeRequest')
    targetAccount.addRequest(explicit)

    try {
      expect(Accounts.declineRequest(explicit.handlerId, account2.address)).toBe(true)
      Accounts.removeRequest(targetAccount, explicit.handlerId)
      remove.mockClear()

      jest.advanceTimersByTime(2000)

      expect(remove).not.toHaveBeenCalled()
    } finally {
      remove.mockRestore()
      jest.useRealTimers()
    }
  })

  it('cancels an in-flight signer request before marking the transaction declined', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('cancel-active-transaction-signing')
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    const cancel = jest.spyOn(targetAccount, 'cancelTransactionSigning').mockReturnValue(true)

    expect(Accounts.declineRequest(explicit.handlerId, account2.address)).toBe(true)

    expect(cancel).toHaveBeenCalledWith(explicit.handlerId)
    expect(explicit.status).toBe('declined')
    cancel.mockRestore()
  })

  it('keeps a declined request terminal when signer callbacks arrive late', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('declined-is-terminal', 'sign')
    targetAccount.addRequest(explicit)
    Accounts.setRequestPending(explicit)

    expect(Accounts.declineRequest(explicit.handlerId, account2.address)).toBe(true)
    expect(Accounts.setRequestSuccess(explicit.handlerId, account2.address)).toBe(false)
    expect(
      Accounts.setRequestError(explicit.handlerId, new Error('Late device error'), account2.address)
    ).toBe(false)
    expect(Accounts.setTxSent(explicit.handlerId, `0x${'b'.repeat(64)}`, account2.address)).toBe(false)
    expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
      status: 'declined',
      notice: 'Request declined'
    })
  })

  it('does not cancel or revive a request after signing', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('signed-is-not-cancelable')
    const monitor = jest.spyOn(Accounts, 'txMonitor').mockImplementation()
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    targetAccount.requests[explicit.handlerId].status = 'sending'

    try {
      expect(Accounts.declineRequest(explicit.handlerId, account2.address)).toBe(false)
      expect(Accounts.setTxSent(explicit.handlerId, `0x${'a'.repeat(64)}`, account2.address)).toBe(true)
      expect(targetAccount.requests[explicit.handlerId].status).toBe('verifying')
      expect(monitor).toHaveBeenCalledWith(targetAccount, explicit.handlerId, `0x${'a'.repeat(64)}`)
    } finally {
      monitor.mockRestore()
    }
  })

  it('records the full outbound target only after broadcast returns a transaction hash', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const destination = `0x1234${'a'.repeat(32)}abcd`
    const explicit = {
      ...targetRequest('record-outbound-after-broadcast'),
      data: { ...targetRequest('record-outbound-after-broadcast').data, to: destination }
    }
    const monitor = jest.spyOn(Accounts, 'txMonitor').mockImplementation()
    store.clearActivity()
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)

    try {
      expect(store('main.outboundAddressMemory')).toEqual({})
      targetAccount.requests[explicit.handlerId].status = 'sending'
      expect(Accounts.setTxSent(explicit.handlerId, `0x${'a'.repeat(64)}`, account2.address)).toBe(true)

      const memory = store('main.outboundAddressMemory')
      expect(Object.values(memory)).toEqual([
        expect.objectContaining({ prefix: '1234', suffix: 'abcd', lastSubmittedAt: expect.any(Number) })
      ])
      expect(JSON.stringify(memory)).not.toContain(destination.slice(6, -4))
    } finally {
      monitor.mockRestore()
      store.clearActivity()
    }
  })

  it('keeps transaction monitoring authoritative when outbound-address persistence fails', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = {
      ...targetRequest('address-memory-persistence-failure'),
      data: { ...targetRequest('address-memory-persistence-failure').data, to: `0x${'1'.repeat(40)}` }
    }
    const monitor = jest.spyOn(Accounts, 'txMonitor').mockImplementation()
    const record = jest.spyOn(store, 'recordOutboundAddresses').mockImplementation(() => {
      throw new Error('address memory unavailable')
    })
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    targetAccount.requests[explicit.handlerId].status = 'sending'

    try {
      expect(Accounts.setTxSent(explicit.handlerId, `0x${'a'.repeat(64)}`, account2.address)).toBe(true)
      expect(targetAccount.requests[explicit.handlerId]).toMatchObject({ status: 'verifying' })
      expect(monitor).toHaveBeenCalledTimes(1)
    } finally {
      record.mockRestore()
      monitor.mockRestore()
    }
  })

  it('fails before signing when durable lifecycle capacity cannot be reserved', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('lifecycle-capacity-before-signing')
    const callback = jest.fn()
    targetAccount.addRequest(explicit)
    const reserve = jest.spyOn(operationLifecycleLedger, 'reserve').mockImplementation(() => {
      throw new Error('Operation lifecycle limit reached')
    })
    const evict = jest.spyOn(operationLifecycleLedger, 'evictOldestHandledTerminal').mockReturnValue(false)

    try {
      Accounts.setTxSigned(explicit.handlerId, callback, account2.address)
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Operation lifecycle limit reached' })
      )
      expect(explicit.status).toBeUndefined()
      expect(evict).toHaveBeenCalledTimes(1)
    } finally {
      reserve.mockRestore()
      evict.mockRestore()
    }
  })

  it('contains a rejected durable monitor handoff after broadcast', async () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('monitor-storage-failure')
    const monitor = jest.spyOn(Accounts, 'txMonitor').mockRejectedValue(new Error('disk unavailable'))
    targetAccount.addRequest(explicit)
    explicit.simulation = { status: 'succeeded', calls: [] }
    Accounts.setRequestPending(explicit)
    targetAccount.requests[explicit.handlerId].status = 'sending'

    try {
      expect(Accounts.setTxSent(explicit.handlerId, `0x${'a'.repeat(64)}`, account2.address)).toBe(true)
      await new Promise(setImmediate)
      expect(targetAccount.requests[explicit.handlerId]).toMatchObject({
        status: 'sent',
        notice: 'Sent; monitoring unavailable',
        mode: 'monitor',
        tx: { hash: `0x${'a'.repeat(64)}`, confirmations: 0 }
      })
    } finally {
      monitor.mockRestore()
    }
  })

  it('does not misdiagnose a generic Ledger invalid-data response', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const explicit = targetRequest('ledger-invalid-data')
    targetAccount.addRequest(explicit)

    Accounts.setRequestError(
      explicit.handlerId,
      new Error('Ledger device: Invalid data received (0x6a80)'),
      account2.address
    )

    expect(targetAccount.requests[explicit.handlerId].notice).toBe(
      'Ledger rejected transaction data (0x6a80)'
    )
  })
})

describe('#cancelUnapprovedRequestForAccount', () => {
  const accessRequest = (handlerId) => ({
    handlerId,
    type: 'access',
    origin: 'transport.test',
    account: account2.address,
    payload: { id: handlerId, jsonrpc: '2.0', method: 'eth_accounts' }
  })

  it('removes only the exact untouched request when its transport aborts', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const controller = new AbortController()
    const response = bindRequestSignal(jest.fn(), controller.signal)
    const ownedRequest = accessRequest('transport-owned')
    const otherRequest = accessRequest('other-transport')

    Accounts.addRequestForAccount(account2.address, ownedRequest, response)
    Accounts.addRequestForAccount(account2.address, otherRequest, jest.fn())
    controller.abort()

    expect(response).toHaveBeenCalledWith({
      id: 'transport-owned',
      jsonrpc: '2.0',
      error: { code: 4900, message: 'Requesting client disconnected' }
    })
    expect(targetAccount.requests['transport-owned']).toBeUndefined()
    expect(targetAccount.requests['other-transport']).toBe(otherRequest)
    expect(Accounts.current().id).toBe(account.address)
  })

  it('preserves a request that was claimed before its transport aborts', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const controller = new AbortController()
    const response = bindRequestSignal(jest.fn(), controller.signal)
    const claimedRequest = {
      ...accessRequest('claimed-request'),
      status: 'pending',
      locked: true
    }

    Accounts.addRequestForAccount(account2.address, claimedRequest, response)
    controller.abort()

    expect(response).not.toHaveBeenCalled()
    expect(targetAccount.requests['claimed-request']).toBe(claimedRequest)
    expect(
      Accounts.cancelUnapprovedRequestForAccount(account2.address, claimedRequest.handlerId, {
        code: 4900,
        message: 'Requesting client disconnected'
      })
    ).toBe(false)
  })

  it('removes a retained pre-broadcast failure when its transport aborts', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const controller = new AbortController()
    const response = bindRequestSignal(jest.fn(), controller.signal)
    const recoverable = {
      ...request,
      handlerId: 'aborted-account-code-retry',
      account: account2.address,
      data: { ...request.data, from: account2.address },
      simulation: { status: 'succeeded', calls: [] }
    }
    Accounts.addRequestForAccount(account2.address, recoverable, response)
    Accounts.setRequestPending(recoverable)
    Accounts.lockRequest(recoverable.handlerId, account2.address)
    Accounts.setRequestError(
      recoverable.handlerId,
      Object.assign(new Error('Delegation recheck unavailable. Request not sent.'), {
        code: 'account-code-evidence-unavailable'
      }),
      account2.address
    )

    controller.abort()

    expect(targetAccount.requests[recoverable.handlerId]).toBeUndefined()
    expect(response).toHaveBeenCalledWith({
      id: request.payload.id,
      jsonrpc: request.payload.jsonrpc,
      error: { code: 4900, message: 'Requesting client disconnected' }
    })
  })

  it('closes a retained wallet-call funding recovery when its transport aborts', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const controller = new AbortController()
    const response = bindRequestSignal(jest.fn(), controller.signal)
    const recoverable = {
      ...accessRequest('aborted-wallet-call-recovery'),
      type: 'walletCalls',
      chainId: '0x1',
      calls: [{ data: '0x', value: '0x0' }],
      preparation: { status: 'pending' },
      simulation: { status: 'pending', calls: [] }
    }
    Accounts.addRequestForAccount(account2.address, recoverable, response)
    Object.assign(recoverable, {
      status: 'error',
      recoverableError: { code: WALLET_CALL_FUNDING_ERROR, message: 'More funds needed.' }
    })

    controller.abort()

    expect(targetAccount.requests[recoverable.handlerId]).toBeUndefined()
    expect(response).toHaveBeenCalledWith({
      id: recoverable.payload.id,
      jsonrpc: recoverable.payload.jsonrpc,
      error: { code: 4900, message: 'Requesting client disconnected' }
    })
  })
})

describe('#removeRequest', () => {
  beforeEach(() => {
    account.clearRequest = jest.fn()
    Accounts.addRequest(request)
  })

  it('should remove a request for the provided handlerId from the account', () => {
    Accounts.removeRequest(account, request.handlerId)

    expect(account.clearRequest).toHaveBeenCalledWith(request.handlerId)
  })
})

describe('ordinary transaction lifecycle outcomes', () => {
  it('confirms on the first canonical receipt and cancels stale cleanup when that receipt reorgs', () => {
    jest.useFakeTimers()
    const targetAccount = Accounts.current()
    const hash = `0x${'a'.repeat(64)}`
    const blockHash = `0x${'b'.repeat(64)}`
    Accounts.addRequest(request)
    const target = targetAccount.getRequest(request.handlerId)
    target.status = 'verifying'
    target.tx = { hash, confirmations: 0 }
    const now = Date.now()
    const submitted = {
      id: target.activityId,
      kind: 'transaction',
      account: target.account,
      origin: target.origin,
      chainId: 1,
      state: 'submitted',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MAX_OPERATION_LIFECYCLE_AGE_MS,
      visibleInActivity: true,
      notification: {},
      transaction: { hash, nonce: target.data.nonce }
    }
    const receipt = {
      transactionHash: hash,
      blockHash,
      blockNumber: '0x5',
      gasUsed: '0x5208',
      status: '0x1'
    }
    const confirmed = {
      ...submitted,
      state: 'confirmed',
      updatedAt: now + 1,
      receipt: {
        transactionHash: hash,
        blockHash,
        blockNumber: '0x5',
        status: '0x1'
      },
      settlement: { status: 'monitoring' }
    }

    try {
      operationLifecycleLedger.put(submitted, now)
      operationLifecycleLedger.put(confirmed, now + 1)
      Accounts.observeOperationLifecycle(confirmed, 1, receipt)
      expect(target).toMatchObject({
        status: 'confirmed',
        notice: 'Confirmed',
        tx: { confirmations: 1, receipt }
      })

      const { receipt: _receipt, settlement: _settlement, ...withoutEvidence } = confirmed
      const reorged = { ...withoutEvidence, state: 'reorged', updatedAt: now + 2 }
      operationLifecycleLedger.put(reorged, now + 2)
      Accounts.observeOperationLifecycle(reorged)
      expect(target).toMatchObject({
        status: 'verifying',
        notice: 'Rechecking after chain reorganization',
        tx: { confirmations: 0 }
      })
      expect(target.tx.receipt).toBeUndefined()

      jest.advanceTimersByTime(60_000)
      expect(targetAccount.getRequest(target.handlerId)).toBe(target)
    } finally {
      operationLifecycleLedger.remove(target.activityId, -1)
      jest.useRealTimers()
    }
  })
})

describe('#clearRequests', () => {
  it('declines untouched requests and silently removes already-answered monitor rows', () => {
    const pendingResponse = jest.fn()
    const monitorResponse = jest.fn()
    const walletCallsResponse = jest.fn()
    Accounts.addRequest(request, pendingResponse)
    Accounts.addRequest({ ...request, handlerId: '2', origin: 'other-origin' }, monitorResponse)
    Accounts.addRequest(
      {
        ...request,
        handlerId: 'retained-wallet-calls',
        type: 'walletCalls',
        chainId: '0x1',
        calls: [{ data: '0x', value: '0x0' }],
        preparation: { status: 'pending' },
        simulation: { status: 'pending', calls: [] }
      },
      walletCallsResponse
    )
    Object.assign(Accounts.accounts[account.id].requests['2'], {
      mode: 'monitor',
      status: 'confirming'
    })
    Object.assign(Accounts.accounts[account.id].requests['retained-wallet-calls'], {
      status: 'error',
      recoverableError: { code: WALLET_CALL_FUNDING_ERROR, message: 'More funds needed.' }
    })

    Accounts.clearRequests(account.id)

    expect(Object.keys(Accounts.accounts[account.id].requests)).toHaveLength(0)
    expect(pendingResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4001, message: 'User rejected the request' } })
    )
    expect(walletCallsResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4001, message: 'User rejected the request' } })
    )
    expect(monitorResponse).not.toHaveBeenCalled()
  })
})

describe('#rejectUnapprovedRequestsForOriginChain', () => {
  it('rejects only untouched requests for the switching origin and old chain', () => {
    const activeAccount = Accounts.current()
    const responses = {
      transaction: jest.fn(),
      sign: jest.fn(),
      walletCalls: jest.fn(),
      retainedWalletCalls: jest.fn()
    }
    const requestFor = (handlerId, overrides) => ({
      ...request,
      handlerId,
      payload: { ...request.payload, id: handlerId },
      ...overrides
    })

    Accounts.addRequest(requestFor('old-transaction', {}), responses.transaction)
    Accounts.addRequest(
      requestFor('old-sign', {
        type: 'sign',
        data: { context: { requestChainId: 1 } }
      }),
      responses.sign
    )
    Accounts.addRequest(
      requestFor('old-wallet-calls', {
        type: 'walletCalls',
        account: activeAccount.id,
        chainId: '0x1',
        calls: [{ data: '0x', value: '0x0' }],
        preparation: { status: 'pending' },
        simulation: { status: 'pending', calls: [] }
      }),
      responses.walletCalls
    )
    Accounts.addRequest(
      requestFor('other-chain', {
        type: 'signTypedData',
        context: { requestChainId: 5 }
      })
    )
    Accounts.addRequest(
      requestFor('retained-wallet-calls', {
        type: 'walletCalls',
        account: activeAccount.id,
        chainId: '0x1',
        calls: [{ data: '0x', value: '0x0' }],
        preparation: { status: 'pending' },
        simulation: { status: 'pending', calls: [] }
      }),
      responses.retainedWalletCalls
    )
    Object.assign(activeAccount.requests['retained-wallet-calls'], {
      status: 'error',
      recoverableError: { code: WALLET_CALL_FUNDING_ERROR, message: 'More funds needed.' }
    })
    Accounts.addRequest(
      requestFor('already-approved', {
        status: 'pending',
        locked: true
      })
    )
    Accounts.addRequest(
      requestFor('other-origin', {
        origin: '07h3r'
      })
    )
    activeAccount.rejectUnapprovedRequestsForOriginChain(request.origin, 1)

    expect(Object.keys(activeAccount.requests).sort()).toEqual(
      ['already-approved', 'other-chain', 'other-origin'].sort()
    )
    expect(responses.transaction).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4901, message: expect.stringContaining('chain 1') } })
    )
    expect(responses.sign).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4901, message: expect.stringContaining('chain 1') } })
    )
    expect(responses.walletCalls).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4901, message: expect.stringContaining('chain 1') } })
    )
    expect(responses.retainedWalletCalls).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4901, message: expect.stringContaining('chain 1') } })
    )
  })
})

describe('#rejectUnapprovedRequestsForOrigins', () => {
  it('rejects only untouched requests for revoked origins on the selected account', () => {
    const activeAccount = Accounts.current()
    const revokedResponse = jest.fn()
    const walletCallsResponse = jest.fn()
    const retainedResponse = jest.fn()
    const requestFor = (handlerId, overrides = {}) => ({
      ...request,
      handlerId,
      payload: { ...request.payload, id: handlerId },
      ...overrides
    })

    Accounts.addRequest(requestFor('revoked-request'), revokedResponse)
    Accounts.addRequest(
      requestFor('retained-wallet-calls', {
        type: 'walletCalls',
        chainId: '0x1',
        calls: [{ data: '0x', value: '0x0' }],
        preparation: { status: 'pending' },
        simulation: { status: 'pending', calls: [] }
      }),
      walletCallsResponse
    )
    Object.assign(activeAccount.requests['retained-wallet-calls'], {
      status: 'error',
      recoverableError: { code: WALLET_CALL_FUNDING_ERROR, message: 'More funds needed.' }
    })
    Accounts.addRequest(requestFor('other-origin', { origin: 'other-origin' }), retainedResponse)
    Accounts.addRequest(requestFor('locked-request', { status: 'pending', locked: true }), retainedResponse)

    expect(Accounts.rejectUnapprovedRequestsForOrigins(activeAccount.id, [request.origin])).toBe(true)

    expect(activeAccount.requests).not.toHaveProperty('revoked-request')
    expect(activeAccount.requests).toHaveProperty('other-origin')
    expect(activeAccount.requests).toHaveProperty('locked-request')
    expect(revokedResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4100, message: 'Request origin access was revoked' } })
    )
    expect(walletCallsResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 4100, message: 'Request origin access was revoked' } })
    )
    expect(retainedResponse).not.toHaveBeenCalled()
  })

  it('ignores unknown accounts and empty origin sets', () => {
    expect(
      Accounts.rejectUnapprovedRequestsForOrigins('0x1111111111111111111111111111111111111111', [
        request.origin
      ])
    ).toBe(false)
    expect(Accounts.rejectUnapprovedRequestsForOrigins(Accounts.current().id, [])).toBe(false)
  })
})

describe('#signTransactionForAccount', () => {
  it('signs through the pinned account even when another account is current', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const callback = jest.fn()
    const sign = jest
      .spyOn(targetAccount, 'signTransaction')
      .mockImplementation((_transaction, cb) => cb(null, '0xsigned'))
    const transaction = { ...request.data, from: account2.address }

    Accounts.signTransactionForAccount(account2.address.toUpperCase(), transaction, callback)

    expect(Accounts.current().id).toBe(account.address)
    expect(sign).toHaveBeenCalledWith(transaction, callback)
    expect(callback).toHaveBeenCalledWith(null, '0xsigned')
    sign.mockRestore()
  })

  it.each([
    ['unknown account', '0x3333333333333333333333333333333333333333', account.address, /locate/],
    ['wrong transaction owner', account2.address, account.address, /does not match/]
  ])('rejects %s without invoking an account signer', (_label, accountId, from, message) => {
    const targetAccount = Accounts.accounts[account2.address]
    const callback = jest.fn()
    const sign = jest.spyOn(targetAccount, 'signTransaction')

    Accounts.signTransactionForAccount(accountId, { ...request.data, from }, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toEqual(
      expect.objectContaining({ message: expect.stringMatching(message) })
    )
    expect(sign).not.toHaveBeenCalled()
    sign.mockRestore()
  })
})

describe('#claimWalletCallsRequest', () => {
  const readyRequest = (handlerId = 'wallet-calls-claim') => {
    const call = {
      to: '0x3333333333333333333333333333333333333333',
      data: '0xabcd',
      value: '0x0'
    }
    return {
      handlerId,
      type: 'walletCalls',
      account: account2.address,
      origin: 'example.test',
      payload: { id: 1, jsonrpc: '2.0', method: 'wallet_sendCalls', params: [] },
      version: '2.0.0',
      batchId: 'batch-id',
      chainId: '0x1',
      atomic: false,
      calls: [call],
      simulation: {
        status: 'succeeded',
        source: 'eth_simulateV1',
        calls: [{ status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x1' }]
      },
      preparation: {
        status: 'succeeded',
        calls: [
          {
            transaction: {
              from: account2.address,
              chainId: '0x1',
              nonce: '0x5',
              type: '0x2',
              gasLimit: '0x5208',
              ...call,
              maxFeePerGas: '0x10',
              maxPriorityFeePerGas: '0x1',
              gasFeesSource: GasFeesSource.Frame
            },
            maxFee: '0x52080'
          }
        ],
        maxFee: '0x52080'
      }
    }
  }

  const admitReadyRequest = (targetAccount, request, responder) => {
    const simulation = request.simulation
    const preparation = request.preparation
    const revealDetails = jest.spyOn(targetAccount, 'revealDetails').mockImplementationOnce(() => {})
    try {
      targetAccount.addRequest(request, responder)
    } finally {
      revealDetails.mockRestore()
    }
    request.simulation = simulation
    request.preparation = preparation
  }

  const claimEvidence = (request) => ({
    execution: snapshotPreparedWalletCallExecutionInput({
      id: request.batchId,
      origin: request.origin,
      account: request.account,
      chainId: request.chainId,
      calls: request.calls,
      preparation: request.preparation
    }),
    simulation: JSON.stringify(request.simulation)
  })

  it('claims from the explicit account while another account remains current', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest()
    admitReadyRequest(targetAccount, request)

    const snapshot = Accounts.claimWalletCallsRequest(account2.address.toUpperCase(), request.handlerId)

    expect(Accounts.current().id).toBe(account.address)
    expect(snapshot).toMatchObject({ account: account2.address, id: request.batchId })
    expect(request).toMatchObject({ locked: true, status: 'pending' })
  })

  it.each([
    ['invalid account identity', undefined, 'wallet-calls-claim', /invalid/i],
    ['invalid handler identity', account2.address, '', /invalid/i],
    ['unknown account', '0x3333333333333333333333333333333333333333', 'wallet-calls-claim', /locate/i]
  ])('rejects %s', (_label, accountId, handlerId, message) => {
    expect(() => Accounts.claimWalletCallsRequest(accountId, handlerId)).toThrow(message)
  })

  it('atomically claims and detaches the lifecycle responder from the explicit account', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest('wallet-calls-with-response')
    const responder = jest.fn()
    responder.walletCallsLifecycle = true
    responder.accept = jest.fn()
    admitReadyRequest(targetAccount, request, responder)

    const claimed = Accounts.claimWalletCallsRequestWithResponse(
      account2.address.toUpperCase(),
      request.handlerId,
      claimEvidence(request)
    )

    expect(Accounts.current().id).toBe(account.address)
    expect(claimed.snapshot).toMatchObject({ account: account2.address, id: request.batchId })
    expect(claimed.responder).toBe(responder)
    expect(request.res).toBeUndefined()
    expect(request).toMatchObject({ locked: true, status: 'pending' })
  })

  it('does not claim a request without its specialized lifecycle responder', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest('wallet-calls-no-response')
    admitReadyRequest(targetAccount, request, jest.fn())

    expect(() => Accounts.claimWalletCallsRequestWithResponse(account2.address, request.handlerId)).toThrow(
      /response is no longer available/i
    )
    expect(request.locked).toBeUndefined()
    expect(request.status).toBeUndefined()
  })

  it('rejects a final claim if preparation changes after preflight evidence was captured', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest('wallet-calls-preflight-drift')
    const responder = jest.fn()
    responder.walletCallsLifecycle = true
    responder.accept = jest.fn()
    admitReadyRequest(targetAccount, request, responder)
    const evidence = claimEvidence(request)
    request.preparation.calls[0].transaction.maxFeePerGas = '0x11'
    const changedMaxFee = toRpcQuantity(BigInt(request.preparation.calls[0].transaction.gasLimit) * 0x11n)
    request.preparation.calls[0].maxFee = changedMaxFee
    request.preparation.maxFee = changedMaxFee

    expect(() =>
      Accounts.claimWalletCallsRequestWithResponse(account2.address, request.handlerId, evidence)
    ).toThrow(/changed during final preflight/i)
    expect(request.locked).toBeUndefined()
    expect(request.status).toBeUndefined()
    expect(request.res).toBe(responder)
    expect(responder.accept).not.toHaveBeenCalled()
  })

  it('retains, updates, and closes an unfunded wallet-call request without detaching its responder', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest('wallet-calls-funding-recovery')
    const responder = jest.fn()
    responder.walletCallsLifecycle = true
    responder.accept = jest.fn()
    admitReadyRequest(targetAccount, request, responder)
    const error = new WalletCallFundingError(WALLET_CALL_FUNDING_ERROR, 'More funds needed.', {
      available: '0x1',
      required: '0x3',
      missing: '0x2',
      value: '0x1',
      maximumFee: '0x2'
    })

    expect(Accounts.retainWalletCallsFundingFailure(account2.address, request.handlerId, error)).toBe(true)
    expect(request.res).toBe(responder)
    expect(request).toMatchObject({
      status: 'error',
      recoverableError: { code: WALLET_CALL_FUNDING_ERROR, data: { missing: '0x2' } }
    })
    expect(responder).not.toHaveBeenCalled()

    const updated = new WalletCallFundingError(WALLET_CALL_FUNDING_ERROR, 'Still needs funds.', {
      available: '0x2',
      required: '0x4',
      missing: '0x2',
      value: '0x2',
      maximumFee: '0x2'
    })
    expect(Accounts.retainWalletCallsFundingFailure(account2.address, request.handlerId, updated)).toBe(true)
    expect(request.recoverableError).toMatchObject({
      message: 'Still needs funds.',
      data: { available: '0x2' }
    })
    expect(request.res).toBe(responder)

    expect(Accounts.closeFailedWalletCalls(request.handlerId, account2.address)).toBe(true)
    expect(responder).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 4001 }) })
    )
    expect(responder.accept).not.toHaveBeenCalled()
  })

  it('settles and expires only the claimed request on its explicit account', () => {
    jest.useFakeTimers()
    try {
      const targetAccount = Accounts.accounts[account2.address]
      const request = readyRequest('wallet-calls-settlement')
      admitReadyRequest(targetAccount, request)
      Accounts.claimWalletCallsRequest(account2.address, request.handlerId)

      expect(Accounts.settleWalletCallsRequest(account2.address, request.handlerId)).toBe(true)
      expect(Accounts.current().id).toBe(account.address)
      expect(request).toMatchObject({ status: 'success', notice: 'Batch Submitted', mode: 'monitor' })

      jest.advanceTimersByTime(3299)
      expect(targetAccount.requests[request.handlerId]).toBe(request)
      jest.advanceTimersByTime(1)
      expect(targetAccount.requests[request.handlerId]).toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })

  it.each([
    ['successful execution', undefined, 3300],
    ['uncertain execution', new Error('broadcast outcome is uncertain'), 8000]
  ])('does not let %s overwrite a durable submitted lifecycle row', (_label, error, delay) => {
    jest.useFakeTimers()
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest(`wallet-calls-durable-${delay}`)
    try {
      store.clearActivity()
      admitReadyRequest(targetAccount, request)
      const now = Date.now()
      operationLifecycleLedger.put(
        {
          id: request.activityId,
          kind: 'walletCalls',
          account: account2.address,
          origin: request.origin,
          chainId: 1,
          state: 'submitted',
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
          visibleInActivity: true,
          notification: {},
          walletCalls: { batchOperationId: request.activityId }
        },
        now
      )
      store.recordActivity({
        id: request.activityId,
        account: account2.address,
        origin: request.origin,
        type: 'walletCalls',
        outcome: 'submitted',
        createdAt: now,
        completedAt: now,
        chainId: 1
      })
      Accounts.claimWalletCallsRequest(account2.address, request.handlerId)
      Accounts.settleWalletCallsRequest(account2.address, request.handlerId, error)

      jest.advanceTimersByTime(delay)

      expect(targetAccount.requests[request.handlerId]).toBeUndefined()
      expect(store('main.activity').find(({ id }) => id === request.activityId)).toMatchObject({
        outcome: 'submitted'
      })
    } finally {
      operationLifecycleLedger.remove(request.activityId, -1)
      store.clearActivity()
      jest.useRealTimers()
    }
  })

  it('rejects an outcome for an unclaimed wallet-call request', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest('wallet-calls-unclaimed-outcome')
    targetAccount.requests[request.handlerId] = request

    expect(() =>
      Accounts.settleWalletCallsRequest(account2.address, request.handlerId, new Error('failed'))
    ).toThrow(/not awaiting an execution outcome/i)
    expect(request.status).toBeUndefined()
  })

  it('restores the pending request when publishing its outcome fails', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const request = readyRequest('wallet-calls-outcome-store-failure')
    admitReadyRequest(targetAccount, request)
    Accounts.claimWalletCallsRequest(account2.address, request.handlerId)
    delete request.res
    const expected = JSON.parse(JSON.stringify(request))
    const update = jest.spyOn(targetAccount, 'update').mockImplementationOnce(() => {
      throw new Error('account store unavailable')
    })

    expect(() => Accounts.settleWalletCallsRequest(account2.address, request.handlerId)).toThrow(
      /store unavailable/
    )
    expect(request).toEqual(expected)
    update.mockRestore()
  })

  it('rejects a forged claim for a queued batch', () => {
    const targetAccount = Accounts.accounts[account2.address]
    const active = readyRequest('wallet-calls-active')
    const queued = readyRequest('wallet-calls-queued')
    admitReadyRequest(targetAccount, active)
    admitReadyRequest(targetAccount, queued)

    expect(() => Accounts.claimWalletCallsRequest(account2.address, queued.handlerId)).toThrow(
      /waiting for review/i
    )
    expect(queued.locked).toBeUndefined()
    expect(queued.status).toBeUndefined()
  })
})

describe('#signerCompatibility', () => {
  let activeSigner

  const lockedSeedSigner = {
    id: '13',
    type: 'seed',
    addresses: [account.id],
    status: 'locked'
  }

  beforeEach(() => {
    store.navDash = jest.fn()

    activeSigner = {
      id: '12',
      addresses: [account.id],
      summary: jest.fn()
    }

    store.newSigner(lockedSeedSigner)

    signers.get.mockImplementation((id) => {
      if (id === activeSigner.id) return activeSigner
      if (id === lockedSeedSigner.id) return lockedSeedSigner
    })

    Accounts.accounts[account.id].lastSignerType = 'seed'
    Accounts.accounts[account.id].signer = activeSigner.id
    Accounts.addRequest(request)
  })

  afterEach(() => {
    store.removeSigner(activeSigner.id)
    store.removeSigner(lockedSeedSigner.id)

    Accounts.removeRequests([request.handlerId])
  })

  const signerTypes = ['trezor', 'ledger', 'lattice']

  signerTypes.forEach((signerType) => {
    it(`should open the signer menu when a ${signerType} signer is not available`, () => {
      const cb = jest.fn()

      activeSigner.status = 'disconnected'
      activeSigner.type = signerType
      store.newSigner(activeSigner)

      Accounts.accounts[account.id].signer = undefined
      Accounts.accounts[account.id].lastSignerType = signerType

      Accounts.signerCompatibility(request.handlerId, cb)

      expect(cb).toHaveBeenCalledWith(new Error('Signer unavailable'))
      expect(store.navDash).toHaveBeenCalledWith({
        data: {
          signer: activeSigner.id
        },
        view: 'expandedSigner'
      })
    })
  })

  it('should not open the signer menu if the current signer is ready', () => {
    const cb = jest.fn()
    const compatibility = { signer: activeSigner.id, tx: 'sometx', compatible: true }

    activeSigner.status = 'ok'
    signerCompatibility.mockReturnValue(compatibility)

    Accounts.signerCompatibility(request.handlerId, cb)

    expect(store.navDash).not.toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith(null, compatibility)
  })

  it('should open the signer panel for a signer that is not ready', () => {
    const cb = jest.fn()

    activeSigner.status = 'locked'

    Accounts.signerCompatibility(request.handlerId, cb)

    expect(store.navDash).toHaveBeenCalledWith({
      data: {
        signer: activeSigner.id
      },
      view: 'expandedSigner'
    })
  })

  it('should return an error when the signer is not ready', () => {
    const cb = jest.fn()

    activeSigner.status = 'locked'

    Accounts.signerCompatibility(request.handlerId, cb)

    expect(cb).toHaveBeenCalledWith(new Error('Signer unavailable'))
  })

  it('should return an error when there is no signer', () => {
    const cb = jest.fn()

    Accounts.accounts[account.id].signer = undefined

    Accounts.signerCompatibility(request.handlerId, cb)

    expect(store.navDash).not.toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith(new Error('No signer'))
  })

  it('rejects a watch-only account without opening a signer panel', () => {
    const cb = jest.fn()
    Accounts.accounts[account.id].lastSignerType = 'address'
    Accounts.accounts[account.id].signer = undefined

    Accounts.signerCompatibility(request.handlerId, cb)

    expect(store.navDash).not.toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith(new Error('Watch-only accounts cannot sign'))
  })
})

describe('#replaceTx', () => {
  const activityId = '00000000-0000-4000-8000-000000000091'
  const originalHash = `0x${'9'.repeat(64)}`

  const installOriginal = (envelope = 'eip1559') => {
    const current = Accounts.current()
    const data =
      envelope === 'legacy'
        ? {
            from: current.id,
            to: `0x${'1'.repeat(40)}`,
            value: '0x5',
            data: '0x',
            chainId: '0x1',
            gasLimit: '0x5208',
            gasPrice: '0x64',
            type: '0x0',
            nonce: '0xa',
            gasFeesSource: GasFeesSource.Frame
          }
        : {
            from: current.id,
            to: `0x${'1'.repeat(40)}`,
            value: '0x5',
            data: '0x1234',
            chainId: '0x1',
            gasLimit: '0x9000',
            maxPriorityFeePerGas: '0xa',
            maxFeePerGas: '0x64',
            type: '0x2',
            nonce: '0xa',
            gasFeesSource: GasFeesSource.Frame
          }
    const original = {
      ...request,
      handlerId: 'replace-original',
      account: current.id,
      origin: 'replacement-origin',
      activityId,
      mode: 'monitor',
      status: 'verifying',
      data,
      tx: { hash: originalHash, confirmations: 0 },
      approvals: [],
      recognizedActions: [],
      simulation: { status: 'succeeded' },
      feesUpdatedByUser: false
    }
    current.requests[original.handlerId] = original
    const now = Date.now()
    operationLifecycleLedger.put(
      {
        id: activityId,
        kind: 'transaction',
        account: current.id,
        origin: original.origin,
        chainId: 1,
        state: 'submitted',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + MAX_OPERATION_LIFECYCLE_AGE_MS,
        visibleInActivity: true,
        notification: {},
        transaction: { hash: originalHash, nonce: '0xa' }
      },
      now
    )
    return { current, original }
  }

  beforeEach(() => {
    provider.sendTransaction.mockReset()
    provider.connection.send.mockReset()
    provider.connection.send.mockImplementation((payload, callback) => {
      if (payload.method === 'eth_getTransactionReceipt') return callback({ result: null })
      if (payload.method === 'eth_getTransactionCount') return callback({ result: '0xa' })
      throw new Error(`Unexpected replacement RPC ${payload.method}`)
    })
    provider.sendTransaction.mockImplementation((payload, _response, _chain, onQueued) => {
      const current = Accounts.current()
      const handlerId = `replacement-${payload.params[0].type}`
      current.requests[handlerId] = {
        ...request,
        handlerId,
        account: current.id,
        origin: payload._origin,
        payload,
        data: { ...payload.params[0], gasFeesSource: GasFeesSource.Dapp },
        approvals: [],
        recognizedActions: [],
        simulation: { status: 'succeeded' },
        feesUpdatedByUser: false
      }
      onQueued(handlerId)
    })
  })

  afterEach(() => {
    operationLifecycleLedger.remove(activityId, -1)
    provider.sendTransaction.mockReset()
    provider.connection.send.mockReset()
  })

  it('queues an EIP-1559 speed-up with current-or-minimum fees and no global preference mutation', async () => {
    const { current, original } = installOriginal()
    store.setGasDefault('ethereum', 1, 'standard', '0x1')
    store.setGasFees('ethereum', 1, {
      maxBaseFeePerGas: '0x70',
      maxPriorityFeePerGas: '0x5'
    })

    await expect(Accounts.replaceTx(current.id, original.handlerId, 'speed')).resolves.toBeUndefined()

    const [payload, , chain] = provider.sendTransaction.mock.calls[0]
    expect(chain).toEqual({ type: 'ethereum', id: 1 })
    expect(payload._origin).toBe(original.origin)
    expect(payload.params[0]).toMatchObject({
      to: original.data.to,
      value: original.data.value,
      data: original.data.data,
      nonce: '0xa',
      gasLimit: original.data.gasLimit,
      maxPriorityFeePerGas: '0xb',
      maxFeePerGas: '0x75'
    })
    expect(payload.params[0]).not.toHaveProperty('gasFeesSource')
    expect(store('main.networksMeta.ethereum', 1, 'gas.price.selected')).toBe('standard')
    expect(current.requests['replacement-0x2'].replacement).toEqual({
      kind: 'speed',
      originalActivityId: activityId,
      originalHash
    })
  })

  it('queues a legacy cancel as a reviewed self-transfer using the original origin', async () => {
    const { current, original } = installOriginal('legacy')
    store.setGasPrices('ethereum', 1, { fast: '0x96' })

    await expect(Accounts.replaceTx(current.id, original.handlerId, 'cancel')).resolves.toBeUndefined()

    const payload = provider.sendTransaction.mock.calls[0][0]
    expect(payload._origin).toBe(original.origin)
    expect(payload.params[0]).toEqual({
      from: current.id,
      nonce: '0xa',
      chainId: '0x1',
      type: '0x0',
      gasPrice: '0x96',
      to: current.id,
      value: '0x0',
      data: '0x'
    })
    expect(current.requests['replacement-0x0'].replacement.kind).toBe('cancel')
  })

  it('fails closed when the original is included before replacement admission', async () => {
    const { current, original } = installOriginal()
    store.setGasFees('ethereum', 1, {
      maxBaseFeePerGas: '0x20',
      maxPriorityFeePerGas: '0x5'
    })
    provider.connection.send.mockImplementation((payload, callback) => {
      if (payload.method === 'eth_getTransactionReceipt') return callback({ result: { status: '0x1' } })
      if (payload.method === 'eth_getTransactionCount') return callback({ result: '0xb' })
    })

    await expect(Accounts.replaceTx(current.id, original.handlerId, 'speed')).rejects.toThrow(
      /already included/i
    )
    expect(provider.sendTransaction).not.toHaveBeenCalled()
  })
})

describe('#setRequestPending', () => {
  it('keeps a transaction reviewable while its execution check is pending', () => {
    const currentAccount = Accounts.current()
    currentAccount.lastSignerType = 'seed'
    const pendingSimulation = {
      ...request,
      handlerId: 'pending-simulation',
      simulation: { status: 'pending', calls: [] }
    }
    currentAccount.requests[pendingSimulation.handlerId] = pendingSimulation
    currentAccount.activeReviewHandlerId = pendingSimulation.handlerId

    expect(() => Accounts.setRequestPending(pendingSimulation)).toThrow(/safety checks are still pending/i)
    expect(pendingSimulation.status).toBeUndefined()
    expect(pendingSimulation.notice).toBeUndefined()
  })

  it('keeps a transaction reviewable while required additional checks are pending', () => {
    const currentAccount = Accounts.current()
    currentAccount.lastSignerType = 'seed'
    const pendingAdvancedChecks = {
      ...request,
      handlerId: 'pending-advanced-checks',
      simulation: { status: 'succeeded', advancedChecks: { status: 'pending' } }
    }
    currentAccount.requests[pendingAdvancedChecks.handlerId] = pendingAdvancedChecks
    currentAccount.activeReviewHandlerId = pendingAdvancedChecks.handlerId

    expect(() => Accounts.setRequestPending(pendingAdvancedChecks)).toThrow(
      /safety checks are still pending/i
    )
    expect(pendingAdvancedChecks.status).toBeUndefined()
  })

  it('records the truthful initial transaction-signing phase', () => {
    const currentAccount = Accounts.current()
    currentAccount.lastSignerType = 'seed'
    const withNonce = {
      ...request,
      handlerId: 'signing-phase-with-nonce',
      simulation: { status: 'succeeded' },
      data: { ...request.data, nonce: '0x5' }
    }
    currentAccount.requests[withNonce.handlerId] = withNonce
    currentAccount.activeReviewHandlerId = withNonce.handlerId

    expect(Accounts.setRequestPending(withNonce)).toBe(true)
    expect(withNonce.signingProgress).toMatchObject({
      phase: 'rechecking-safety',
      startedAt: expect.any(Number)
    })
  })

  it.each(['transaction', 'sign', 'signTypedData', 'signErc20Permit'])(
    'rejects a watch-only %s request before pending state',
    (type) => {
      const currentAccount = Accounts.current()
      const signingRequest = { ...request, handlerId: `watch-only-${type}`, type }
      currentAccount.lastSignerType = 'address'
      currentAccount.requests[signingRequest.handlerId] = signingRequest
      currentAccount.activeReviewHandlerId = signingRequest.handlerId

      expect(() => Accounts.setRequestPending(signingRequest)).toThrow(/watch-only accounts cannot sign/i)
      expect(signingRequest.status).toBeUndefined()
      expect(signingRequest.notice).toBeUndefined()
    }
  )

  it('keeps add-chain approval available to watch-only accounts', () => {
    const currentAccount = Accounts.current()
    const addChainRequest = { ...request, handlerId: 'watch-only-add-chain', type: 'addChain' }
    currentAccount.lastSignerType = 'address'
    currentAccount.requests[addChainRequest.handlerId] = addChainRequest
    currentAccount.activeReviewHandlerId = addChainRequest.handlerId

    expect(() => Accounts.setRequestPending(addChainRequest)).not.toThrow()
    expect(addChainRequest.status).toBe('pending')
  })
})

describe('wallet-owned EIP-7702 revocation', () => {
  const privateKey = '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356'
  const authority = computeAddress(new SigningKey(privateKey).publicKey).toLowerCase()
  const delegation = '0xef01001111111111111111111111111111111111111111'
  const signer = {
    id: 'eip7702-seed',
    type: 'seed',
    status: 'ok',
    addresses: [authority],
    signEip7702Revoke: jest.fn((_index, signingRequest, cb) => {
      cb(null, signEip7702RevokeRequest(privateKey, signingRequest))
    })
  }

  let code = delegation
  let receiptStatus = '0x0'
  let latestNonce = '0x3'
  let pendingNonce = '0x3'
  let pendingSignerCallback

  const flush = async () => {
    for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve))
  }

  beforeEach(async () => {
    signer.type = 'seed'
    code = delegation
    receiptStatus = '0x0'
    latestNonce = '0x3'
    pendingNonce = '0x3'
    pendingSignerCallback = undefined
    provider.connection.connections.ethereum[1] = {
      chainConfig: {},
      active: { connected: true }
    }
    store.setGasFees('ethereum', 1, {
      maxBaseFeePerGas: '0x77359400',
      maxPriorityFeePerGas: '0x3b9aca00'
    })
    await new Promise((resolve, reject) =>
      Accounts.add(authority, 'Revocation Account', { type: 'seed' }, (error, created) => {
        if (error) return reject(error)
        created.signer = signer.id
        Accounts.setSigner(authority, (setError) => (setError ? reject(setError) : resolve()))
      })
    )
    Accounts.current().signer = signer.id
    Accounts.current().lastSignerType = 'seed'
    signers.get.mockImplementation((id) => (id === signer.id ? signer : undefined))
    provider.connection.send.mockImplementation((payload, callback) => {
      if (payload.method === 'eth_getCode') return callback({ result: code })
      if (payload.method === 'eth_getTransactionCount') {
        return callback({ result: payload.params[1] === 'pending' ? pendingNonce : latestNonce })
      }
      if (payload.method === 'eth_sendRawTransaction') {
        return callback({ result: Transaction.from(payload.params[0]).hash })
      }
      if (payload.method === 'eth_getTransactionReceipt') {
        const rawHash = provider.connection.send.mock.calls.find(
          ([candidate]) => candidate.method === 'eth_sendRawTransaction'
        )?.[0]?.params?.[0]
        const hash = rawHash ? Transaction.from(rawHash).hash : `0x${'0'.repeat(64)}`
        return callback({
          result: {
            transactionHash: hash,
            blockHash: `0x${'b'.repeat(64)}`,
            blockNumber: '0x5',
            gasUsed: '0xb3b0',
            status: receiptStatus
          }
        })
      }
      if (payload.method === 'eth_getBlockByNumber') {
        const number = payload.params[0] === 'latest' ? '0x10' : payload.params[0]
        const hash = number === '0x5' ? `0x${'b'.repeat(64)}` : `0x${'c'.repeat(64)}`
        return callback({ result: { number, hash } })
      }
      return callback({ error: { code: -32601, message: 'unsupported test method' } })
    })
  })

  afterEach(async () => {
    const active = Accounts.accounts[authority]
    if (active) {
      Object.keys(active.requests).forEach((handlerId) => active.clearRequest(handlerId))
      await new Promise((resolve) => Accounts.setSigner(account.id, () => resolve()))
      Accounts.remove(authority)
    }
    delete provider.connection.connections.ethereum[1]
    provider.connection.send.mockReset()
    signer.signEip7702Revoke.mockClear()
    signers.get.mockReset()
  })

  it('exposes bounded eligibility and admits one safe FIFO request', async () => {
    await expect(Accounts.getEip7702RevocationEligibility(authority, 1)).resolves.toMatchObject({
      status: 'eligible',
      account: authority,
      chainId: 1,
      source: 'eth_getCode',
      delegate: '0x1111111111111111111111111111111111111111',
      codeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    const admitted = Accounts.current().getRequest(reference.handlerId)
    expect(admitted).toMatchObject({
      type: 'eip7702Revoke',
      account: authority,
      chainId: '0x1',
      evidence: {
        source: 'eth_getCode',
        authority,
        delegate: '0x1111111111111111111111111111111111111111',
        latestNonce: '0x3',
        pendingNonce: '0x3'
      },
      fees: {
        gasLimit: '0xc350',
        maxFeePerGas: '0xb2d05e00',
        maxPriorityFeePerGas: '0x3b9aca00',
        maxFee: '0x886c98b76000'
      }
    })
    expect(JSON.stringify(admitted)).not.toMatch(/rawTransaction|authorizationList|signature/i)
  })

  it('reports configured-RPC account execution independently of signer eligibility', async () => {
    signer.type = 'ledger'
    await expect(Accounts.getAccountExecutionState(authority, 1)).resolves.toMatchObject({
      status: 'delegated',
      account: authority,
      chainId: 1,
      source: 'eth_getCode',
      delegate: '0x1111111111111111111111111111111111111111',
      codeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/)
    })

    code = '0x6000'
    await expect(Accounts.getAccountExecutionState(authority, 1)).resolves.toMatchObject({
      status: 'contract',
      source: 'eth_getCode'
    })
    code = '0x'
    await expect(Accounts.getAccountExecutionState(authority, 1)).resolves.toMatchObject({
      status: 'no-code',
      source: 'eth_getCode'
    })
    code = 'malformed'
    await expect(Accounts.getAccountExecutionState(authority, 1)).resolves.toMatchObject({
      status: 'unavailable'
    })
    delete provider.connection.connections.ethereum[1]
    await expect(Accounts.getAccountExecutionState(authority, 1)).resolves.toMatchObject({
      status: 'disconnected'
    })
    signer.type = 'seed'
  })

  it('serializes same-tick admission and rejects a duplicate reservation', async () => {
    let releaseCode
    provider.connection.send.mockImplementation((payload, callback) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => callback({ result: delegation })
        return
      }
      callback({ result: payload.params?.[1] === 'pending' ? '0x3' : '0x3' })
    })
    const first = Accounts.requestEip7702Revocation(authority, 1)
    await expect(Accounts.requestEip7702Revocation(authority, 1)).rejects.toThrow('already being prepared')
    releaseCode()
    await expect(first).resolves.toMatchObject({ type: 'eip7702Revoke' })
  })

  it('does not report eligibility during a concurrent admission', async () => {
    let releaseCode
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })

    const admission = Accounts.requestEip7702Revocation(authority, 1)
    await expect(Accounts.getEip7702RevocationEligibility(authority, 1)).resolves.toMatchObject({
      status: 'unavailable'
    })
    releaseCode()
    await expect(admission).resolves.toMatchObject({ type: 'eip7702Revoke' })
  })

  it('rejects eligibility when the selected account changes during preflight', async () => {
    let releaseCode
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })

    const eligibility = Accounts.getEip7702RevocationEligibility(authority, 1)
    await new Promise((resolve) => Accounts.setSigner(account.id, () => resolve()))
    releaseCode()
    await expect(eligibility).resolves.toMatchObject({ status: 'unavailable' })
  })

  it('rejects admission when signer readiness changes during preflight', async () => {
    let releaseCode
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })

    const admission = Accounts.requestEip7702Revocation(authority, 1)
    signer.status = 'locked'
    releaseCode()
    await expect(admission).rejects.toThrow(/unlocked Ring or Seed signer/)
    signer.status = 'ok'
    expect(Object.values(Accounts.current().requests)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'eip7702Revoke' })])
    )
  })

  it('rejects admission when its reservation expires during preflight', async () => {
    let releaseCode
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })

    const admission = Accounts.requestEip7702Revocation(authority, 1)
    Accounts.eip7702Admissions.clear()
    releaseCode()
    await expect(admission).rejects.toThrow('admission expired')
  })

  it('rejects eligibility when the configured chain disconnects during preflight', async () => {
    let releaseCode
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })

    const eligibility = Accounts.getEip7702RevocationEligibility(authority, 1)
    delete provider.connection.connections.ethereum[1]
    releaseCode()
    await expect(eligibility).resolves.toMatchObject({ status: 'disconnected' })
  })

  it('rejects admission when another revocation becomes active during preflight', async () => {
    let releaseCode
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getCode') {
        releaseCode = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })

    const admission = Accounts.requestEip7702Revocation(authority, 1)
    Accounts.addRequestForAccount(authority, {
      ...request,
      type: 'eip7702Revoke',
      handlerId: 'competing-eip7702-revocation',
      account: authority
    })
    releaseCode()
    await expect(admission).rejects.toThrow('already active')
  })

  it('revalidates reviewed code before signer invocation', async () => {
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    code = '0xef01002222222222222222222222222222222222222222'
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const request = Accounts.current().getRequest(reference.handlerId)
    expect(request).toMatchObject({
      status: 'error',
      failureReason: 'evidence-changed',
      notice: 'EIP-7702 delegation or nonce changed after review',
      mode: 'monitor'
    })
    expect(signer.signEip7702Revoke).not.toHaveBeenCalled()
  })

  it('rejects a pending nonce change before signer invocation', async () => {
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    pendingNonce = '0x4'
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    expect(Accounts.current().getRequest(reference.handlerId)).toMatchObject({
      status: 'error',
      failureReason: 'evidence-changed',
      notice: 'EIP-7702 revocation requires a stable account nonce'
    })
    expect(signer.signEip7702Revoke).not.toHaveBeenCalled()
  })

  it('reports a bounded not-delegated failure when delegation clears after review', async () => {
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    code = '0x'
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    expect(Accounts.current().getRequest(reference.handlerId)).toMatchObject({
      status: 'error',
      failureReason: 'not-delegated'
    })
    expect(signer.signEip7702Revoke).not.toHaveBeenCalled()
  })

  it('binds broadcast and receipt to the inspected hash and reports failed-but-cleared truthfully', async () => {
    store.clearActivity()
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    code = '0x'
    await flush()

    const request = Accounts.current().getRequest(reference.handlerId)
    expect(request).toMatchObject({
      status: 'confirmed',
      notice: 'Delegation removed',
      tx: { confirmations: 12 },
      result: {
        receiptStatus: 'failed',
        revocationStatus: 'cleared',
        reason: 'code-cleared',
        checkedAtBlock: '0x10'
      }
    })
    expect(provider.connection.send).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_sendRawTransaction', params: [expect.stringMatching(/^0x04/)] }),
      expect.any(Function),
      { type: 'ethereum', id: 1 }
    )
    expect(provider.connection.send).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'eth_getCode',
        params: [authority, { blockHash: `0x${'c'.repeat(64)}`, requireCanonical: true }]
      }),
      expect.any(Function),
      { type: 'ethereum', id: 1 }
    )

    new OperationLifecycleProjection(operationLifecycleLedger).project(request.activityId)
    expect(store('main.activity').find(({ id }) => id === request.activityId)).toMatchObject({
      outcome: 'verified-clearance'
    })
    Accounts.current().clearRequest(reference.handlerId)
    expect(store('main.activity').find(({ id }) => id === request.activityId)).toMatchObject({
      outcome: 'verified-clearance'
    })
    store.clearActivity()
  })

  it('clears live pending evidence after an outage without changing the claimed lifecycle', async () => {
    const observations = []
    const removeObserver = observeOperationLifecycles((observation) => observations.push(observation))
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback) => {
      if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === 'latest') {
        return callback({ result: { number: '0xf', hash: `0x${'c'.repeat(64)}` } })
      }
      return normalSend(payload, callback)
    })

    try {
      const reference = await Accounts.requestEip7702Revocation(authority, 1)
      Accounts.approveEip7702Revocation(authority, reference.handlerId)
      await new Promise(jest.requireActual('timers').setImmediate)

      const accountInstance = Accounts.current()
      const revoke = accountInstance.getRequest(reference.handlerId)
      const operation = operationLifecycleLedger.get(revoke.activityId)
      expect(operation).toMatchObject({ state: 'confirming', receipt: expect.any(Object) })
      expect(observations).toContainEqual(expect.objectContaining({ pendingEvidence: true }))

      const beforeOutage = operationLifecycleLedger.get(revoke.activityId)
      provider.connection.send.mockImplementation((payload, callback) => {
        if (payload.method === 'eth_getTransactionReceipt') {
          return callback({ error: { code: -32000, message: 'offline' } })
        }
        return normalSend(payload, callback)
      })

      await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)

      expect(observations.at(-1)).toEqual(
        expect.objectContaining({
          previous: beforeOutage,
          current: beforeOutage,
          pendingEvidence: false
        })
      )
      expect(operationLifecycleLedger.get(revoke.activityId)).toEqual(beforeOutage)

      provider.connection.send.mockImplementation((payload, callback) => {
        if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === 'latest') {
          return callback({ result: { number: '0xf', hash: `0x${'c'.repeat(64)}` } })
        }
        return normalSend(payload, callback)
      })
      await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)
      expect(observations.at(-1)).toEqual(expect.objectContaining({ pendingEvidence: true }))
    } finally {
      removeObserver()
    }
  })

  it('expires a continuously running live revocation monitor without another RPC or lost evidence', async () => {
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getTransactionReceipt') return callback({ result: null })
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const accountInstance = Accounts.current()
    const revoke = accountInstance.getRequest(reference.handlerId)
    const operation = operationLifecycleLedger.listStored().find(({ id }) => id === revoke.activityId)
    expect(operation).toMatchObject({ state: 'submitted' })
    const now = Date.now()
    const expired = {
      ...operation,
      createdAt: now - MAX_OPERATION_LIFECYCLE_AGE_MS,
      updatedAt: now - MAX_OPERATION_LIFECYCLE_AGE_MS,
      expiresAt: now - 1
    }
    store.setOperationLifecycles({ [expired.id]: expired })
    const readsBeforeExpiry = provider.connection.send.mock.calls.length

    await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)

    expect(provider.connection.send.mock.calls).toHaveLength(readsBeforeExpiry)
    expect(accountInstance.getRequest(reference.handlerId)).toBeUndefined()
    expect(operationLifecycleLedger.listStored()).toEqual([
      expect.objectContaining({ id: expired.id, state: 'stopped', updatedAt: expired.expiresAt })
    ])
    operationLifecycleLedger.remove(expired.id, -1)
  })

  it('preserves a stopped lifecycle when the user stops just after the live deadline', async () => {
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getTransactionReceipt') return callback({ result: null })
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const revoke = Accounts.current().getRequest(reference.handlerId)
    const operation = operationLifecycleLedger.listStored().find(({ id }) => id === revoke.activityId)
    const now = Date.now()
    const expired = {
      ...operation,
      createdAt: now - MAX_OPERATION_LIFECYCLE_AGE_MS,
      updatedAt: now - MAX_OPERATION_LIFECYCLE_AGE_MS,
      expiresAt: now - 1
    }
    store.setOperationLifecycles({ [expired.id]: expired })

    expect(Accounts.stopEip7702RevocationMonitoring(authority, reference.handlerId)).toBe(true)

    expect(Accounts.current().getRequest(reference.handlerId)).toBeUndefined()
    expect(operationLifecycleLedger.listStored()).toEqual([
      expect.objectContaining({ id: expired.id, state: 'stopped', updatedAt: expired.expiresAt })
    ])
    operationLifecycleLedger.remove(expired.id, -1)
  })

  it('keeps monitoring when the receipt block is no longer canonical', async () => {
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === '0x5') {
        return callback({ result: { number: '0x5', hash: `0x${'f'.repeat(64)}` } })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const revoke = Accounts.current().getRequest(reference.handlerId)
    expect(revoke).toMatchObject({ status: 'verifying', tx: { confirmations: 0 } })
    expect(revoke.result).toBeUndefined()
    expect(Accounts.current().getActiveReviewRequest(reference.handlerId)).toBe(revoke)
  })

  it('discards evidence when the receipt block changes after the block-bound code read', async () => {
    let receiptBlockReads = 0
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === '0x5') {
        receiptBlockReads += 1
        const hash = receiptBlockReads === 1 ? `0x${'b'.repeat(64)}` : `0x${'f'.repeat(64)}`
        return callback({ result: { number: '0x5', hash } })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const revoke = Accounts.current().getRequest(reference.handlerId)
    expect(revoke).toMatchObject({
      status: 'verifying',
      notice: 'Rechecking after chain reorganization',
      tx: { confirmations: 0 }
    })
    expect(revoke.result).toBeUndefined()
    expect(Accounts.current().getActiveReviewRequest(reference.handlerId)).toBe(revoke)
  })

  it('discards evidence when the latest block changes after the block-bound code read', async () => {
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === '0x10') {
        return callback({ result: { number: '0x10', hash: `0x${'f'.repeat(64)}` } })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const revoke = Accounts.current().getRequest(reference.handlerId)
    expect(revoke).toMatchObject({
      status: 'verifying',
      notice: 'Rechecking after chain reorganization',
      tx: { confirmations: 0 }
    })
    expect(revoke.result).toBeUndefined()
    expect(Accounts.current().getActiveReviewRequest(reference.handlerId)).toBe(revoke)
  })

  it('ignores a late signer callback after the exact request is cleared', async () => {
    signer.signEip7702Revoke.mockImplementationOnce((_index, signingRequest, callback) => {
      pendingSignerCallback = () => callback(null, signEip7702RevokeRequest(privateKey, signingRequest))
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()
    Accounts.current().clearRequest(reference.handlerId)
    pendingSignerCallback()
    await flush()

    expect(
      provider.connection.send.mock.calls.filter(([payload]) => payload.method === 'eth_sendRawTransaction')
    ).toHaveLength(0)
  })

  it('keeps the review claimed and rejects decline while broadcast is in flight', async () => {
    let releaseBroadcast
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_sendRawTransaction') {
        releaseBroadcast = () => normalSend(payload, callback, chain)
        return
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    expect(Accounts.current().getRequest(reference.handlerId).status).toBe('sending')
    expect(Accounts.declineRequest(reference.handlerId, authority)).toBe(false)
    expect(() => Accounts.stopEip7702RevocationMonitoring(authority, reference.handlerId)).toThrow(
      'cannot be stopped'
    )
    releaseBroadcast()
    await flush()
  })

  it('ignores a mismatched broadcast hash and monitors the locally inspected hash', async () => {
    let receiptAvailable = false
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_sendRawTransaction') return callback({ result: `0x${'f'.repeat(64)}` })
      if (payload.method === 'eth_getTransactionReceipt' && !receiptAvailable) {
        return callback({ result: null })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const accountInstance = Accounts.current()
    const revoke = accountInstance.getRequest(reference.handlerId)
    const rawTransaction = provider.connection.send.mock.calls.find(
      ([payload]) => payload.method === 'eth_sendRawTransaction'
    )[0].params[0]
    const inspectedHash = Transaction.from(rawTransaction).hash.toLowerCase()
    expect(revoke).toMatchObject({
      status: 'verifying',
      notice: 'Submission status unclear',
      submission: {
        status: 'unconfirmed',
        detail:
          'Wren is monitoring the expected transaction hash, and this account’s request queue is paused until its status is known.'
      },
      tx: { hash: inspectedHash, confirmations: 0 }
    })
    expect(
      provider.connection.send.mock.calls.find(
        ([payload]) => payload.method === 'eth_getTransactionReceipt'
      )[0].params[0]
    ).toBe(inspectedHash)
    expect(accountInstance.getActiveReviewRequest(reference.handlerId)).toBe(revoke)

    receiptAvailable = true
    code = '0x'
    await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)
    expect(revoke).toMatchObject({
      status: 'confirmed',
      tx: { hash: inspectedHash },
      result: { revocationStatus: 'cleared' }
    })
  })

  it('ignores a late duplicate callback and monitors the expected hash after a broadcast error', async () => {
    let receiptAvailable = false
    let lateBroadcastCallback
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_sendRawTransaction') {
        callback({ error: { code: -32000, message: 'broadcast unavailable' } })
        lateBroadcastCallback = () => callback({ result: `0x${'a'.repeat(64)}` })
        return
      }
      if (payload.method === 'eth_getTransactionReceipt' && !receiptAvailable) {
        return callback({ result: null })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const accountInstance = Accounts.current()
    const revoke = accountInstance.getRequest(reference.handlerId)
    const rawTransaction = provider.connection.send.mock.calls.find(
      ([payload]) => payload.method === 'eth_sendRawTransaction'
    )[0].params[0]
    const inspectedHash = Transaction.from(rawTransaction).hash.toLowerCase()
    expect(revoke).toMatchObject({
      status: 'verifying',
      notice: 'Submission status unclear',
      submission: { status: 'unconfirmed' },
      tx: { hash: inspectedHash, confirmations: 0 }
    })
    expect(
      provider.connection.send.mock.calls.filter(([payload]) => payload.method === 'eth_sendRawTransaction')
    ).toHaveLength(1)

    lateBroadcastCallback()
    await flush()
    expect(revoke).toMatchObject({
      status: 'verifying',
      notice: 'Submission status unclear',
      submission: { status: 'unconfirmed' },
      tx: { hash: inspectedHash }
    })

    receiptAvailable = true
    code = '0x'
    await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)
    expect(revoke).toMatchObject({ status: 'confirmed', result: { revocationStatus: 'cleared' } })
    expect(revoke.submission).toBeUndefined()
  })

  it('stays fail-closed after an uncertain submission until trusted stop advances the FIFO', async () => {
    let receiptReads = 0
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_sendRawTransaction') {
        return callback({ error: { code: -32000, message: 'broadcast unavailable' } })
      }
      if (payload.method === 'eth_getTransactionReceipt') {
        receiptReads += 1
        return callback({ result: null })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    const accountInstance = Accounts.current()
    const queued = { ...request, handlerId: 'after-uncertain-revocation', account: authority }
    Accounts.addRequestForAccount(authority, queued)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    await flush()

    const revoke = accountInstance.getRequest(reference.handlerId)
    const operationVersion = revoke.operationVersion
    expect(revoke).toMatchObject({
      status: 'verifying',
      notice: 'Submission status unclear',
      submission: { status: 'unconfirmed' }
    })
    expect(accountInstance.getActiveReviewRequest(reference.handlerId)).toBe(revoke)
    expect(accountInstance.getActiveReviewRequest(queued.handlerId)).toBeUndefined()

    expect(() => Accounts.stopEip7702RevocationMonitoring(account.id, reference.handlerId)).toThrow(
      'requires the selected account'
    )
    expect(() => Accounts.stopEip7702RevocationMonitoring(authority, queued.handlerId)).toThrow(
      'no longer active'
    )

    Accounts.stopEip7702RevocationMonitoring(authority, reference.handlerId)
    expect(accountInstance.getRequest(reference.handlerId)).toBeUndefined()
    expect(revoke.operationVersion).toBe(operationVersion + 1)
    expect(accountInstance.getActiveReviewRequest(queued.handlerId)).toBe(queued)
    expect(() => Accounts.stopEip7702RevocationMonitoring(authority, queued.handlerId)).toThrow(
      'no longer active'
    )
    const readsAfterClear = receiptReads
    await Accounts.monitorEip7702Revocation(accountInstance, revoke, operationVersion)
    expect(receiptReads).toBe(readsAfterClear)
    expect(() => Accounts.stopEip7702RevocationMonitoring(authority, reference.handlerId)).toThrow(
      'no longer active'
    )
  })

  it('rejects stopping an EIP-7702 review before signing', async () => {
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    expect(() => Accounts.stopEip7702RevocationMonitoring(authority, reference.handlerId)).toThrow(
      'cannot be stopped'
    )
    expect(Accounts.current().getActiveReviewRequest(reference.handlerId)).toBeDefined()
  })

  it('holds unavailable post-confirmation evidence until trusted stop advances the FIFO', async () => {
    let monitorCodeUnavailable = false
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (
        payload.method === 'eth_getCode' &&
        typeof payload.params[1] === 'object' &&
        monitorCodeUnavailable
      ) {
        return callback({ result: undefined })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    const accountInstance = Accounts.current()
    const queued = { ...request, handlerId: 'after-unavailable-revocation', account: authority }
    Accounts.addRequestForAccount(authority, queued)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    monitorCodeUnavailable = true
    await flush()

    const revoke = accountInstance.getRequest(reference.handlerId)
    expect(revoke).toMatchObject({
      status: 'confirming',
      tx: { confirmations: 12 },
      result: { revocationStatus: 'unavailable' }
    })
    expect(revoke.submission).toBeUndefined()
    expect(accountInstance.getActiveReviewRequest(reference.handlerId)).toBe(revoke)
    expect(accountInstance.getActiveReviewRequest(queued.handlerId)).toBeUndefined()

    Accounts.stopEip7702RevocationMonitoring(authority, reference.handlerId)
    expect(accountInstance.getActiveReviewRequest(queued.handlerId)).toBe(queued)
  })

  it('removes stale receipt truth during a reorg and reaches terminal state only after re-inclusion', async () => {
    let receiptReads = 0
    let blockReads = 0
    const normalSend = provider.connection.send.getMockImplementation()
    provider.connection.send.mockImplementation((payload, callback, chain) => {
      if (payload.method === 'eth_getTransactionReceipt') {
        receiptReads += 1
        if (receiptReads === 2) return callback({ result: null })
        const rawHash = provider.connection.send.mock.calls.find(
          ([candidate]) => candidate.method === 'eth_sendRawTransaction'
        )?.[0]?.params?.[0]
        return callback({
          result: {
            transactionHash: Transaction.from(rawHash).hash,
            blockHash: `0x${(receiptReads === 1 ? 'b' : 'c').repeat(64)}`,
            blockNumber: receiptReads === 1 ? '0x5' : '0x6',
            gasUsed: '0xb3b0',
            status: '0x1'
          }
        })
      }
      if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === 'latest') {
        blockReads += 1
        const number = blockReads === 1 ? '0x5' : '0x11'
        const hash = number === '0x5' ? `0x${'b'.repeat(64)}` : `0x${'d'.repeat(64)}`
        return callback({ result: { number, hash } })
      }
      if (payload.method === 'eth_getBlockByNumber') {
        const number = payload.params[0]
        const hash =
          number === '0x5'
            ? `0x${'b'.repeat(64)}`
            : number === '0x11'
              ? `0x${'d'.repeat(64)}`
              : `0x${'c'.repeat(64)}`
        return callback({ result: { number, hash } })
      }
      return normalSend(payload, callback, chain)
    })
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    Accounts.approveEip7702Revocation(authority, reference.handlerId)
    code = '0x'
    await flush()
    const accountInstance = Accounts.current()
    const revoke = accountInstance.getRequest(reference.handlerId)
    expect(revoke).toMatchObject({ status: 'confirming', tx: { confirmations: 1 } })
    const queued = { ...request, handlerId: 'blocked-through-confirmation', account: authority }
    Accounts.addRequestForAccount(authority, queued)
    expect(accountInstance.getActiveReviewRequest(reference.handlerId)).toBe(revoke)
    expect(accountInstance.getActiveReviewRequest(queued.handlerId)).toBeUndefined()

    await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)
    expect(revoke).toMatchObject({ status: 'verifying', tx: { confirmations: 0 } })
    expect(revoke.result).toBeUndefined()

    await Accounts.monitorEip7702Revocation(accountInstance, revoke, revoke.operationVersion)
    expect(revoke).toMatchObject({
      status: 'confirmed',
      tx: { confirmations: 12 },
      result: { revocationStatus: 'cleared', checkedAtBlock: '0x11' }
    })
    expect(accountInstance.getActiveReviewRequest(queued.handlerId)).toBe(queued)
  })

  it('reports bounded ineligibility for unsupported, disconnected, and non-delegated states', async () => {
    signer.type = 'ledger'
    await expect(Accounts.getEip7702RevocationEligibility(authority, 1)).resolves.toMatchObject({
      status: 'unsupported-signer'
    })
    signer.type = 'seed'
    delete provider.connection.connections.ethereum[1]
    await expect(Accounts.getEip7702RevocationEligibility(authority, 1)).resolves.toMatchObject({
      status: 'disconnected'
    })
    provider.connection.connections.ethereum[1] = { chainConfig: {}, active: { connected: true } }
    code = '0x'
    await expect(Accounts.getEip7702RevocationEligibility(authority, 1)).resolves.toMatchObject({
      status: 'not-delegated'
    })
    signer.type = 'seed'
  })

  it('rejects forged queued fee mutation and keeps the fixed envelope', async () => {
    const blocker = { ...request, handlerId: 'queued-before-revoke', account: authority }
    Accounts.addRequestForAccount(authority, blocker)
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    expect(() => Accounts.setGasLimit('0xb3b0', reference.handlerId, true, authority)).toThrow(
      'waiting for review'
    )
    const revoke = Accounts.current().getRequest(reference.handlerId)
    expect(revoke.fees.gasLimit).toBe('0xc350')
  })

  it('edits only active EIP-1559 fees within the fixed revocation envelope', async () => {
    const reference = await Accounts.requestEip7702Revocation(authority, 1)
    const revoke = Accounts.current().getRequest(reference.handlerId)
    const initialOperationVersion = revoke.operationVersion

    Accounts.setBaseFee('0x1', reference.handlerId, true, authority)
    Accounts.setPriorityFee('0x2', reference.handlerId, true, authority)
    Accounts.setGasLimit('0xb3b0', reference.handlerId, true, authority)

    expect(revoke).toMatchObject({
      feesUpdatedByUser: true,
      fees: {
        gasLimit: '0xb3b0',
        maxFeePerGas: '0x3',
        maxPriorityFeePerGas: '0x2'
      }
    })
    expect(BigInt(revoke.fees.maxFee)).toBe(BigInt(revoke.fees.gasLimit) * BigInt(revoke.fees.maxFeePerGas))
    expect(revoke.operationVersion).toBeGreaterThan(initialOperationVersion)
    expect(() => Accounts.setGasLimit('0xb3af', reference.handlerId, true, authority)).toThrow(
      'below the intrinsic minimum'
    )
    expect(() => Accounts.setGasPrice('0x1', reference.handlerId, true, authority)).toThrow(
      'does not use a legacy gas price'
    )
  })
})
