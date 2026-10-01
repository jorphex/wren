import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
  shell,
  WebContents,
  WebContentsView
} from 'electron'
import log from 'electron-log'
import path from 'path'

import store from '../store'

import type { ChainId } from '../store/state'
import { rendererRoleForWindow } from '../../resources/bridge/roles'
import type { ContractVerificationDestination } from '../../resources/domain/contractVerification'
import {
  WREN_COMPANION_RELEASES_URL,
  WREN_LICENSE_URL,
  WREN_SUPPORT_URL,
  LEDGER_SHOP_URL,
  TREZOR_SHOP_URL
} from '../../resources/constants'
import { onRenderer, registerRendererRole } from '../ipc/renderer'

// Reload only the requesting wallet view; keep navigation policy unchanged.
onRenderer('tray:reload', (event) => {
  if (!event.sender.isDestroyed()) event.sender.reload()
})

const hardenedSessions = new WeakSet<Session>()

function denySessionPermissions(session: Session) {
  if (hardenedSessions.has(session)) return
  hardenedSessions.add(session)
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  session.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }))
  session.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  session.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  session.on('select-serial-port', (event, _ports, _webContents, callback) => {
    event.preventDefault()
    callback('')
  })
}

function denyDeviceSelection(webContents: WebContents) {
  webContents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault()
    callback('')
  })
}

export function createWindow(
  name: string,
  opts?: BrowserWindowConstructorOptions,
  webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {}
) {
  log.verbose(`Creating ${name} window`)
  const rendererRole = rendererRoleForWindow(name)

  const isShellWindow = name === 'tray'
  const browserWindow = new BrowserWindow({
    ...opts,
    frame: false,
    ...(process.platform === 'linux' ? { roundedCorners: false } : {}),
    acceptFirstMouse: true,
    transparent: process.platform === 'darwin' || isShellWindow,
    show: false,
    backgroundColor: isShellWindow
      ? '#00000000'
      : store('main.colorwayPrimary', store('main.colorway'), 'background'),
    skipTaskbar: process.platform !== 'linux',
    webPreferences: {
      ...webPreferences,
      additionalArguments: [
        ...(webPreferences?.additionalArguments || []),
        `--frame-renderer-role=${rendererRole}`
      ],
      preload: path.resolve(process.env.BUNDLE_LOCATION, 'bridge.js'),
      backgroundThrottling: false, // Allows repaint when window is hidden
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
      defaultEncoding: 'utf-8',
      nodeIntegration: false,
      scrollBounce: true,
      navigateOnDragDrop: false,
      disableBlinkFeatures: 'Auxclick'
    }
  })
  registerRendererRole(browserWindow.webContents, rendererRole)
  denySessionPermissions(browserWindow.webContents.session)
  denyDeviceSelection(browserWindow.webContents)

  browserWindow.webContents.once('did-finish-load', () => {
    log.info(`Created ${name} renderer process, pid:`, browserWindow.webContents.getOSProcessId())
  })
  browserWindow.webContents.on('will-navigate', (e) => e.preventDefault()) // Prevent navigation
  browserWindow.webContents.on('will-attach-webview', (e) => e.preventDefault()) // Prevent attaching <webview>
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' })) // Prevent new windows

  if (isShellWindow) installTrayRecovery(browserWindow)
  return browserWindow
}

function installTrayRecovery(window: BrowserWindow) {
  const contents = window.webContents
  let timer: ReturnType<typeof setTimeout> | undefined
  let unresponsiveTimer: ReturnType<typeof setTimeout> | undefined
  let recoveryReason: string | undefined
  let attempts = 0
  let lastRecovery = 0
  const cancelUnresponsive = () => {
    clearTimeout(unresponsiveTimer)
    unresponsiveTimer = undefined
  }
  const recover = (reason: string) => {
    if (window.isDestroyed() || contents.isDestroyed()) return
    if (timer) {
      if (reason === 'render-process-gone') recoveryReason = reason
      return
    }
    if (Date.now() - lastRecovery >= 60_000) attempts = 0
    if (attempts >= 2) return
    recoveryReason = reason
    log.warn('Wallet renderer recovery', { reason })
    timer = setTimeout(() => {
      timer = undefined
      if (window.isDestroyed() || contents.isDestroyed()) return
      attempts += 1
      lastRecovery = Date.now()
      // Reload only the view. Transaction execution stays in the main process.
      contents.reload()
    }, 500)
  }
  contents.on('render-process-gone', () => recover('render-process-gone'))
  contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) recover('load-failed')
  })
  contents.on('unresponsive', () => {
    if (unresponsiveTimer) return
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = undefined
      recover('unresponsive')
    }, 3000)
  })
  contents.on('responsive', () => {
    cancelUnresponsive()
    if (recoveryReason === 'unresponsive') {
      clearTimeout(timer)
      timer = undefined
      recoveryReason = undefined
    }
  })
  contents.on('did-finish-load', () => {
    cancelUnresponsive()
    clearTimeout(timer)
    timer = undefined
  })
  window.on('closed', () => {
    clearTimeout(timer)
    cancelUnresponsive()
  })
}

export function restoreWindow(browserWindow: BrowserWindow) {
  if (browserWindow.isFullScreen()) {
    browserWindow.setFullScreen(false)
  } else {
    browserWindow.unmaximize()
  }
}

