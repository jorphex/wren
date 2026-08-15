import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electron = path.join(projectRoot, 'node_modules', '.bin', 'electron')
const harness = path.join(projectRoot, 'scripts', 'qualification', 'ui', 'electron-harness.cjs')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-ui-qualification-'))
const directories = ['home', 'config', 'data', 'cache', 'tmp', 'profile', 'report', 'screenshots']
const children = new Set()
let interruptedSignal

fs.chmodSync(runRoot, 0o700)
for (const directory of directories) {
  const target = path.join(runRoot, directory)
  fs.mkdirSync(target, { mode: 0o700 })
  fs.chmodSync(target, 0o700)
}

const reportPath = path.join(runRoot, 'report', 'ui-qualification.json')
const screenshotRoot = path.join(runRoot, 'screenshots')
const exportRoot = process.env.WREN_UI_QUALIFICATION_EXPORT
  ? path.resolve(process.env.WREN_UI_QUALIFICATION_EXPORT)
  : undefined

const assertPrivateExportDirectory = (target) => {
  const stat = fs.lstatSync(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`UI qualification export target is not a regular directory: ${target}`)
  }
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
    throw new Error(`UI qualification export target must use mode 0700: ${target}`)
  }
}

const exportArtifacts = (report) => {
  if (!exportRoot) return
  assertPrivateExportDirectory(exportRoot)
  const exportedReport = path.join(exportRoot, 'ui-qualification.json')
  fs.copyFileSync(reportPath, exportedReport)
  fs.chmodSync(exportedReport, 0o600)
  for (const result of report.results || []) {
    if (!result.screenshot || !fs.existsSync(result.screenshot)) continue
    const destination = path.join(exportRoot, path.basename(result.screenshot))
    fs.copyFileSync(result.screenshot, destination)
    fs.chmodSync(destination, 0o600)
  }
}

const terminate = async (child, graceMs = 2000) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, graceMs))
  ])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ])
  }
}

const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })

