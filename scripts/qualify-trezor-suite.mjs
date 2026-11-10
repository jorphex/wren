// Real Connect client and Wren signer; a disposable local Suite host supplies
// synthetic signatures. This does not qualify a physical Trezor or Suite build.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import ts from 'typescript'
import { WebSocketServer } from 'ws'
import { HDKey } from '@scure/bip32'
import { Common } from '@ethereumjs/common'
import { TransactionFactory } from '@ethereumjs/tx'
import { Wallet, TypedDataEncoder, getBytes, verifyMessage, verifyTypedData } from 'ethers'

// Match the installer exclusion, including imports inside ESM dependencies.
const clientModules = new Set()
const moduleGuard = registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context)
    if (/\/@trezor\/(?:connect|connect-core|transport|crypto-utils)\//.test(result.url || ''))
      throw new Error('Excluded Trezor package entered the runtime')
    if (result.url?.includes('/@trezor/')) clientModules.add(result.url)
    return result
  }
})
const { CoreInSuiteDesktop } = await import('@trezor/connect-web/lib/impl/core-in-suite-desktop.js')

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const reportPath = path.resolve(
  root,
  execFileSync('git', ['rev-parse', '--git-path', 'trezor-suite-client/qualification.json'], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
)
const results = []
const requests = []
const cache = new Map()
const hashes = {}
const hd = HDKey.fromMasterSeed(Buffer.alloc(32, 7))
const basePath = "m/44'/60'/0'/0"
const wallet = (derivation = `${basePath}/0`) =>
  new Wallet(`0x${Buffer.from(hd.derive(derivation).privateKey).toString('hex')}`)
const address = wallet().address.toLowerCase()
const device = { path: 'suite-device-path', instance: 2, state: { staticSessionId: 'fixture-wallet' } }
const features = { model: 'T', major_version: 2, minor_version: 13, patch_version: 0, capabilities: [] }
const state = {
  main: {
    accounts: { [address]: { name: 'Existing account', lastSignerType: 'trezor' } },
    signers: {},
    trezor: { derivation: 'standard' }
  }
}
const savedAccounts = JSON.stringify(state.main.accounts)
let mode = 'normal'
let held
let cancellations = 0
let bridge
let adapter
let connected
let Signers
const logger = Object.fromEntries(['info', 'debug', 'error', 'warn', 'verbose'].map((key) => [key, () => {}]))
const server = http.createServer()
const wss = new WebSocketServer({ server })
const watchdog = setTimeout(() => {
  console.error('Trezor Suite qualification exceeded 30 seconds')
  process.exit(1)
}, 30_000)

const store = (key) => key.split('.').reduce((value, part) => value?.[part], state)
store.observer = () => ({ remove() {} })

function load(relative) {
  const target = path.join(root, relative)
  const filename = ['', '.ts', '.js', '/index.ts', '/index.js']
    .map((suffix) => target + suffix)
    .find((name) => fs.existsSync(name) && fs.statSync(name).isFile())
  if (!filename) throw new Error(`Missing source: ${relative}`)
  if (cache.has(filename)) return cache.get(filename).exports
  if (!filename.startsWith(root) || filename.includes(`${path.sep}node_modules${path.sep}`))
    return require(filename)
  const source = fs.readFileSync(filename, 'utf8')
  hashes[path.relative(root, filename)] = crypto.createHash('sha256').update(source).digest('hex')
  const module = { exports: {} }
  cache.set(filename, module)
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
  const localRequire = (name) => {
    if (name === 'electron-log') return logger
    if (name === 'electron') throw new Error('Qualification cannot load Electron or access a real profile')
    if (filename === path.join(root, 'main/signers/index.ts')) {
      // Keep the real manager admission/removal methods without starting other
      // hardware adapters, software-wallet sessions or Electron window hooks.
      const type = {
        './ledger/adapter': 'ledger',
        './lattice/adapter': 'lattice',
        './hot/adapter': 'hot'
      }[name]
      if (type) {
        const { SignerAdapter } = load('main/signers/adapters.ts')
        return class extends SignerAdapter {
          constructor() {
            super(type)
          }
        }
      }
      if (name === './hot') return {}
      if (name === './hot/RingSigner') return class {}
      if (name === './generated')
        return {
          GeneratedWalletSessions: class {
            close() {}
          }
        }
      if (name === '../windows/closeToTray') return { onCloseToTray: () => () => false }
    }
    if (name === '@trezor/connect-web/lib/impl/core-in-suite-desktop.js') {
      return {
        CoreInSuiteDesktop: class extends CoreInSuiteDesktop {
          constructor() {
            super()
            // Change only the host address. Protocol, serialization, correlation,
            // connection handling and API factories are the published SDK code.
            this.ws.options.url = `ws://127.0.0.1:${server.address().port}/connect-ws`
          }
        }
      }
    }
    if (!name.startsWith('.')) return require(name)
    const target = path.resolve(path.dirname(filename), name)
    if (target === path.join(root, 'main/store')) return store
    if (target === path.join(root, 'main/store/action'))
      return {
        requireStoreAction:
          (name) =>
          (...args) => {
            if (name === 'newSigner' || name === 'updateSigner') {
              const summary = args[0]
              state.main.signers[summary.id] = { ...state.main.signers[summary.id], ...summary }
            } else if (name === 'removeSigner') delete state.main.signers[args[0]]
            else if (name !== 'navClearSigner') throw new Error(`Unexpected store action: ${name}`)
          }
      }
    if (target === path.join(root, 'main/crypt'))
      return { stringToKey: (value) => crypto.createHash('sha256').update(value).digest() }
    return load(path.relative(root, target))
  }
  // Exercise Wren's long user/connection deadlines without a five-minute test.
  const scopedTimeout = (callback, ms, ...args) =>
    setTimeout(callback, mode === 'timeout' ? Math.min(ms, 80) : ms, ...args)
  vm.runInThisContext(`(function(require,module,exports,setTimeout){${code}\n})`, { filename })(
    localRequire,
    module,
    module.exports,
    scopedTimeout
  )
  return module.exports
}

async function payloadFor(params) {
  switch (params.method) {
    case 'getFeatures':
      return features
    case 'ethereumGetPublicKey': {
      const key = hd.derive(params.path)
      return {
        publicKey: Buffer.from(key.publicKey).toString('hex'),
        chainCode: Buffer.from(key.chainCode).toString('hex')
      }
    }
    case 'ethereumGetAddress':
      return {
        address: mode === 'wrong-wallet' ? wallet(`${basePath}/1`).address : wallet(params.path).address
      }
    case 'ethereumSignMessage':
      return {
        address: wallet(params.path).address,
        signature: (
          await wallet(mode === 'wrong-signature' ? `${basePath}/1` : params.path).signMessage(
            getBytes(`0x${params.message}`)
          )
        ).slice(2)
      }
    case 'ethereumSignTypedData': {
      const { EIP712Domain: _domain, ...types } = params.data.types
      return {
        address: wallet(params.path).address,
        signature: await wallet(mode === 'wrong-signature' ? `${basePath}/1` : params.path).signTypedData(
          params.data.domain,
          types,
          params.data.message
        )
      }
    }
    case 'ethereumSignTransaction': {
      const input = params.transaction
      const common = Common.custom({ chainId: input.chainId }, { hardfork: 'london' })
      const quantities = Object.fromEntries(
        ['nonce', 'gasLimit', 'gasPrice', 'value', 'maxFeePerGas', 'maxPriorityFeePerGas']
          .filter((key) => input[key] !== undefined)
          .map((key) => [key, `0x${input[key] || '0'}`])
      )
      const tx = TransactionFactory.fromTxData(
        {
          ...quantities,
          type: input.maxFeePerGas === undefined ? 0 : 2,
          to: input.to ? `0x${input.to}` : undefined,
          data: `0x${input.data}`,
          ...(input.accessList && { accessList: input.accessList })
        },
        { common }
      ).sign(Buffer.from(hd.derive(mode === 'wrong-signature' ? `${basePath}/1` : params.path).privateKey))
      return Object.fromEntries(['v', 'r', 's'].map((key) => [key, tx[key].toString(16).padStart(2, '0')]))
    }
    default:
      throw new Error(`Unexpected Suite method: ${params.method}`)
  }
}

wss.on('connection', (ws, request) => {
  assert.equal(request.url, '/connect-ws')
  assert.equal(request.headers.origin, 'https://node.trezor.io')
  if (mode === 'offline') return ws.close()
  let pending = false
  ws.on('message', async (raw) => {
    const message = JSON.parse(raw)
    requests.push(message)
    if (message.type === 'popup-handshake') {
      assert.equal(message.payload.settings.manifest.appName, 'Wren')
      assert.equal(message.payload.settings.version, '10.0.1')
      ws.send(JSON.stringify({ id: message.id, type: message.type, payload: 'ok' }))
      return
    }
    if (message.type === 'ping') {
      ws.send(JSON.stringify({ id: message.id, type: 'pong' }))
      return
    }
    assert.equal(message.type, 'iframe-call')
    if (
      mode === 'hold' ||
      mode === 'timeout' ||
      (mode === 'hold-verification' && message.payload.method === 'ethereumGetAddress')
    ) {
      pending = true
      held = { ws, message }
      return
    }
    if (mode === 'disconnect') return ws.close()
    if (mode === 'deny') {
      ws.send(
        JSON.stringify({
          id: message.id,
          success: false,
          error: { code: 'Method_PermissionsNotGranted', message: 'Permission denied' }
        })
      )
      return
    }
    const responseDevice = {
      ...device,
      instance: message.payload.device ? (message.payload.device.instance ?? 0) : device.instance
    }
    if (mode === 'changed-instance') responseDevice.instance = device.instance + 1
    if (mode === 'invalid-instance') responseDevice.instance = -1
    if (mode === 'missing-instance') delete responseDevice.instance
    ws.send(
      JSON.stringify({
        id: message.id,
        success: true,
        payload: mode === 'malformed' ? null : await payloadFor(message.payload),
        device: responseDevice
      })
    )
  })
  ws.on('close', () => {
    if (pending) cancellations++
  })
})

async function check(name, operation) {
  const start = requests.length
  console.log(`Checking ${name}`)
  const result = { name, passed: false, methods: [] }
  results.push(result)
  try {
    await operation()
    result.passed = true
  } catch (error) {
    result.error = error.message
    throw error
  } finally {
    result.methods = requests
      .slice(start)
      .filter((item) => item.type === 'iframe-call')
      .map((item) => item.payload.method)
  }
}

async function waitFor(predicate) {
  for (let count = 0; count < 100; count++) {
    if (predicate()) return
    await delay(5)
  }
  throw new Error('Suite fixture did not reach the expected state')
}

const sign = (method, ...args) =>
  new Promise((resolve, reject) =>
    connected[method](...args, (error, result) => (error ? reject(error) : resolve(result)))
  )

async function withSignerManager(operation) {
  const listeners = Object.fromEntries(
    ['add', 'update', 'remove'].map((event) => [event, adapter.listeners(event)])
  )
  Object.keys(listeners).forEach((event) => adapter.removeAllListeners(event))
  const manager = new Signers([adapter])
  manager.add(connected)
  try {
    await operation(manager)
  } finally {
    delete state.main.pendingSignerRemovals
    manager.removeAdapter(adapter)
    await manager.close()
    for (const [event, handlers] of Object.entries(listeners)) {
      handlers.forEach((handler) => adapter.on(event, handler))
    }
  }
}

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  bridge = load('main/signers/trezor/bridge.ts').default
  const managerModule = load('main/signers/index.ts')
  Signers = managerModule.Signers
  await managerModule.default.close()
  const Adapter = load('main/signers/trezor/adapter.ts').default
  adapter = new Adapter()
  adapter.on('add', (signer) => {
    connected = signer
    state.main.signers[signer.id] = signer.summary()
  })
  adapter.on('update', (signer) => {
    if (connected?.id === signer.id) connected = signer
    state.main.signers[signer.id] = signer.summary()
  })
  adapter.on('remove', (id) => {
    delete state.main.signers[id]
  })
  await check('startup does not contact Suite or open a device', async () => {
    adapter.open()
    await delay(10)
    assert.equal(requests.length, 0)
  })
  await check('explicit connection derives and verifies existing accounts', async () => {
    await adapter.connect()
    assert.equal(connected.status, 'ready')
    assert.equal(connected.addresses[0].toLowerCase(), address)
    assert.equal(JSON.stringify(state.main.accounts), savedAccounts)
    assert.equal(connected.addresses.length, 100)
  })
  for (const instance of [2, 0]) {
    await check(`preserves Suite wallet instance ${instance} across requests`, async () => {
      device.instance = instance
      const start = requests.length
      const id = connected.id
      await adapter.connect()
      await sign('signMessage', 0, '0x01')
      assert.equal(connected.id, id)
      const calls = requests.slice(start).filter((item) => item.type === 'iframe-call' && item.payload.device)
      assert(calls.length >= 3)
      calls.forEach((call) => assert.equal(call.payload.device.instance, instance))
    })
  }
  device.instance = 2
  await adapter.connect()
  for (const phase of ['hold', 'hold-verification']) {
    await check(`removal during ${phase} cannot restore the signer`, async () => {
      mode = phase
      held = undefined
      const id = connected.id
      const rejected = assert.rejects(adapter.connect(), /cancel|closed/i)
      await waitFor(() => held)
      const late = held
      adapter.remove(connected)
      mode = 'normal'
      if (late.ws.readyState === 1)
        late.ws.send(
          JSON.stringify({
            id: late.message.id,
            success: true,
            payload: late.message.payload.method === 'getFeatures' ? features : { address },
            device
          })
        )
      await rejected
      await delay(10)
      assert.equal(state.main.signers[id], undefined)
      assert.equal(await adapter.connect(), id)
    })
  }
  await check('on-device address verification uses the selected Suite wallet', async () => {
    assert.equal(await sign('verifyAddress', 0, address, true), true)
    const call = requests.at(-1).payload
    assert.equal(call.showOnTrezor, true)
    assert.deepEqual(call.device.state, device.state)
  })
  await check('personal message signature recovers the expected account', async () => {
    const signature = await sign('signMessage', 0, '0x68656c6c6f')
    assert.equal(verifyMessage(getBytes('0x68656c6c6f'), signature).toLowerCase(), address)
  })
  await check('overlapping address checks both settle', async () => {
    const checks = Promise.all([
      sign('verifyAddress', 0, address, false),
      sign('verifyAddress', 1, wallet(`${basePath}/1`).address, false)
    ])
    assert.deepEqual(await checks, [true, true])
  })
  const typedData = {
    types: { EIP712Domain: [{ name: 'name', type: 'string' }], Mail: [{ name: 'contents', type: 'string' }] },
    primaryType: 'Mail',
    domain: { name: 'Wren qualification' },
    message: { contents: 'Hello' }
  }
  await check('connection excludes signing and address checks without reporting user rejection', async () => {
    mode = 'hold-verification'
    held = undefined
    const connection = adapter.connect()
    void connection.catch(() => {})
    assert.equal(adapter.connect(), connection)
    await waitFor(() => held)
    assert.equal(state.main.signers[connected.id].status, 'connecting')
    const before = requests.length
    const busy = (error) => /connecting.*Suite/i.test(error.message) && error.code !== 4001
    await assert.rejects(sign('signMessage', 0, '0x04'), busy)
    await assert.rejects(sign('signTypedData', 0, { data: typedData }), busy)
    await assert.rejects(sign('verifyAddress', 0, address, false), busy)
    await assert.rejects(
      sign('signTransaction', 0, {
        chainId: '0x1',
        type: '0x0',
        nonce: '0x0',
        gasLimit: '0x5208',
        gasPrice: '0x1',
        value: '0x0',
        data: '0x',
        to: address
      }),
      busy
    )
    assert.equal(requests.length, before)
    mode = 'normal'
    held.ws.send(JSON.stringify({ id: held.message.id, success: true, payload: { address }, device }))
    await connection
    assert.equal(state.main.signers[connected.id].status, 'ready')
  })
  await check('connection cannot interrupt an active signing request', async () => {
    mode = 'hold'
    held = undefined
    const signing = sign('signMessage', 0, '0x06')
    void signing.catch(() => {})
    await waitFor(() => held)
    const before = requests.length
    await assert.rejects(adapter.connect(), /Finish the current Trezor request/)
    assert.equal(requests.length, before)
    mode = 'normal'
    held.ws.send(
      JSON.stringify({
        id: held.message.id,
        success: true,
        payload: await payloadFor(held.message.payload),
        device
      })
    )
    assert.equal(verifyMessage(getBytes('0x06'), await signing).toLowerCase(), address)
  })
  await check('canceling connection restores signing without rejecting an unrelated request', async () => {
    mode = 'hold'
    held = undefined
    const canceled = assert.rejects(adapter.connect(), /cancel/i)
    await waitFor(() => held)
    assert.equal(state.main.signers[connected.id].status, 'connecting')
    await assert.rejects(
      sign('signMessage', 0, '0x05'),
      (error) => /connecting.*Suite/i.test(error.message) && error.code !== 4001
    )
    adapter.cancelConnect()
    await canceled
    assert.equal(state.main.signers[connected.id].status, 'ready')
    mode = 'normal'
    assert.equal(verifyMessage(getBytes('0x05'), await sign('signMessage', 0, '0x05')).toLowerCase(), address)
  })
  await check('connection failure clears busy status and preserves the existing signer', async () => {
    const id = connected.id
    mode = 'deny'
    await assert.rejects(adapter.connect(), /Permission denied/)
    assert.equal(connected.id, id)
    assert.equal(state.main.signers[id].status, 'ready')
    mode = 'normal'
    await sign('signMessage', 0, '0x07')
  })
  await check('failed replacement keeps the existing signer usable', async () => {
    const current = connected
    const rejectReplacement = (signer) => {
      if (signer.id === current.id && signer !== current) throw new Error('Fixture replacement rejected')
    }
    adapter.prependListener('update', rejectReplacement)
    try {
      await assert.rejects(adapter.connect(), /Fixture replacement rejected/)
    } finally {
      adapter.removeListener('update', rejectReplacement)
    }
    assert.equal(state.main.signers[current.id].status, 'ready')
    assert.equal(verifyMessage(getBytes('0x08'), await sign('signMessage', 0, '0x08')).toLowerCase(), address)
  })
  for (const phase of ['before selection', 'during verification']) {
    await check(`pending signer removal ${phase} rejects replacement and stays removed`, async () => {
      await withSignerManager(async (manager) => {
        const current = connected
        const id = current.id
        const journal = { kind: 'hardware', addresses: [...current.addresses] }
        if (phase === 'before selection') {
          state.main.pendingSignerRemovals = { [id]: journal }
          await assert.rejects(adapter.connect(), /removal.*completed/i)
        } else {
          mode = 'hold-verification'
          held = undefined
          const rejected = assert.rejects(adapter.connect(), /removal.*completed/i)
          await waitFor(() => held)
          state.main.pendingSignerRemovals = { [id]: journal }
          mode = 'normal'
          held.ws.send(JSON.stringify({ id: held.message.id, success: true, payload: { address }, device }))
          await rejected
        }
        assert.equal(manager.get(id), current)
        assert.equal(
          verifyMessage(getBytes('0x09'), await sign('signMessage', 0, '0x09')).toLowerCase(),
          address
        )
        manager.remove(id)
        delete state.main.pendingSignerRemovals[id]
        mode = 'deny'
        await assert.rejects(adapter.connect(), /Permission denied/)
        assert.equal(manager.exists(id), false)
        assert.equal(state.main.signers[id], undefined)
      })
      mode = 'normal'
      await adapter.connect()
    })
  }
  await check('failed initial busy publication rejects setup before contacting Suite', async () => {
    await withSignerManager(async (manager) => {
      const current = connected
      const before = requests.length
      const rejectBusy = (signer) => {
        if (signer.summary().status === 'connecting') throw new Error('Fixture initial busy update failed')
      }
      adapter.on('update', rejectBusy)
      mode = 'deny'
      try {
        let connection
        assert.doesNotThrow(() => {
          connection = adapter.connect()
        })
        await assert.rejects(connection, /Fixture initial busy update failed/)
        await delay(20)
        assert.equal(requests.length, before)
        assert.equal(manager.get(current.id), current)
        assert.equal(state.main.signers[current.id].status, 'ready')
        mode = 'normal'
        await sign('signMessage', 0, '0x0a')
      } finally {
        adapter.removeListener('update', rejectBusy)
        // Also consume an orphaned setup promise when running against the
        // unfixed implementation, so the report retains its original failure.
        await adapter.connect().catch(() => {})
        connected = manager.get(current.id)
        mode = 'normal'
      }
    })
  })
  await check('manager reload completion waits for Suite verification and restored status', async () => {
    await withSignerManager(async (manager) => {
      const current = connected
      mode = 'hold-verification'
      held = undefined
      let completed = false
      const completion = Promise.resolve(manager.reload(current.id)).then(() => {
        completed = true
      })
      await waitFor(() => held)
      assert.equal(completed, false)
      assert.equal(state.main.signers[current.id].status, 'connecting')
      mode = 'normal'
      held.ws.send(JSON.stringify({ id: held.message.id, success: true, payload: { address }, device }))
      await completion
      assert.equal(state.main.signers[current.id].status, 'ready')
      connected = manager.get(current.id)
      await sign('signMessage', 0, '0x0d')
    })
  })
  for (const phase of ['initial', 'initial and failure']) {
    await check(`signer-details reconnect handles ${phase} status failure and allows retry`, async () => {
      await withSignerManager(async (manager) => {
        const current = connected
        const before = requests.length
        const unhandled = []
        let busySeen = false
        const onUnhandled = (error) => unhandled.push(error.message)
        const rejectStatus = (signer) => {
          const status = signer.summary().status
          if (status === 'connecting') busySeen = true
          if (status === 'connecting' || (phase === 'initial and failure' && status === 'reconnect-required'))
            throw new Error('Fixture signer-details status update failed')
        }
        process.on('unhandledRejection', onUnhandled)
        adapter.on('update', rejectStatus)
        try {
          manager.reload(current.id)
          await waitFor(
            () => busySeen && (state.main.signers[current.id].status !== 'connecting' || unhandled.length > 0)
          )
          await delay(20)
          assert.deepEqual(unhandled, [])
          assert.equal(manager.get(current.id), current)
          assert.equal(current.status, 'reconnect-required')
          assert.equal(state.main.signers[current.id].status, 'reconnect-required')
          assert.equal(requests.length, before)
          adapter.removeListener('update', rejectStatus)
          mode = 'hold-verification'
          held = undefined
          manager.reload(current.id)
          await waitFor(() => held)
          assert.equal(state.main.signers[current.id].status, 'connecting')
          mode = 'normal'
          held.ws.send(JSON.stringify({ id: held.message.id, success: true, payload: { address }, device }))
          await waitFor(
            () => manager.get(current.id) !== current && state.main.signers[current.id].status === 'ready'
          )
          connected = manager.get(current.id)
          assert.equal(
            verifyMessage(getBytes('0x0c'), await sign('signMessage', 0, '0x0c')).toLowerCase(),
            address
          )
          assert.deepEqual(unhandled, [])
        } finally {
          adapter.removeListener('update', rejectStatus)
          process.removeListener('unhandledRejection', onUnhandled)
        }
      })
    })
  }
  for (const phase of ['immediate', 'busy update']) {
    await check(`${phase} cancellation cannot start Suite setup`, async () => {
      const before = requests.length
      const cancel = () => adapter.cancelConnect()
      if (phase === 'busy update') adapter.once('update', cancel)
      try {
        const rejected = assert.rejects(adapter.connect(), /cancel/i)
        if (phase === 'immediate') cancel()
        await rejected
        await delay(20)
        assert.equal(requests.length, before)
        assert.equal(state.main.signers[connected.id].status, 'ready')
        await sign('signMessage', 0, '0x0b')
      } finally {
        adapter.removeListener('update', cancel)
      }
    })
  }
  await check('typed message signature recovers the expected account', async () => {
    const signature = await sign('signTypedData', 0, { data: typedData })
    assert.equal(
      verifyTypedData(
        typedData.domain,
        { Mail: typedData.types.Mail },
        typedData.message,
        signature
      ).toLowerCase(),
      address
    )
  })
  await check('a signature from another wallet is rejected locally', async () => {
    mode = 'wrong-signature'
    await assert.rejects(sign('signMessage', 0, '0x01'), /match/i)
    mode = 'normal'
  })
  await check('Model One typed-data request includes both hashes', async () => {
    features.model = '1'
    await adapter.connect()
    const typed = {
      types: { EIP712Domain: [], Message: [{ name: 'value', type: 'string' }] },
      primaryType: 'Message',
      domain: {},
      message: { value: 'Model One' }
    }
    await sign('signTypedData', 0, { data: typed })
    assert.equal(
      requests.at(-1).payload.domain_separator_hash,
      TypedDataEncoder.hashDomain(typed.domain).slice(2)
    )
    assert.equal(
      requests.at(-1).payload.message_hash,
      TypedDataEncoder.from({ Message: typed.types.Message }).hash(typed.message).slice(2)
    )
    features.model = 'T'
    await adapter.connect()
  })
  for (const type of ['0x0', '0x2']) {
    await check(`${type} transaction preserves data and recovers its sender`, async () => {
      const tx = {
        chainId: '0x1',
        type,
        nonce: '0x7',
        gasLimit: '0x186a0',
        to: '0x2222222222222222222222222222222222222222',
        value: '0x1',
        data: '0xdeadbeef',
        ...(type === '0x2'
          ? { maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x1' }
          : { gasPrice: '0x3b9aca00' })
      }
      const signed = await sign('signTransaction', 0, tx)
      const parsed = TransactionFactory.fromSerializedData(Buffer.from(signed.slice(2), 'hex'), {
        common: new Common({ chain: 1, hardfork: 'london' })
      })
      assert.equal(parsed.getSenderAddress().toString(), address)
      assert.equal(`0x${parsed.data.toString('hex')}`, tx.data)
      assert.equal(parsed.nonce, 7n)
    })
  }
  await check('typed-data and transaction signatures from another account are rejected', async () => {
    mode = 'wrong-signature'
    await assert.rejects(sign('signTypedData', 0, { data: typedData }), /match/i)
    await assert.rejects(
      sign('signTransaction', 0, {
        chainId: '0x1',
        type: '0x0',
        nonce: '0x0',
        gasLimit: '0x5208',
        gasPrice: '0x1',
        value: '0x0',
        data: '0x',
        to: address
      }),
      /match/i
    )
    mode = 'normal'
    await adapter.connect()
  })
  await check('permission denial settles once and the next request succeeds', async () => {
    mode = 'deny'
    await assert.rejects(sign('signMessage', 0, '0x01'))
    mode = 'normal'
    await sign('signMessage', 0, '0x02')
  })
  await check('malformed success cannot become a signature', async () => {
    mode = 'malformed'
    await assert.rejects(sign('signMessage', 0, '0x01'))
    mode = 'normal'
    await sign('signMessage', 0, '0x02')
  })
  await check('disconnect rejects callers and explicit reconnect preserves identity', async () => {
    const id = connected.id
    mode = 'disconnect'
    await assert.rejects(sign('signMessage', 0, '0x01'))
    mode = 'normal'
    await adapter.connect()
    assert.equal(connected.id, id)
    assert.equal(JSON.stringify(state.main.accounts), savedAccounts)
  })
  await check('wrong-wallet address cannot pass verification', async () => {
    mode = 'wrong-wallet'
    await assert.rejects(sign('verifyAddress', 0, address, false), /match/i)
    mode = 'normal'
    await adapter.connect()
  })
  for (const responseMode of ['changed-instance', 'invalid-instance', 'missing-instance']) {
    await check(`${responseMode} response cannot complete an address check`, async () => {
      mode = responseMode
      await assert.rejects(sign('verifyAddress', 0, address, false), /device|wallet/i)
      mode = 'normal'
      await adapter.connect()
    })
  }
  await check('canceling a queued transaction preserves other work and the Suite connection', async () => {
    mode = 'hold'
    held = undefined
    const verifying = sign('verifyAddress', 0, address, false)
    void verifying.catch(() => {})
    await waitFor(() => held)
    const socket = held.ws
    const before = requests.length
    const transaction = {
      chainId: '0x1',
      type: '0x0',
      nonce: '0x0',
      gasLimit: '0x5208',
      gasPrice: '0x1',
      value: '0x0',
      data: '0x',
      to: address
    }
    const rejected = assert.rejects(sign('signTransaction', 0, transaction), (error) => error.code === 4001)
    void rejected.catch(() => {})
    await delay(10)
    const following = bridge.signMessage(connected.device, `${basePath}/0`, '02').then(
      (signature) => ({ signature }),
      (error) => ({ error })
    )
    assert.equal(connected.cancelTransactionSigning(), true)
    mode = 'normal'
    socket.send(JSON.stringify({ id: held.message.id, success: true, payload: { address }, device }))
    assert.equal(await verifying, true)
    await rejected
    const result = await following
    if (result.error) throw result.error
    assert.equal(verifyMessage(getBytes('0x02'), `0x${result.signature}`).toLowerCase(), address)
    assert.equal(connected.status, 'ready')
    assert.equal(state.main.signers[connected.id].status, 'ready')
    assert.equal(socket.readyState, 1)
    assert.equal(
      requests
        .slice(before)
        .filter((item) => item.type === 'iframe-call' && item.payload.method === 'ethereumSignTransaction')
        .length,
      0
    )
    await sign('signTransaction', 0, transaction)
    assert.equal(socket.readyState, 1)
    assert.equal(connected.status, 'ready')
  })
  await check('cancellation settles Wren calls and rejects queued work', async () => {
    mode = 'hold'
    held = undefined
    const active = sign('signTransaction', 0, {
      chainId: '0x1',
      type: '0x0',
      nonce: '0x0',
      gasLimit: '0x5208',
      gasPrice: '0x1',
      value: '0x0',
      data: '0x',
      to: address
    })
    const activeRejected = assert.rejects(active)
    await waitFor(() => held)
    const queuedRejected = assert.rejects(bridge.signMessage(connected.device, `${basePath}/0`, '01'))
    bridge.cancelCurrentRequest()
    await activeRejected
    await queuedRejected
    await waitFor(() => cancellations > 0)
    mode = 'normal'
    await adapter.connect()
    await sign('signMessage', 0, '0x03')
  })
  await check('unanswered request expires and recovery uses a fresh connection', async () => {
    mode = 'timeout'
    await assert.rejects(sign('signMessage', 0, '0x01'), /timed out/i)
    mode = 'normal'
    await adapter.connect()
  })
  await check('closing an unfinished connection cannot add a signer', async () => {
    mode = 'hold'
    held = undefined
    const count = Object.keys(state.main.signers).length
    const rejected = assert.rejects(adapter.connect())
    await waitFor(() => held)
    adapter.cancelConnect()
    await rejected
    assert.equal(Object.keys(state.main.signers).length, count)
    mode = 'normal'
    await adapter.connect()
  })
  await check('a missing Suite connection gives a retryable error', async () => {
    bridge.cancelCurrentRequest()
    mode = 'offline'
    await assert.rejects(adapter.connect(), /Suite/)
    mode = 'normal'
    await adapter.connect()
  })
  await check('shutdown settles active work without publishing late success', async () => {
    mode = 'hold'
    held = undefined
    const active = sign('signMessage', 0, '0x01')
    const rejected = assert.rejects(active)
    await waitFor(() => held)
    await adapter.close()
    await rejected
    assert.equal(JSON.stringify(state.main.accounts), savedAccounts)
  })
  console.log(`Trezor Suite qualification: ${results.length} scenarios passed`)
} finally {
  await adapter?.close()
  wss.clients.forEach((ws) => ws.terminate())
  await new Promise((resolve) => wss.close(resolve))
  await new Promise((resolve) => server.close(resolve))
  clearTimeout(watchdog)
  moduleGuard.deregister()
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify({ scope: 'Real published client; simulated Suite and signatures; no physical hardware', hashes, results, cancellations, clientModules: [...clientModules].sort() }, null, 2)}\n`
  )
}
