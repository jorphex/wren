'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, session } = require('electron')

const { auditPage } = require('./audit-page.cjs')
const { COMPACT_TARGET_EXCEPTIONS, physicalSize, scenarioMatrix } = require('./policy.cjs')
const {
  QUALIFICATION_INVOKE_CHANNELS,
  fixtureFor,
  invokeReplyFor,
  rpcReplyFor
} = require('./state-fixture.cjs')

const projectRoot = path.resolve(__dirname, '../../..')
const runRoot = path.resolve(process.env.WREN_UI_QUALIFICATION_ROOT || '')
const reportPath = path.resolve(process.env.WREN_UI_QUALIFICATION_REPORT || '')
const screenshotRoot = path.resolve(process.env.WREN_UI_QUALIFICATION_SCREENSHOTS || '')
const captureAll = process.env.WREN_UI_QUALIFICATION_CAPTURE_ALL === '1'
const selectedScenarioIds = new Set(
  (process.env.WREN_UI_QUALIFICATION_SCENARIOS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)
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
        (button) =>
          button.innerText.trim() === ${JSON.stringify(text)} ||
          button.getAttribute('aria-label') === ${JSON.stringify(text)}
      )
      if (!target) return false
      target.click()
      return true
    })()`,
    true
  )
  if (!clicked) throw new Error(`Could not find button text ${text}`)
}

const focusText = async (webContents, text) => {
  const focused = await webContents.executeJavaScript(
    `(() => {
      const target = Array.from(document.querySelectorAll('button')).find(
        (button) =>
          button.innerText.trim() === ${JSON.stringify(text)} ||
          button.getAttribute('aria-label') === ${JSON.stringify(text)}
      )
      if (!target) return false
      target.focus()
      return document.activeElement === target
    })()`,
    true
  )
  if (!focused) throw new Error(`Could not focus button text ${text}`)
}

const hoverText = async (webContents, text) => {
  const point = await webContents.executeJavaScript(
    `(() => {
      const target = Array.from(document.querySelectorAll('button')).find(
        (button) =>
          button.innerText.trim() === ${JSON.stringify(text)} ||
          button.getAttribute('aria-label') === ${JSON.stringify(text)}
      )
      if (!target) return undefined
      const rect = target.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    })()`,
    true
  )
  if (!point) throw new Error(`Could not find button text ${text}`)
  webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
}

const inputByLabel = async (webContents, label, value) => {
  const changed = await webContents.executeJavaScript(
    `(() => {
      const input = Array.from(document.querySelectorAll('input, textarea')).find(
        (element) =>
          element.getAttribute('aria-label') === ${JSON.stringify(label)} ||
          Array.from(element.labels || []).some(
            (candidate) => candidate.textContent.trim() === ${JSON.stringify(label)}
          )
      )
      if (!input) return false
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
    true
  )
  if (!changed) throw new Error(`Could not find input label ${label}`)
}

