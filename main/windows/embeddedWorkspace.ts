import type { App, BrowserWindow, Rectangle, WebContentsView } from 'electron'

export const shellTransitionDuration = 180
export const workspaceUnresponsiveRecoveryDelay = 3000
export const workspaceRecoveryAttemptLimit = 2

type RecoveryReason = 'reload-requested' | 'render-process-gone' | 'unresponsive' | 'load-failed'

type EmbeddedWorkspaceRecoveryOptions = {
  beforeReload?: () => void
  unresponsiveDelay?: number
}

export class EmbeddedWorkspace {
  private visible = false
  private targetVisible = false
  private destroyed = false
  private viewBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private animationTimer: ReturnType<typeof setTimeout> | undefined
  private unresponsiveTimer: ReturnType<typeof setTimeout> | undefined
  private loaded = false
  private recoveryPending = false
  private recoveryStarted = false
  private recoveryAttempts = 0
  private recoveryReason: RecoveryReason | undefined
  private readonly loadedHandlers = new Set<() => void>()
  private readonly shutdownHandler = () => this.destroy()
  private readonly didFinishLoadHandler = () => this.finishLoad()
  private readonly didFailLoadHandler = (
    _event: unknown,
    errorCode: number,
    _errorDescription: string,
    _validatedURL: string,
    isMainFrame = true
  ) => {
    if (isMainFrame && errorCode !== -3) this.requestRecovery('load-failed')
  }
  private readonly renderProcessGoneHandler = () => this.requestRecovery('render-process-gone')
  private readonly unresponsiveHandler = () => this.startUnresponsiveTimer()
  private readonly responsiveHandler = () => this.cancelUnresponsiveRecovery()

  constructor(
    private readonly parent: BrowserWindow,
    private readonly view: WebContentsView,
    private readonly app?: Pick<App, 'off' | 'once'>,
    private readonly recoveryOptions: EmbeddedWorkspaceRecoveryOptions = {}
  ) {
    parent.contentView.addChildView(view)
    view.setVisible(false)
    view.webContents.on('did-finish-load', this.didFinishLoadHandler)
    view.webContents.on('did-fail-load', this.didFailLoadHandler)
    view.webContents.on('render-process-gone', this.renderProcessGoneHandler)
    view.webContents.on('unresponsive', this.unresponsiveHandler)
    view.webContents.on('responsive', this.responsiveHandler)
    app?.once('before-quit', this.shutdownHandler)
  }

  loadURL(url: string) {
    return this.view.webContents.loadURL(url)
  }

  onLoaded(handler: () => void) {
    this.loadedHandlers.add(handler)
  }

  setZoomFactor(scale: number) {
    if (!this.destroyed && !this.view.webContents.isDestroyed()) {
      this.view.webContents.setZoomFactor(scale)
    }
  }

  processId() {
    if (this.destroyed || this.view.webContents.isDestroyed()) return null
    return this.view.webContents.getOSProcessId()
  }

  applyLayout(bounds: Rectangle, showing: boolean) {
    if (this.destroyed) return
    this.cancelAnimation()
    this.view.setBounds(bounds)
    const effectiveShowing = this.effectiveShowing(showing)
    this.view.setVisible(effectiveShowing)
    this.viewBounds = bounds
    this.visible = effectiveShowing
    this.targetVisible = showing
    if (!showing) this.recoverWhenHidden(true)
  }

  applyShellLayout(
    windowBounds: Rectangle,
    mainBounds: Rectangle,
    viewBounds: Rectangle,
    showing: boolean,
    animate = false,
    onComplete?: () => void
  ) {
    if (this.destroyed || this.parent.isDestroyed()) return
    if (animate) {
      this.animateShellLayout(windowBounds, mainBounds, viewBounds, showing, onComplete)
      return
    }
    this.applyWindowBounds(windowBounds)
    this.applyWindowShape(showing ? this.fullShape(windowBounds) : mainBounds)
    this.applyLayout(viewBounds, showing)
    onComplete?.()
  }

  private animateShellLayout(
    windowBounds: Rectangle,
    mainBounds: Rectangle,
    viewBounds: Rectangle,
    showing: boolean,
    onComplete?: () => void
  ) {
    this.cancelAnimation()
    this.targetVisible = showing

    if (showing && !this.canShow()) {
      this.applyWindowBounds(windowBounds)
      this.applyWindowShape(this.fullShape(windowBounds))
      this.view.setBounds(viewBounds)
      this.viewBounds = viewBounds
      if (!this.visible) this.view.setVisible(false)
      onComplete?.()
      return
    }

    if (showing) {
      this.view.setVisible(false)
      this.visible = false
      this.applyWindowBounds(windowBounds)
      this.applyWindowShape(this.fullShape(windowBounds))
      this.view.setBounds(viewBounds)
      this.viewBounds = viewBounds
    }

    this.animationTimer = setTimeout(() => {
      if (this.destroyed || this.parent.isDestroyed()) return

      if (!showing) {
        this.view.setVisible(false)
        this.visible = false
        this.applyWindowBounds(windowBounds)
        this.applyWindowShape(mainBounds)
        this.view.setBounds(viewBounds)
        this.viewBounds = viewBounds
      }
      this.animationTimer = undefined
      if (showing) {
        this.visible = true
        this.view.setVisible(true)
      }
      onComplete?.()
      if (!showing) this.recoverWhenHidden(true)
    }, shellTransitionDuration)
  }

