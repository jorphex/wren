import type { App, BrowserWindow, Rectangle, WebContentsView } from 'electron'

export const shellTransitionDuration = 180

export class EmbeddedWorkspace {
  private visible = false
  private targetVisible = false
  private destroyed = false
  private viewBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private animationTimer: ReturnType<typeof setTimeout> | undefined
  private readonly shutdownHandler = () => this.destroy()

  constructor(
    private readonly parent: BrowserWindow,
    private readonly view: WebContentsView,
    private readonly app?: Pick<App, 'off' | 'once'>
  ) {
    parent.contentView.addChildView(view)
    view.setVisible(false)
    app?.once('before-quit', this.shutdownHandler)
  }

  loadURL(url: string) {
    return this.view.webContents.loadURL(url)
  }

  onLoaded(handler: () => void) {
    this.view.webContents.on('did-finish-load', handler)
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
    this.view.setVisible(showing)
    this.viewBounds = bounds
    this.visible = showing
    this.targetVisible = showing
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

    if (showing) {
      this.view.setVisible(false)
      this.visible = false
      this.applyWindowBounds(windowBounds)
      this.applyWindowShape(this.fullShape(windowBounds))
      this.view.setBounds(viewBounds)
      this.viewBounds = viewBounds
    } else {
      this.view.setVisible(false)
      this.visible = false
    }

    this.animationTimer = setTimeout(() => {
      if (this.destroyed || this.parent.isDestroyed()) return

      if (!showing) {
        this.applyWindowBounds(windowBounds)
        this.applyWindowShape(mainBounds)
        this.view.setBounds(viewBounds)
        this.viewBounds = viewBounds
      }
      this.animationTimer = undefined
      this.visible = showing
      if (showing) this.view.setVisible(true)
      onComplete?.()
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
    this.view.setVisible(true)
    this.view.webContents.focus()
    this.visible = true
    this.targetVisible = true
  }

  hide() {
    if (this.destroyed) return
    this.view.setVisible(false)
    this.visible = false
    this.targetVisible = false
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
    if (!this.destroyed && !this.view.webContents.isDestroyed()) this.view.webContents.reload()
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
    this.app?.off('before-quit', this.shutdownHandler)
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
    this.visible = false
    this.targetVisible = false
  }
}
