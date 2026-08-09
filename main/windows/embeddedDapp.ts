import type { App, BrowserWindow, Rectangle, WebContentsView } from 'electron'
import log from 'electron-log'

import server from '../dapps/server'
import { createViewInstance } from './window'
import { DappViewDescriptor, extractDappSession, loadDappView } from './dappView'

// Keep aligned with the Wren command bottom and `.dash .dashMain` top in the dashboard styles.
export const dashContentTop = 64

export class EmbeddedDapp {
  private readonly view: WebContentsView
  private ready = false
  private targetVisible = false
  private destroyed = false
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private readonly shutdownHandler = () => this.destroy()

  constructor(
    private readonly parent: BrowserWindow,
    private readonly descriptor: DappViewDescriptor,
    private readonly onReady?: () => void,
    private readonly app?: Pick<App, 'off' | 'once'>
  ) {
    this.view = createViewInstance(descriptor.ens)
    this.view.webContents.setVisualZoomLevelLimits(1, 3)
    this.parent.contentView.addChildView(this.view)
    this.view.setVisible(false)
    this.app?.once('before-quit', this.shutdownHandler)

    loadDappView(this.view, descriptor, () => {
      if (this.destroyed) return
      this.ready = true
      this.view.setBounds(this.bounds)
      this.view.setVisible(this.targetVisible)
      if (this.targetVisible) this.view.webContents.focus()
      this.onReady?.()
    }).catch((error) => log.error('Could not load embedded dapp', error))
  }

  applyLayout(workspace: Rectangle, showing: boolean, focus = false) {
    if (this.destroyed) return
    this.bounds = {
      x: workspace.x,
      y: workspace.y + dashContentTop,
      width: workspace.width,
      height: Math.max(0, workspace.height - dashContentTop)
    }
    this.targetVisible = showing
    this.view.setBounds(this.bounds)
    this.view.setVisible(this.ready && showing)
    if (this.ready && showing && focus) this.view.webContents.focus()
  }

  focus() {
    if (!this.destroyed && this.ready && this.targetVisible) this.view.webContents.focus()
  }

  matches(ens: string) {
    return !this.destroyed && this.descriptor.ens === ens
  }

  hide() {
    if (this.destroyed) return
    this.targetVisible = false
    this.view.setVisible(false)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.app?.off('before-quit', this.shutdownHandler)
    const { ens, session } = extractDappSession(this.descriptor.url)
    if (ens && session) server.sessions.remove(ens, session)
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close({ waitForBeforeUnload: false })
  }
}
