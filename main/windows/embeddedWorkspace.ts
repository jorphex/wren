import type { BrowserWindow, Rectangle, WebContentsView } from 'electron'

export class EmbeddedWorkspace {
  private visible = false
  private destroyed = false

  constructor(
    private readonly parent: BrowserWindow,
    private readonly view: WebContentsView
  ) {
    parent.contentView.addChildView(view)
    view.setVisible(false)
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
    this.view.setBounds(bounds)
    this.view.setVisible(showing)
    this.visible = showing
  }

  applyShellLayout(windowBounds: Rectangle, viewBounds: Rectangle, showing: boolean) {
    if (this.destroyed || this.parent.isDestroyed()) return
    this.parent.setBounds(windowBounds, false)
    this.applyLayout(viewBounds, showing)
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
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
    this.visible = false
  }
}
