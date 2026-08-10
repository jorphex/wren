import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-e2e-'))
const directories = ['home', 'config', 'data', 'cache', 'profile']

fs.chmodSync(runRoot, 0o700)
directories.forEach((directory) => {
  const target = path.join(runRoot, directory)
  fs.mkdirSync(target, { mode: 0o700 })
  fs.chmodSync(target, 0o700)
})

const environment = {
  ...process.env,
  HOME: path.join(runRoot, 'home'),
  XDG_CONFIG_HOME: path.join(runRoot, 'config'),
  XDG_DATA_HOME: path.join(runRoot, 'data'),
  XDG_CACHE_HOME: path.join(runRoot, 'cache'),
  WREN_E2E_PROFILE: path.join(runRoot, 'profile'),
  WREN_E2E_NAMESPACE: crypto.randomBytes(16).toString('hex'),
  WREN_E2E_RUN_ROOT: runRoot,
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  ALL_PROXY: '',
  NO_PROXY: '127.0.0.1,localhost,::1'
}

const jest = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js')
const child = spawn(
  process.execPath,
  [jest, '--config', 'jest.e2e.config.json', '--runInBand', '--detectOpenHandles'],
  { cwd: projectRoot, env: environment, stdio: 'inherit' }
)

let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGTERM')
  setTimeout(() => child.kill('SIGKILL'), 2000).unref()
}, 120_000)
timeout.unref()

const forwardSignal = (signal) => child.kill(signal)
process.once('SIGINT', forwardSignal)
process.once('SIGTERM', forwardSignal)

const exitCode = await new Promise((resolve) => {
  child.once('error', (error) => {
    console.error(`Unable to start isolated E2E tests: ${error.message}`)
    resolve(1)
  })
  child.once('exit', (code, signal) => {
    if (timedOut) console.error('Isolated E2E tests exceeded the 120 second limit')
    else if (signal) console.error(`Isolated E2E tests stopped by ${signal}`)
    resolve(code ?? 1)
  })
})

clearTimeout(timeout)
process.removeListener('SIGINT', forwardSignal)
process.removeListener('SIGTERM', forwardSignal)

try {
  fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
} catch (error) {
  console.error(`Unable to remove isolated E2E profile: ${error.message}`)
  process.exit(1)
}

process.exit(exitCode)
