// Diagnostic qualification, not a hardware or clear-signing support test.
// Failure cases and scope: TREZOR_CLEAR_SIGNING.md.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { setTimeout as delay } from 'node:timers/promises'
import nock from 'nock'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const reportPath = path.join(root, '.git/trezor-clear-signing/lookup-qualification.json')
const results = []
const warnings = []
const unexpectedRequests = []
const originalWarn = console.warn
const watchdog = setTimeout(() => {
  console.error('Trezor lookup qualification exceeded 30 seconds')
  process.exit(1)
}, 30_000)

nock.disableNetConnect()
const onNoMatch = (request) => unexpectedRequests.push(`${request.method} ${request.path}`)
nock.emitter.on('no match', onNoMatch)
console.warn = (...args) => warnings.push(args.map(String).join(' '))

const sourceHashes = {}
function source(relative) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8')
  sourceHashes[relative] = crypto.createHash('sha256').update(text).digest('hex')
  return text
}

// Use the same in-process engine and public method factory as Connect's Node
// entry point. Exclude CoreInModuleNode so no native USB module is even loaded.
const { CoreInModule } = await import('@trezor/connect-core/lib/impl/core-in-module.js')
const common = await import('@trezor/connect-common')
const { AbstractTransport } = await import('@trezor/transport-common')
class IsolatedCore extends CoreInModule {
  defaultTransports() {
    throw new Error('Qualification must never create a default transport')
  }
}
const sdk = common.factoryPrivileged(new IsolatedCore())
let wireCalls = 0
class EmptyTransport extends AbstractTransport {
  name = 'NodeUsbTransport'
  async init() {
    this.stopped = false
    return { success: true, payload: undefined }
  }
  async enumerate() {
    return { success: true, payload: [] }
  }
  listen() {
    return { success: true, payload: undefined }
  }
  acquire() {
    return this.call()
  }
  release() {
    return this.call()
  }
  send() {
    return this.call()
  }
  receive() {
    return this.call()
  }
  call() {
    wireCalls++
    throw new Error('Empty qualification transport cannot access a device')
  }
}

