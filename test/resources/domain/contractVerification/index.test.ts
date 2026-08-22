import {
  canonicalContractVerificationJson,
  CONTRACT_VERIFICATION_DOMAIN_ERROR_CODES,
  ContractVerificationDomainError,
  hashContractVerificationSources,
  hashContractVerificationSubmission,
  matchContractVerificationRuntimeCode,
  MAX_CONTRACT_VERIFICATION_CANDIDATES,
  MAX_CONTRACT_VERIFICATION_JOBS,
  MAX_CONTRACT_VERIFICATION_JSON_DEPTH,
  MAX_CONTRACT_VERIFICATION_REMOTE_ID_CHARS,
  MAX_CONTRACT_VERIFICATION_SOURCE_CONTENT_BYTES,
  MAX_CONTRACT_VERIFICATION_SOURCE_COUNT,
  MAX_CONTRACT_VERIFICATION_SOURCE_PATH_CHARS,
  MAX_CONTRACT_VERIFICATION_SOURCE_URLS,
  parseContractVerificationArtifacts,
  prepareContractVerificationSubmission,
  sha256ContractVerificationJson,
  summarizeContractVerificationArtifact,
  validateContractVerificationJobLedger,
  validateContractVerificationTarget
} from '../../../../resources/domain/contractVerification'

const standardInput = (language: 'Solidity' | 'Vyper' = 'Solidity') => ({
  language,
  sources: { 'contracts/Counter.sol': { content: 'contract Counter {}' } },
  settings: { optimizer: { enabled: true, runs: 200 } }
})

const compilerOutput = (deployedBytecode: Record<string, unknown> = { object: '600061' }) => ({
  contracts: {
    'contracts/Counter.sol': {
      Counter: { evm: { deployedBytecode } },
      InterfaceOnly: { evm: { deployedBytecode: { object: '' } } }
    }
  },
  sources: { 'contracts/Counter.sol': { id: 0 } }
})

const hardhat2 = () => ({
  id: 'build-1',
  _format: 'hh-sol-build-info-1',
  solcVersion: '0.8.28',
  solcLongVersion: '0.8.28+commit.7893614a',
  input: standardInput(),
  output: compilerOutput()
})

