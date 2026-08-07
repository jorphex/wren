import {
  app as electronApp,
  BrowserWindow,
  screen,
  globalShortcut,
  systemPreferences,
  IpcMainEvent,
  WebContents
} from 'electron'
import path from 'path'
import log from 'electron-log'
import EventEmitter from 'events'
import { hexToInt } from '../../resources/utils'

import store from '../store'
import { requireStoreAction } from '../store/action'
import FrameManager from './frames'
import { installCloseToTray } from './closeToTray'
import { createRendererView, createWindow, restoreWindow } from './window'
import { EmbeddedWorkspace } from './embeddedWorkspace'
import { shouldAnimateShell, shouldSuppressRepeatedShow } from './displayTransition'
import { GlideDetector, shouldAutoHideGlide } from './glide'
import { GlideSentinel } from './glideSentinel'
import {
  getShellLayout,
  GlideEdge,
  ShellLayout,
  shellMainTargetWidth,
  shouldJoinWorkspace
} from './shellGeometry'
import { SystemTray, SystemTrayEventHandlers } from './systemTray'
import { registerShortcut } from '../keyboardShortcuts'
import { Shortcut } from '../store/state/types/shortcuts'
import { onRenderer, onceRenderer } from '../ipc/renderer'

type Windows = {
  tray?: BrowserWindow
  onboard?: BrowserWindow
  [key: string]: BrowserWindow | undefined
}

const events = new EventEmitter()
const frameManager = new FrameManager()
const isDev = process.env.NODE_ENV === 'development'
const devToolsEnabled = isDev || process.env['ENABLE_DEV_TOOLS'] === 'true'
const fullheight = !!process.env['FULL_HEIGHT']
const openedAtLogin =
  electronApp?.getLoginItemSettings() && electronApp.getLoginItemSettings().wasOpenedAtLogin
const windows: Windows = {}
const devHeight = 800
const shellBackgroundColor = '#090c0a'
const isWindows = process.platform === 'win32'
const isMacOS = process.platform === 'darwin'

let tray: Tray
let dash: Dash
let onboard: Onboard
let glideDetector: GlideDetector | undefined
let glideSentinel: GlideSentinel | undefined
let glide = false
let lifecycleObservers: Observer[] = []
let displayChangeHandler: (() => void) | undefined

const getGlideEdge = (): GlideEdge => (store('main.glideSide') === 'left' ? 'left' : 'right')

const getActiveShellLayout = (
  area: Electron.Rectangle,
  edge: GlideEdge,
  workspaceOpen: boolean
): ShellLayout => {
  const requested = getShellLayout(area, edge, workspaceOpen)
  if (process.platform !== 'linux' || requested.workspaceOverlaysMain) return requested
  return getShellLayout(area, edge, true)
}

const app = {
  hide: () => tray.hide(),
  show: () => tray.show(),
  toggle: () => {
    if (tray.isVisible()) app.hide()
    else app.show()
  }
}
const systemTrayEventHandlers: SystemTrayEventHandlers = {
  click: () => {
    if (isWindows) {
      app.toggle()
    }
  },
  clickHide: () => app.hide(),
  clickShow: () => app.show()
}
const systemTray = new SystemTray(systemTrayEventHandlers)
const getDisplaySummonShortcut = () => store('main.shortcuts.summon.enabled')

const center = (window: BrowserWindow) => {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const screenSize = area
  const [windowWidth, windowHeight] = window.getSize()
  if (windowWidth === undefined || windowHeight === undefined) {
    throw new Error('Window dimensions are unavailable')
  }
  return {
    x: Math.floor(screenSize.x + screenSize.width / 2 - windowWidth / 2),
    y: Math.floor(screenSize.y + screenSize.height / 2 - windowHeight / 2)
  }
}

const rendererUrl = (id: string) =>
  isDev
    ? new URL(`http://localhost:1234/${id}/index.dev.html`)
    : new URL(path.join(process.env.BUNDLE_LOCATION, `${id}.html`), 'file:')

function initWindow(id: string, opts: Electron.BrowserWindowConstructorOptions) {
  const window = createWindow(id, opts)
  windows[id] = window
  window.loadURL(rendererUrl(id).toString())
  return window
}