const selectByLabel = async (webContents, label, value) => {
  const changed = await webContents.executeJavaScript(
    `(() => {
      const select = Array.from(document.querySelectorAll('select')).find(
        (element) =>
          element.getAttribute('aria-label') === ${JSON.stringify(label)} ||
          Array.from(element.labels || []).some(
            (candidate) =>
              candidate.textContent.trim() === ${JSON.stringify(label)} ||
              candidate.querySelector(':scope > span')?.textContent.trim() === ${JSON.stringify(label)}
          )
      )
      if (!select) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, ${JSON.stringify(value)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
    true
  )
  if (!changed) throw new Error(`Could not find select label ${label}`)
}

const clickCheckboxText = async (webContents, text) => {
  const clicked = await webContents.executeJavaScript(
    `(() => {
      const label = Array.from(document.querySelectorAll('label')).find(
        (candidate) => candidate.textContent.includes(${JSON.stringify(text)}) && candidate.querySelector('input[type="checkbox"]')
      )
      const checkbox = label?.querySelector('input[type="checkbox"]')
      if (!checkbox) return false
      checkbox.click()
      return true
    })()`,
    true
  )
  if (!clicked) throw new Error(`Could not find checkbox text ${text}`)
}

const performAction = async (webContents, action) => {
  if (action.type === 'sequence') {
    for (const step of action.steps) {
      await performAction(webContents, step)
      await new Promise((resolve) => setTimeout(resolve, action.delayMs || 30))
    }
    return
  }
  if (action.type === 'clickText') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('button')).some(
        (button) =>
          button.innerText.trim() === ${JSON.stringify(action.text)} ||
          button.getAttribute('aria-label') === ${JSON.stringify(action.text)}
      )`
    )
    await clickText(webContents, action.text)
    return
  }
  if (action.type === 'focusText') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('button')).some(
        (button) =>
          button.innerText.trim() === ${JSON.stringify(action.text)} ||
          button.getAttribute('aria-label') === ${JSON.stringify(action.text)}
      )`
    )
    await focusText(webContents, action.text)
    return
  }
  if (action.type === 'hoverText') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('button')).some(
        (button) =>
          button.innerText.trim() === ${JSON.stringify(action.text)} ||
          button.getAttribute('aria-label') === ${JSON.stringify(action.text)}
      )`
    )
    await hoverText(webContents, action.text)
    return
  }
  if (action.type === 'inputLabel') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('input, textarea')).some(
        (input) =>
          input.getAttribute('aria-label') === ${JSON.stringify(action.label)} ||
          Array.from(input.labels || []).some(
            (candidate) => candidate.textContent.trim() === ${JSON.stringify(action.label)}
          )
      )`
    )
    await inputByLabel(webContents, action.label, action.value)
    return
  }
  if (action.type === 'selectLabel') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('select')).some(
        (element) =>
          element.getAttribute('aria-label') === ${JSON.stringify(action.label)} ||
          Array.from(element.labels || []).some(
            (candidate) =>
              candidate.textContent.trim() === ${JSON.stringify(action.label)} ||
              candidate.querySelector(':scope > span')?.textContent.trim() === ${JSON.stringify(action.label)}
          )
      )`
    )
    await selectByLabel(webContents, action.label, action.value)
    return
  }
  if (action.type === 'clickCheckboxText') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('label')).some(
        (candidate) => candidate.textContent.includes(${JSON.stringify(action.text)}) && candidate.querySelector('input[type="checkbox"]')
      )`
    )
    await clickCheckboxText(webContents, action.text)
    return
  }
  if (action.type === 'confirmRequestWarning') {
    await waitFor(
      webContents,
      `Array.from(document.querySelectorAll('button')).some(
        (button) => button.innerText.trim() === ${JSON.stringify(action.text)}
      )`
    )
    await clickText(webContents, action.text)
    const state = stateByWebContents.get(webContents.id)
    const accountEntry = Object.entries(state?.main?.accounts || {}).find(
      ([, account]) => account?.requests?.[action.requestId]
    )
    if (!accountEntry) throw new Error('Could not confirm qualification request warning')
    const [accountId, account] = accountEntry
    const approvals = (account.requests[action.requestId].approvals || []).map((approval) => ({
      ...approval,
      approved: true
    }))
    account.requests[action.requestId].approvals = approvals
    state.windows.panel.footer.height = 114
    webContents.send(
      'main:action',
      'stateSync',
      JSON.stringify([
        {
          name: 'qualification-confirm-request-warning',
          count: 1,
          deferred: false,
          updates: [
            {
              path: `main.accounts.${accountId}.requests.${action.requestId}.approvals`,
              value: approvals
            },
            { path: 'windows.panel.footer.height', value: 114 }
          ]
        }
      ])
    )
    return
  }
  if (action.type === 'setRequestStatus') {
    await waitFor(webContents, `document.body.innerText.includes('Transaction queued')`)
    const requestState = {
      handlerId: action.requestId,
      status: action.status,
      ...(action.submission ? { submission: action.submission } : {}),
      ...(action.notice ? { notice: action.notice } : {})
    }
    const updated = await webContents.executeJavaScript(
      `(() => {
        if (!window.store?.api?.replaceState) return false
        const state = JSON.parse(JSON.stringify(window.store()))
        const account = state.main?.accounts?.[${JSON.stringify(action.account)}]
        if (!account) return false
        account.requests ||= {}
        account.requests[${JSON.stringify(action.requestId)}] = ${JSON.stringify(requestState)}
        window.store.api.replaceState(state)
        return true
      })()`,
      true
    )
    if (!updated) throw new Error('Could not update qualification request status')
    return
  }
  throw new Error(`Unknown qualification action ${action.type}`)
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
    if (scenario.action) await performAction(window.webContents, scenario.action)
    await waitFor(window.webContents, `document.querySelector(${JSON.stringify(scenario.ready)})`)
    const assertGeneratedViewport = async () => {
      const state = await window.webContents.executeJavaScript(
        `(() => {
          const setup = document.querySelector('.generatedWalletSetup')
          if (!setup) return null
          const viewport = setup.querySelector('.addAccountItemOption')
          const frames = [...setup.querySelectorAll('.generatedWalletFrame')]
          if (frames.length === 0) return null
          const activeFrames = frames.filter((frame) => frame.getAttribute('aria-hidden') === 'false')
          // Password setup precedes secret generation, so every secret frame is
          // intentionally inactive in that state.
          if (activeFrames.length === 0) return null
          return {
            scrollLeft: viewport?.scrollLeft ?? -1,
            active: activeFrames.length,
            renderedInactive: frames.filter(
              (frame) => frame.getAttribute('aria-hidden') === 'true' && frame.getClientRects().length > 0
            ).length
          }
        })()`,
        true
      )
      if (state && (state.scrollLeft !== 0 || state.active !== 1 || state.renderedInactive !== 0)) {
        throw new Error(`Generated-wallet viewport is unstable: ${JSON.stringify(state)}`)
      }
    }
    await assertGeneratedViewport()
    await new Promise((resolve) => setTimeout(resolve, 900))
    await assertGeneratedViewport()

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
    if (captureAll || audit.violations.length) {
      if (captureAll) {
        await window.webContents.executeJavaScript(
          `if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          for (const element of [document.scrollingElement, ...document.querySelectorAll('*')]) {
            if (element) {
              element.scrollTop = 0
              element.scrollLeft = 0
            }
          }`,
          true
        )
        if (scenario.captureScroll === 'bottom') {
          await window.webContents.executeJavaScript(
            `(() => {
              const element = document.querySelector(${JSON.stringify(scenario.captureScrollSelector)})
              if (!element) throw new Error('Capture scroll target was not found')
              element.scrollTop = element.scrollHeight
            })()`,
            true
          )
        } else if (scenario.captureScroll === 'target') {
          await window.webContents.executeJavaScript(
            `(() => {
              const element = document.querySelector(${JSON.stringify(scenario.captureScrollSelector)})
              if (!element) throw new Error('Capture scroll target was not found')
              element.scrollIntoView({ block: 'start', inline: 'nearest' })
              const offset = ${JSON.stringify(scenario.captureScrollOffset || 0)}
              const scroll = element.closest('.dashMainScroll') || document.scrollingElement
              if (scroll && offset) scroll.scrollTop += offset
            })()`,
            true
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
        window.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      screenshot = path.join(screenshotRoot, `${scenario.id}.png`)
      const image = await window.capturePage(undefined, { stayAwake: true })
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
  ipcMain.handle('profile:inspectBackup', (event) => {
    const scenario = scenarioByWebContents.get(event.sender.id)
    const reply = scenario ? invokeReplyFor(scenario, 'profile:inspectBackup') : undefined
    if (reply === undefined) throw new Error('Qualification harness does not provide profile:inspectBackup')
    return reply
  })
  ipcMain.handle('inspector:inspect', (event, ...args) => {
    const scenario = scenarioByWebContents.get(event.sender.id)
    const reply = scenario ? invokeReplyFor(scenario, 'inspector:inspect', args) : undefined
    if (reply === undefined) throw new Error('Qualification harness does not provide inspector:inspect')
    return reply
  })
  for (const channel of QUALIFICATION_INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event, ...args) => {
      const scenario = scenarioByWebContents.get(event.sender.id)
      const cacheOnlyCatalog = channel === 'yearn:getCatalog' && args[0]?.cacheOnly === true
      if (scenario?.deferInvokes?.includes(channel) && !cacheOnlyCatalog) {
        return new Promise(() => {})
      }
      const reply = scenario ? invokeReplyFor(scenario, channel, args) : undefined
      if (reply === undefined) throw new Error(`Qualification harness does not provide ${channel}`)
      return reply
    })
  }

  const localFileProbe = await runLocalFileSelfTest()
  const isolationProbe = await runIsolationSelfTest()
  const scenarios = scenarioMatrix({ includeReview: captureAll || selectedScenarioIds.size > 0 })
  if (selectedScenarioIds.size) {
    const knownIds = new Set(scenarios.map((scenario) => scenario.id))
    const unknownIds = [...selectedScenarioIds].filter((id) => !knownIds.has(id))
    if (unknownIds.length) throw new Error(`Unknown UI qualification scenarios: ${unknownIds.join(', ')}`)
  }
  const selectedScenarios = selectedScenarioIds.size
    ? scenarios.filter((scenario) => selectedScenarioIds.has(scenario.id))
    : scenarios
  const results = []
  for (const scenario of selectedScenarios) results.push(await runScenario(scenario))

  const report = {
    covered: {
      renderers: ['tray', 'dash', 'onboard'],
      states: [
        'empty account tray',
        'control center dashboard',
        'selected account network and gas module',
        'site network-change consent review',
        'selected software account delegation',
        'custom-token management',
        'account-scoped connected-app guardrail editor',
        'guardrail source identity, confirmation, busy, and refused-save states',
        'contract source verification form, immutable evidence, public consent, result, and credential states',
        'confirmed managed-deployment verification handoff',
        'delegation revocation review',
        'ambiguous delegation revocation monitoring',
        'onboarding intro',
        'onboarding access'
      ],
      geometry: ['full shell', 'short shell', 'capped-width fallback', 'onboarding window'],
      scales: [1, 1.25, 1.5]
    },
    uncovered: [
      'Request, transaction, and account variants beyond the controlled fixtures remain outside this deterministic matrix.',
      'Live hardware transports, provider requests, and live network content are intentionally excluded.',
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
