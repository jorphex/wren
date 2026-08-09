import log from 'electron-log'

import { FrameInstance } from './frameInstances'
import store from '../../store'
import { requireStoreAction } from '../../store/action'
import server from '../../dapps/server'
import { createViewInstance } from '../window'
import { embeddedDappOrigin, extractDappSession, loadDappView } from '../dappView'

export { embeddedDappOrigin }

export default {
  // Create a view instance on a frame
  create: (frameInstance: FrameInstance, view: ViewMetadata) => {
    const { frameId } = frameInstance
    if (!frameId) throw new Error('Frame instance has no state id')
    const frame = store('main.frames', frameId)
    if (!frame) throw new Error(`Frame ${frameId} is unavailable while creating a view`)

    const viewInstance = createViewInstance(view.ens)

    const fullscreen = !!frame.fullscreen

    const { width, height } = frameInstance.getBounds()

    frameInstance.contentView.addChildView(viewInstance)

    const dappBackground = store('main.dapps', view.dappId, 'colors', 'background')
    if (dappBackground) frameInstance.setBackgroundColor(dappBackground)

    viewInstance.setBounds({
      x: 0,
      y: fullscreen ? 0 : 32,
      width: width,
      height: fullscreen ? height : height - 32
    })

    viewInstance.webContents.setVisualZoomLevelLimits(1, 3)

    frameInstance.contentView.removeChildView(viewInstance)

    // viewInstance.webContents.openDevTools({ mode: 'detach' })

    loadDappView(viewInstance, view, () => {
      requireStoreAction('updateFrameView')(frameId, view.id, { ready: true })
    }).catch((error) => log.error(error))

    // Keep reference to view on frame instance
    frameInstance.views = { ...(frameInstance.views || {}), [view.id]: viewInstance }
  },
  // Destroy a view instance on a frame
  destroy: (frameInstance: FrameInstance, viewId: string) => {
    const views = frameInstance.views || {}
    const { frameId } = frameInstance

    const viewMetadata = frameId ? store('main.frames', frameId, 'views', viewId) : undefined
    if (viewMetadata) {
      const { ens, session } = extractDappSession(viewMetadata.url)
      server.sessions.remove(ens, session)
    }

    const view = views[viewId]
    if (!view) return

    if (frameInstance && !frameInstance.isDestroyed()) {
      frameInstance.contentView.removeChildView(view)
    }

    view.webContents.close({ waitForBeforeUnload: false })

    delete views[viewId]
  },
  position: (frameInstance: FrameInstance, viewId: string) => {
    const { frameId } = frameInstance
    if (!frameId) return
    const frame = store('main.frames', frameId)
    if (!frame) return
    const fullscreen = !!frame.fullscreen
    const viewInstance = (frameInstance.views || {})[viewId]
    if (viewInstance) {
      const { width, height } = frameInstance.getBounds()
      viewInstance.setBounds({
        x: 0,
        y: fullscreen ? 0 : 32,
        width: width,
        height: fullscreen ? height : height - 32
      })
      // viewInstance.setBounds({ x: 73, y: 16, width: width - 73, height: height - 16 })
    }
  }
}
