import {
  SignTypedDataVersion,
  TypedDataUtils,
  recoverTypedSignature,
  signTypedData
} from '@metamask/eth-sig-util'
import { privateToAddress } from '@ethereumjs/util'

import { getTypedDataContext, parseTypedMessage } from '../../resources/domain/typedData'
import { parseInspectorInput } from '../../resources/domain/inspector'
import { hyperliquidFixture as fixture, saveIssueEvidence } from './support/issue105'

const primaryType = 'HyperliquidTransaction:ApproveAgent'

it('keeps the exact Hyperliquid payload through parsing, inspection, hashing and signing', () => {
  const data = fixture()
  const original = JSON.stringify(data)
  const parsed = parseTypedMessage(data, SignTypedDataVersion.V4)
  const inspected = parseInspectorInput({ kind: 'typed-data', input: original, version: 'V4' })
  expect(parsed.data).toEqual(data)
  expect(inspected.typedData).toEqual(data)
  expect(JSON.stringify(data)).toBe(original)
  const digest = TypedDataUtils.eip712Hash(data, SignTypedDataVersion.V4).toString('hex')
  expect(TypedDataUtils.eip712Hash(inspected.typedData, SignTypedDataVersion.V4).toString('hex')).toBe(digest)
  const key = Buffer.alloc(32, 1)
  const signature = signTypedData({ privateKey: key, data: parsed.data, version: SignTypedDataVersion.V4 })
  const recovered = recoverTypedSignature({ data, signature, version: SignTypedDataVersion.V4 })
  expect(recovered).toBe(`0x${privateToAddress(key).toString('hex')}`)
  expect(getTypedDataContext(parsed, 1).risks).toContain('domain-chain-mismatch')
  saveIssueEvidence('hyperliquid-typed-data', { primaryType, digest, signature, recovered, inspected: true })
})

it('supports namespaced struct references and arrays without changing their names', () => {
  const data = fixture()
  data.types.Envelope = [{ name: 'actions', type: `${primaryType}[]` }]
  data.primaryType = 'Envelope'
  data.message = { actions: [data.message] }
  expect(parseTypedMessage(data, SignTypedDataVersion.V4).data).toEqual(data)
  expect(parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(data) }).typedData).toEqual(data)
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
    expect(() => parseTypedMessage(data, SignTypedDataVersion.V4)).toThrow()
    expect(() => parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(data) })).toThrow()
  }
)
