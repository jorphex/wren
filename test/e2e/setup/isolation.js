const childProcess = require('child_process')
const dgram = require('dgram')
const dns = require('dns')
const fs = require('fs')
const net = require('net')
const path = require('path')

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1'])
const WREN_LIVE_PORTS = new Set([1248, 8421])
const profile = process.env.WREN_E2E_PROFILE
const runRoot = process.env.WREN_E2E_RUN_ROOT
const namespace = process.env.WREN_E2E_NAMESPACE

function fail(message) {
  throw new Error(`E2E isolation violation: ${message}`)
}

if (!profile || !runRoot || !namespace) fail('use npm run test:e2e to create a disposable profile')

const resolvedProfile = path.resolve(profile)
const resolvedRoot = path.resolve(runRoot)
if (resolvedProfile === resolvedRoot || !resolvedProfile.startsWith(`${resolvedRoot}${path.sep}`)) {
  fail('profile must be inside the disposable run root')
}

for (const directory of [resolvedRoot, resolvedProfile]) {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('profile paths must be regular directories')
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
    fail('profile directories must use mode 0700')
  }
}

const allowedPorts = new Set()
const serverPorts = new WeakMap()

function connectionTarget(args) {
  const first = args[0]
  if (Array.isArray(first)) return connectionTarget(first)
  if (first && typeof first === 'object') {
    return { host: first.host ?? first.hostname, port: Number(first.port) }
  }
  return { port: Number(first), host: typeof args[1] === 'string' ? args[1] : undefined }
}

function assertConnection(args) {
  const { host, port } = connectionTarget(args)
  if (!LOOPBACK_HOSTS.has(host)) fail(`outbound connection to ${host || '<default host>'} is blocked`)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail('connection port is invalid')
  if (WREN_LIVE_PORTS.has(port)) fail(`live Wren port ${port} is blocked`)
  if (!allowedPorts.has(port)) fail(`loopback port ${port} does not belong to this test process`)
}

const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function isolatedConnect(...args) {
  assertConnection(args)
  return originalConnect.apply(this, args)
}

const originalListen = net.Server.prototype.listen
net.Server.prototype.listen = function isolatedListen(...args) {
  const first = args[0]
  const options = first && typeof first === 'object' ? first : undefined
  const port = Number(options?.port ?? first)
  const host = options?.host ?? (typeof args[1] === 'string' ? args[1] : undefined)
  if (port !== 0 || host !== '127.0.0.1') {
    fail('servers must bind an ephemeral port on 127.0.0.1')
  }

  this.once('listening', () => {
    const address = this.address()
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      this.close()
      fail('server escaped the IPv4 loopback interface')
    }
    allowedPorts.add(address.port)
    serverPorts.set(this, address.port)
  })
  this.once('close', () => {
    const assignedPort = serverPorts.get(this)
    if (assignedPort !== undefined) allowedPorts.delete(assignedPort)
  })
  return originalListen.apply(this, args)
}

const originalFetch = global.fetch
if (originalFetch) {
  global.fetch = function isolatedFetch(input, options) {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
    if (!LOOPBACK_HOSTS.has(target.hostname) || !allowedPorts.has(port)) {
      fail(`fetch to ${target.origin} is blocked`)
    }
    return originalFetch(input, options)
  }
}

childProcess.exec = () => fail('subprocess execution is blocked')
childProcess.execFile = () => fail('subprocess execution is blocked')
childProcess.fork = () => fail('subprocess execution is blocked')
childProcess.spawn = () => fail('subprocess execution is blocked')
childProcess.spawnSync = () => fail('subprocess execution is blocked')
dgram.createSocket = () => fail('UDP sockets are blocked')
const originalLookup = dns.lookup
dns.lookup = (hostname, ...args) => {
  if (!LOOPBACK_HOSTS.has(hostname)) fail('DNS queries are blocked')
  return originalLookup(hostname, ...args)
}
if (dns.promises) {
  const originalPromiseLookup = dns.promises.lookup
  dns.promises.lookup = (hostname, ...args) => {
    if (!LOOPBACK_HOSTS.has(hostname)) fail('DNS queries are blocked')
    return originalPromiseLookup(hostname, ...args)
  }
}
for (const method of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
  dns[method] = () => fail('DNS queries are blocked')
  if (dns.promises && typeof dns.promises[method] === 'function')
    dns.promises[method] = () => fail('DNS queries are blocked')
}

Object.defineProperty(global, '__WREN_E2E_ISOLATION__', {
  value: Object.freeze({ allowedPorts, namespace, profile: resolvedProfile, runRoot: resolvedRoot }),
  enumerable: false,
  configurable: false,
  writable: false
})
