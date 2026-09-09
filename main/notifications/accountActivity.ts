import { Notification } from 'electron'
import store from '../store'
import windows from '../windows'
import { requireStoreAction } from '../store/action'
import { observedActivityLabels } from '../../resources/domain/activity/labels'
import type { ActivityEntry } from '../store/state'
const accounts = () => Object.keys(store('main.accounts') || {}).map((a) => a.toLowerCase())

export function notifyObservedActivity(entry: ActivityEntry, count = 1) {
  if (
    !entry.observed ||
    entry.chainId === undefined ||
    !accounts().includes(entry.account) ||
    store('main.transactionNotifications') === false ||
    windows.isAnyWrenVisible() ||
    !Notification?.isSupported?.()
  )
    return false
  const notification = new Notification({
    title:
      count > 1
        ? 'New wallet activity'
        : entry.outcome === 'failed'
          ? 'Transaction failed'
          : observedActivityLabels[entry.observed.action],
    body: [
      count > 1 ? `${count} activities outside Wren` : 'Outside Wren',
      store('main.networks.ethereum', entry.chainId, 'name')
    ]
      .filter(Boolean)
      .join(' · ')
  })
  notification.once('click', () => {
    if (!accounts().includes(entry.account)) return
    requireStoreAction('showAccountActivity')(entry.account, entry.id)
    windows.showTray()
  })
  notification.show()
  return true
}
