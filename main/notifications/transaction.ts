import { Notification } from 'electron'

import store from '../store'
import windows from '../windows'
import { requireStoreAction } from '../store/action'

export type TransactionNotificationOutcome = 'confirmed' | 'failed' | 'dropped'

const copy: Record<TransactionNotificationOutcome, { title: string; body: string }> = {
  confirmed: { title: 'Transaction confirmed', body: 'A transaction finished successfully.' },
  failed: { title: 'Transaction failed', body: 'A transaction did not complete.' },
  dropped: { title: 'Transaction replaced', body: 'A pending transaction was replaced.' }
}

const delivered = new Set<string>()
const deliveryOrder: string[] = []
const MAX_DELIVERED = 1024

export function notifyTransactionOutcome(
  activityId: string,
  account: string,
  outcome: TransactionNotificationOutcome
) {
  if (
    !activityId ||
    delivered.has(activityId) ||
    !Notification ||
    typeof Notification.isSupported !== 'function' ||
    !Notification.isSupported() ||
    store('main.transactionNotifications') === false ||
    windows.isAnyWrenVisible()
  ) {
    return false
  }

  delivered.add(activityId)
  deliveryOrder.push(activityId)
  if (deliveryOrder.length > MAX_DELIVERED) {
    const expired = deliveryOrder.shift()
    if (expired) delivered.delete(expired)
  }
  const notification = new Notification(copy[outcome])
  notification.once('click', () => {
    requireStoreAction('showAccountActivity')(account, activityId)
    windows.showTray()
  })
  notification.show()
  return true
}

export function resetTransactionNotificationDeduplicationForTests() {
  delivered.clear()
  deliveryOrder.length = 0
}
