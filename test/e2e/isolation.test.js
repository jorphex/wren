import fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'

import { createDappClient, startJsonRpcFixture } from './support/harness'

it('uses a disposable mode-0700 profile outside the repository', () => {
  const isolation = global.__WREN_E2E_ISOLATION__
  expect(isolation.profile.startsWith(`${isolation.runRoot}/`)).toBe(true)
  expect(isolation.profile.startsWith(process.cwd())).toBe(false)
  if (process.platform !== 'win32') {
    expect(fs.statSync(isolation.profile).mode & 0o777).toBe(0o700)
  }
})

it.each([1248, 8421])('blocks the installed Wren port %i before connecting', (port) => {
  expect(() => net.connect({ host: '127.0.0.1', port })).toThrow(/live Wren port/)
})

it('blocks public RPC, arbitrary loopback, wildcard listeners, UDP, and subprocesses', () => {
  expect(() => http.request('http://rpc.example')).toThrow(/outbound connection/)
  expect(() => https.request('https://rpc.example')).toThrow(/outbound connection/)
  expect(() => net.connect({ host: '127.0.0.1', port: 65534 })).toThrow(/does not belong/)
  expect(() => net.createServer().listen(0, '0.0.0.0')).toThrow(/ephemeral port on 127\.0\.0\.1/)
  expect(() => require('dgram').createSocket('udp4')).toThrow(/UDP sockets/)
  expect(() => require('dns').lookup('rpc.example', () => {})).toThrow(/DNS queries/)
  expect(() => require('child_process').spawn('true')).toThrow(/subprocess/)
})

it('permits only a server created inside this process on an ephemeral loopback port', async () => {
  const rpc = await startJsonRpcFixture(async (payload) => ({ result: `echo:${payload.method}` }))
  try {
    const client = createDappClient(rpc.url, 'https://garden.example')
    await expect(client.request('eth_chainId')).resolves.toBe('echo:eth_chainId')
    expect(rpc.requests).toEqual([
      {
        origin: 'https://garden.example',
        payload: { id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] }
      }
    ])
  } finally {
    await rpc.close()
  }
})
