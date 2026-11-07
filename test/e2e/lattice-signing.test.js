import { Client, Constants } from 'gridplus-sdk'
import { Common } from '@ethereumjs/common'
import { TransactionFactory } from '@ethereumjs/tx'
import { ecsign, privateToAddress } from '@ethereumjs/util'
import { Interface, keccak256 } from 'ethers'
import log from 'electron-log'
import { SignTypedDataVersion, recoverTypedSignature, signTypedData } from '@metamask/eth-sig-util'

import Lattice from '../../main/signers/lattice/Lattice'
import { parseTypedMessage } from '../../resources/domain/typedData'
import { hyperliquidFixture, saveIssueEvidence } from './support/issue105'

const key = Buffer.alloc(32, 1)
const account = `0x${privateToAddress(key).toString('hex')}`
const common = new Common({ chain: 1, hardfork: 'london' })
const contract = new Interface(['function approve(address spender,uint256 amount)'])
const target = '0x2222222222222222222222222222222222222222'
const relay = 'https://lattice-fixture.invalid/device'
const base = {
  chainId: '0x1',
  type: '0x2',
  nonce: '0x7',
  gasLimit: '0x186a0',
  maxFeePerGas: '0x20000000000001',
  maxPriorityFeePerGas: '0x3b9aca00',
  to: target,
  value: '0x1',
  data: '0x'
}
const evidence = []
let lattice
let client
let requests
let submitted
let expected
let consoleLevel
let fileLevel

beforeAll(() => {
  consoleLevel = log.transports.console.level
  fileLevel = log.transports.file.level
  log.transports.console.level = false
  log.transports.file.level = false
})

afterAll(() => {
  log.transports.console.level = consoleLevel
  log.transports.file.level = fileLevel
  saveIssueEvidence('lattice-signing', {
    scope: 'Real SDK preparation; synthetic device signature',
    evidence
  })
})

beforeEach(() => {
  requests = []
  submitted = []
  client = new Client({ name: 'WrenIssue105', privKey: key, baseUrl: 'https://lattice-fixture.invalid' })
  client.fwVersion = Buffer.from([0, 18, 0])
  client.ephemeralPub = client.key
  client.url = relay
  client.activeWallets = { internal: { uid: Buffer.alloc(32, 1) }, external: { uid: Buffer.alloc(32) } }
  const signWithSdk = client.sign.bind(client)
  jest.spyOn(client, 'sign').mockImplementation(async (options) => {
    submitted.push({ ...options, data: { ...options.data } })
    await expect(signWithSdk(options)).rejects.toThrow('fixture-device-boundary')
    const digest = Buffer.from(keccak256(options.data.payload).slice(2), 'hex')
    expect(digest).toEqual(expected.getMessageToSign(true))
    const sig = ecsign(digest, key, expected.type === 0 ? common.chainId() : undefined)
    return { sig: { r: sig.r, s: sig.s, v: expected.type === 0 ? sig.v : sig.v - 27n } }
  })
  jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    requests.push(String(url))
    if (String(url) !== relay) throw new Error('Unexpected decoder or network request')
    throw new Error('fixture-device-boundary')
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  lattice = new Lattice('FIXTURE', 'Issue 105 fixture', 'test')
  lattice.derivation = 'standard'
  lattice.appVersion = { major: 0, minor: 18, patch: 0 }
  lattice.connection = client
})

afterEach(() => {
  lattice.close()
  jest.restoreAllMocks()
})

async function signFixture(raw) {
  expected = TransactionFactory.fromTxData(raw, { common })
  const signed = await new Promise((resolve, reject) => {
    lattice.signTransaction(0, raw, (error, result) => (error ? reject(error) : resolve(result)))
  })
  const decoded = TransactionFactory.fromSerializedData(Buffer.from(signed.slice(2), 'hex'), { common })
  expect(decoded.getSenderAddress().toString()).toBe(account)
  expect(decoded.toJSON()).toEqual(expected.sign(key).toJSON())
  expect(requests).toEqual([relay])
  expect(submitted[0].currency).toBeUndefined()
  expect(submitted[0].data.encodingType).toBe(Constants.SIGNING.ENCODINGS.EVM)
  evidence.push({
    type: raw.type,
    data: raw.data,
    to: raw.to,
    transaction: decoded.toJSON(),
    recoveredSigner: account,
    requests,
    hasLocalDecoder: !!submitted[0].data.decoder
  })
  return submitted[0].data
}

it.each([
  ['empty native transfer', {}],
  ['missing native calldata', { data: undefined }],
  ['unknown selector', { data: '0xdeadbeef' }],
  ['short calldata', { data: '0x1234' }],
  ['malformed standard calldata', { data: '0x095ea7b3' }],
  ['contract creation', { to: undefined, data: '0x6000' }],
  [
    'ordered access list',
    { accessList: [{ address: target, storageKeys: [`0x${'ab'.repeat(32)}`, `0x${'cd'.repeat(32)}`] }] }
  ]
])('signs %s without a decoder lookup or changing the transaction', async (_name, overrides) => {
  const data = await signFixture({ ...base, ...overrides })
  expect(data.decoder).toBeUndefined()
})

it.each(['0x0', '0x1', '0x2'])('signs a %s approval with only a bundled decoder', async (type) => {
  const raw = {
    ...base,
    type,
    value: '0x0',
    data: contract.encodeFunctionData('approve', [target, 123456789n])
  }
  if (type !== '0x2') {
    delete raw.maxFeePerGas
    delete raw.maxPriorityFeePerGas
    raw.gasPrice = '0x20000000000001'
  }
  if (type === '0x1') raw.accessList = [{ address: target, storageKeys: [] }]
  const data = await signFixture(raw)
  expect(data.decoder.length).toBeGreaterThan(0)
})

it('preserves device rejection without producing a signed transaction', async () => {
  client.sign.mockRejectedValue({ responseCode: 132, errorMessage: 'User declined' })
  const outcome = await new Promise((resolve) => {
    lattice.signTransaction(0, base, (error, result) => resolve({ error, result }))
  })
  expect(outcome.error.code).toBe(4001)
  expect(outcome.result).toBeUndefined()
  expect(requests).toEqual([])
})

it('prepares Hyperliquid typed data with the real SDK and preserves the signed hash', async () => {
  const data = hyperliquidFixture()
  const version = SignTypedDataVersion.V4
  const expectedSignature = signTypedData({ privateKey: key, data, version })
  client.sign.mockImplementation(async (options) => {
    expect(options.data.payload).toEqual(data)
    await expect(Client.prototype.sign.call(client, options)).rejects.toThrow('fixture-device-boundary')
    return {
      sig: {
        r: expectedSignature.slice(2, 66),
        s: expectedSignature.slice(66, 130),
        v: expectedSignature.slice(130)
      }
    }
  })
  const signature = await new Promise((resolve, reject) => {
    lattice.signTypedData(0, parseTypedMessage(data, version), (error, result) =>
      error ? reject(error) : resolve(result)
    )
  })
  expect(signature).toBe(expectedSignature)
  expect(recoverTypedSignature({ data, signature, version })).toBe(account)
  expect(requests).toEqual([relay])
  evidence.push({ type: 'typed-data', primaryType: data.primaryType, recoveredSigner: account, requests })
})