  private applyWindowBounds(bounds: Rectangle) {
    const current = this.parent.getBounds()
    if (
      current.x !== bounds.x ||
      current.y !== bounds.y ||
      current.width !== bounds.width ||
      current.height !== bounds.height
    ) {
      this.parent.setBounds(bounds, false)
    }
  }

  private applyWindowShape(bounds: Rectangle) {
    if (process.platform === 'linux') this.parent.setShape([bounds])
  }

  private fullShape(bounds: Rectangle): Rectangle {
    return { x: 0, y: 0, width: bounds.width, height: bounds.height }
  }

  private cancelAnimation() {
    if (this.animationTimer) clearTimeout(this.animationTimer)
    this.animationTimer = undefined
  }

  show() {
    if (this.destroyed) return
    this.targetVisible = true
    if (!this.canShow()) return
    this.view.setVisible(true)
    this.view.webContents.focus()
    this.visible = true
  }

  hide() {
    if (this.destroyed) return
    this.view.setVisible(false)
    this.visible = false
    this.targetVisible = false
    this.recoverWhenHidden(true)
  }

  isVisible() {
    return this.visible
  }

  isSettled(showing: boolean) {
    return this.animationTimer === undefined && this.visible === showing && this.targetVisible === showing
  }

  isTransitioningTo(showing: boolean) {
    return this.animationTimer !== undefined && this.targetVisible === showing
  }

  focus() {
    if (!this.destroyed && this.visible && !this.view.webContents.isDestroyed()) {
      this.view.webContents.focus()
    }
  }

  send(channel: string, ...args: string[]) {
    if (!this.destroyed && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send(channel, ...args)
    }
  }

  reload() {
    this.requestRecovery('reload-requested')
  }

  openDevTools() {
    if (!this.destroyed && !this.view.webContents.isDestroyed()) {
      this.view.webContents.openDevTools({ mode: 'detach' })
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.cancelAnimation()
    this.cancelUnresponsiveTimer()
    this.app?.off('before-quit', this.shutdownHandler)
    this.view.webContents.off('did-finish-load', this.didFinishLoadHandler)
    this.view.webContents.off('did-fail-load', this.didFailLoadHandler)
    this.view.webContents.off('render-process-gone', this.renderProcessGoneHandler)
    this.view.webContents.off('unresponsive', this.unresponsiveHandler)
    this.view.webContents.off('responsive', this.responsiveHandler)
    this.loadedHandlers.clear()
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
    this.visible = false
    this.targetVisible = false
  }

  private canShow() {
    return this.loaded && !this.recoveryPending && !this.recoveryStarted
  }

  private effectiveShowing(showing: boolean) {
    if (!showing) return false
    if (this.canShow()) return true
    // Do not conceal a failed renderer until the user explicitly closes the dashboard.
    return this.visible && this.recoveryPending && !this.recoveryStarted
  }

  private finishLoad() {
    if (this.destroyed) return
    this.cancelUnresponsiveTimer()
    this.loaded = true
    this.recoveryPending = false
    this.recoveryStarted = false
    this.recoveryAttempts = 0
    this.recoveryReason = undefined
    for (const handler of this.loadedHandlers) handler()
  }

  private requestRecovery(reason: RecoveryReason) {
    if (this.destroyed) return
    if (this.recoveryStarted) {
      this.loaded = false
      this.recoveryPending = true
      this.recoveryStarted = false
      this.recoveryReason = reason
      this.recoverWhenHidden()
      return
    }
    if (this.recoveryPending) {
      if (reason === 'render-process-gone') this.recoveryReason = reason
      return
    }
    this.cancelUnresponsiveTimer()
    this.loaded = false
    this.recoveryPending = true
    this.recoveryReason = reason
    this.recoverWhenHidden()
  }

  private recoverWhenHidden(explicitRetry = false) {
    if (
      this.destroyed ||
      this.visible ||
      !this.recoveryPending ||
      this.recoveryStarted ||
      this.view.webContents.isDestroyed()
    ) {
      return
    }
    if (this.recoveryAttempts >= workspaceRecoveryAttemptLimit) {
      if (!explicitRetry) return
      this.recoveryAttempts = 0
    }
    this.recoveryStarted = true
    this.recoveryAttempts += 1
    this.recoveryOptions.beforeReload?.()
    if (!this.destroyed && !this.view.webContents.isDestroyed()) this.view.webContents.reload()
  }

  private startUnresponsiveTimer() {
    if (this.destroyed || this.recoveryPending || this.recoveryStarted || this.unresponsiveTimer) return
    this.unresponsiveTimer = setTimeout(() => {
      this.unresponsiveTimer = undefined
      this.requestRecovery('unresponsive')
    }, this.recoveryOptions.unresponsiveDelay ?? workspaceUnresponsiveRecoveryDelay)
  }

  private cancelUnresponsiveRecovery() {
    if (this.destroyed) return
    this.cancelUnresponsiveTimer()
    if (this.recoveryReason !== 'unresponsive' || this.recoveryStarted) return
    this.loaded = true
    this.recoveryPending = false
    this.recoveryReason = undefined
  }

  private cancelUnresponsiveTimer() {
    if (this.unresponsiveTimer) clearTimeout(this.unresponsiveTimer)
    this.unresponsiveTimer = undefined
  }
}
