import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

import {
  CONTRACT_VERIFICATION_INTAKE_SESSION_TTL_MS,
  contractVerificationArtifactErrorCode,
  ContractVerificationArtifactIntakeError,
  createContractVerificationArtifactIntake,
  MAX_CONTRACT_VERIFICATION_ARTIFACT_BUNDLE_BYTES,
  MAX_CONTRACT_VERIFICATION_ARTIFACT_FILE_BYTES,
  type ContractVerificationArtifactFileChooser,
  type ContractVerificationArtifactIntakeErrorCode
} from '../../../main/contractVerification/artifactIntake'
import { ContractVerificationDomainError } from '../../../resources/domain/contractVerification'

const VYPER_SOLC_JSON_FIXTURE = path.resolve(
  __dirname,
  '../../fixtures/contractVerification/vyper-0.4.3-solc-json.json'
)

const UUIDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005'
]

const standardInput = () => ({
  language: 'Solidity',
  sources: { 'contracts/Counter.sol': { content: 'contract Counter {}' } },
  settings: {}
})

const compilerOutput = (second = false) => ({
  contracts: {
    'contracts/Counter.sol': {
      Counter: { evm: { deployedBytecode: { object: '600061' } } },
      ...(second ? { Other: { evm: { deployedBytecode: { object: '600062' } } } } : {})
    }
  }
})

const hardhat2 = (second = false) => ({
  id: 'build-1',
  _format: 'hh-sol-build-info-1',
  solcVersion: '0.8.28',
  solcLongVersion: '0.8.28+commit.7893614a',
  input: standardInput(),
  output: compilerOutput(second)
})

const hh3Input = () => ({
  _format: 'hh3-sol-build-info-1',
  id: 'build-3',
  solcVersion: '0.8.28',
  solcLongVersion: '0.8.28+commit.7893614a',
  input: standardInput()
})

const hh3Output = () => ({
  _format: 'hh3-sol-build-info-output-1',
  id: 'build-3',
  output: compilerOutput()
})

let roots: string[] = []

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
  roots = []
  jest.restoreAllMocks()
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-artifact-intake-'))
  roots.push(root)
  return root
}

function writeJson(root: string, name: string, value: unknown): string {
  const target = path.join(root, name)
  fs.writeFileSync(target, JSON.stringify(value))
  return target
}

function chooserFor(paths: readonly string[]): ContractVerificationArtifactFileChooser {
  return async () => ({ canceled: false, filePaths: paths })
}

function uuidSequence() {
  let index = 0
  return () => UUIDS[index++]!
}

function expectIntakeCode(run: () => unknown, code: ContractVerificationArtifactIntakeErrorCode) {
  try {
    const result = run()
    if (result instanceof Promise) {
      return expect(result).rejects.toMatchObject({
        name: 'ContractVerificationArtifactIntakeError',
        code
      })
    }
  } catch (error) {
    expect(error).toMatchObject({ name: 'ContractVerificationArtifactIntakeError', code })
    return undefined
  }
  throw new Error('Expected artifact intake to fail')
}

test('allows user cancellation without creating a session', async () => {
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: async () => ({ canceled: true, filePaths: ['/private/source.json'] })
  })

  await expect(intake.inspect()).resolves.toBeUndefined()
})

test('accepts one JSON file and exposes only a deeply frozen bounded summary', async () => {
  const root = fixture()
  const source = writeJson(root, 'artifact.json', hardhat2())
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([source]),
    randomUUID: uuidSequence()
  })

  const handle = await intake.inspect()

  expect(handle).toEqual({
    token: UUIDS[0],
    summary: {
      format: 'hardhat-2-build-info',
      language: 'Solidity',
      compilerStatus: 'included',
      compilerVersion: '0.8.28+commit.7893614a',
      sourceCount: 1,
      contractCandidates: ['contracts/Counter.sol:Counter'],
      localRuntimeMatch: true,
      selectionRequired: false,
      selectedContractIdentifier: 'contracts/Counter.sol:Counter'
    }
  })
  expect(Object.isFrozen(handle)).toBe(true)
  expect(Object.isFrozen(handle?.summary)).toBe(true)
  expect(Object.isFrozen(handle?.summary.contractCandidates)).toBe(true)
  expect(JSON.stringify(handle)).not.toContain('contract Counter')
  expect(JSON.stringify(handle)).not.toContain(root)
})

test('accepts exactly two matching JSON artifacts and opens each with O_NOFOLLOW', async () => {
  const root = fixture()
  const input = writeJson(root, 'input.json', hh3Input())
  const output = writeJson(root, 'output.json', hh3Output())
  const open = jest.spyOn(fs, 'openSync')
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([input, output]),
    randomUUID: uuidSequence()
  })

  const handle = await intake.inspect()

  expect(handle?.summary.format).toBe('hardhat-3-build-info')
  for (const target of [input, output]) {
    const call = open.mock.calls.find(([candidate]) => candidate === target)
    expect(call).toBeDefined()
    expect((call?.[1] as number) & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW)
  }
})

