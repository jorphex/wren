import { ipcRenderer } from 'electron'
import rpc from './rpc'
import {
  BRIDGE_SOURCE,
  LINK_SOURCE,
  decodeBridgeMessage,
  encodeBridgeMessage,
  getRendererTargetOrigin,
  getRendererRole,
  isTrustedBridgeEvent
} from './protocol'

const safeOrigins =
  window.location.protocol === 'file:'
    ? ['null']
    : process.env.NODE_ENV === 'development'
      ? ['http://localhost:1234']
      : []
const targetOrigin = getRendererTargetOrigin(window.location)
const rendererRole = getRendererRole(process.argv)
const postToRenderer = (message) => window.postMessage(encodeBridgeMessage(message), targetOrigin)

window.addEventListener(
  'message',
  (e) => {
    if (!isTrustedBridgeEvent(e, window, safeOrigins)) return

    const data = decodeBridgeMessage(e.data, LINK_SOURCE, rendererRole)
    if (!data) return

    if (data.method === 'rpc') {
      return rpc(...data.args, (...args) =>
        postToRenderer({ method: 'rpc', id: data.id, args, source: BRIDGE_SOURCE })
      )
    }
    if (data.method === 'event') return ipcRenderer.send(...data.args)
    if (data.method === 'invoke') {
      ;(async () => {
        try {
          const args = await ipcRenderer.invoke(...data.args)
          postToRenderer({ method: 'invoke', id: data.id, args: args ?? [], source: BRIDGE_SOURCE })
        } catch {
          const result = ['tokens:save', 'tray:addChain'].includes(data.args[0])
            ? { success: false, error: 'Main IPC invocation failed' }
            : {}
          postToRenderer({
            method: 'invoke',
            id: data.id,
            args: result,
            source: BRIDGE_SOURCE
          })
        }
      })()
    }
  },
  false
)

ipcRenderer.on('main:action', (...args) => {
  args.shift()
  postToRenderer({ method: 'event', channel: 'action', args, source: BRIDGE_SOURCE })
})

ipcRenderer.on('main:flex', (...args) => {
  args.shift()
  postToRenderer({ method: 'event', channel: 'flex', args, source: BRIDGE_SOURCE })
})
