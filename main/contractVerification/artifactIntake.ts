import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'

import {
  ContractVerificationDomainError,
  parseContractVerificationArtifacts,
  summarizeContractVerificationArtifact,
  type ContractVerificationArtifact,
  type ContractVerificationArtifactSummary
} from '../../resources/domain/contractVerification'

export const MAX_CONTRACT_VERIFICATION_ARTIFACT_FILE_BYTES = 48 * 1024 * 1024
export const MAX_CONTRACT_VERIFICATION_ARTIFACT_BUNDLE_BYTES = 64 * 1024 * 1024
export const MAX_CONTRACT_VERIFICATION_INTAKE_SESSIONS = 2
export const CONTRACT_VERIFICATION_INTAKE_SESSION_TTL_MS = 10 * 60 * 1000

export const CONTRACT_VERIFICATION_ARTIFACT_INTAKE_ERROR_CODES = Object.freeze([
  'invalid-file-selection',
  'invalid-file',
  'artifact-file-too-large',
  'artifact-bundle-too-large',
  'invalid-utf8',
  'invalid-json',
  'contract-selection-required',
  'invalid-contract-selection',
  'invalid-session',
  'session-unavailable'
] as const)

export type ContractVerificationArtifactIntakeErrorCode =
  (typeof CONTRACT_VERIFICATION_ARTIFACT_INTAKE_ERROR_CODES)[number]

export const CONTRACT_VERIFICATION_ARTIFACT_INTAKE_ERROR_MESSAGES: Readonly<
  Record<ContractVerificationArtifactIntakeErrorCode, string>
> = Object.freeze({
  'invalid-file-selection': 'Select one or two JSON verification artifact files',
  'invalid-file': 'Verification artifact file is unavailable or invalid',
  'artifact-file-too-large': 'A verification artifact file is too large',
  'artifact-bundle-too-large': 'Verification artifact files are too large',
  'invalid-utf8': 'Verification artifact file is not valid UTF-8',
  'invalid-json': 'Verification artifact file does not contain valid JSON',
  'contract-selection-required': 'Select a contract before continuing',
  'invalid-contract-selection': 'Contract selection is invalid',
  'invalid-session': 'Verification artifact session is unavailable',
  'session-unavailable': 'Verification artifact session could not be created'
})

export class ContractVerificationArtifactIntakeError extends Error {
  readonly code: ContractVerificationArtifactIntakeErrorCode

  constructor(code: ContractVerificationArtifactIntakeErrorCode) {
    super(CONTRACT_VERIFICATION_ARTIFACT_INTAKE_ERROR_MESSAGES[code])
    this.name = 'ContractVerificationArtifactIntakeError'
    this.code = code
  }
}

export interface ContractVerificationArtifactIntakeSummary extends ContractVerificationArtifactSummary {
  readonly selectionRequired: boolean
  readonly selectedContractIdentifier: string | null
}

export interface ContractVerificationArtifactIntakeHandle {
  readonly token: string
  readonly summary: ContractVerificationArtifactIntakeSummary
}

/** Trusted main-process payload. It must not be projected to a renderer or persisted. */
export interface ConsumedContractVerificationArtifact {
  readonly artifact: ContractVerificationArtifact
  readonly contractIdentifier: string | null
}

