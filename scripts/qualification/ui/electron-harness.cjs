'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, session } = require('electron')

const { auditPage } = require('./audit-page.cjs')
const { COMPACT_TARGET_EXCEPTIONS, physicalSize, scenarioMatrix } = require('./policy.cjs')
const { fixtureFor, rpcReplyFor } = require('./state-fixture.cjs')

const projectRoot = path.resolve(__dirname, '../../..')
const runRoot = path.resolve(process.env.WREN_UI_QUALIFICATION_ROOT || '')
const reportPath = path.resolve(process.env.WREN_UI_QUALIFICATION_REPORT || '')
const screenshotRoot = path.resolve(process.env.WREN_UI_QUALIFICATION_SCREENSHOTS || '')
const bundleRoot = path.join(projectRoot, 'bundle')
const preload = path.join(bundleRoot, 'bridge.js')
const stateByWebContents = new Map()
const scenarioByWebContents = new Map()
const rendererErrors = new Map()
const isolation = {
  blockedOutbound: 0,
  blockedPermissions: 0,
  blockedPopups: 0,
  blockedNavigation: 0,
  blockedWebviews: 0,
  devicePolicyInstalled: false
}

const fail = (message) => {
  throw new Error(`UI qualification isolation violation: ${message}`)
}

const assertPrivateDirectory = (target) => {
  const resolved = path.resolve(target)
  const stat = fs.lstatSync(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${resolved} is not a regular directory`)
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
    fail(`${resolved} must use mode 0700`)
  }
  if (resolved !== runRoot && !resolved.startsWith(`${runRoot}${path.sep}`)) {
    fail(`${resolved} is outside the disposable run root`)
  }
}

const parseWireValue = (value) => {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') fail('renderer RPC value was not serialized')
  return JSON.parse(value)
}

const waitFor = async (webContents, expression, timeoutMs = 8000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await webContents.executeJavaScript(`Boolean(${expression})`, true)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const pageText = await webContents.executeJavaScript(
    `document.body?.innerText?.replace(/\\s+/gu, ' ').trim().slice(0, 300) || '<empty>'`,
    true
  )
  throw new Error(`Timed out waiting for ${expression}; page text: ${pageText}`)
}

const installIsolation = () => {
  const isolatedSession = session.defaultSession
  const denyRequest = () => {
    isolation.blockedOutbound += 1
    return Response.error()
  }
  isolatedSession.protocol.handle('http', denyRequest)
  isolatedSession.protocol.handle('https', denyRequest)
  isolatedSession.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    isolation.blockedOutbound += 1
    callback({ cancel: true })
  })
  isolatedSession.setPermissionCheckHandler(() => {
    isolation.blockedPermissions += 1
    return false
  })
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    isolation.blockedPermissions += 1
    callback(false)
  })
  isolatedSession.setDevicePermissionHandler(() => false)
  isolatedSession.setBluetoothPairingHandler((_details, callback) => callback('reject'))
  isolation.devicePolicyInstalled = true

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => {
      isolation.blockedPopups += 1
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, target) => {
      const protocol = new URL(target).protocol
      if (protocol !== 'file:' && protocol !== 'data:') {
        isolation.blockedNavigation += 1
        event.preventDefault()
      }
    })
    contents.on('will-attach-webview', (event) => {
      isolation.blockedWebviews += 1
      event.preventDefault()
    })
  })
}

const runIsolationSelfTest = async () => {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  try {
    await probe.loadURL('data:text/html,<meta charset="utf-8"><title>Wren isolation probe</title>')
    const result = await probe.webContents.executeJavaScript(
      `(async () => {
      let fetchBlocked = false
      try { await fetch('https://example.invalid/wren-ui-qualification') } catch { fetchBlocked = true }
      const popupBlocked = window.open('https://example.invalid/wren-ui-popup') === null
      const initialLocation = location.href
      location.assign('https://example.invalid/wren-ui-navigation')
      await new Promise((resolve) => setTimeout(resolve, 50))
      const navigationBlocked = location.href === initialLocation
      const permission = await navigator.permissions.query({ name: 'geolocation' })
      return { fetchBlocked, navigationBlocked, popupBlocked, permission: permission.state }
    })()`,
      true
    )
    if (
      !result.fetchBlocked ||
      !result.navigationBlocked ||
      !result.popupBlocked ||
      result.permission !== 'denied'
    ) {
      fail(`renderer isolation probe failed: ${JSON.stringify(result)}`)
    }
    if (
      !isolation.blockedOutbound ||
      !isolation.blockedNavigation ||
      !isolation.blockedPopups ||
      !isolation.blockedPermissions
    ) {
      fail(`isolation handlers were not exercised: ${JSON.stringify(isolation)}`)
    }
    return result
  } finally {
    probe.destroy()
  }
}

const runLocalFileSelfTest = async () => {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  try {
    await probe.loadFile(path.join(bundleRoot, 'tray.html'))
    return probe.webContents.getURL().startsWith('file:')
  } finally {
    probe.destroy()
  }
}

const createRendererWindow = (scenario) => {
  const size = physicalSize(scenario)
  const window = new BrowserWindow({
    ...size,
    useContentSize: true,
    frame: false,
    show: true,
    x: 0,
    y: 0,
    backgroundColor: '#111513',
    webPreferences: {
      additionalArguments: [`--frame-renderer-role=${scenario.renderer}`],
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true
    }
  })
  window.setResizable(false)
  window.webContents.setZoomFactor(scenario.scale)
  stateByWebContents.set(window.webContents.id, fixtureFor(scenario))
  scenarioByWebContents.set(window.webContents.id, scenario)
  rendererErrors.set(window.webContents.id, [])
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      rendererErrors.get(window.webContents.id)?.push(String(details.message))
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.get(window.webContents.id)?.push(`renderer exited: ${details.reason}`)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    rendererErrors
      .get(window.webContents.id)
      ?.push(`load failed ${code} ${description} at ${url}; main frame: ${isMainFrame}`)
  })
  return window
}

const clickText = async (webContents, text) => {
  const clicked = await webContents.executeJavaScript(
    `(() => {
      const target = Array.from(document.querySelectorAll('button')).find(
        (button) => button.innerText.trim() === ${JSON.stringify(text)}
      )
      if (!target) return false
      target.click()
      return true
    })()`,
    true
  )
  if (!clicked) throw new Error(`Could not find button text ${text}`)
}

const runScenario = async (scenario) => {
  const window = createRendererWindow(scenario)
  try {
    try {
      await window.loadFile(path.join(bundleRoot, `${scenario.renderer}.html`))
    } catch (error) {
      const errors = rendererErrors.get(window.webContents.id) || []
      throw new Error(`${error.message}${errors.length ? `; ${errors.join(' | ')}` : ''}`)
    }
    window.webContents.setZoomFactor(scenario.scale)
    if (scenario.action?.type === 'clickText') {
      await waitFor(
        window.webContents,
        `Array.from(document.querySelectorAll('button')).some(
          (button) => button.innerText.trim() === ${JSON.stringify(scenario.action.text)}
        )`
      )
      await clickText(window.webContents, scenario.action.text)
    }
    await waitFor(window.webContents, `document.querySelector(${JSON.stringify(scenario.ready)})`)
    await new Promise((resolve) => setTimeout(resolve, 900))

    const audit = await window.webContents.executeJavaScript(
      `(${auditPage.toString()})(${JSON.stringify({
        compactExceptions: COMPACT_TARGET_EXCEPTIONS,
        expectedInitialFocus: scenario.expectedInitialFocus,
        expectedViewport: { width: scenario.logicalWidth, height: scenario.logicalHeight },
        layoutExpectations: scenario.layoutExpectations,
        requiredControls: scenario.requiredControls,
        requiredText: scenario.requiredText
      })})`,
      true
    )
    const errors = rendererErrors.get(window.webContents.id) || []
    if (errors.length) {
      audit.violations.push({ kind: 'renderer-error', detail: errors.join(' | ').slice(0, 1000) })
    }

    let screenshot
    if (audit.violations.length) {
      screenshot = path.join(screenshotRoot, `${scenario.id}.png`)
      const image = await window.webContents.capturePage()
      fs.writeFileSync(screenshot, image.toPNG(), { mode: 0o600 })
    }
    return { ...scenario, audit, screenshot }
  } finally {
    stateByWebContents.delete(window.webContents.id)
    scenarioByWebContents.delete(window.webContents.id)
    rendererErrors.delete(window.webContents.id)
    window.destroy()
  }
}

const main = async () => {
  if (!runRoot || runRoot === path.parse(runRoot).root) fail('missing disposable run root')
  for (const directory of [runRoot, path.dirname(reportPath), screenshotRoot])
    assertPrivateDirectory(directory)
  if (!fs.existsSync(preload)) throw new Error('bundle/bridge.js is missing; run npm run bundle first')

  app.setPath('userData', path.join(runRoot, 'profile'))
  app.setPath('temp', path.join(runRoot, 'tmp'))
  installIsolation()

  ipcMain.on('main:rpc', (event, idWire, methodWire) => {
    const id = parseWireValue(idWire)
    const method = parseWireValue(methodWire)
    const scenario = scenarioByWebContents.get(event.sender.id)
    const reply = scenario ? rpcReplyFor(scenario, method) : undefined
    if (method !== 'getState' && reply === undefined) {
      event.sender.send('main:rpc', id, JSON.stringify(`Qualification harness does not provide ${method}`))
      return
    }
    const result = method === 'getState' ? stateByWebContents.get(event.sender.id) : reply
    event.sender.send('main:rpc', id, null, JSON.stringify(result))
  })

  const localFileProbe = await runLocalFileSelfTest()
  const isolationProbe = await runIsolationSelfTest()
  const results = []
  for (const scenario of scenarioMatrix()) results.push(await runScenario(scenario))

  const report = {
    covered: {
      renderers: ['tray', 'dash', 'onboard'],
      states: [
        'empty account tray',
        'control center dashboard',
        'selected software account delegation',
        'custom-token management',
        'delegation revocation review',
        'ambiguous delegation revocation monitoring',
        'onboarding intro',
        'onboarding access'
      ],
      geometry: ['full shell', 'short shell', 'capped-width fallback', 'onboarding window'],
      scales: [1, 1.25, 1.5]
    },
    uncovered: [
      'General transaction review and account-home states remain outside this focused matrix.',
      'Hardware prompts, provider requests, and live network content are intentionally excluded.',
      'This harness qualifies renderer scaling; production window placement remains covered by shell-geometry tests.',
      "This host cannot provide Chromium's test sandbox; only trusted local bundles run, with application-level isolation self-tested."
    ],
    isolation: {
      ...isolation,
      chromiumSandbox: process.argv.includes('--no-sandbox') ? 'disabled-test-only' : 'enabled',
      localFileProbe,
      probe: isolationProbe
    },
    results,
    violations: results.reduce((total, result) => total + result.audit.violations.length, 0)
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  process.exitCode = report.violations ? 1 : 0
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-default-apps')
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,Translate')
app.on('window-all-closed', () => {})

app
  .whenReady()
  .then(main)
  .catch((error) => {
    try {
      fs.writeFileSync(reportPath, `${JSON.stringify({ fatal: error.stack || error.message }, null, 2)}\n`, {
        mode: 0o600
      })
    } catch {}
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
  .finally(() => app.exit(process.exitCode || 0))