function initTrayWindow() {
  const trayOpts: Electron.BrowserWindowConstructorOptions = {
    width: shellMainTargetWidth,
    backgroundColor: shellBackgroundColor,
    icon: path.join(__dirname, './AppIcon.png')
  }
  if (isMacOS) {
    trayOpts.type = 'panel'
  }
  const trayWindow = initWindow('tray', trayOpts)

  installCloseToTray(electronApp, trayWindow, () => app.hide())

  trayWindow.on('closed', () => {
    if (windows.tray === trayWindow) delete windows.tray
  })
  trayWindow.setResizable(false)
  trayWindow.setMovable(false)

  const { width, height, x, y } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  trayWindow.setPosition(width + x, height + y)

  trayWindow.on('show', () => {
    if (process.platform === 'win32') {
      systemTray.closeContextMenu()
    }
    systemTray.setContextMenu('hide', { displaySummonShortcut: getDisplaySummonShortcut() })
  })
  trayWindow.on('hide', () => {
    if (process.platform === 'win32') {
      systemTray.closeContextMenu()
    }
    systemTray.setContextMenu('show', { displaySummonShortcut: getDisplaySummonShortcut() })
  })

  setTimeout(() => {
    if (trayWindow.isDestroyed()) return
    trayWindow.on('focus', () => {
      if (isMacOS) {
        glide = false
      }
      tray.show()
    })
  }, 2000)

  if (devToolsEnabled) {
    trayWindow.webContents.openDevTools()
  }

  setTimeout(() => {
    if (trayWindow.isDestroyed()) return
    trayWindow.on('blur', () => {
      setTimeout(() => {
        if (tray.canAutoHide()) {
          tray.hide()
        }
      }, 100)
    })
    trayWindow.focus()
  }, 1260)

  trayWindow.once('ready-to-show', () => {
    if (!openedAtLogin) {
      tray.show()
    }
  })
}

export class Tray {
  private recentDisplayEvent = false
  private recentDisplayEventTimeout?: NodeJS.Timeout
  private gasObserver: Observer
  private ready = false
  private readyHandler: () => void
  private removeReadyHandler: () => void

  constructor() {
    this.gasObserver = store.observer(() => {
      let title = ''
      if (store('platform') === 'darwin' && store('main.menubarGasPrice')) {
        const gasPrice = store('main.networksMeta.ethereum', 1, 'gas.price.levels.fast')
        if (!gasPrice) return
        const gasDisplay = Math.round(hexToInt(gasPrice) / 1000000000).toString()
        title = gasDisplay // ɢ 🄶 Ⓖ ᴳᵂᴱᴵ
      }
      systemTray.setTitle(title)
    })
    this.readyHandler = () => {
      const trayWindow = windows.tray
      if (!trayWindow || trayWindow.isDestroyed()) {
        log.error(new Error('Tray window is unavailable when the renderer becomes ready'))
        return
      }

      this.ready = true
      systemTray.init(trayWindow)
      const visible = trayWindow.isVisible()
      systemTray.setContextMenu(visible ? 'hide' : 'show', {
        displaySummonShortcut: getDisplaySummonShortcut()
      })
      requireStoreAction('trayOpen')(visible)
      if (!visible && store('main.reveal')) glideDetector?.start()

      const showOnboardingWindow = !store('main.mute.onboardingWindow')

      if (store('windows.dash.showing')) {
        setTimeout(() => {
          requireStoreAction('setDash')({ showing: true })
        }, 300)
      }

      if (showOnboardingWindow) {
        setTimeout(() => {
          requireStoreAction('setOnboard')({ showing: true })
        }, 600)
      }
    }
    this.removeReadyHandler = onceRenderer('tray:ready', this.readyHandler)
    initTrayWindow()
  }

  isReady() {
    return this.ready
  }

  isVisible() {
    return windows.tray?.isVisible() ?? false
  }

  canAutoHide() {
    const autoHideOn = !!store('main.autohide')
    const dashShowing = !!store('windows.dash.showing')
    const onboardShowing = !!store('windows.onboard.showing')
    const isFrameShowing = frameManager.isFrameShowing()

    log.debug(
      `%ccanAutoHide ${JSON.stringify({ autoHideOn, dashShowing, onboardShowing, isFrameShowing })}`,
      'color: blue'
    )

    return autoHideOn && !dashShowing && !onboardShowing && !isFrameShowing
  }

