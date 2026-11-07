import { SignTypedDataVersion } from '@metamask/eth-sig-util'
import { TypedDataEncoder, Wallet, verifyTypedData } from 'ethers'
import { openTransportReplayer, RecordStore } from '@ledgerhq/hw-transport-mocker'

import HotSignerWorker from '../../main/signers/hot/HotSigner/worker'
import LedgerEthereumApp from '../../main/signers/ledger/Ledger/eth'
import { parseTypedMessage } from '../../resources/domain/typedData'
import { parseInspectorInput } from '../../resources/domain/inspector'
import { hyperliquidFixture as fixture, saveIssueEvidence } from './support/issue105'

const primaryType = 'HyperliquidTransaction:ApproveAgent'
const wallet = new Wallet(`0x${'01'.repeat(32)}`)
const evidence = []

function nestedFixture(kind) {
  const data = fixture()
  const suffix = kind.includes('dynamic array') ? '[]' : kind.includes('fixed array') ? '[1]' : ''
  if (kind.startsWith('namespaced reference')) {
    data.types.Envelope = [{ name: 'actions', type: `${primaryType}${suffix}` }]
    data.primaryType = 'Envelope'
    data.message = { actions: suffix ? [data.message] : data.message }
  } else if (kind === 'indirect namespaced reference') {
    data.types.Wrapper = [{ name: 'action', type: primaryType }]
    data.types.Envelope = [{ name: 'wrapper', type: 'Wrapper' }]
    data.primaryType = 'Envelope'
    data.message = { wrapper: { action: data.message } }
  } else if (kind === 'namespaced domain field') {
    data.types.EIP712Domain.push({ name: 'action', type: primaryType })
    data.domain.action = data.message
  } else {
    data.types.Action = [{ name: 'nonce', type: 'uint64' }]
    data.types[primaryType] = [{ name: 'actions', type: `Action${suffix}` }]
    data.message = { actions: suffix ? [{ nonce: 1 }] : { nonce: 1 } }
  }
  return data
}

afterAll(() => {
  saveIssueEvidence('typed-data-compatibility', {
    scope:
      'Shared signing and Inspector validation; real software signing and Ledger APDU replay; independent ethers digest and signature verification; no physical device',
    evidence
  })
})

it.each([
  ['flat Hyperliquid V3', SignTypedDataVersion.V3],
  ['flat Hyperliquid V4', SignTypedDataVersion.V4],
  ['flat Hyperliquid with atomic arrays', SignTypedDataVersion.V4],
  ['ordinary nested structs', SignTypedDataVersion.V3],
  ['ordinary nested struct arrays', SignTypedDataVersion.V4]
])('preserves independently verified software and Ledger signatures for %s', async (kind, version) => {
  const data = kind.startsWith('ordinary') ? nestedFixture('ordinary struct') : fixture()
  if (kind.startsWith('ordinary')) {
    data.types.Envelope = data.types[primaryType]
    delete data.types[primaryType]
    data.primaryType = 'Envelope'
    if (kind.endsWith('arrays')) {
      data.types.Envelope[0].type = 'Action[]'
      data.message.actions = [data.message.actions]
    }
  } else if (kind.endsWith('atomic arrays')) {
    data.types[primaryType].push({ name: 'nonces', type: 'uint64[]' })
    data.message.nonces = [1, 2]
  }
  const original = JSON.stringify(data)
  const parsed = parseTypedMessage(data, version)
  const inspected = parseInspectorInput({ kind: 'typed-data', input: original, version })
  expect(inspected.typedData).toEqual(parsed.data)

  const { EIP712Domain: _domain, ...types } = data.types
  const digest = TypedDataEncoder.hash(data.domain, types, data.message)
  const expected = await wallet.signTypedData(data.domain, types, data.message)
  const software = await new Promise((resolve, reject) => {
    HotSignerWorker.prototype.signTypedData(
      Buffer.from(wallet.privateKey.slice(2), 'hex'),
      parsed,
      (error, result) => (error ? reject(new Error(error)) : resolve(result))
    )
  })
  expect(software).toBe(expected)
  expect(verifyTypedData(data.domain, types, data.message, software)).toBe(wallet.address)

  const domainHash = TypedDataEncoder.hashDomain(data.domain).slice(2)
  const messageHash = TypedDataEncoder.from(types).hash(data.message).slice(2)
  const apdu = `e00c000055058000002c8000003c800000000000000000000000${domainHash}${messageHash}`
  const response = `${expected.slice(-2)}${expected.slice(2, -2)}9000`
  const transport = await openTransportReplayer(RecordStore.fromString(`=> ${apdu}\n<= ${response}`))
  const ledger = new LedgerEthereumApp(transport)
  try {
    const signature = await ledger.signTypedData("44'/60'/0'/0/0", parsed.data)
    expect(verifyTypedData(data.domain, types, data.message, signature)).toBe(wallet.address)
  } finally {
    await ledger.close()
  }
  expect(JSON.stringify(data)).toBe(original)
  evidence.push({
    kind,
    version,
    digest,
    softwareVerified: true,
    ledgerApduVerified: true,
    payloadUnchanged: true
  })
})

it.each([
  'namespaced reference',
  'namespaced reference dynamic array',
  'namespaced reference fixed array',
  'indirect namespaced reference',
  'ordinary struct',
  'ordinary struct dynamic array',
  'ordinary struct fixed array',
  'namespaced domain field'
])('rejects unsupported %s before signing and inspection', (kind) => {
  const data = nestedFixture(kind)
  const original = JSON.stringify(data)
  for (const version of [SignTypedDataVersion.V3, SignTypedDataVersion.V4]) {
    expect(() => parseTypedMessage(data, version)).toThrow(
      expect.objectContaining({ code: -32602, message: expect.stringMatching(/namespaced.*nested/) })
    )
    expect(() => parseInspectorInput({ kind: 'typed-data', input: original, version })).toThrow()
  }
  expect(JSON.stringify(data)).toBe(original)
  evidence.push({ kind, versions: ['V3', 'V4'], rejectedBeforeSigning: true, rejectedByInspector: true })
})

it.each([
  'OtherNamespace:ApproveAgent',
  'HyperliquidTransaction:',
  'HyperliquidTransaction:Approve:Agent',
  'HyperliquidTransaction:ApproveAgent()',
  'HyperliquidTransaction:ApproveAgent,Other',
  'HyperliquidTransaction:1ApproveAgent'
])('rejects malformed or unrelated type name %s before signing', (name) => {
  const data = fixture()
  data.types[name] = data.types[primaryType]
  delete data.types[primaryType]
  data.primaryType = name
  expect(() => parseTypedMessage(data, SignTypedDataVersion.V4)).toThrow()
  expect(() => parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(data) })).toThrow()
})

it.each(['undefined reference', 'inherited reference', 'duplicate field', 'invalid field name'])(
  'retains %s rejection',
  (kind) => {
    const data = fixture()
    if (kind === 'undefined reference') data.types[primaryType][0].type = 'HyperliquidTransaction:Missing'
    if (kind === 'inherited reference') data.types[primaryType][0].type = 'constructor'
    if (kind === 'duplicate field') data.types[primaryType].push({ name: 'nonce', type: 'uint64' })
    if (kind === 'invalid field name') data.types[primaryType][0].name = 'bad:field'
    expect(() => parseTypedMessage(data, SignTypedDataVersion.V4)).toThrow(
      expect.objectContaining({ code: -32602, message: expect.stringMatching(/^Invalid params:/) })
    )
    expect(() => parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(data) })).toThrow()
  }
)