const foundry = () => ({
  ...hardhat2(),
  _format: 'ethers-rs-sol-build-info-1',
  source_id_to_path: { 0: 'contracts/Counter.sol' },
  language: 'Solidity'
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

const target = {
  address: '0x1111111111111111111111111111111111111111',
  chainId: 1,
  runtimeCodeHash: `0x${'44'.repeat(32)}`
}

const job = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  target,
  language: 'Solidity',
  compilerVersion: '0.8.28+commit.7893614a',
  contractIdentifier: 'contracts/Counter.sol:Counter',
  sourceHash: '55'.repeat(32),
  submissionHash: '66'.repeat(32),
  status: 'partial',
  destinations: [
    {
      destination: 'sourcify',
      status: 'published',
      statusUrl: 'https://sourcify.dev/check/1/0x1111111111111111111111111111111111111111'
    },
    { destination: 'etherscan-direct', status: 'needs-api-key', reasonCode: 'api-key-required' }
  ],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000
}

function expectCode(run: () => unknown, code: string) {
  expect(run).toThrow(expect.objectContaining({ name: 'ContractVerificationDomainError', code }))
}

describe('artifact format detection and renderer summary', () => {
  it('detects raw Solidity and Vyper standard JSON by shape and keeps source out of its summary', () => {
    const solidity = parseContractVerificationArtifacts([standardInput()])
    const vyperInput = {
      ...standardInput('Vyper'),
      sources: { 'contracts/Counter.vy': { content: '@external\ndef ping(): pass' } },
      storage_layout_overrides: {}
    }
    const vyper = parseContractVerificationArtifacts([vyperInput])

    expect(summarizeContractVerificationArtifact(solidity)).toEqual({
      format: 'solidity-standard-json',
      language: 'Solidity',
      compilerStatus: 'required',
      compilerVersion: null,
      sourceCount: 1,
      contractCandidates: [],
      localRuntimeMatch: false
    })
    expect(summarizeContractVerificationArtifact(vyper)).toEqual(
      expect.objectContaining({ format: 'vyper-standard-json', language: 'Vyper' })
    )
    expect(JSON.stringify(summarizeContractVerificationArtifact(solidity))).not.toContain('contract Counter')
    expect(Object.isFrozen(solidity)).toBe(true)
    expect(Object.isFrozen(solidity.stdJsonInput)).toBe(true)
    expect(Object.isFrozen(solidity.stdJsonInput['sources'])).toBe(true)
  })

  it.each([
    ['Hardhat 2', hardhat2(), 'hardhat-2-build-info'],
    ['Foundry', foundry(), 'foundry-build-info']
  ])('accepts complete %s build-info and derives only deployable candidates', (_name, value, format) => {
    const artifact = parseContractVerificationArtifacts([value])
    expect(summarizeContractVerificationArtifact(artifact)).toEqual({
      format,
      language: 'Solidity',
      compilerStatus: 'included',
      compilerVersion: '0.8.28+commit.7893614a',
      sourceCount: 1,
      contractCandidates: ['contracts/Counter.sol:Counter'],
      localRuntimeMatch: true
    })
  })

  it('accepts an order-independent matching Hardhat 3 input/output pair', () => {
    expect(
      summarizeContractVerificationArtifact(parseContractVerificationArtifacts([hh3Output(), hh3Input()]))
    ).toEqual(expect.objectContaining({ format: 'hardhat-3-build-info', localRuntimeMatch: true }))
  })

  it('requires and validates Foundry source context without broadening Hardhat envelopes', () => {
    expectCode(
      () => parseContractVerificationArtifacts([{ ...foundry(), language: 'Vyper' }]),
      'invalid-artifact'
    )
    expectCode(
      () =>
        parseContractVerificationArtifacts([
          { ...foundry(), source_id_to_path: { 0: 'contracts/Missing.sol' } }
        ]),
      'invalid-artifact'
    )
    const {
      source_id_to_path: _sourceMap,
      language: _language,
      ...hardhatWithFoundryFieldsRemoved
    } = foundry()
    expectCode(
      () => parseContractVerificationArtifacts([hardhatWithFoundryFieldsRemoved]),
      'invalid-artifact'
    )
    expectCode(
      () =>
        parseContractVerificationArtifacts([
          { ...hardhat2(), source_id_to_path: { 0: 'contracts/Counter.sol' }, language: 'Solidity' }
        ]),
      'invalid-artifact'
    )
  })

  it('rejects incomplete, mismatched, extra, unknown, and filename-independent shapes', () => {
    expectCode(() => parseContractVerificationArtifacts([]), 'invalid-artifact-bundle')
    expectCode(() => parseContractVerificationArtifacts([{}, {}, {}]), 'too-many-artifacts')
    expectCode(() => parseContractVerificationArtifacts([hh3Input()]), 'missing-build-output')
    expectCode(
      () => parseContractVerificationArtifacts([hh3Input(), { ...hh3Output(), id: 'other' }]),
      'mismatched-build-info-pair'
    )
    expectCode(() => parseContractVerificationArtifacts([hh3Output()]), 'invalid-artifact-bundle')
    expectCode(() => parseContractVerificationArtifacts([{ ...hardhat2(), extra: true }]), 'invalid-artifact')
    expectCode(
      () => parseContractVerificationArtifacts([{ ...hardhat2(), _format: 'future-build-info' }]),
      'unsupported-artifact-format'
    )
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), language: 'Yul' }]),
      'unsupported-language'
    )
  })

  it('uses own data properties without invoking accessors or trusting prototypes', () => {
    let accessed = false
    const malicious = Object.create(null)
    Object.defineProperty(malicious, 'language', {
      enumerable: true,
      get: () => {
        accessed = true
        return 'Solidity'
      }
    })
    malicious.sources = standardInput().sources
    malicious.settings = {}

    expectCode(() => parseContractVerificationArtifacts([malicious]), 'invalid-artifact')
    expect(accessed).toBe(false)
    expectCode(
      () => parseContractVerificationArtifacts([Object.assign(Object.create({}), standardInput())]),
      'invalid-artifact'
    )

    const accessorBundle: unknown[] = []
    Object.defineProperty(accessorBundle, '0', {
      enumerable: true,
      get: () => {
        accessed = true
        return standardInput()
      }
    })
    accessorBundle.length = 1
    expectCode(() => parseContractVerificationArtifacts(accessorBundle), 'invalid-artifact-bundle')
    expect(accessed).toBe(false)
  })
})

