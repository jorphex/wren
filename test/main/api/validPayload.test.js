import parsePayload from '../../../main/api/validPayload'

let payload

beforeEach(() => {
  payload = {
    id: 7,
    jsonrpc: '2.0',
    method: 'eth_getBalance',
    params: ['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62']
  }
})

const parse = () => parsePayload(JSON.stringify(payload))
const expectInvalidRequest = (result, id = null) => {
  expect(result).toEqual({
    success: false,
    id,
    error: { code: -32600, message: 'Invalid Request' }
  })
}

it('returns a valid payload with a string id', () => {
  payload.id = '12'

  expect(parse()).toStrictEqual({ success: true, payload })
})

it('returns a valid payload with object params', () => {
  payload.params = { asset: { address: '0x912a' } }

  expect(parse()).toStrictEqual({ success: true, payload })
})

it('changes missing params to an empty array', () => {
  delete payload.params

  expect(parse()).toStrictEqual({
    success: true,
    payload: { ...payload, params: [] }
  })
})

it('distinguishes malformed JSON from an invalid request', () => {
  expect(parsePayload('{')).toEqual({
    success: false,
    id: null,
    error: { code: -32700, message: 'Parse error' }
  })
})

it.each([undefined, null, { test: 'bad-data' }])('rejects non-string input %#', (input) => {
  expectInvalidRequest(parsePayload(input))
})

it.each(['null', '[]', '["eth_chainId"]'])('rejects non-object JSON %s', (input) => {
  expectInvalidRequest(parsePayload(input))
})

it('requires an id so wallet operations remain correlatable', () => {
  delete payload.id

  expectInvalidRequest(parse())
})

it.each([null, { id: 1 }, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid id %#', (id) => {
  payload.id = id

  expectInvalidRequest(parse())
})

it('requires the exact JSON-RPC 2.0 version', () => {
  payload.jsonrpc = '1.0'

  expectInvalidRequest(parse(), payload.id)
})

it.each([undefined, '', { eth: 'get_balance' }])('rejects invalid method %#', (method) => {
  payload.method = method

  expectInvalidRequest(parse(), payload.id)
})

it.each([null, 'params', 1, true])('rejects invalid params %#', (params) => {
  payload.params = params

  expectInvalidRequest(parse(), payload.id)
})
