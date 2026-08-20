import {
  MAX_OPERATION_LIFECYCLES,
  OperationLifecycle,
  OperationLifecycleSchema,
  OperationLifecycles,
  pruneOperationLifecycles
} from '../store/state/types/operationLifecycle'
import { WREN_DEPLOY_ORIGIN, WREN_INTERNAL_ORIGIN, originIdForName } from '../../resources/domain/origin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface OperationLifecycleStorage {
  load(): unknown
  save(operations: OperationLifecycles): void
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const deployOriginId = originIdForName(WREN_DEPLOY_ORIGIN)
const internalOriginId = originIdForName(WREN_INTERNAL_ORIGIN)

const hasValidReplacementLineage = (operation: OperationLifecycle, operations: OperationLifecycles) => {
  const visited = new Set<string>()
  let child = operation

  while (child.transaction?.replacementOf) {
    if (visited.has(child.id)) return false
    visited.add(child.id)

    const parent = operations[child.transaction.replacementOf]
    if (
      !parent ||
      parent.kind !== 'transaction' ||
      !parent.transaction ||
      child.account !== parent.account ||
      child.chainId !== parent.chainId ||
      child.transaction.nonce !== parent.transaction.nonce
    ) {
      return false
    }
    const parentDeployment = parent.transaction.deployment
    const replacementDeployment = child.transaction.deployment
    if (replacementDeployment) {
      if (
        child.origin !== deployOriginId ||
        JSON.stringify(replacementDeployment) !== JSON.stringify(parentDeployment)
      ) {
        return false
      }
    } else if (parentDeployment && child.origin !== internalOriginId) {
      return false
    }
    child = parent
  }

  return !visited.has(child.id)
}

export class OperationLifecycleLedger {
  private readonly admissions = new Set<string>()

  constructor(private readonly storage: OperationLifecycleStorage) {}

  private read(now = Date.now()) {
    const loaded = this.storage.load()
    const operations = this.normalize(loaded, now)
    const loadedCount =
      loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? Object.keys(loaded).length : 0
    if (Object.keys(operations).length !== loadedCount) this.storage.save(clone(operations))
    return operations
  }

  private normalize(value: unknown, now: number) {
    let operations = pruneOperationLifecycles(value, -1)

    // Removing an invalid parent can invalidate its descendants. Repeat until
    // the retained replacement graph is closed over valid parents.
    let previousCount = -1
    while (Object.keys(operations).length !== previousCount) {
      previousCount = Object.keys(operations).length
      operations = Object.fromEntries(
        Object.entries(operations).filter(([_id, operation]) =>
          hasValidReplacementLineage(operation, operations)
        )
      ) as OperationLifecycles
    }

    const retained = new Set(
      Object.values(operations)
        .filter((operation) => operation.expiresAt > now || operation.state === 'stopped')
        .map(({ id }) => id)
    )
    for (const id of [...retained]) {
      let ancestorId = operations[id]?.transaction?.replacementOf
      while (ancestorId && !retained.has(ancestorId)) {
        retained.add(ancestorId)
        ancestorId = operations[ancestorId]?.transaction?.replacementOf
      }
    }

    return Object.fromEntries(
      Object.entries(operations).filter(([id]) => retained.has(id))
    ) as OperationLifecycles
  }

  list(now = Date.now()) {
    return Object.freeze(Object.values(this.read(now)).map((operation) => Object.freeze(clone(operation))))
  }

  listStored() {
    return Object.freeze(Object.values(this.read(-1)).map((operation) => Object.freeze(clone(operation))))
  }

  get(id: string, now = Date.now()) {
    const operation = this.read(now)[id]
    return operation ? Object.freeze(clone(operation)) : undefined
  }

