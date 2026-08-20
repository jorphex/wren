import { z } from 'zod'

import {
  ContractVerificationJobRecord,
  MAX_CONTRACT_VERIFICATION_JOBS,
  validateContractVerificationJobLedger
} from '../../../../resources/domain/contractVerification'

const invalidLedger = (ctx: z.RefinementCtx) => {
  ctx.addIssue({ code: 'custom', message: 'invalid contract verification job ledger' })
  return z.NEVER
}

const isPlainDenseArray = (value: unknown): value is readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false

  const properties = Object.getOwnPropertyDescriptors(value)
  const names = Object.keys(properties)
  if (names.length !== value.length + 1 || !properties['length']) return false
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = properties[String(index)]
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false
  }
  return true
}

const parsedRecord = (value: unknown): ContractVerificationJobRecord | undefined => {
  try {
    return validateContractVerificationJobLedger([value])[0]
  } catch (_error) {
    return undefined
  }
}

export const ContractVerificationJobRecordSchema = z.unknown().transform((value, ctx) => {
  const parsed = parsedRecord(value)
  return parsed ?? invalidLedger(ctx)
})

export const ContractVerificationJobsSchema = z.unknown().transform((value, ctx) => {
  if (!isPlainDenseArray(value)) return invalidLedger(ctx)
  try {
    return validateContractVerificationJobLedger(value)
  } catch (_error) {
    return invalidLedger(ctx)
  }
})

export type ContractVerificationJobs = readonly ContractVerificationJobRecord[]

/**
 * Recovers valid privacy-minimal rows from durable state. Rows are ordered newest first,
 * duplicate IDs keep their newest occurrence, and malformed input never escapes this boundary.
 */
export const normalizeContractVerificationJobs = (value: unknown): ContractVerificationJobs => {
  if (!isPlainDenseArray(value)) return Object.freeze([])

  const records = Object.getOwnPropertyDescriptors(value)
  const parsed = Array.from({ length: value.length }, (_, index) => {
    const descriptor = records[String(index)]
    return descriptor && 'value' in descriptor ? parsedRecord(descriptor.value) : undefined
  })
    .filter((record): record is ContractVerificationJobRecord => record !== undefined)
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.createdAt - left.createdAt ||
        left.id.localeCompare(right.id)
    )

  const seen = new Set<string>()
  const retained = parsed.filter((record) => {
    if (seen.has(record.id)) return false
    seen.add(record.id)
    return true
  })

  return validateContractVerificationJobLedger(retained.slice(0, MAX_CONTRACT_VERIFICATION_JOBS))
}

export { MAX_CONTRACT_VERIFICATION_JOBS }