  hide() {
    if (this.recentDisplayEvent || !windows.tray?.isVisible()) {
      return
    }
    clearTimeout(this.recentDisplayEventTimeout)
    this.recentDisplayEvent = true
    this.recentDisplayEventTimeout = setTimeout(() => {
      this.recentDisplayEvent = false
    }, 150)

    requireStoreAction('trayOpen')(false)
    if (store('main.reveal')) {
      glideDetector?.start()
    } else {
      glideDetector?.stop()
    }
    windows.tray.hide()
    events.emit('tray:hide')
  }

  public show() {
    const trayWindow = windows.tray
    if (!trayWindow || trayWindow.isDestroyed()) {
      return init()
    }
    if (shouldSuppressRepeatedShow(this.recentDisplayEvent, trayWindow.isVisible())) {
      return
    }
    glideDetector?.stop()
    clearTimeout(this.recentDisplayEventTimeout)
    this.recentDisplayEvent = true
    this.recentDisplayEventTimeout = setTimeout(() => {
      this.recentDisplayEvent = false
    }, 150)

    if (isMacOS) {
      trayWindow.setPosition(0, 0)
    } else {
      trayWindow.setAlwaysOnTop(true)
    }
    trayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    trayWindow.setResizable(false)
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const layout = getActiveShellLayout(area, getGlideEdge(), !!store('windows.dash.showing'))
    if (dash) dash.applyLayout(layout)
    else trayWindow.setBounds(layout.window, false)
    requireStoreAction('trayOpen')(true)
    if (glide && isMacOS) {
      trayWindow.showInactive()
    } else {
      trayWindow.show()
    }
    events.emit('tray:show')
    if (!glide) {
      trayWindow.focus()
    }
    trayWindow.setVisibleOnAllWorkspaces(false, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
  }

  toggle() {
    if (!this.isReady()) return

    if (this.isVisible()) this.hide()
    else this.show()
  }

  reposition(animate = false, focusWorkspace = false) {
    const trayWindow = windows.tray
    if (!trayWindow || trayWindow.isDestroyed()) return

    const area = screen.getDisplayMatching(trayWindow.getBounds()).workArea
    const layout = getActiveShellLayout(area, getGlideEdge(), !!store('windows.dash.showing'))
    if (dash) dash.applyLayout(layout, animate, focusWorkspace)
    else trayWindow.setBounds(layout.window, false)
  }

  destroy() {
    clearTimeout(this.recentDisplayEventTimeout)
    this.gasObserver.remove()
    this.removeReadyHandler()
  }
}

class Dash {
  private readonly workspace: EmbeddedWorkspace

  constructor() {
    const trayWindow = windows.tray
    if (!trayWindow || trayWindow.isDestroyed()) {
      throw new Error('Tray window is unavailable while creating the workspace')
    }

    const workspaceView = createRendererView('dash')
    workspaceView.setBackgroundColor('#00000000')
    this.workspace = new EmbeddedWorkspace(trayWindow, workspaceView, electronApp)
    this.workspace.loadURL(rendererUrl('dash').toString())
    this.workspace.onLoaded(() => {
      const processId = this.workspace.processId()
      if (processId !== null) log.info('Created dash renderer view process, pid:', processId)
      tray.reposition()
    })
  }

  public applyLayout(layout: ShellLayout, animate = false, focusWhenShown = false) {
    const showing = !!store('windows.dash.showing')
    const joined = shouldJoinWorkspace(layout, showing, false)
    if (animate && showing) this.prepareWorkspaceContent()
    if (animate && !showing) this.concealWorkspaceContent()
    if (!animate) this.setShellJoined(joined)
    this.workspace.applyShellLayout(layout.window, layout.main, layout.workspace, showing, animate, () => {
      this.setShellJoined(joined)
      if (showing) this.revealWorkspaceContent()
      if (showing && focusWhenShown) this.workspace.focus()
    })
    if (animate) this.setShellJoined(shouldJoinWorkspace(layout, showing, true))
    this.workspace.send('main:flex', 'shellLayout', layout.workspaceOverlaysMain ? 'overlay' : 'adjacent')
  }

  private setShellJoined(joined: boolean) {
    const trayWindow = windows.tray
    if (!trayWindow || trayWindow.isDestroyed()) return
    trayWindow.webContents.send('main:flex', 'shellJoined', joined ? 'true' : 'false')
  }

  private revealWorkspaceContent() {
    this.workspace.send('main:flex', 'shellContent', 'reveal')
  }

  private prepareWorkspaceContent() {
    this.workspace.send('main:flex', 'shellContent', 'prepare')
  }

