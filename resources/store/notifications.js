const { v4 } = require('uuid')

const REQUEST_OWNER_PREFIX = 'request:'
const EXTENSION_OWNER_PREFIX = 'extension:'
const NATIVE_OWNER_PREFIX = 'native:'

const requestNotificationOwner = (account, handlerId) => {
  if (!handlerId) return ''
  const normalizedAccount = typeof account === 'string' ? account.toLowerCase() : ''
  return normalizedAccount
    ? `${REQUEST_OWNER_PREFIX}${normalizedAccount}:${handlerId}`
    : `${REQUEST_OWNER_PREFIX}${handlerId}`
}

const requestReference = (req = {}) => ({
  handlerId: req.handlerId,
  account: req.account,
  type: req.type
})

const notificationOwner = (type, data = {}, explicitOwner) => {
  if (explicitOwner) return explicitOwner
  if (data.req?.handlerId) return requestNotificationOwner(data.req.account, data.req.handlerId)
  if (type === 'extensionConnect' && data.requestId) {
    return `${EXTENSION_OWNER_PREFIX}${data.requestId}`
  }
  if (type === 'nativeConnect' && data.requestId) return `${NATIVE_OWNER_PREFIX}${data.requestId}`
  return ''
}

const notificationById = (queue = [], id) => queue.find((notification) => notification.id === id)

const notificationByOwner = (queue = [], owner) => queue.find((notification) => notification.owner === owner)

const notificationIdentity = (type, data = {}, explicitId) => {
  if (explicitId) return explicitId
  const owner = notificationOwner(type, data)
  return owner ? `${owner}:${type}` : type || ''
}

const syncActiveNotification = (view, queue) => {
  const active = queue[0]
  return {
    ...view,
    notifyQueue: queue,
    notifyId: active?.id || '',
    notifyOwner: active?.owner || '',
    notify: active?.type || '',
    notifyData: active?.data || {}
  }
}

const normalizedQueue = (view) => {
  if (Array.isArray(view.notifyQueue) && view.notifyQueue.length) return view.notifyQueue
  if (!view.notify) return []
  return [
    {
      id: view.notifyId || v4(),
      owner: view.notifyOwner || notificationOwner(view.notify, view.notifyData),
      type: view.notify,
      data: view.notifyData || {}
    }
  ]
}

const transitionNotification = (view, type = '', data = {}, options = {}) => {
  const queue = [...normalizedQueue(view)]

  if (!type) {
    const expectedId = options.expectedId || queue[0]?.id
    if (!expectedId || !notificationById(queue, expectedId)) return syncActiveNotification(view, queue)
    return syncActiveNotification(
      view,
      queue.filter(({ id }) => id !== expectedId)
    )
  }

  const owner = notificationOwner(type, data, options.owner)
  const existingOwner = owner && notificationByOwner(queue, owner)
  if (existingOwner && !options.replaceId) return syncActiveNotification(view, queue)

  const notification = {
    id: options.id || v4(),
    owner,
    type,
    data
  }

  if (options.replaceId) {
    const index = queue.findIndex(({ id }) => id === options.replaceId)
    if (index < 0) return syncActiveNotification(view, queue)
    queue.splice(index, 1, notification)
  } else {
    queue.push(notification)
  }

  return syncActiveNotification(view, queue)
}

module.exports = {
  EXTENSION_OWNER_PREFIX,
  NATIVE_OWNER_PREFIX,
  REQUEST_OWNER_PREFIX,
  notificationById,
  notificationByOwner,
  notificationIdentity,
  notificationOwner,
  requestNotificationOwner,
  requestReference,
  transitionNotification
}
