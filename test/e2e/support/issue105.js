import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { EventEmitter } from 'events'
import ts from 'typescript'

export function saveIssueEvidence(name, evidence) {
  const directory = process.env.WREN_E2E_EVIDENCE_DIR
  if (!directory) return
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
}

export async function waitUntil(predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Issue 105 fixture did not settle')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// Run the original controller and worker together with a fixture IPC boundary.
// RPC still goes through the isolated loopback server. Scaling preserves the
// production deadline/heartbeat relationships without a long timeout test.
export function balanceWorkerHarness(chains, { timeScale = 1, responseDelay = 0 } = {}) {
  const logs = []
  const events = []
  const rpcResponses = []
  const timeouts = new Set()
  const intervals = new Set()
  let stopped = false
  const worker = Object.assign(new EventEmitter(), {
    pid: 105,
    connected: true,
    channel: {},
    send(message) {
      const deliver = () => {
        if (!stopped) {
          if (message.command === 'rpcResponse')
            rpcResponses.push({ at: Date.now(), response: message.args[0] })
          workerProcess.emit('message', message)
        }
      }
      if (message.command === 'rpcResponse' && responseDelay) setTimeout(deliver, responseDelay)
      else queueMicrotask(deliver)
      return true
    },
    kill() {
      if (stopped) return
      stopped = true
      timeouts.forEach(clearTimeout)
      intervals.forEach(clearInterval)
      worker.connected = false
      worker.emit('close', 0, 'SIGTERM')
    }
  })
  const workerProcess = Object.assign(new EventEmitter(), {
    env: { NODE_ENV: 'test' },
    connected: true,
    pid: 105,
    send(message) {
      queueMicrotask(() => {
        if (!stopped) worker.emit('message', message)
      })
      return true
    },
    disconnect() {},
    kill() {
      worker.kill()
    }
  })
  const logger = Object.fromEntries(
    ['info', 'warn', 'error', 'debug', 'verbose'].map((level) => [
      level,
      (...args) => logs.push({ level, args: args.map((arg) => (arg instanceof Error ? arg.message : arg)) })
    ])
  )
  logger.transports = { console: {}, file: {} }
  function load(relative, dependencies = {}) {
    const filename = path.resolve(relative)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText
    const module = { exports: {} }
    const localRequire = (name) => {
      if (name === 'electron-log') return logger
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name)
    }
    const scopedTimeout = (callback, milliseconds, ...args) => {
      const timer = setTimeout(callback, milliseconds * timeScale, ...args)
      timeouts.add(timer)
      return timer
    }
    const scopedInterval = (callback, milliseconds, ...args) => {
      const timer = setInterval(callback, milliseconds * timeScale, ...args)
      intervals.add(timer)
      return timer
    }
    vm.runInThisContext(
      '(function(require,module,exports,process,__dirname,setTimeout,clearTimeout,setInterval,clearInterval){' +
        code +
        '\n})',
      { filename }
    )(
      localRequire,
      module,
      module.exports,
      workerProcess,
      path.dirname(filename),
      scopedTimeout,
      clearTimeout,
      scopedInterval,
      clearInterval
    )
    return module.exports
  }
  const Controller = load('main/externalData/balances/controller.ts', {
    child_process: { fork: () => worker },
    '../../chains': chains
  }).default
  const controller = new Controller()
  for (const name of ['ready', 'tokenBalances', 'chainBalances']) {
    controller.on(name, (...args) => events.push({ name, args, at: Date.now() }))
  }
  load('main/externalData/balances/worker.ts')
  return {
    controller,
    events,
    logs,
    rpcResponses,
    createPublisher(store) {
      const createPublisher = load('main/externalData/balances/index.ts', {
        './controller': function () {
          return controller
        }
      }).default
      const publisher = createPublisher(store)
      publisher.start()
      return publisher
    },
    close: () => controller.close()
  }
}

export const hyperliquidFixture = () => ({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' }
    ],
    ['HyperliquidTransaction:ApproveAgent']: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'agentAddress', type: 'address' },
      { name: 'agentName', type: 'string' },
      { name: 'nonce', type: 'uint64' }
    ]
  },
  primaryType: 'HyperliquidTransaction:ApproveAgent',
  domain: {
    name: 'HyperliquidSignTransaction',
    version: '1',
    chainId: 421614,
    verifyingContract: '0x0000000000000000000000000000000000000000'
  },
  message: {
    hyperliquidChain: 'Mainnet',
    agentAddress: '0x2222222222222222222222222222222222222222',
    agentName: 'issue105',
    nonce: 1
  }
})
