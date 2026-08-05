import { BaseWindow, BaseWindowConstructorOptions, screen as electronScreen } from 'electron'
import log from 'electron-log'

import type { GlideEdge } from './shellGeometry'

type Display = {
  workArea: { x: number; y: number; width: number; height: number }
}

type Screen = {
  getAllDisplays(): Display[]
}

type EdgeWindow = {
  destroy(): void
  isDestroyed(): boolean
  setVisibleOnAllWorkspaces(visible: boolean, options: { visibleOnFullScreen: boolean }): void
  showInactive(): void
}

type CreateEdgeWindow = (options: BaseWindowConstructorOptions) => EdgeWindow

const edgeWidth = 2
const verticalMargin = 5
const supportsEdgeSentinel =
  process.platform === 'linux' &&
  Boolean(process.env['DISPLAY']) &&
  process.env['XDG_SESSION_TYPE'] !== 'wayland'

export class GlideSentinel {
  private active = false
  private edge: GlideEdge = 'right'
  private windows: EdgeWindow[] = []

  constructor(
    private readonly screen: Screen = electronScreen,
    private readonly createWindow: CreateEdgeWindow = (options) => new BaseWindow(options),
    private readonly supported = supportsEdgeSentinel,
    private readonly reportError: (error: unknown) => void = (error) =>
      log.warn('Could not start Glide edge sentinel', error)
  ) {}

  setEdge(edge: GlideEdge) {
    if (edge === this.edge) return
    this.edge = edge
    this.refresh()
  }

  start() {
    if (this.active || !this.supported) return

    this.active = true
    this.rebuild()
  }

  private rebuild() {
    this.destroyWindows()
    try {
      for (const { workArea } of this.screen.getAllDisplays()) {
        if (workArea.width < edgeWidth || workArea.height <= verticalMargin * 2) continue

        const window = this.createWindow({
          x: this.edge === 'right' ? workArea.x + workArea.width - edgeWidth : workArea.x,
          y: workArea.y + verticalMargin,
          width: edgeWidth,
          height: workArea.height - verticalMargin * 2,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#01000000',
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          resizable: false,
          movable: false,
          hasShadow: false
        })
        this.windows.push(window)
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        window.showInactive()
      }
    } catch (error) {
      this.destroyWindows()
      this.reportError(error)
    }
  }

  private destroyWindows() {
    const windows = this.windows
    this.windows = []
    windows.forEach((window) => {
      if (!window.isDestroyed()) window.destroy()
    })
  }

  stop() {
    this.active = false
    this.destroyWindows()
  }

  refresh() {
    if (!this.active) return
    this.rebuild()
  }
}
