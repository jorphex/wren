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

const handlers = {}

const link = new EventEmitter()
link.rpc = (...args) => {
  const cb = args.pop()
  if (typeof cb !== 'function') throw new Error('link.rpc requires a callback')
  const id = v4()
  handlers[id] = cb
  postToBridge({ id, args, source: LINK_SOURCE, method: 'rpc' })
}
link.send = (...args) => {
  postToBridge({ args, source: LINK_SOURCE, method: 'event' })
}
link.invoke = (...args) => {
  return new Promise((resolve) => {
    const id = v4()
    handlers[id] = resolve
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
      if (!handlers[data.id]) return console.log('link.rpc response had no handler')
      handlers[data.id](...args)
      delete handlers[data.id]
    } else if (data.method === 'invoke') {
      if (!handlers[data.id]) return console.log('link.invoke response had no handler')
      handlers[data.id](args)
      delete handlers[data.id]
    } else if (data.method === 'event') {
      link.emit(data.channel, ...args)
    }
  },
  false
)

export default link
