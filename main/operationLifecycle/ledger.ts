import {
  MAX_OPERATION_LIFECYCLES,
  OperationLifecycle,
  OperationLifecycleSchema,
  OperationLifecycles,
  pruneOperationLifecycles
} from '../store/state/types/operationLifecycle'

export interface OperationLifecycleStorage {
  load(): unknown
  save(operations: OperationLifecycles): void
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class OperationLifecycleLedger {
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
    const operations = pruneOperationLifecycles(value, -1)
    return Object.fromEntries(
      Object.entries(operations).filter(
        ([_id, operation]) => operation.expiresAt > now || operation.state === 'stopped'
      )
    ) as OperationLifecycles
  }

  list(now = Date.now()) {
    return Object.freeze(Object.values(this.read(now)).map((operation) => Object.freeze(clone(operation))))
  }

  listStored() {
    return Object.freeze(
      Object.values(pruneOperationLifecycles(this.storage.load(), -1)).map((operation) =>
        Object.freeze(clone(operation))
      )
    )
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
    if (!current && Object.keys(operations).length >= MAX_OPERATION_LIFECYCLES) {
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

    const next = { ...operations, [parsed.data.id]: parsed.data }
    this.storage.save(clone(next))
    return Object.freeze(clone(parsed.data))
  }

  remove(id: string, now = Date.now()) {
    const operations = this.read(now)
    if (!operations[id]) return false
    delete operations[id]
    this.storage.save(clone(operations))
    return true
  }

  evictOldestHandledTerminal(now = Date.now()) {
    const candidate = this.listStored()
      .filter(
        (operation) =>
          ['confirmed', 'failed', 'replaced', 'stopped', 'verified-clearance'].includes(operation.state) &&
          operation.notification.terminalHandledAt !== undefined
      )
      .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))[0]
    return candidate ? this.remove(candidate.id, now) : false
  }
}