  private concealWorkspaceContent() {
    this.workspace.send('main:flex', 'shellContent', 'conceal')
  }

  public hide() {
    if (this.workspace.isTransitioningTo(false)) return
    tray.reposition(false)
    windows.tray?.webContents.focus()
  }

  public show() {
    if (!tray.isReady()) return
    if (this.workspace.isTransitioningTo(true)) return

    const currentlyVisible = tray.isVisible()
    const animate = shouldAnimateShell(
      currentlyVisible && !this.workspace.isSettled(true),
      systemPreferences.getAnimationSettings().prefersReducedMotion
    )
    if (!currentlyVisible) {
      tray.show()
    } else {
      tray.reposition(animate, true)
    }
    if (!animate) this.workspace.focus()
    if (devToolsEnabled) this.workspace.openDevTools()
  }

  isVisible() {
    return this.workspace.isVisible()
  }

  destroy() {
    this.workspace.destroy()
  }

  send(channel: string, ...args: string[]) {
    this.workspace.send(channel, ...args)
  }

  reload() {
    this.workspace.reload()
  }
}

class Onboard {
  constructor() {
    initWindow('onboard', {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 10, y: 9 },
      icon: path.join(__dirname, './AppIcon.png')
    })
  }

  public hide() {
    if (windows.onboard && windows.onboard.isVisible()) {
      windows.onboard.hide()
    }
  }

  public show() {
    if (!tray.isReady()) {
      return
    }

    const onboardWindow = windows.onboard
    if (!onboardWindow || onboardWindow.isDestroyed()) return

    const cleanupHandler = () => onboardWindow.off('close', closeHandler)

    const closeHandler = () => {
      requireStoreAction('completeOnboarding')()
      windows.tray?.focus()

      electronApp.off('before-quit', cleanupHandler)
      if (windows.onboard === onboardWindow) delete windows.onboard
    }

    setTimeout(() => {
      if (onboardWindow.isDestroyed()) return

      electronApp.on('before-quit', cleanupHandler)
      onboardWindow.once('close', closeHandler)

      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      const availableHeight = (isDev && !fullheight ? devHeight : area.height) - 48
      const artworkRatio = 900 / 506
      const width = Math.max(1, Math.floor(Math.min(720, area.width - 48, availableHeight * artworkRatio)))
      const height = Math.max(1, Math.round(width / artworkRatio))
      const minimumWidth = Math.min(560, width)
      onboardWindow.setMinimumSize(minimumWidth, Math.round(minimumWidth / artworkRatio))
      onboardWindow.setSize(width, height)
      onboardWindow.setResizable(false)
      const pos = center(onboardWindow)
      onboardWindow.setPosition(pos.x, pos.y)
      onboardWindow.show()
      onboardWindow.focus()
      onboardWindow.setVisibleOnAllWorkspaces(false, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
      if (devToolsEnabled) {
        onboardWindow.webContents.openDevTools()
      }
    }, 10)
  }
}

onRenderer('tray:quit', () => electronApp.quit())
onRenderer('tray:mouseout', () => {
  if (shouldAutoHideGlide(glide, !!store('main.autohide'), !!store('windows.dash.showing'))) {
    glide = false
    app.hide()
  }
})

// deny navigation, webview attachment & new windows on creation of webContents
// also set elsewhere but enforced globally here to minimize possible vectors of attack
// - in the case of e.g. dependency injection
// - as a 'to be sure' against possibility of misconfiguration in the future
electronApp.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault())
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

electronApp.on('ready', () => {
  frameManager.start()
})

if (isDev) {
  electronApp.once('ready', () => {
    globalShortcut.register('CommandOrControl+R', () => {
      Object.keys(windows).forEach((win) => {
        windows[win]?.reload()
      })
      dash?.reload()

      // frameManager.reloadFrames()
    })
  })
}

onRenderer('*:contextmenu', (e, x, y) => {
  if (isDev) {
    e.sender.inspectElement(x, y)
  }
})

const windowFromWebContents = (webContents: WebContents) =>
  BrowserWindow.fromWebContents(webContents) as BrowserWindow