describe('bounded standard JSON', () => {
  it('normalizes compiler-optional settings to an empty exact object', () => {
    const { settings: _settings, ...withoutSettings } = standardInput()
    const artifact = parseContractVerificationArtifacts([withoutSettings])
    expect(artifact.stdJsonInput['settings']).toEqual({})
    expect(Object.isFrozen(artifact.stdJsonInput['settings'])).toBe(true)
  })

  it('counts UTF-8 bytes and rejects one source beyond the byte cap', () => {
    const atLimit = 'x'.repeat(MAX_CONTRACT_VERIFICATION_SOURCE_CONTENT_BYTES)
    expect(
      parseContractVerificationArtifacts([
        { ...standardInput(), sources: { 'Large.sol': { content: atLimit } } }
      ]).sourceCount
    ).toBe(1)
    const tooLarge = '😀'.repeat(Math.floor(MAX_CONTRACT_VERIFICATION_SOURCE_CONTENT_BYTES / 4) + 1)
    expectCode(
      () =>
        parseContractVerificationArtifacts([
          { ...standardInput(), sources: { 'Large.sol': { content: tooLarge } } }
        ]),
      'source-content-too-large'
    )
  })

  it('enforces total source bytes before the independent canonical submission cap', () => {
    const content = 'x'.repeat(MAX_CONTRACT_VERIFICATION_SOURCE_CONTENT_BYTES)
    const sources = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`${index}.sol`, { content }]))
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), sources: sources(9) }]),
      'total-source-content-too-large'
    )
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), sources: sources(8) }]),
      'submission-too-large'
    )
  })

  it('accepts the source-count limit and rejects one more', () => {
    const sources = Object.fromEntries(
      Array.from({ length: MAX_CONTRACT_VERIFICATION_SOURCE_COUNT }, (_, index) => [
        `${index}.sol`,
        { content: '' }
      ])
    )
    expect(parseContractVerificationArtifacts([{ ...standardInput(), sources }]).sourceCount).toBe(
      MAX_CONTRACT_VERIFICATION_SOURCE_COUNT
    )
    sources['overflow.sol'] = { content: '' }
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), sources }]),
      'too-many-sources'
    )
  })

  it('rejects empty, padded, control-containing, and over-limit paths', () => {
    for (const sourcePath of [
      '',
      ' padded.sol',
      'padded.sol ',
      'bad\npath.sol',
      'a'.repeat(MAX_CONTRACT_VERIFICATION_SOURCE_PATH_CHARS + 1)
    ]) {
      expect(() =>
        parseContractVerificationArtifacts([
          { ...standardInput(), sources: { [sourcePath]: { content: '' } } }
        ])
      ).toThrow(ContractVerificationDomainError)
    }
  })

  it('accepts bounded source metadata and rejects unknown source keys', () => {
    const artifact = parseContractVerificationArtifacts([
      {
        ...standardInput(),
        sources: {
          'Counter.sol': {
            content: '',
            keccak256: `0x${'ab'.repeat(32)}`,
            urls: ['dweb:/ipfs/example', 'bzz-raw://example']
          }
        }
      }
    ])
    expect(artifact.sourceCount).toBe(1)
    expectCode(
      () =>
        parseContractVerificationArtifacts([
          { ...standardInput(), sources: { 'Counter.sol': { content: '', unknown: true } } }
        ]),
      'invalid-source-content'
    )
    expectCode(
      () =>
        parseContractVerificationArtifacts([
          {
            ...standardInput(),
            sources: {
              'Counter.sol': {
                content: '',
                urls: Array(MAX_CONTRACT_VERIFICATION_SOURCE_URLS + 1).fill('ipfs://example')
              }
            }
          }
        ]),
      'invalid-source-content'
    )
  })

  it('accepts the maximum canonical JSON depth and rejects one level more', () => {
    const nested = (depth: number): unknown => {
      let value: unknown = null
      for (let index = 0; index < depth; index += 1) value = { value }
      return value
    }
    expect(canonicalContractVerificationJson(nested(MAX_CONTRACT_VERIFICATION_JSON_DEPTH))).toContain('null')
    expectCode(
      () => canonicalContractVerificationJson(nested(MAX_CONTRACT_VERIFICATION_JSON_DEPTH + 1)),
      'artifact-too-deep'
    )
  })

  it('rejects excessive depth, cycles, sparse arrays, and non-finite numbers', () => {
    let nested: Record<string, unknown> = {}
    for (let index = 0; index <= MAX_CONTRACT_VERIFICATION_JSON_DEPTH; index += 1) nested = { nested }
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), settings: nested }]),
      'artifact-too-deep'
    )

    const cycle: Record<string, unknown> = {}
    cycle['cycle'] = cycle
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), settings: cycle }]),
      'invalid-artifact'
    )
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), settings: { sparse: new Array(2) } }]),
      'invalid-artifact'
    )
    expectCode(
      () => parseContractVerificationArtifacts([{ ...standardInput(), settings: { runs: Infinity } }]),
      'invalid-artifact'
    )
  })

  it('caps candidate traversal before filtering empty runtime objects', () => {
    const contracts = Object.fromEntries(
      Array.from({ length: MAX_CONTRACT_VERIFICATION_CANDIDATES + 1 }, (_, index) => [
        `Contract${index}`,
        { evm: { deployedBytecode: { object: index === 0 ? '60' : '' } } }
      ])
    )
    expectCode(
      () =>
        parseContractVerificationArtifacts([
          { ...hardhat2(), output: { contracts: { 'Counter.sol': contracts } } }
        ]),
      'too-many-contracts'
    )
  })

  it('accepts exactly the candidate limit', () => {
    const contracts = Object.fromEntries(
      Array.from({ length: MAX_CONTRACT_VERIFICATION_CANDIDATES }, (_, index) => [
        `Contract${index}`,
        { evm: { deployedBytecode: { object: '60' } } }
      ])
    )
    expect(
      parseContractVerificationArtifacts([
        { ...hardhat2(), output: { contracts: { 'Counter.sol': contracts } } }
      ]).contractCandidates
    ).toHaveLength(MAX_CONTRACT_VERIFICATION_CANDIDATES)
  })
})

