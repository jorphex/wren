import {
  ContractVerificationDestinationRecord,
  ContractVerificationDestinationStatus,
  ContractVerificationJobRecord,
  ContractVerificationJobStatus,
  MAX_CONTRACT_VERIFICATION_JOBS,
  validateContractVerificationJobLedger
} from '../../resources/domain/contractVerification'
import {
  ContractVerificationJobs,
  normalizeContractVerificationJobs
} from '../store/state/types/contractVerification'

export interface ContractVerificationJobStorage {
  load(): unknown
  save(jobs: ContractVerificationJobs): void
}

export type ContractVerificationJobUpdater = (
  current: ContractVerificationJobRecord
) => ContractVerificationJobRecord

const successfulDestinationStatuses = new Set<ContractVerificationDestinationStatus>([
  'published',
  'verified',
  'already-published',
  'already-verified'
])

const retryableDestinationStatuses = new Set<ContractVerificationDestinationStatus>([
  'unavailable',
  'needs-api-key',
  'unknown'
])

const jobStatusSet = (...statuses: ContractVerificationJobStatus[]) => new Set(statuses)

const jobStatusTransitions: Readonly<
  Record<ContractVerificationJobStatus, ReadonlySet<ContractVerificationJobStatus>>
> = Object.freeze({
  preparing: jobStatusSet('preparing', 'publishing', 'rejected', 'unknown'),
  publishing: jobStatusSet('publishing', 'published', 'partial', 'rejected', 'unknown'),
  unknown: jobStatusSet('unknown', 'partial', 'published', 'rejected'),
  rejected: jobStatusSet('rejected'),
  partial: jobStatusSet('partial', 'published'),
  published: jobStatusSet('published')
})

const snapshot = (jobs: readonly ContractVerificationJobRecord[]): ContractVerificationJobs =>
  validateContractVerificationJobLedger(jobs)

const recordSnapshot = (job: ContractVerificationJobRecord): ContractVerificationJobRecord =>
  snapshot([job])[0]!

const safeEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false
  }

  const leftArray = Array.isArray(left)
  if (leftArray !== Array.isArray(right)) return false
  if (leftArray && left.length !== (right as readonly unknown[]).length) return false
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (Object.getOwnPropertySymbols(left).length !== 0 || Object.getOwnPropertySymbols(right).length !== 0) {
    return false
  }

  const leftDescriptors = Object.getOwnPropertyDescriptors(left)
  const rightDescriptors = Object.getOwnPropertyDescriptors(right)
  const leftKeys = Object.keys(leftDescriptors)
    .filter((key) => key !== 'length')
    .sort()
  const rightKeys = Object.keys(rightDescriptors)
    .filter((key) => key !== 'length')
    .sort()
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    return false
  }

  return leftKeys.every((key) => {
    const leftDescriptor = leftDescriptors[key]
    const rightDescriptor = rightDescriptors[key]
    return (
      !!leftDescriptor &&
      !!rightDescriptor &&
      'value' in leftDescriptor &&
      'value' in rightDescriptor &&
      safeEqual(leftDescriptor.value, rightDescriptor.value)
    )
  })
}

const sameTarget = (left: ContractVerificationJobRecord, right: ContractVerificationJobRecord) =>
  safeEqual(left.target, right.target)

const immutableIdentityMatches = (
  current: ContractVerificationJobRecord,
  candidate: ContractVerificationJobRecord
) =>
  current.id === candidate.id &&
  sameTarget(current, candidate) &&
  current.language === candidate.language &&
  current.compilerVersion === candidate.compilerVersion &&
  current.contractIdentifier === candidate.contractIdentifier &&
  current.sourceHash === candidate.sourceHash &&
  current.submissionHash === candidate.submissionHash &&
  current.createdAt === candidate.createdAt

