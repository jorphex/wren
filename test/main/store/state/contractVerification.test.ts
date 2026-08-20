import {
  ContractVerificationJobRecord,
  MAX_CONTRACT_VERIFICATION_JOBS
} from '../../../../resources/domain/contractVerification'
import {
  ContractVerificationJobRecordSchema,
  ContractVerificationJobsSchema,
  normalizeContractVerificationJobs
} from '../../../../main/store/state/types/contractVerification'

const id = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`

const job = (index = 1, updatedAt = index): ContractVerificationJobRecord => ({
  id: id(index),
  target: {
    address: `0x${'1'.repeat(40)}`,
    chainId: 1,
    runtimeCodeHash: `0x${'2'.repeat(64)}`
  },
  language: 'Solidity',
  compilerVersion: '0.8.28+commit.7893614a',
  contractIdentifier: 'contracts/Counter.sol:Counter',
  sourceHash: '3'.repeat(64),
  submissionHash: '4'.repeat(64),
  status: 'publishing',
  destinations: [{ destination: 'sourcify', status: 'checking', remoteId: `poll-${index}` }],
  createdAt: index,
  updatedAt
})

test('accepts and freezes only exact pure-domain job arrays', () => {
  const parsed = ContractVerificationJobsSchema.parse([job()])

  expect(parsed).toEqual([job()])
  expect(Object.isFrozen(parsed)).toBe(true)
  expect(Object.isFrozen(parsed[0])).toBe(true)
  expect(Object.isFrozen(parsed[0]?.target)).toBe(true)
  expect(Object.isFrozen(parsed[0]?.destinations)).toBe(true)
  expect(ContractVerificationJobRecordSchema.parse(job())).toEqual(job())

  expect(() => ContractVerificationJobsSchema.parse([{ ...job(), source: 'private source' }])).toThrow()
  expect(() => ContractVerificationJobsSchema.parse([{ ...job(), apiKey: 'secret' }])).toThrow()
  expect(() =>
    ContractVerificationJobsSchema.parse([
      {
        ...job(),
        destinations: [{ ...job().destinations[0], message: 'raw remote response' }]
      }
    ])
  ).toThrow()
  expect(() =>
    ContractVerificationJobsSchema.parse(Array(MAX_CONTRACT_VERIFICATION_JOBS + 1).fill(job()))
  ).toThrow()
})

test('rejects inherited, accessor, sparse, and augmented persistence shapes without invoking accessors', () => {
  expect(() => ContractVerificationJobsSchema.parse([Object.assign(Object.create({}), job())])).toThrow()

  let accessed = false
  const malicious = { ...job() }
  Object.defineProperty(malicious, 'sourceHash', {
    enumerable: true,
    get: () => {
      accessed = true
      return '3'.repeat(64)
    }
  })
  expect(() => ContractVerificationJobsSchema.parse([malicious])).toThrow()
  expect(accessed).toBe(false)

  const sparse = Array(1)
  expect(() => ContractVerificationJobsSchema.parse(sparse)).toThrow()

  const augmented = [job()]
  Object.defineProperty(augmented, 'source', { value: 'private source', enumerable: true })
  expect(() => ContractVerificationJobsSchema.parse(augmented)).toThrow()

  const inheritedArray = [job()]
  Object.setPrototypeOf(inheritedArray, Object.create(Array.prototype))
  expect(() => ContractVerificationJobsSchema.parse(inheritedArray)).toThrow()
})

test('falls back safely and recovers only valid rows from malformed durable input', () => {
  expect(normalizeContractVerificationJobs(null)).toEqual([])
  expect(normalizeContractVerificationJobs({ jobs: [job()] })).toEqual([])
  expect(normalizeContractVerificationJobs([job(), { ...job(2), apiKey: 'secret' }, 'malformed'])).toEqual([
    job()
  ])
  expect(Object.isFrozen(normalizeContractVerificationJobs(null))).toBe(true)
})

test('prunes oversized and duplicate input deterministically with newest rows first', () => {
  const oversized = Array.from({ length: MAX_CONTRACT_VERIFICATION_JOBS + 2 }, (_, offset) =>
    job(offset + 1, offset + 1)
  ).reverse()
  const newestDuplicate = { ...job(10), status: 'published' as const, updatedAt: 10_000 }

  const normalized = normalizeContractVerificationJobs([...oversized, newestDuplicate])

  expect(normalized).toHaveLength(MAX_CONTRACT_VERIFICATION_JOBS)
  expect(normalized[0]).toEqual(newestDuplicate)
  expect(normalized.filter(({ id: candidate }) => candidate === newestDuplicate.id)).toHaveLength(1)
  expect(normalized.map(({ updatedAt }) => updatedAt)).toEqual(
    [...normalized].map(({ updatedAt }) => updatedAt).sort((left, right) => right - left)
  )
  expect(normalized.some(({ id: candidate }) => candidate === id(1))).toBe(false)
})