const startXvfb = async () => {
  const child = spawn(
    'Xvfb',
    ['-displayfd', '3', '-screen', '0', '2400x1600x24', '-nolisten', 'tcp', '-noreset'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] }
  )
  children.add(child)
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const display = await Promise.race([
    new Promise((resolve, reject) => {
      let output = ''
      child.stdio[3].on('data', (chunk) => {
        output += chunk.toString()
        const match = output.match(/^(\d+)\s*$/u)
        if (match) resolve(`:${match[1]}`)
      })
      child.once('exit', () => reject(new Error(`Xvfb exited before startup: ${stderr.trim()}`)))
      child.once('error', reject)
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Xvfb startup timed out')), 5000))
  ])
  return { child, display }
}

const preserveFailures = (report) => {
  if (!report?.violations) return null
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-ui-qualification-failures-'))
  fs.chmodSync(target, 0o700)
  fs.copyFileSync(reportPath, path.join(target, 'ui-qualification.json'))
  fs.chmodSync(path.join(target, 'ui-qualification.json'), 0o600)
  for (const result of report.results || []) {
    if (!result.screenshot || !fs.existsSync(result.screenshot)) continue
    const destination = path.join(target, path.basename(result.screenshot))
    fs.copyFileSync(result.screenshot, destination)
    fs.chmodSync(destination, 0o600)
  }
  return target
}

let finalCode = 1
let failureArtifacts
const forwardSignal = (signal) => {
  if (interruptedSignal) return
  interruptedSignal = signal
  for (const child of children) child.kill('SIGTERM')
}
const handleSigint = () => forwardSignal('SIGINT')
const handleSigterm = () => forwardSignal('SIGTERM')
process.once('SIGINT', handleSigint)
process.once('SIGTERM', handleSigterm)

try {
  if (process.platform !== 'linux') throw new Error('UI qualification currently requires Linux and Xvfb')
  for (const required of [electron, harness, path.join(projectRoot, 'bundle', 'bridge.js')]) {
    if (!fs.existsSync(required)) throw new Error(`Missing qualification dependency: ${required}`)
  }

  const { child: xvfb, display } = await startXvfb()
  const environment = {
    ...process.env,
    DISPLAY: display,
    HOME: path.join(runRoot, 'home'),
    XDG_CONFIG_HOME: path.join(runRoot, 'config'),
    XDG_DATA_HOME: path.join(runRoot, 'data'),
    XDG_CACHE_HOME: path.join(runRoot, 'cache'),
    TMPDIR: path.join(runRoot, 'tmp'),
    WREN_UI_QUALIFICATION_ROOT: runRoot,
    WREN_UI_QUALIFICATION_REPORT: reportPath,
    WREN_UI_QUALIFICATION_SCREENSHOTS: screenshotRoot,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    NO_PROXY: '',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null'
  }
  delete environment.ELECTRON_RUN_AS_NODE

  // The npm-distributed Electron helper is neither root-owned nor setuid, and this
  // host blocks unprivileged user namespaces. The renderer still loads only trusted
  // local bundles inside a disposable profile; the harness independently denies all
  // network, permission, device, popup, navigation, and webview capabilities.
  const renderer = spawn(electron, ['--no-sandbox', harness], {
    cwd: projectRoot,
    env: environment,
    stdio: ['ignore', 'inherit', 'pipe']
  })
  let rendererStderr = ''
  renderer.stderr.on('data', (chunk) => {
    rendererStderr += chunk.toString()
    const lines = rendererStderr.split('\n')
    rendererStderr = lines.pop() || ''
    for (const line of lines) {
      if (!/dbus\/|org\.freedesktop\.DBus/u.test(line)) process.stderr.write(`${line}\n`)
    }
  })
  children.add(renderer)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    void terminate(renderer)
  }, 180_000)
  timeout.unref()
  const result = await waitForExit(renderer)
  clearTimeout(timeout)
  if (rendererStderr && !/dbus\/|org\.freedesktop\.DBus/u.test(rendererStderr)) {
    process.stderr.write(`${rendererStderr}\n`)
  }

  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null
  failureArtifacts = preserveFailures(report)
  if (!report) throw new Error('Electron harness did not write a qualification report')
  if (report.fatal) throw new Error(report.fatal)
  exportArtifacts(report)
  if (timedOut) throw new Error('Electron UI qualification exceeded 180 seconds')

  const passed = report.results.filter((entry) => entry.audit.violations.length === 0).length
  console.log(`UI qualification: ${passed}/${report.results.length} scenarios passed`)
  console.log(
    `Isolation (${report.isolation.chromiumSandbox}): ${report.isolation.blockedOutbound} outbound, ${report.isolation.blockedPermissions} permission, ${report.isolation.blockedNavigation} navigation, and ${report.isolation.blockedPopups} popup attempts blocked`
  )
  for (const gap of report.uncovered) console.log(`Uncovered: ${gap}`)
  if (report.violations) {
    for (const entry of report.results.filter((item) => item.audit.violations.length)) {
      console.error(
        `${entry.id}: ${entry.audit.violations.map((item) => `${item.kind}: ${item.detail}`).join('; ')}`
      )
    }
  }

  finalCode = result.code === 0 && report.violations === 0 ? 0 : 1
  await terminate(xvfb)
} catch (error) {
  console.error(`UI qualification failed: ${error.message}`)
} finally {
  for (const child of children) await terminate(child)
  try {
    fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (error) {
    console.error(`Could not remove disposable UI profile: ${error.message}`)
    finalCode = 1
  }
}

if (failureArtifacts) console.error(`Failure-only screenshots: ${failureArtifacts}`)
process.removeListener('SIGINT', handleSigint)
process.removeListener('SIGTERM', handleSigterm)
if (interruptedSignal) finalCode = interruptedSignal === 'SIGINT' ? 130 : 143
process.exit(finalCode)