export interface ContractVerificationArtifactFileChooserResult {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

export type ContractVerificationArtifactFileChooser =
  () => Promise<ContractVerificationArtifactFileChooserResult>

export type ContractVerificationArtifactFileSystem = Pick<
  typeof fs,
  'closeSync' | 'constants' | 'fstatSync' | 'lstatSync' | 'openSync' | 'readSync'
>

export interface ContractVerificationArtifactIntake {
  inspect(): Promise<ContractVerificationArtifactIntakeHandle | undefined>
  select(token: unknown, contractIdentifier: unknown): ContractVerificationArtifactIntakeHandle
  peek(token: unknown): ContractVerificationArtifactIntakeSummary
  consume(token: unknown): ConsumedContractVerificationArtifact
  dispose(token: unknown): void
}

interface IntakeSession {
  artifact: ContractVerificationArtifact | undefined
  contractIdentifier: string | null
  readonly expiresAt: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function fail(code: ContractVerificationArtifactIntakeErrorCode): never {
  throw new ContractVerificationArtifactIntakeError(code)
}

const defaultFileChooser: ContractVerificationArtifactFileChooser = async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const options: OpenDialogOptions = {
    title: 'Inspect Contract Verification Artifacts',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  return focusedWindow ? dialog.showOpenDialog(focusedWindow, options) : dialog.showOpenDialog(options)
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameSnapshot(left: fs.Stats, right: fs.Stats): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function validRegularFile(stats: fs.Stats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && Number.isSafeInteger(stats.size) && stats.size >= 0
}

function readDescriptorBounded(
  fileSystem: ContractVerificationArtifactFileSystem,
  descriptor: number,
  expectedSize: number
): Buffer {
  const buffer = Buffer.alloc(expectedSize + 1)
  let offset = 0
  while (offset < buffer.length) {
    const count = fileSystem.readSync(descriptor, buffer, offset, buffer.length - offset, null)
    if (count === 0) break
    offset += count
  }
  if (offset !== expectedSize) {
    buffer.fill(0)
    return fail('invalid-file')
  }
  return buffer.subarray(0, expectedSize)
}

function readRegularFile(
  fileSystem: ContractVerificationArtifactFileSystem,
  source: string,
  before: fs.Stats
): Buffer {
  let bytes: Buffer | undefined
  try {
    const descriptor = fileSystem.openSync(
      source,
      fileSystem.constants.O_RDONLY | (fileSystem.constants.O_NOFOLLOW || 0)
    )
    try {
      const opened = fileSystem.fstatSync(descriptor)
      if (
        !validRegularFile(opened) ||
        !sameSnapshot(before, opened) ||
        opened.size > MAX_CONTRACT_VERIFICATION_ARTIFACT_FILE_BYTES
      ) {
        return fail('invalid-file')
      }

      bytes = readDescriptorBounded(fileSystem, descriptor, opened.size)
      const read = fileSystem.fstatSync(descriptor)
      const current = fileSystem.lstatSync(source)
      if (
        !validRegularFile(read) ||
        !validRegularFile(current) ||
        !sameSnapshot(opened, read) ||
        !sameSnapshot(read, current)
      ) {
        bytes.fill(0)
        bytes = undefined
        return fail('invalid-file')
      }
    } finally {
      fileSystem.closeSync(descriptor)
    }
    return bytes!
  } catch (error) {
    if (error instanceof ContractVerificationArtifactIntakeError) throw error
    if (bytes) bytes.fill(0)
    return fail('invalid-file')
  }
}

function decodeJsonObject(bytes: Buffer): Record<string, unknown> {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail('invalid-utf8')
  } finally {
    bytes.fill(0)
  }

  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('invalid-json')
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof ContractVerificationArtifactIntakeError) throw error
    return fail('invalid-json')
  }
}

function selectedByDefault(artifact: ContractVerificationArtifact): string | null {
  return artifact.contractCandidates.length === 1 ? artifact.contractCandidates[0]! : null
}

function rendererSummary(
  artifact: ContractVerificationArtifact,
  contractIdentifier: string | null
): ContractVerificationArtifactIntakeSummary {
  const summary = summarizeContractVerificationArtifact(artifact)
  return Object.freeze({
    ...summary,
    contractCandidates: Object.freeze([...summary.contractCandidates]),
    selectionRequired: artifact.contractCandidates.length > 1 && contractIdentifier === null,
    selectedContractIdentifier: contractIdentifier
  })
}