function loadSource(relative, dependencies) {
  const { outputText } = ts.transpileModule(source(relative), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  })
  const module = { exports: {} }
  const localRequire = (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected bridge dependency: ${name}`)
    return dependencies[name]
  }
  vm.runInThisContext(`(function(require, module, exports) {${outputText}\n})`, {
    filename: relative
  })(localRequire, module, module.exports)
  return module.exports
}
const constants = loadSource('resources/constants/index.ts', {})
const deviceId = loadSource('main/signers/trezor/deviceId.ts', { uuid: require('uuid') })
const bridge = loadSource('main/signers/trezor/bridge.ts', {
  events: require('node:events'),
  'electron-log': { info() {}, debug() {}, error() {} },
  '@trezor/connect': { ...common, default: sdk, __esModule: true },
  './nodeUsbTransport': {
    FrameNodeUsbTransport: class {
      constructor() {
        throw new Error('USB construction is forbidden during qualification')
      }
    },
    closeFrameNodeUsbTransports: async () => {}
  },
  './deviceId': deviceId,
  '../../../resources/constants': constants
}).default

const device = { path: 'wren-isolated-no-device' }
const derivation = "m/44'/60'/0'/0/0"
const contract = '1111111111111111111111111111111111111111'
const base = '/firmware/definitions/eth/chain-id/1'
const tokenUrl = `${base}/token-${contract}.dat`
const nativeTx = {
  to: contract,
  value: '01',
  gasLimit: '5208',
  gasPrice: '01',
  nonce: '00',
  chainId: 1,
  data: ''
}
const contractTx = { ...nativeTx, data: '095ea7b3' + '00'.repeat(64) }
const observe = (promise) => {
  const state = { settled: false }
  state.promise = promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error: { code: error.code, message: error.message } })
  )
  return state
}
const assertNoDevice = async (state) => {
  await state.promise
  assert.equal(state.error?.code, 'Device_NotFound', JSON.stringify(state.error))
}
async function initialize() {
  nock('https://data.trezor.io').get('/firmware/config/releases.v1.json').reply(404)
  await sdk.init({
    manifest: {
      appName: 'Wren isolated qualification',
      appUrl: constants.WREN_REPOSITORY_URL,
      email: 'test@example.invalid'
    },
    transports: [new EmptyTransport({ id: 'Wren isolated qualification' })],
    transportReconnect: false,
    pendingTransportEvent: false
  })
}
const sign = (tx, dispatch) => observe(bridge.signTransaction(device, derivation, tx, dispatch))

try {
  await initialize()
  await assertNoDevice(sign(nativeTx))
  results.push({ case: 'native-no-lookup', outcome: 'reached-device-selection' })

  // Unsigned host-decoding fixture: trzd1 header + EthereumNetworkInfo protobuf.
  // No proof/signature is included. Never use this as firmware validation data.
  const hostMetadata = Buffer.from('74727a64310000000000130008011203455448183c2208457468657265756d', 'hex')
  nock('https://data.trezor.io').get(`${base}/network.dat`).reply(200, hostMetadata)
  nock('https://data.trezor.io').get(tokenUrl).reply(404)
  const { gasPrice: _gasPrice, ...type2Tx } = contractTx
  await assertNoDevice(sign({ ...type2Tx, maxFeePerGas: '02', maxPriorityFeePerGas: '01', accessList: [] }))
  results.push({
    case: 'type2-decodable-host-metadata',
    outcome: 'reached-device-selection',
    signedDefinition: false
  })

  for (const status of [404, 503, 200]) {
    nock('https://data.trezor.io')
      .get(`${base}/network.dat`)
      .reply(status, status === 200 ? 'malformed-definition' : '')
    nock('https://data.trezor.io').get(tokenUrl).reply(404)
    const request = sign(contractTx)
    await request.promise
    if (status === 200) {
      assert.ok(request.error)
      assert.notEqual(request.error.code, 'Device_NotFound')
    } else await assertNoDevice(request)
    await assertNoDevice(sign(nativeTx))
    results.push({ case: `metadata-http-${status}`, error: request.error, queueRecovered: true })
  }

  for (const stage of ['network', 'token']) {
    let release
    let started
    const requested = new Promise((resolve) => {
      started = resolve
    })
    const heldUrl = stage === 'network' ? `${base}/network.dat` : tokenUrl
    if (stage === 'token') nock('https://data.trezor.io').get(`${base}/network.dat`).reply(404)
    nock('https://data.trezor.io')
      .get(heldUrl)
      .reply(
        () =>
          new Promise((resolve) => {
            release = () => resolve([404, ''])
            started()
          })
      )
    if (stage === 'network') nock('https://data.trezor.io').get(tokenUrl).reply(404)
    const current = sign(contractTx)
    await requested
    let dispatched = false
    const queued = sign(nativeTx, () => {
      dispatched = true
    })
    const sdkQueued = observe(
      sdk.getFeatures({ device }).then((response) => {
        if (!response.success)
          throw Object.assign(new Error(response.error.message), { code: response.error.code })
        return response.payload
      })
    )
    bridge.cancelCurrentRequest()
    await delay(250)
    const cancellationBlocked = !current.settled && !queued.settled && !sdkQueued.settled && !dispatched
    release()
    await Promise.all([current.promise, queued.promise, sdkQueued.promise])
    assert.equal(cancellationBlocked, true, 'Cancellation behavior changed; review the finding')
    await assertNoDevice(current)
    await assertNoDevice(queued)
    await assertNoDevice(sdkQueued)
    results.push({
      case: `cancel-during-${stage}-lookup`,
      cancellationBlocked,
      observationMs: 250,
      queueRecoveredAfterHttpReply: true,
      cancellationPreventedDeviceSelection: false,
      originalError: current.error
    })
  }

  let release
  let started
  const requested = new Promise((resolve) => {
    started = resolve
  })
  nock('https://data.trezor.io')
    .get(`${base}/network.dat`)
    .reply(
      () =>
        new Promise((resolve) => {
          release = () => resolve([404, ''])
          started()
        })
    )
  nock('https://data.trezor.io').get(tokenUrl).reply(404)
  const stale = sign(contractTx)
  await requested
  let staleQueuedDispatched = false
  const staleQueued = sign(nativeTx, () => {
    staleQueuedDispatched = true
  })
  await bridge.close()
  await delay(0)
  const callersSettledBeforeReply = stale.settled && staleQueued.settled
  assert.equal(callersSettledBeforeReply, true, 'Closing must settle active and queued bridge callers')
  assert.match(stale.error?.message ?? '', /bridge closed/)
  assert.match(staleQueued.error?.message ?? '', /bridge closed/)
  release()
  await delay(250)
  const disposedRequestUnsettled = !stale.settled
  assert.equal(disposedRequestUnsettled, false, 'Disposed bridge callers must settle')
  await initialize()
  await assertNoDevice(sign(nativeTx))
  assert.equal(staleQueuedDispatched, false, 'A closed lifecycle must not dispatch queued work')
  results.push({
    case: 'dispose-during-lookup',
    disposedRequestUnsettled,
    callersSettledBeforeReply,
    staleQueuedDispatched,
    observationMs: 250,
    newCoreUsable: true
  })

  assert.equal(wireCalls, 0)
  assert.deepEqual(nock.pendingMocks(), [])
  assert.deepEqual(unexpectedRequests, [])
  const sdkSources = [
    'scripts/qualify-trezor-lookups.mjs',
    'node_modules/@trezor/connect-common/lib/factory.js',
    'node_modules/@trezor/connect-core/lib/core/index.js',
    'node_modules/@trezor/connect-core/lib/impl/core-in-module.js',
    'node_modules/@trezor/connect-core/lib/api/ethereum/api/ethereumSignTransaction.js',
    'node_modules/@trezor/connect-core/lib/api/ethereum/ethereumDefinitions.js'
  ]
  sdkSources.forEach(source)
  const report = {
    scope:
      'Wren bridge source + released Connect public method factory/in-process core, empty in-memory transport',
    connect: JSON.parse(source('node_modules/@trezor/connect/package.json')).version,
    core: JSON.parse(source('node_modules/@trezor/connect-core/package.json')).version,
    liveNetwork: false,
    usb: false,
    device: false,
    realSignature: false,
    firmwareValidation: false,
    wireCalls,
    cases: results.length,
    lookupCancellationQualified: false,
    findings: ['Initial lookup cancellation waits for HTTP completion and holds both queues.'],
    results,
    warnings,
    sourceHashes
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(
    `Recorded ${results.length} diagnostic cases; shutdown regression passes; SDK cancellation gap remains. Evidence: ${reportPath}`
  )
} finally {
  await bridge.close()
  console.warn = originalWarn
  nock.emitter.off('no match', onNoMatch)
  nock.abortPendingRequests()
  nock.cleanAll()
  nock.enableNetConnect()
  clearTimeout(watchdog)
}
