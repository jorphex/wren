import {
  notificationByOwner,
  requestNotificationOwner,
  requestReference,
  transitionNotification
} from '../../../resources/store/notifications'

const emptyView = () => ({
  notify: '',
  notifyData: {},
  notifyId: '',
  notifyOwner: '',
  notifyQueue: []
})

test('queues request notifications in FIFO order with stable owner keys', () => {
  const firstReq = { handlerId: 'first', account: '0x1', type: 'transaction' }
  const secondReq = { handlerId: 'second', account: '0x2', type: 'signMessage' }
  let view = transitionNotification(emptyView(), 'gasFeeWarning', { req: firstReq }, { id: 'notice-1' })
  view = transitionNotification(view, 'noSignerWarning', { req: secondReq }, { id: 'notice-2' })

  expect(view.notify).toBe('gasFeeWarning')
  expect(view.notifyId).toBe('notice-1')
  expect(view.notifyQueue.map(({ id }) => id)).toEqual(['notice-1', 'notice-2'])
  expect(view.notifyQueue.map(({ owner }) => owner)).toEqual(['request:0x1:first', 'request:0x2:second'])
})

test('an expected-id dismissal cannot close a newer notification', () => {
  let view = transitionNotification(emptyView(), 'gasFeeWarning', {}, { id: 'old' })
  view = transitionNotification(view, 'openExternal', {}, { id: 'new', replaceId: 'old' })

  const staleDismissal = transitionNotification(view, '', {}, { expectedId: 'old' })
  expect(staleDismissal.notifyId).toBe('new')
  expect(staleDismissal.notify).toBe('openExternal')
})

test('expected-id replacement is guarded and keeps FIFO position', () => {
  let view = transitionNotification(emptyView(), 'signerCompatibilityWarning', {}, { id: 'first' })
  view = transitionNotification(view, 'openExternal', {}, { id: 'second' })

  const staleReplacement = transitionNotification(
    view,
    'gasFeeWarning',
    {},
    {
      id: 'ignored',
      replaceId: 'missing'
    }
  )
  expect(staleReplacement.notifyQueue.map(({ id }) => id)).toEqual(['first', 'second'])

  const replacement = transitionNotification(
    view,
    'gasFeeWarning',
    {},
    {
      id: 'replacement',
      replaceId: 'first'
    }
  )
  expect(replacement.notifyQueue.map(({ id }) => id)).toEqual(['replacement', 'second'])
  expect(replacement.notify).toBe('gasFeeWarning')
})

test('duplicate notifications from one request do not stack', () => {
  const req = { handlerId: 'request', account: '0x1', type: 'transaction' }
  let view = transitionNotification(emptyView(), 'noSignerWarning', { req }, { id: 'first' })
  view = transitionNotification(view, 'noSignerWarning', { req }, { id: 'duplicate' })

  expect(view.notifyQueue).toHaveLength(1)
  expect(notificationByOwner(view.notifyQueue, requestNotificationOwner(req.account, req.handlerId)).id).toBe(
    'first'
  )
})

test('same handler ids on different accounts have independent owners and cleanup', () => {
  const firstReq = { handlerId: 'shared', account: '0xA', type: 'access' }
  const secondReq = { handlerId: 'shared', account: '0xB', type: 'access' }
  let view = transitionNotification(emptyView(), 'noSignerWarning', { req: firstReq }, { id: 'first' })
  view = transitionNotification(view, 'noSignerWarning', { req: secondReq }, { id: 'second' })

  expect(view.notifyQueue.map(({ owner }) => owner)).toEqual(['request:0xa:shared', 'request:0xb:shared'])

  const first = notificationByOwner(
    view.notifyQueue,
    requestNotificationOwner(firstReq.account, firstReq.handlerId)
  )
  view = transitionNotification(view, '', {}, { expectedId: first.id })

  expect(view.notifyQueue).toEqual([expect.objectContaining({ id: 'second', owner: 'request:0xb:shared' })])
})

test('dismissal advances to the next queued item', () => {
  let view = transitionNotification(emptyView(), 'gasFeeWarning', {}, { id: 'first' })
  view = transitionNotification(view, 'openExternal', {}, { id: 'second' })
  view = transitionNotification(view, '', {}, { expectedId: 'first' })

  expect(view.notifyId).toBe('second')
  expect(view.notify).toBe('openExternal')
})

test('builds the narrow trusted request reference', () => {
  expect(
    requestReference({
      handlerId: 'request',
      account: '0xaccount',
      type: 'transaction',
      data: { secret: 'not forwarded' }
    })
  ).toEqual({ handlerId: 'request', account: '0xaccount', type: 'transaction' })
})