export function createContractVerificationArtifactIntake(
  options: {
    chooseFiles?: ContractVerificationArtifactFileChooser
    fileSystem?: ContractVerificationArtifactFileSystem
    now?: () => number
    randomUUID?: () => string
  } = {}
): ContractVerificationArtifactIntake {
  const chooseFiles = options.chooseFiles || defaultFileChooser
  const fileSystem = options.fileSystem || fs
  const now = options.now || Date.now
  const randomUUID = options.randomUUID || crypto.randomUUID
  const sessions = new Map<string, IntakeSession>()

  const currentTime = (): number => {
    try {
      const value = now()
      return Number.isSafeInteger(value) && value >= 0 ? value : fail('invalid-session')
    } catch (error) {
      if (error instanceof ContractVerificationArtifactIntakeError) throw error
      return fail('invalid-session')
    }
  }

  const clearSession = (session: IntakeSession) => {
    session.artifact = undefined
    session.contractIdentifier = null
  }

  const pruneExpired = (timestamp: number) => {
    for (const [token, session] of sessions) {
      if (timestamp >= session.expiresAt) {
        clearSession(session)
        sessions.delete(token)
      }
    }
  }

  const sessionFor = (token: unknown): IntakeSession => {
    const timestamp = currentTime()
    pruneExpired(timestamp)
    if (typeof token !== 'string' || !UUID.test(token)) return fail('invalid-session')
    const session = sessions.get(token)
    if (!session || !session.artifact) return fail('invalid-session')
    return session
  }

  const newToken = (): string => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const token: unknown = randomUUID()
        if (typeof token === 'string' && UUID.test(token) && !sessions.has(token)) return token
      } catch {
        return fail('session-unavailable')
      }
    }
    return fail('session-unavailable')
  }

  const handle = (token: string, session: IntakeSession): ContractVerificationArtifactIntakeHandle => {
    const artifact = session.artifact
    if (!artifact) return fail('invalid-session')
    return Object.freeze({
      token,
      summary: rendererSummary(artifact, session.contractIdentifier)
    })
  }

  const addSession = (artifact: ContractVerificationArtifact): ContractVerificationArtifactIntakeHandle => {
    const timestamp = currentTime()
    pruneExpired(timestamp)
    const token = newToken()
    if (sessions.size >= MAX_CONTRACT_VERIFICATION_INTAKE_SESSIONS) {
      const oldest = sessions.entries().next().value as [string, IntakeSession] | undefined
      if (oldest) {
        clearSession(oldest[1])
        sessions.delete(oldest[0])
      }
    }
    const session: IntakeSession = {
      artifact,
      contractIdentifier: selectedByDefault(artifact),
      expiresAt: timestamp + CONTRACT_VERIFICATION_INTAKE_SESSION_TTL_MS
    }
    sessions.set(token, session)
    return handle(token, session)
  }

  const inspect = async (): Promise<ContractVerificationArtifactIntakeHandle | undefined> => {
    let result: ContractVerificationArtifactFileChooserResult
    try {
      result = await chooseFiles()
    } catch {
      return fail('invalid-file-selection')
    }
    if (result.canceled) return undefined
    const selected = result.filePaths
    if (
      !Array.isArray(selected) ||
      selected.length < 1 ||
      selected.length > 2 ||
      selected.some(
        (source) =>
          typeof source !== 'string' || source.length === 0 || path.extname(source).toLowerCase() !== '.json'
      ) ||
      new Set(selected).size !== selected.length
    ) {
      return fail('invalid-file-selection')
    }

    const snapshots: fs.Stats[] = []
    let aggregateSize = 0
    try {
      for (const source of selected) {
        const stats = fileSystem.lstatSync(source)
        if (!validRegularFile(stats)) return fail('invalid-file')
        if (stats.size > MAX_CONTRACT_VERIFICATION_ARTIFACT_FILE_BYTES) {
          return fail('artifact-file-too-large')
        }
        aggregateSize += stats.size
        if (aggregateSize > MAX_CONTRACT_VERIFICATION_ARTIFACT_BUNDLE_BYTES) {
          return fail('artifact-bundle-too-large')
        }
        snapshots.push(stats)
      }
    } catch (error) {
      if (error instanceof ContractVerificationArtifactIntakeError) throw error
      return fail('invalid-file')
    }

    const objects: Record<string, unknown>[] = []
    for (let index = 0; index < selected.length; index += 1) {
      const bytes = readRegularFile(fileSystem, selected[index]!, snapshots[index]!)
      objects.push(decodeJsonObject(bytes))
    }

    try {
      return addSession(parseContractVerificationArtifacts(objects))
    } catch (error) {
      if (
        error instanceof ContractVerificationDomainError ||
        error instanceof ContractVerificationArtifactIntakeError
      ) {
        throw error
      }
      return fail('invalid-json')
    }
  }

  const select = (token: unknown, contractIdentifier: unknown): ContractVerificationArtifactIntakeHandle => {
    const session = sessionFor(token)
    const artifact = session.artifact!
    if (typeof contractIdentifier !== 'string' || !artifact.contractCandidates.includes(contractIdentifier)) {
      return fail('invalid-contract-selection')
    }

    const replacementToken = newToken()
    sessions.delete(token as string)
    session.contractIdentifier = contractIdentifier
    sessions.set(replacementToken, session)
    return handle(replacementToken, session)
  }

  const peek = (token: unknown): ContractVerificationArtifactIntakeSummary => {
    const session = sessionFor(token)
    return rendererSummary(session.artifact!, session.contractIdentifier)
  }

  const consume = (token: unknown): ConsumedContractVerificationArtifact => {
    const session = sessionFor(token)
    const artifact = session.artifact!
    if (artifact.contractCandidates.length > 1 && session.contractIdentifier === null) {
      return fail('contract-selection-required')
    }
    const consumed = Object.freeze({
      artifact,
      contractIdentifier: session.contractIdentifier
    })
    sessions.delete(token as string)
    clearSession(session)
    return consumed
  }

  const dispose = (token: unknown): void => {
    const session = sessionFor(token)
    sessions.delete(token as string)
    clearSession(session)
  }

  return Object.freeze({ inspect, select, peek, consume, dispose })
}