test('accepts a Vyper 0.4.3 solc_json artifact without exposing its source in the handle', async () => {
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([VYPER_SOLC_JSON_FIXTURE]),
    randomUUID: uuidSequence()
  })

  const handle = await intake.inspect()

  expect(handle).toEqual({
    token: UUIDS[0],
    summary: {
      format: 'vyper-solc-json',
      language: 'Vyper',
      compilerStatus: 'included',
      compilerVersion: '0.4.3+commit.bff19ea2',
      sourceCount: 1,
      contractCandidates: [],
      localRuntimeMatch: false,
      selectionRequired: false,
      selectedContractIdentifier: null
    }
  })
  expect(JSON.stringify(handle)).not.toContain('#pragma version')
  expect(JSON.stringify(handle)).not.toContain('sha256sum')

  const consumed = intake.consume(handle!.token)
  expect(consumed.artifact.stdJsonInput).not.toHaveProperty('compiler_version')
  expect(consumed.artifact.stdJsonInput['sources']?.['contracts/simple/LastClaimWins.vy']).not.toHaveProperty(
    'sha256sum'
  )
})

test.each([
  [[], 'invalid-file-selection'],
  [['one.json', 'two.json', 'three.json'], 'invalid-file-selection'],
  [['artifact.txt'], 'invalid-file-selection'],
  [['same.json', 'same.json'], 'invalid-file-selection']
] as const)('rejects invalid chooser selection %j', async (selected, code) => {
  const intake = createContractVerificationArtifactIntake({ chooseFiles: chooserFor(selected) })
  await expectIntakeCode(() => intake.inspect(), code)
})

test('rejects directories, FIFOs, and symlinks before descriptor reads', async () => {
  const root = fixture()
  const directory = path.join(root, 'directory.json')
  const fifo = path.join(root, 'pipe.json')
  const target = writeJson(root, 'target.json', standardInput())
  const link = path.join(root, 'link.json')
  fs.mkdirSync(directory)
  execFileSync('mkfifo', [fifo])
  fs.symlinkSync(target, link)
  const open = jest.spyOn(fs, 'openSync')

  for (const source of [directory, fifo, link]) {
    const intake = createContractVerificationArtifactIntake({ chooseFiles: chooserFor([source]) })
    await expectIntakeCode(() => intake.inspect(), 'invalid-file')
  }
  expect(open).not.toHaveBeenCalled()
})

test('rejects a path replacement during descriptor reading', async () => {
  const root = fixture()
  const source = writeJson(root, 'artifact.json', standardInput())
  const moved = path.join(root, 'original.json')
  let replaced = false
  const fileSystem = Object.create(fs) as typeof fs
  fileSystem.readSync = (descriptor, buffer, offset, length, position) => {
    const count = fs.readSync(descriptor, buffer, offset, length, position)
    if (!replaced) {
      replaced = true
      fs.renameSync(source, moved)
      fs.writeFileSync(source, JSON.stringify(standardInput()))
    }
    return count
  }
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([source]),
    fileSystem
  })

  await expectIntakeCode(() => intake.inspect(), 'invalid-file')
})

test('rejects per-file and aggregate size limits before reading contents', async () => {
  const root = fixture()
  const oversized = path.join(root, 'oversized.json')
  fs.writeFileSync(oversized, '')
  fs.truncateSync(oversized, MAX_CONTRACT_VERIFICATION_ARTIFACT_FILE_BYTES + 1)
  await expectIntakeCode(
    () => createContractVerificationArtifactIntake({ chooseFiles: chooserFor([oversized]) }).inspect(),
    'artifact-file-too-large'
  )

  const first = path.join(root, 'first.json')
  const second = path.join(root, 'second.json')
  fs.writeFileSync(first, '')
  fs.writeFileSync(second, '')
  fs.truncateSync(first, MAX_CONTRACT_VERIFICATION_ARTIFACT_BUNDLE_BYTES / 2 + 1)
  fs.truncateSync(second, MAX_CONTRACT_VERIFICATION_ARTIFACT_BUNDLE_BYTES / 2 + 1)
  await expectIntakeCode(
    () =>
      createContractVerificationArtifactIntake({
        chooseFiles: chooserFor([first, second])
      }).inspect(),
    'artifact-bundle-too-large'
  )
})

test('rejects invalid UTF-8, invalid JSON, and non-object JSON with bounded errors', async () => {
  const root = fixture()
  const invalidUtf8 = path.join(root, 'utf8.json')
  const invalidJson = path.join(root, 'syntax.json')
  const arrayJson = path.join(root, 'array.json')
  fs.writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]))
  fs.writeFileSync(invalidJson, '{"language":')
  fs.writeFileSync(arrayJson, '[]')

  await expectIntakeCode(
    () =>
      createContractVerificationArtifactIntake({
        chooseFiles: chooserFor([invalidUtf8])
      }).inspect(),
    'invalid-utf8'
  )
  await expectIntakeCode(
    () =>
      createContractVerificationArtifactIntake({
        chooseFiles: chooserFor([invalidJson])
      }).inspect(),
    'invalid-json'
  )
  await expectIntakeCode(
    () =>
      createContractVerificationArtifactIntake({
        chooseFiles: chooserFor([arrayJson])
      }).inspect(),
    'invalid-json'
  )
})

