'use strict'

const fs = require('node:fs/promises')
const { lstatSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const exit = (child) =>
  new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })

const renderAssets = async (jobs, outputRoot) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wren-brand-'))
  await fs.chmod(root, 0o700)
  const children = new Set()
  let cancelled = false
  let forceStop
  const stop = () => {
    cancelled = true
    for (const child of children) child.kill('SIGTERM')
    clearTimeout(forceStop)
    forceStop = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL')
    }, 2000)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let timer
  try {
    for (const name of ['home', 'config', 'data', 'cache', 'profile', 'tmp']) {
      await fs.mkdir(path.join(root, name), { mode: 0o700 })
    }
    const manifest = path.join(root, 'jobs.json')
    await fs.writeFile(manifest, JSON.stringify({ outputRoot, jobs }), { mode: 0o600 })
    let display = process.env.DISPLAY
    if (process.platform === 'linux') {
      const xvfb = spawn(
        'Xvfb',
        ['-displayfd', '3', '-screen', '0', '2400x2000x24', '-nolisten', 'tcp', '-noreset'],
        {
          stdio: ['ignore', 'ignore', 'ignore', 'pipe']
        }
      )
      children.add(xvfb)
      display = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Xvfb startup timed out')), 5000)
        xvfb.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        xvfb.once('exit', () => {
          clearTimeout(timeout)
          reject(new Error('Xvfb exited before rendering'))
        })
        let address = ''
        xvfb.stdio[3].on('data', (chunk) => {
          address += chunk.toString()
          const match = address.match(/^(\d+)\s*\n/u)
          if (!match) return
          clearTimeout(timeout)
          resolve(':' + match[1])
        })
      })
    }
    const env = {
      ...process.env,
      DISPLAY: display,
      WAYLAND_DISPLAY: '',
      HOME: path.join(root, 'home'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      TMPDIR: path.join(root, 'tmp'),
      WREN_BRAND_RENDER_ROOT: root,
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: ''
    }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron'), ['--no-sandbox', __filename], {
      env,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    children.add(child)
    let errors = ''
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk.toString()).slice(-4000)
    })
    timer = setTimeout(stop, 60000)
    if ((await exit(child)) !== 0 || cancelled) throw new Error('Brand rendering failed: ' + errors)
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      child.kill('SIGTERM')
      await Promise.race([exit(child), new Promise((resolve) => setTimeout(resolve, 1000))])
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    clearTimeout(forceStop)
    await fs.rm(root, { recursive: true, force: true })
  }
}

const runElectron = async () => {
  const { app, BrowserWindow, session } = require('electron')
  const root = process.env.WREN_BRAND_RENDER_ROOT
  const manifest = root && path.join(root, 'jobs.json')
  if (
    !root ||
    !manifest ||
    path.dirname(path.resolve(manifest)) !== root ||
    !lstatSync(root).isDirectory() ||
    lstatSync(root).isSymbolicLink() ||
    (lstatSync(root).mode & 0o777) !== 0o700
  ) {
    throw new Error('Brand rendering requires a private temporary profile')
  }
  app.setPath('userData', path.join(root, 'profile'))
  app.setPath('temp', path.join(root, 'tmp'))
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  app.commandLine.appendSwitch('force-color-profile', 'srgb')
  app.commandLine.appendSwitch('disable-background-networking')
  app.commandLine.appendSwitch('disable-component-update')
  app.commandLine.appendSwitch('disable-default-apps')
  app.on('window-all-closed', () => {})
  await app.whenReady()
  const isolated = session.fromPartition('brand-render')
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] },
    (_details, callback) => callback({ cancel: true })
  )
  const { jobs, outputRoot } = JSON.parse(await fs.readFile(manifest, 'utf8'))
  if (!Array.isArray(jobs) || !path.isAbsolute(outputRoot)) throw new Error('Invalid rendering manifest')
  for (const { html, outputPath, width, height, fullPage } of jobs) {
    if (
      typeof html !== 'string' ||
      html.length > 16 * 1024 * 1024 ||
      !path.resolve(outputPath).startsWith(path.resolve(outputRoot) + path.sep) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 4096 ||
      height > 4096
    )
      throw new Error('Invalid asset output')
    const window = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        session: isolated,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    try {
      await window.loadURL('about:blank')
      await window.webContents.executeJavaScript(`(async () => {
        document.open(); document.write(${JSON.stringify(html)}); document.close();
        await Promise.all([...document.images].map(image => image.decode()));
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`)
      if (fullPage) {
        const fullHeight = await window.webContents.executeJavaScript(
          'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight)'
        )
        window.setContentSize(width, fullHeight)
      }
      const image = await window.webContents.capturePage(undefined, { stayAwake: true })
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, image.toPNG())
    } finally {
      window.destroy()
    }
  }
  app.quit()
}

if (process.versions.electron)
  runElectron().catch((error) => {
    console.error(error.message)
    require('electron').app.exit(1)
  })
else module.exports = renderAssets
