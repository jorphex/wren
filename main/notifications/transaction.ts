import { Notification } from 'electron'

import store from '../store'
import windows from '../windows'
import { requireStoreAction } from '../store/action'

export type WalletActivityNotificationOutcome =
  'confirmed' | 'failed' | 'replaced' | 'long-pending' | 'long-pending-broadcasting'
export type TransactionNotificationOutcome = WalletActivityNotificationOutcome | 'dropped'

const copy: Record<WalletActivityNotificationOutcome, { title: string; body: string }> = {
  confirmed: { title: 'Wallet activity confirmed', body: 'A submitted wallet activity completed.' },
  failed: { title: 'Wallet activity failed', body: 'A submitted wallet activity did not complete.' },
  replaced: { title: 'Wallet activity replaced', body: 'A submitted wallet activity was replaced.' },
  'long-pending': {
    title: 'Wallet activity still pending',
    body: 'Wren is still checking a submitted wallet activity.'
  },
  'long-pending-broadcasting': {
    title: 'Wallet activity broadcast status unknown',
    body: 'Wren is checking whether a signed wallet activity was broadcast.'
  }
}

const delivered = new Set<string>()
const deliveryOrder: string[] = []
const MAX_DELIVERED = 1024

export function notifyTransactionOutcome(
  activityId: string,
  account: string,
  outcome: TransactionNotificationOutcome
) {
  const normalizedOutcome = outcome === 'dropped' ? 'replaced' : outcome
  const deliveryKey = `${activityId}:${normalizedOutcome.startsWith('long-pending') ? 'pending' : 'terminal'}`
  if (
    !activityId ||
    delivered.has(deliveryKey) ||
    !Notification ||
    typeof Notification.isSupported !== 'function' ||
    !Notification.isSupported() ||
    store('main.transactionNotifications') === false ||
    windows.isAnyWrenVisible()
  ) {
    return false
  }

  delivered.add(deliveryKey)
  deliveryOrder.push(deliveryKey)
  if (deliveryOrder.length > MAX_DELIVERED) {
    const expired = deliveryOrder.shift()
    if (expired) delivered.delete(expired)
  }
  const notification = new Notification(copy[normalizedOutcome])
  notification.once('click', () => {
    requireStoreAction('showAccountActivity')(account, activityId)
    windows.showTray()
  })
  notification.show()
  return true
}

export const notifyWalletActivity = (
  activityId: string,
  account: string,
  outcome: WalletActivityNotificationOutcome
) => notifyTransactionOutcome(activityId, account, outcome)

export function resetTransactionNotificationDeduplicationForTests() {
  delivered.clear()
  deliveryOrder.length = 0
}
