import type { App, BrowserWindow, Rectangle, WebContentsView } from 'electron'

export class EmbeddedWorkspace {
  private visible = false
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
  }

  applyShellLayout(
    windowBounds: Rectangle,
    viewBounds: Rectangle,
    showing: boolean,
    animate = false,
    onComplete?: () => void
  ) {
    if (this.destroyed || this.parent.isDestroyed()) return
    if (animate) {
      this.animateShellLayout(windowBounds, viewBounds, showing, onComplete)
      return
    }
    this.parent.setBounds(windowBounds, false)
    this.applyLayout(viewBounds, showing)
    onComplete?.()
  }

  private animateShellLayout(
    windowBounds: Rectangle,
    viewBounds: Rectangle,
    showing: boolean,
    onComplete?: () => void
  ) {
    this.cancelAnimation()

    const startWindowBounds = this.parent.getBounds()
    const startViewBounds = this.viewBounds
    const frameCount = 10
    let frame = 0

    if (showing) {
      this.view.setVisible(true)
      this.visible = true
    }

    const interpolate = (start: number, end: number, progress: number) =>
      Math.round(start + (end - start) * progress)

    const advance = () => {
      if (this.destroyed || this.parent.isDestroyed()) return

      frame += 1
      const progress = frame / frameCount
      const easedProgress = 1 - Math.pow(1 - progress, 3)
      const nextWindowBounds = {
        x: interpolate(startWindowBounds.x, windowBounds.x, easedProgress),
        y: interpolate(startWindowBounds.y, windowBounds.y, easedProgress),
        width: interpolate(startWindowBounds.width, windowBounds.width, easedProgress),
        height: interpolate(startWindowBounds.height, windowBounds.height, easedProgress)
      }
      const nextViewBounds = {
        x: interpolate(startViewBounds.x, viewBounds.x, easedProgress),
        y: interpolate(startViewBounds.y, viewBounds.y, easedProgress),
        width: interpolate(startViewBounds.width, viewBounds.width, easedProgress),
        height: interpolate(startViewBounds.height, viewBounds.height, easedProgress)
      }

      this.parent.setBounds(nextWindowBounds, false)
      this.view.setBounds(nextViewBounds)
      this.viewBounds = nextViewBounds

      if (frame < frameCount) {
        this.animationTimer = setTimeout(advance, 18)
      } else {
        this.animationTimer = undefined
        this.visible = showing
        if (!showing) this.view.setVisible(false)
        onComplete?.()
      }
    }

    advance()
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
  }

  hide() {
    if (this.destroyed) return
    this.view.setVisible(false)
    this.visible = false
  }

  isVisible() {
    return this.visible
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
  }
}