test('passes malformed artifact objects through the domain fixed error contract', async () => {
  const root = fixture()
  const source = writeJson(root, 'malformed.json', { language: 'Solidity', sources: {} })
  const intake = createContractVerificationArtifactIntake({ chooseFiles: chooserFor([source]) })

  await expect(intake.inspect()).rejects.toMatchObject({
    name: 'ContractVerificationDomainError',
    code: 'invalid-standard-json',
    message: 'Compiler standard JSON input is invalid'
  })
})

test('preserves fixed intake and domain errors for the renderer boundary', () => {
  expect(
    contractVerificationArtifactErrorCode(
      new ContractVerificationArtifactIntakeError('artifact-file-too-large')
    )
  ).toBe('artifact-file-too-large')
  expect(
    contractVerificationArtifactErrorCode(new ContractVerificationDomainError('source-checksum-mismatch'))
  ).toBe('source-checksum-mismatch')
  expect(contractVerificationArtifactErrorCode(new Error('private detail'))).toBe('invalid-file')
})

test('requires an explicit ambiguous contract choice and rotates the token on every edit', async () => {
  const root = fixture()
  const source = writeJson(root, 'ambiguous.json', hardhat2(true))
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([source]),
    randomUUID: uuidSequence()
  })
  const initial = (await intake.inspect())!

  expect(initial.summary.selectionRequired).toBe(true)
  expectIntakeCode(() => intake.consume(initial.token), 'contract-selection-required')
  expectIntakeCode(
    () => intake.select(initial.token, 'contracts/Counter.sol:Missing'),
    'invalid-contract-selection'
  )

  const selected = intake.select(initial.token, 'contracts/Counter.sol:Other')
  expect(selected.token).toBe(UUIDS[1])
  expect(selected.summary).toEqual(
    expect.objectContaining({
      selectionRequired: false,
      selectedContractIdentifier: 'contracts/Counter.sol:Other'
    })
  )
  expectIntakeCode(() => intake.peek(initial.token), 'invalid-session')

  const edited = intake.select(selected.token, 'contracts/Counter.sol:Counter')
  expect(edited.token).toBe(UUIDS[2])
  expectIntakeCode(() => intake.peek(selected.token), 'invalid-session')
})

test('consume is one-shot and dispose clears a session', async () => {
  const root = fixture()
  const source = writeJson(root, 'artifact.json', hardhat2())
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([source]),
    randomUUID: uuidSequence()
  })
  const consumedHandle = (await intake.inspect())!

  const consumed = intake.consume(consumedHandle.token)
  expect(consumed.contractIdentifier).toBe('contracts/Counter.sol:Counter')
  expect(consumed.artifact.stdJsonInput['sources']).toBeDefined()
  expectIntakeCode(() => intake.consume(consumedHandle.token), 'invalid-session')

  const disposedHandle = (await intake.inspect())!
  intake.dispose(disposedHandle.token)
  expectIntakeCode(() => intake.peek(disposedHandle.token), 'invalid-session')
})

test('expires sessions after ten minutes and does not revive them on replay', async () => {
  const root = fixture()
  const source = writeJson(root, 'artifact.json', standardInput())
  let timestamp = 1_700_000_000_000
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([source]),
    now: () => timestamp,
    randomUUID: uuidSequence()
  })
  const handle = (await intake.inspect())!
  timestamp += CONTRACT_VERIFICATION_INTAKE_SESSION_TTL_MS

  expectIntakeCode(() => intake.peek(handle.token), 'invalid-session')
  timestamp -= 1
  expectIntakeCode(() => intake.peek(handle.token), 'invalid-session')
})

test('keeps at most two sessions and evicts the oldest fail closed', async () => {
  const root = fixture()
  const source = writeJson(root, 'artifact.json', standardInput())
  const intake = createContractVerificationArtifactIntake({
    chooseFiles: chooserFor([source]),
    randomUUID: uuidSequence()
  })
  const first = (await intake.inspect())!
  const second = (await intake.inspect())!
  const third = (await intake.inspect())!

  expectIntakeCode(() => intake.peek(first.token), 'invalid-session')
  expect(intake.peek(second.token).format).toBe('solidity-standard-json')
  expect(intake.peek(third.token).format).toBe('solidity-standard-json')
})

test('never includes source contents or paths in bounded intake failures', async () => {
  const root = fixture()
  const secret = 'PRIVATE_SOURCE_MARKER'
  const source = path.join(root, 'private-artifact.json')
  fs.writeFileSync(source, `{${secret}`)
  const intake = createContractVerificationArtifactIntake({ chooseFiles: chooserFor([source]) })

  try {
    await intake.inspect()
    throw new Error('expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(ContractVerificationArtifactIntakeError)
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(root)
    expect((error as Error).message).toBe('Verification artifact file does not contain valid JSON')
  }
})
