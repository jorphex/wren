import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import { parseTypedMessage } from '../../resources/domain/typedData'
import { parseInspectorInput } from '../../resources/domain/inspector'
import { hyperliquidFixture as fixture } from './support/issue105'

const primaryType = 'HyperliquidTransaction:ApproveAgent'

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
    expect(() => parseTypedMessage(data, SignTypedDataVersion.V4)).toThrow(
      expect.objectContaining({ code: -32602, message: expect.stringMatching(/^Invalid params:/) })
    )
    expect(() => parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(data) })).toThrow()
  }
)