const init = () => {
  glideDetector?.stop()
  glideSentinel?.stop()
  lifecycleObservers.forEach((observer) => observer.remove())
  lifecycleObservers = []
  if (displayChangeHandler) {
    screen.off('display-added', displayChangeHandler)
    screen.off('display-removed', displayChangeHandler)
    screen.off('display-metrics-changed', displayChangeHandler)
    displayChangeHandler = undefined
  }
  if (dash) {
    dash.destroy()
  }
  if (tray) {
    tray.destroy()
  }
  for (const id of ['tray']) {
    const window = windows[id]
    if (window && !window.isDestroyed()) window.destroy()
    delete windows[id]
  }

  tray = new Tray()
  dash = new Dash()
  glideSentinel = new GlideSentinel(screen)
  glideSentinel.setEdge(getGlideEdge())
  glideDetector = new GlideDetector(
    screen,
    () => store('main.reveal'),
    () => {
      glide = true
      app.show()
      if (tray.isVisible()) return true

      glide = false
      return false
    },
    glideSentinel,
    getGlideEdge
  )

  displayChangeHandler = () => {
    glideSentinel?.refresh()
    tray.reposition()
  }
  screen.on('display-added', displayChangeHandler)
  screen.on('display-removed', displayChangeHandler)
  screen.on('display-metrics-changed', displayChangeHandler)

  if (!store('main.mute.onboardingWindow') && (!windows.onboard || windows.onboard.isDestroyed())) {
    onboard = new Onboard()
  }

  // data change events
  lifecycleObservers.push(
    store.observer(() => {
      if (store('windows.dash.showing')) {
        dash.show()
      } else {
        dash.hide()
        windows.tray?.webContents.focus()
      }
    }, 'windows:dash')
  )

  lifecycleObservers.push(
    store.observer(() => {
      if (store('windows.onboard.showing')) {
        if (!windows.onboard) {
          onboard = new Onboard()
        }

        onboard.show()
      } else if (onboard) {
        onboard.hide()
        windows.tray?.focus()
      }
    }, 'windows:onboard')
  )

  lifecycleObservers.push(
    store.observer(() => {
      let summonShortcut: Shortcut = store('main.shortcuts.summon')
      const summonHandler = (accelerator: string) => {
        app.toggle()
        if (store('windows.onboard.showing')) {
          send('onboard', 'main:flex', 'shortcutActivated')
        }
        if (tray?.isReady()) {
          systemTray.setContextMenu(tray.isVisible() ? 'hide' : 'show', {
            displaySummonShortcut: summonShortcut.enabled,
            accelerator
          })
        }
      }

      registerShortcut(summonShortcut, summonHandler)
    })
  )

  let revealEnabled = store('main.reveal')
  let glideEdge = getGlideEdge()
  lifecycleObservers.push(
    store.observer(() => {
      const nextRevealEnabled = store('main.reveal')
      const nextGlideEdge = getGlideEdge()
      if (nextGlideEdge !== glideEdge) {
        glideEdge = nextGlideEdge
        glideSentinel?.setEdge(glideEdge)
        tray.reposition()
      }
      if (nextRevealEnabled === revealEnabled) return

      revealEnabled = nextRevealEnabled
      if (!revealEnabled) {
        glide = false
        glideDetector?.stop()
      } else if (!tray.isVisible()) {
        glideDetector?.start()
      }
    }, 'windows:glide')
  )
}

const send = (id: string, channel: string, ...args: string[]) => {
  if (id === 'dash') {
    dash?.send(channel, ...args)
    return
  }
  const window = windows[id]
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, ...args)
  } else {
    log.error(new Error(`A window with id "${id}" does not exist (windows.send)`))
  }
}

const broadcast = (channel: string, ...args: string[]) => {
  Object.keys(windows).forEach((id) => send(id, channel, ...args))
  dash?.send(channel, ...args)
  frameManager.broadcast(channel, args)
}

store.api.feed((_state, actions) => {
  broadcast('main:action', 'stateSync', JSON.stringify(actions))
})

export default {
  toggleTray() {
    tray.toggle()
  },
  showTray() {
    tray.show()
  },
  refocusFrame(frameId: string) {
    frameManager.refocus(frameId)
  },
  close(e: IpcMainEvent) {
    windowFromWebContents(e.sender).close()
  },
  max(e: IpcMainEvent) {
    windowFromWebContents(e.sender).maximize()
  },
  unmax(e: IpcMainEvent) {
    restoreWindow(windowFromWebContents(e.sender))
  },
  min(e: IpcMainEvent) {
    windowFromWebContents(e.sender).minimize()
  },
  init
}