export function createRendererView(
  name: string,
  webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {}
) {
  log.verbose(`Creating ${name} renderer view`)
  const rendererRole = rendererRoleForWindow(name)
  const rendererView = new WebContentsView({
    webPreferences: {
      ...webPreferences,
      additionalArguments: [
        ...(webPreferences?.additionalArguments || []),
        `--frame-renderer-role=${rendererRole}`
      ],
      preload: path.resolve(process.env.BUNDLE_LOCATION, 'bridge.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
      defaultEncoding: 'utf-8',
      nodeIntegration: false,
      scrollBounce: true,
      navigateOnDragDrop: false,
      disableBlinkFeatures: 'Auxclick'
    }
  })
  registerRendererRole(rendererView.webContents, rendererRole)
  denySessionPermissions(rendererView.webContents.session)
  denyDeviceSelection(rendererView.webContents)

  const backgroundColor = store('main.colorwayPrimary', store('main.colorway'), 'background')
  rendererView.setBackgroundColor(backgroundColor || '#0b0f0d')
  rendererView.webContents.on('will-navigate', (event) => event.preventDefault())
  rendererView.webContents.on('will-attach-webview', (event) => event.preventDefault())
  rendererView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return rendererView
}

export function createViewInstance(
  ens = '',
  webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {}
) {
  const viewInstance = new WebContentsView({
    webPreferences: {
      ...webPreferences,
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
      defaultEncoding: 'utf-8',
      nodeIntegration: false,
      scrollBounce: true,
      navigateOnDragDrop: false,
      disableBlinkFeatures: 'Auxclick',
      preload: path.resolve(__dirname, 'viewPreload.js'),
      partition: `persist:${ens}`
    }
  })
  viewInstance.setBackgroundColor('#00000000')
  denySessionPermissions(viewInstance.webContents.session)
  denyDeviceSelection(viewInstance.webContents)

  viewInstance.webContents.on('will-navigate', (e) => e.preventDefault())
  viewInstance.webContents.on('will-attach-webview', (e) => e.preventDefault())
  viewInstance.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return viewInstance
}

const externalWhitelist = [
  'https://yearn.fi',
  WREN_COMPANION_RELEASES_URL,
  WREN_LICENSE_URL,
  WREN_SUPPORT_URL,
  LEDGER_SHOP_URL,
  TREZOR_SHOP_URL,
  'https://opensea.io'
]

const isValidReleasePage = (url: string) => url.startsWith('https://github.com/jorphex/wren/releases/tag/')
const isWhitelistedHost = (url: string) =>
  externalWhitelist.some((entry) => url === entry || url.startsWith(entry + '/'))

const contractVerificationResultHosts: Readonly<
  Partial<Record<ContractVerificationDestination, readonly string[]>>
> = Object.freeze({
  sourcify: Object.freeze(['sourcify.dev']),
  'etherscan-forwarded': Object.freeze([
    'etherscan.io',
    'etherscan.com',
    'arbiscan.io',
    'basescan.org',
    'bscscan.com',
    'celoscan.io',
    'ftmscan.com',
    'lineascan.build',
    'polygonscan.com',
    'snowtrace.io',
    'scrollscan.com'
  ]),
  'blockscout-forwarded': Object.freeze(['blockscout.com']),
  'routescan-forwarded': Object.freeze(['routescan.io']),
  'etherscan-direct': Object.freeze([
    'etherscan.io',
    'etherscan.com',
    'arbiscan.io',
    'basescan.org',
    'bscscan.com',
    'celoscan.io',
    'ftmscan.com',
    'lineascan.build',
    'polygonscan.com',
    'snowtrace.io',
    'scrollscan.com'
  ])
})

export function openContractVerificationResult(
  destination: ContractVerificationDestination,
  value: string
): boolean {
  const hosts = contractVerificationResultHosts[destination]
  if (!hosts || typeof value !== 'string' || value.length > 2_048) return false
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    ) {
      return false
    }
    void Promise.resolve(shell.openExternal(url.toString())).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

export function openExternal(url = '') {
  if (isWhitelistedHost(url) || isValidReleasePage(url)) {
    shell.openExternal(url)
  }
}

export function openBlockExplorer({ id, type }: ChainId, hash?: string, account?: string) {
  const configuredExplorer = store('main.networks', type, id, 'explorer')
  if (typeof configuredExplorer !== 'string') return

  let explorerUrl: URL
  try {
    explorerUrl = new URL(configuredExplorer)
  } catch {
    return
  }
  if (
    (explorerUrl.protocol !== 'https:' && explorerUrl.protocol !== 'http:') ||
    explorerUrl.username ||
    explorerUrl.password
  ) {
    return
  }

  // Remove trailing slashes while preserving an explicitly configured base path.
  const explorer = configuredExplorer.replace(/\/+$/, '')

  if (explorer) {
    if (hash) {
      const hashPath = hash && `/tx/${hash}`
      shell.openExternal(`${explorer}${hashPath}`)
    } else if (account) {
      const accountPath = account && `/address/${account}`
      shell.openExternal(`${explorer}${accountPath}`)
    } else {
      shell.openExternal(`${explorer}`)
    }
  }
}
