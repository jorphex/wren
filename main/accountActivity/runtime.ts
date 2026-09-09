import { notifyObservedActivity } from '../notifications/accountActivity'
import log from 'electron-log'
import store from '../store'
import chains from '../chains'
import { requireStoreAction } from '../store/action'
import { createWalletCallEvidenceRPC } from '../provider/walletCallEvidenceRPC'
import { createAccountActivityScanner } from './scanner'
import {
  activityTransactionReferenceForOperation,
  type ActivityTransactionReference
} from '../store/state/types/activityTransactionReference'
import type { Chain, ActivityEntry } from '../store/state'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import type { WalletCallBatch } from '../store/state/types/walletCallBatch'
import type { AccountActivityCursors } from '../store/state/types/accountActivity'

const rpc = createWalletCallEvidenceRPC(chains).rpc
const accounts = () => Object.keys(store('main.accounts') || {}).map((a) => a.toLowerCase())
const networks = () =>
  (Object.values(store('main.networks.ethereum') || {}) as Chain[]).filter(
    (chain) => chain.on && chain.connection.endpoints.some((endpoint) => endpoint.connected)
  )

let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let enabled = false
function start() {
  if (enabled) return
  enabled = true
  const current = ++generation
  const active = () => enabled && generation === current
  let notifications: ActivityEntry[] = []
  const scanner = createAccountActivityScanner({
    rpc,
    accounts,
    active,
    cursor: (chainId) => ((store('main.accountActivityCursors') || {}) as AccountActivityCursors)[chainId],
    clearedAt: () => store('main.activityClearedAt') || 0,
    localActivity: (chainId, hash) => {
      const references = Object.values(
        (store('main.activityTransactionReferences') || {}) as Record<string, ActivityTransactionReference>
      )
      const batches = (store('main.walletCallBatches') || {}) as Record<string, WalletCallBatch>
      for (const operation of Object.values(
        (store('main.operationLifecycles') || {}) as Record<string, OperationLifecycle>
      )) {
        if (operation.chainId !== chainId) continue
        const reference = activityTransactionReferenceForOperation(operation, batches)
        if (reference) references.push(reference)
      }
      return references.find(
        (reference) => reference.chainId === chainId && reference.transactions.some((tx) => tx.hash === hash)
      )
    },
    commit: (chainId, cursor, entries, reorgAfter) => {
      if (!active() || !networks().some((chain) => chain.id === chainId))
        throw new Error('Activity network disconnected')
      const currentAccounts = accounts()
      requireStoreAction('commitAccountActivity')(
        chainId,
        cursor,
        entries.filter((entry) => currentAccounts.includes(entry.account)),
        reorgAfter
      )
    },
    notify: (entry) => {
      notifications.push(entry)
    }
  })
  const run = async () => {
    let backlog = false
    // Sequential network scans bound RPC concurrency and keep endpoints independent.
    for (const chain of networks()) {
      if (!active()) break
      try {
        backlog = (await scanner.scan(chain.id)) || backlog
      } catch {
        if (active()) log.verbose('Account activity scan will retry', { chainId: chain.id })
      } finally {
        if (active() && notifications.length) {
          try {
            notifyObservedActivity(notifications[notifications.length - 1]!, notifications.length)
          } catch {
            log.warn('Account activity notification unavailable')
          }
        }
        notifications = []
      }
    }
    if (active()) {
      timer = setTimeout(() => void run(), backlog ? 1000 : 15000)
      timer.unref?.()
    }
  }
  void run()
}
function stop() {
  enabled = false
  generation++
  clearTimeout(timer)
  timer = undefined
}
export default { start, stop }