const destinationTransitionAllowed = (
  current: ContractVerificationDestinationStatus,
  candidate: ContractVerificationDestinationStatus
) => {
  if (current === candidate) return true
  if (current === 'not-submitted') return true
  if (retryableDestinationStatuses.has(current)) {
    return (
      candidate === 'checking' ||
      candidate === 'rejected' ||
      retryableDestinationStatuses.has(candidate) ||
      successfulDestinationStatuses.has(candidate)
    )
  }
  if (current === 'checking') {
    return (
      candidate === 'rejected' ||
      candidate === 'needs-api-key' ||
      candidate === 'unknown' ||
      successfulDestinationStatuses.has(candidate)
    )
  }
  return false
}

const remoteEvidenceMatches = (
  current: ContractVerificationDestinationRecord,
  candidate: ContractVerificationDestinationRecord
) =>
  (current.remoteId === undefined || current.remoteId === candidate.remoteId) &&
  (current.statusUrl === undefined || current.statusUrl === candidate.statusUrl) &&
  (current.explorerUrl === undefined || current.explorerUrl === candidate.explorerUrl)

const destinationsAdvance = (
  current: readonly ContractVerificationDestinationRecord[],
  candidate: readonly ContractVerificationDestinationRecord[]
) => {
  const candidateByName = new Map(candidate.map((record) => [record.destination, record]))
  return current.every((record) => {
    const next = candidateByName.get(record.destination)
    return (
      next !== undefined &&
      destinationTransitionAllowed(record.status, next.status) &&
      remoteEvidenceMatches(record, next)
    )
  })
}

const safelyEvictable = (job: ContractVerificationJobRecord) =>
  (job.status === 'published' || job.status === 'rejected') &&
  job.destinations.every(({ status }) => status !== 'checking')

export class ContractVerificationJobLedger {
  constructor(private readonly storage: ContractVerificationJobStorage) {}

  private read() {
    const loaded = this.storage.load()
    const normalized = normalizeContractVerificationJobs(loaded)
    if (!safeEqual(loaded, normalized)) this.storage.save(snapshot(normalized))
    return normalized
  }

  private write(jobs: readonly ContractVerificationJobRecord[]) {
    const normalized = normalizeContractVerificationJobs(jobs)
    this.storage.save(snapshot(normalized))
    return normalized
  }

  list() {
    return snapshot(this.read())
  }

  get(id: string) {
    const job = this.read().find((candidate) => candidate.id === id)
    return job ? recordSnapshot(job) : undefined
  }

  put(candidate: ContractVerificationJobRecord) {
    const parsed = recordSnapshot(candidate)
    const jobs = this.read()
    if (jobs.some(({ id }) => id === parsed.id)) {
      throw new Error('Contract verification job already exists')
    }

    let retained = jobs
    if (retained.length >= MAX_CONTRACT_VERIFICATION_JOBS) {
      const oldestTerminal = [...retained]
        .filter(safelyEvictable)
        .sort(
          (left, right) =>
            left.updatedAt - right.updatedAt ||
            left.createdAt - right.createdAt ||
            left.id.localeCompare(right.id)
        )[0]
      if (!oldestTerminal) throw new Error('Contract verification job limit reached')
      retained = retained.filter(({ id }) => id !== oldestTerminal.id)
    }

    this.write([...retained, parsed])
    return recordSnapshot(parsed)
  }

  update(
    id: string,
    replacement: ContractVerificationJobRecord | ContractVerificationJobUpdater
  ): ContractVerificationJobRecord {
    const jobs = this.read()
    const current = jobs.find((candidate) => candidate.id === id)
    if (!current) throw new Error('Unknown contract verification job')

    const input = typeof replacement === 'function' ? replacement(recordSnapshot(current)) : replacement
    const candidate = recordSnapshot(input)
    if (!immutableIdentityMatches(current, candidate)) {
      throw new Error('Contract verification job identity cannot change')
    }
    if (candidate.updatedAt < current.updatedAt) {
      throw new Error('Contract verification job update cannot move backwards')
    }
    if (!jobStatusTransitions[current.status].has(candidate.status)) {
      throw new Error('Contract verification job status cannot move backwards')
    }
    if (!destinationsAdvance(current.destinations, candidate.destinations)) {
      throw new Error('Contract verification destination evidence cannot move backwards or change')
    }

    this.write(jobs.map((job) => (job.id === id ? candidate : job)))
    return recordSnapshot(candidate)
  }
}
