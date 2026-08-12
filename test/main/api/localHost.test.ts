import { isAllowedLocalRpcHost } from '../../../main/api/localHost'

it.each(['127.0.0.1:1248', 'localhost:1248', 'LOCALHOST:1248', '[::1]:1248'])(
  'accepts the local RPC authority %s',
  (host) => expect(isAllowedLocalRpcHost(host, 1248)).toBe(true)
)

it.each([
  undefined,
  '',
  'wallet.attacker.example:1248',
  'localhost.attacker.example:1248',
  'localhost:1249',
  'localhost:65536',
  'localhost:0',
  'localhost:1248/path',
  'user@localhost:1248'
])('rejects the non-local or mismatched RPC authority %s', (host) => {
  expect(isAllowedLocalRpcHost(host, 1248)).toBe(false)
})
