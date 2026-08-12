import type { OperationReconciliationObservation, OperationReconciliationObserver } from './reconciler'

const observers = new Set<OperationReconciliationObserver>()

export const observeOperationLifecycles = (observer: OperationReconciliationObserver) => {
  observers.add(observer)
  return () => observers.delete(observer)
}

export const publishOperationLifecycleObservation = (observation: OperationReconciliationObservation) => {
  observers.forEach((observer) => observer(observation))
}