describe('canonical publication selection and hashes', () => {
  it('sorts object keys, preserves array order, normalizes negative zero, and matches SHA-256 vectors', () => {
    expect(canonicalContractVerificationJson({ z: -0, a: [2, 1] })).toBe('{"a":[2,1],"z":0}')
    expect(sha256ContractVerificationJson({ hello: 'world' })).toBe(
      '93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588'
    )
  })

  it('requires exact compiler and fully qualified source contract for raw input', () => {
    const artifact = parseContractVerificationArtifacts([standardInput()])
    expectCode(
      () =>
        prepareContractVerificationSubmission(artifact, {
          contractIdentifier: 'contracts/Counter.sol:Counter'
        }),
      'missing-compiler-version'
    )
    expectCode(
      () =>
        prepareContractVerificationSubmission(artifact, {
          compilerVersion: 'latest',
          contractIdentifier: 'contracts/Counter.sol:Counter'
        }),
      'invalid-compiler-version'
    )
    expectCode(
      () =>
        prepareContractVerificationSubmission(artifact, {
          compilerVersion: '0.8.28+commit.7893614a',
          contractIdentifier: 'Counter'
        }),
      'invalid-contract-identifier'
    )

    const submission = prepareContractVerificationSubmission(artifact, {
      compilerVersion: '0.8.28+commit.7893614a',
      contractIdentifier: 'contracts/Counter.sol:Counter'
    })
    expect(submission).toEqual(
      expect.objectContaining({
        compilerVersion: '0.8.28+commit.7893614a',
        contractIdentifier: 'contracts/Counter.sol:Counter',
        localRuntimeMatch: false,
        sourceHash: hashContractVerificationSources(artifact)
      })
    )
    expect(submission.sourceHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(submission.submissionHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(submission.submissionHash).toBe(
      hashContractVerificationSubmission(artifact, {
        compilerVersion: '0.8.28+commit.7893614a',
        contractIdentifier: 'contracts/Counter.sol:Counter'
      })
    )
    expect(Object.isFrozen(submission)).toBe(true)
  })

  it('binds build-info to its included exact compiler and candidate', () => {
    const artifact = parseContractVerificationArtifacts([hardhat2()])
    expectCode(
      () =>
        prepareContractVerificationSubmission(artifact, {
          compilerVersion: '0.8.27+commit.40a35a09',
          contractIdentifier: 'contracts/Counter.sol:Counter'
        }),
      'invalid-compiler-version'
    )
    expectCode(
      () =>
        prepareContractVerificationSubmission(artifact, {
          contractIdentifier: 'contracts/Counter.sol:Other'
        }),
      'invalid-contract-identifier'
    )
  })
})

describe('declared-reference-only runtime matching', () => {
  const artifactWith = (deployed: Record<string, unknown>) =>
    parseContractVerificationArtifacts([{ ...hardhat2(), output: compilerOutput(deployed) }])

  it('matches exact bytes and masks only declared link and immutable ranges', () => {
    const artifact = artifactWith({
      object: '60____000061',
      linkReferences: { 'Library.sol': { Library: [{ start: 1, length: 2 }] } },
      immutableReferences: { '0': [{ start: 3, length: 2 }] }
    })
    expect(
      matchContractVerificationRuntimeCode(artifact, 'contracts/Counter.sol:Counter', '0x60aabbccdd61')
    ).toEqual({
      matched: true,
      runtimeBytes: 6,
      maskedRanges: [
        { start: 1, length: 2 },
        { start: 3, length: 2 }
      ]
    })
  })

  it('does not strip or guess metadata and rejects unmasked differences or malformed code', () => {
    const artifact = artifactWith({ object: '600061' })
    expectCode(
      () => matchContractVerificationRuntimeCode(artifact, 'contracts/Counter.sol:Counter', '0x600062'),
      'runtime-bytecode-mismatch'
    )
    expectCode(
      () => matchContractVerificationRuntimeCode(artifact, 'contracts/Counter.sol:Counter', '0x6000'),
      'runtime-bytecode-mismatch'
    )
    expectCode(
      () => matchContractVerificationRuntimeCode(artifact, 'contracts/Counter.sol:Counter', '0xzz'),
      'invalid-runtime-code'
    )
    expectCode(
      () =>
        matchContractVerificationRuntimeCode(
          artifactWith({ object: '60zz61' }),
          'contracts/Counter.sol:Counter',
          '0x600061'
        ),
      'invalid-deployed-bytecode'
    )
  })

  it.each([
    [
      'invalid-bytecode-reference',
      { object: '600061', immutableReferences: { 0: [{ start: -1, length: 1 }] } }
    ],
    [
      'overlapping-bytecode-reference',
      {
        object: '60000061',
        linkReferences: { 'L.sol': { L: [{ start: 1, length: 2 }] } },
        immutableReferences: { 0: [{ start: 2, length: 1 }] }
      }
    ],
    [
      'bytecode-reference-out-of-range',
      { object: '600061', immutableReferences: { 0: [{ start: 2, length: 2 }] } }
    ]
  ])('rejects %s', (code, deployed) => {
    expectCode(
      () =>
        matchContractVerificationRuntimeCode(
          artifactWith(deployed),
          'contracts/Counter.sol:Counter',
          `0x${'00'.repeat((deployed.object as string).length / 2)}`
        ),
      code
    )
  })

  it('never offers local matching for raw standard JSON', () => {
    expectCode(
      () =>
        matchContractVerificationRuntimeCode(
          parseContractVerificationArtifacts([standardInput()]),
          'contracts/Counter.sol:Counter',
          '0x600061'
        ),
      'local-match-unavailable'
    )
  })
})

describe('exact target and privacy-minimal job ledger', () => {
  it('accepts and freezes a canonical evidence-bound target', () => {
    const parsed = validateContractVerificationTarget(target)
    expect(parsed).toEqual(target)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('accepts optional all-or-none immutable creation evidence', () => {
    const withEvidence = validateContractVerificationTarget({
      ...target,
      creationEvidence: {
        transactionHash: `0x${'22'.repeat(32)}`,
        blockNumber: '0xa',
        blockHash: `0x${'33'.repeat(32)}`,
        operationId: '123e4567-e89b-42d3-a456-426614174000'
      }
    })
    expect(withEvidence.creationEvidence).toEqual({
      transactionHash: `0x${'22'.repeat(32)}`,
      blockNumber: '0xa',
      blockHash: `0x${'33'.repeat(32)}`,
      operationId: '123e4567-e89b-42d3-a456-426614174000'
    })
    expect(Object.isFrozen(withEvidence.creationEvidence)).toBe(true)
    expectCode(
      () =>
        validateContractVerificationTarget({
          ...target,
          creationEvidence: { transactionHash: `0x${'22'.repeat(32)}` }
        }),
      'invalid-target'
    )
  })

  it.each([
    { ...target, address: target.address.toUpperCase() },
    { ...target, chainId: 0 },
    { ...target, chainId: Number.MAX_SAFE_INTEGER + 1 },
    { ...target, extra: true }
  ])('rejects noncanonical or inexact target %p', (value) => {
    expectCode(() => validateContractVerificationTarget(value), 'invalid-target')
  })

  it('accepts only bounded, ordered, source-free destination records', () => {
    const parsed = validateContractVerificationJobLedger([job])
    expect(parsed).toEqual([
      {
        ...job,
        destinations: [
          {
            ...job.destinations[0],
            statusUrl: `${job.destinations[0]!.statusUrl}`
          },
          job.destinations[1]
        ]
      }
    ])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed[0])).toBe(true)
    expect(JSON.stringify(parsed)).not.toContain('stdJsonInput')
    expect(JSON.stringify(parsed)).not.toContain('apiKey')
  })

  it('distinguishes forwarded explorer observations from direct fallback', () => {
    const destinations = [
      { destination: 'sourcify', status: 'published' },
      { destination: 'etherscan-forwarded', status: 'verified' },
      { destination: 'blockscout-forwarded', status: 'unavailable' },
      { destination: 'routescan-forwarded', status: 'unknown' },
      { destination: 'etherscan-direct', status: 'already-verified', reasonCode: 'already-verified' }
    ]
    expect(validateContractVerificationJobLedger([{ ...job, destinations }])[0]!.destinations).toEqual(
      destinations
    )
    expectCode(
      () =>
        validateContractVerificationJobLedger([
          { ...job, destinations: [{ destination: 'etherscan-forwarded', status: 'published' }] }
        ]),
      'invalid-job-ledger'
    )
    expectCode(
      () =>
        validateContractVerificationJobLedger([
          { ...job, destinations: [{ destination: 'sourcify', status: 'needs-api-key' }] }
        ]),
      'invalid-job-ledger'
    )
  })

  it('persists only bounded opaque polling IDs on meaningful direct jobs', () => {
    for (const destination of [
      { destination: 'sourcify', status: 'checking', remoteId: 'sourcify-job_1:poll' },
      { destination: 'sourcify', status: 'published', remoteId: 'sourcify-job_1:poll' },
      { destination: 'sourcify', status: 'rejected', remoteId: 'sourcify-job_1:poll' },
      { destination: 'etherscan-direct', status: 'checking', remoteId: 'GUID.123-abc:def' },
      { destination: 'etherscan-direct', status: 'needs-api-key', remoteId: 'GUID.123-abc:def' },
      { destination: 'etherscan-direct', status: 'already-verified', remoteId: 'GUID.123-abc:def' }
    ]) {
      const destinations =
        destination.destination === 'sourcify'
          ? [destination]
          : [{ destination: 'sourcify', status: 'published' }, destination]
      expect(validateContractVerificationJobLedger([{ ...job, destinations }])[0]!.destinations).toEqual(
        destinations
      )
    }

    for (const destinations of [
      [{ destination: 'sourcify', status: 'checking' }],
      [
        { destination: 'sourcify', status: 'published' },
        { destination: 'etherscan-direct', status: 'checking' }
      ],
      [{ destination: 'sourcify', status: 'published', remoteId: 'contains whitespace' }],
      [
        {
          destination: 'sourcify',
          status: 'published',
          remoteId: 'a'.repeat(MAX_CONTRACT_VERIFICATION_REMOTE_ID_CHARS + 1)
        }
      ],
      [
        { destination: 'sourcify', status: 'published' },
        { destination: 'etherscan-forwarded', status: 'verified', remoteId: 'not-owned-by-wren' }
      ],
      [
        { destination: 'sourcify', status: 'published' },
        { destination: 'etherscan-direct', status: 'rejected', remoteId: 'terminal-but-not-pollable' }
      ],
      [{ destination: 'sourcify', status: 'published', remoteId: 'valid', opaqueId: 'extra' }]
    ]) {
      expectCode(
        () => validateContractVerificationJobLedger([{ ...job, destinations }]),
        'invalid-job-ledger'
      )
    }
  })

  it('rejects duplicate IDs, invalid ordering, extra secret/source fields, and excessive records', () => {
    expectCode(() => validateContractVerificationJobLedger([job, job]), 'invalid-job-ledger')
    expectCode(
      () =>
        validateContractVerificationJobLedger([{ ...job, destinations: [...job.destinations].reverse() }]),
      'invalid-job-ledger'
    )
    expectCode(
      () => validateContractVerificationJobLedger([{ ...job, apiKey: 'secret' }]),
      'invalid-job-ledger'
    )
    expectCode(
      () =>
        validateContractVerificationJobLedger([
          {
            ...job,
            destinations: [{ ...job.destinations[0], source: standardInput() }]
          }
        ]),
      'invalid-job-ledger'
    )
    expectCode(
      () => validateContractVerificationJobLedger(Array(MAX_CONTRACT_VERIFICATION_JOBS + 1).fill(job)),
      'too-many-jobs'
    )
    expectCode(() => validateContractVerificationJobLedger(new Array(1)), 'invalid-job-ledger')
  })

  it('accepts exactly the non-secret ledger record limit', () => {
    const records = Array.from({ length: MAX_CONTRACT_VERIFICATION_JOBS }, (_, index) => ({
      ...job,
      id: `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`
    }))
    expect(validateContractVerificationJobLedger(records)).toHaveLength(MAX_CONTRACT_VERIFICATION_JOBS)
  })

  it('exposes only fixed kebab-case public errors and messages', () => {
    expect(CONTRACT_VERIFICATION_DOMAIN_ERROR_CODES.length).toBeGreaterThan(20)
    for (const code of CONTRACT_VERIFICATION_DOMAIN_ERROR_CODES) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/u)
      const error = new ContractVerificationDomainError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
    }
  })
})
