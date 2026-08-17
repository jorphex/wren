import { v4 } from 'uuid'
import EventEmitter from 'events'
import {
  BRIDGE_SOURCE,
  LINK_SOURCE,
  decodeBridgeMessage,
  encodeBridgeMessage,
  getRendererTargetOrigin,
  isTrustedBridgeEvent
} from '../bridge/protocol'

const targetOrigin = getRendererTargetOrigin(window.location)
const omitTrailingUndefined = (args) => {
  let end = args.length
  while (end > 0 && args[end - 1] === undefined) end -= 1
  return end === args.length ? args : args.slice(0, end)
}
const postToBridge = (message) => {
  const args = omitTrailingUndefined(message.args)
  const normalizedMessage = args === message.args ? message : { ...message, args }
  window.postMessage(encodeBridgeMessage(normalizedMessage), targetOrigin)
}

const handlers = new Map()

const link = new EventEmitter()
link.rpc = (...args) => {
  const cb = args.pop()
  if (typeof cb !== 'function') throw new Error('link.rpc requires a callback')
  const id = v4()
  handlers.set(id, cb)
  postToBridge({ id, args, source: LINK_SOURCE, method: 'rpc' })
}
link.send = (...args) => {
  postToBridge({ args, source: LINK_SOURCE, method: 'event' })
}
link.invoke = (...args) => {
  return new Promise((resolve) => {
    const id = v4()
    handlers.set(id, resolve)
    postToBridge({ id, args, source: LINK_SOURCE, method: 'invoke' })
  })
}

const safeOrigins =
  window.location.protocol === 'file:'
    ? ['null']
    : process.env.NODE_ENV === 'development'
      ? ['http://localhost:1234']
      : []

window.addEventListener(
  'message',
  (e) => {
    if (!isTrustedBridgeEvent(e, window, safeOrigins)) return

    const data = decodeBridgeMessage(e.data, BRIDGE_SOURCE)
    if (!data) return

    const args = data.args
    if (data.method === 'rpc') {
      const handler = handlers.get(data.id)
      if (!handler) return console.log('link.rpc response had no handler')
      handler(...args)
      handlers.delete(data.id)
    } else if (data.method === 'invoke') {
      const handler = handlers.get(data.id)
      if (!handler) return console.log('link.invoke response had no handler')
      handler(args)
      handlers.delete(data.id)
    } else if (data.method === 'event') {
      link.emit(data.channel, ...args)
    }
  },
  false
)

export default link