  put(candidate: OperationLifecycle, now = Date.now()) {
    const parsed = OperationLifecycleSchema.safeParse(candidate)
    if (!parsed.success || (parsed.data.expiresAt <= now && parsed.data.state !== 'stopped')) {
      throw new Error('Invalid operation lifecycle')
    }

    const operations = this.read(now)
    const current = operations[parsed.data.id]
    const reservedForOthers = [...this.admissions].filter((id) => id !== parsed.data.id).length
    if (!current && Object.keys(operations).length + reservedForOthers >= MAX_OPERATION_LIFECYCLES) {
      throw new Error('Operation lifecycle limit reached')
    }
    if (
      current &&
      (current.kind !== parsed.data.kind ||
        current.account !== parsed.data.account ||
        current.origin !== parsed.data.origin ||
        current.chainId !== parsed.data.chainId ||
        current.createdAt !== parsed.data.createdAt)
    ) {
      throw new Error('Operation lifecycle identity cannot change')
    }
    if (current && parsed.data.updatedAt < current.updatedAt) {
      throw new Error('Operation lifecycle update cannot move backwards')
    }
    if (current && JSON.stringify(current.transaction) !== JSON.stringify(parsed.data.transaction)) {
      throw new Error('Operation lifecycle transaction evidence cannot change')
    }
    if (
      current?.receipt?.contractAddress &&
      parsed.data.state !== 'reorged' &&
      parsed.data.receipt?.contractAddress !== current.receipt.contractAddress
    ) {
      throw new Error('Operation lifecycle deployment receipt evidence cannot change')
    }

    const replacementOf = parsed.data.transaction?.replacementOf
    if (replacementOf) {
      const parent = operations[replacementOf]
      if (!parent || parent.kind !== 'transaction') {
        throw new Error('Operation lifecycle replacement parent is unavailable')
      }
      if (
        !parent.transaction ||
        parsed.data.account !== parent.account ||
        parsed.data.chainId !== parent.chainId ||
        parsed.data.transaction?.nonce !== parent.transaction.nonce
      ) {
        throw new Error('Operation lifecycle replacement identity does not match')
      }
      const parentDeployment = parent.transaction?.deployment
      const replacementDeployment = parsed.data.transaction?.deployment
      if (replacementDeployment) {
        if (
          parsed.data.origin !== deployOriginId ||
          JSON.stringify(replacementDeployment) !== JSON.stringify(parentDeployment)
        ) {
          throw new Error('Operation lifecycle deployment replacement evidence does not match')
        }
      } else if (parentDeployment && parsed.data.origin !== internalOriginId) {
        throw new Error('Managed deployment replacement requires exact evidence or internal cancellation')
      }
    }

    const next = { ...operations, [parsed.data.id]: parsed.data }
    this.storage.save(clone(next))
    this.admissions.delete(parsed.data.id)
    return Object.freeze(clone(parsed.data))
  }

  reserve(id: string, now = Date.now()) {
    if (!UUID.test(id)) {
      throw new Error('Invalid operation lifecycle admission')
    }
    if (this.admissions.has(id) || this.read(now)[id]) return false
    if (Object.keys(this.read(now)).length + this.admissions.size >= MAX_OPERATION_LIFECYCLES) {
      throw new Error('Operation lifecycle limit reached')
    }
    this.admissions.add(id)
    return true
  }

  releaseReservation(id: string) {
    return this.admissions.delete(id)
  }

  remove(id: string, now = Date.now()) {
    const operations = this.read(now)
    if (!operations[id]) return false
    if (Object.values(operations).some(({ transaction }) => transaction?.replacementOf === id)) {
      return false
    }
    delete operations[id]
    this.storage.save(clone(operations))
    return true
  }

  evictOldestHandledTerminal(now = Date.now()) {
    const stored = this.listStored()
    const referenced = new Set(
      stored.flatMap(({ transaction }) => (transaction?.replacementOf ? [transaction.replacementOf] : []))
    )
    const candidate = stored
      .filter(
        (operation) =>
          [
            'confirmed',
            'failed',
            'replaced',
            'stopped',
            'clearance-unverified',
            'verified-clearance'
          ].includes(operation.state) &&
          operation.notification.terminalHandledAt !== undefined &&
          operation.settlement?.status !== 'monitoring' &&
          !referenced.has(operation.id)
      )
      .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))[0]
    return candidate ? this.remove(candidate.id, now) : false
  }
}
