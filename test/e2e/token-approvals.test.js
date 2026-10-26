import fs from 'fs'
import path from 'path'
import { Interface } from 'ethers'

import {
  createEncryptedProfileBackup,
  stageEncryptedProfileRestore,
  runPendingProfileRestore
} from '../../main/profileBackup'
import { migratePersistedConfiguration } from '../../main/profileMigration'
import migrations from '../../main/store/migrate'
import { MainSchema } from '../../main/store/state/types/main'
import { rendererVisibleState, rendererVisibleActions } from '../../main/store/rendererPrivacy'
import { TokenApprovalRevocations } from '../../main/tokenApprovals/revocations'
import { TokenApprovalsService } from '../../main/tokenApprovals/service'
import { ACCOUNT, TARGET, createDappClient, profileStorage, startJsonRpcFixture } from './support/harness'

const spender = '0x3333333333333333333333333333333333333333'
const otherAccount = '0x4444444444444444444444444444444444444444'
const hash = `0x${'ab'.repeat(32)}`
const contract = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
])
const transaction = (overrides = {}) => ({
  from: ACCOUNT,
  to: TARGET,
  chainId: '0x1',
  data: contract.encodeFunctionData('approve', [spender, 100]),
  ...overrides
})

let upstream
let amount
let failure
let hold
let enabled
let savedAccounts
let storage
let service
let fixtureSequence = 0
let tokenContracts

beforeEach(async () => {
  amount = 100n
  failure = false
  hold = undefined
  enabled = true
  savedAccounts = [ACCOUNT]
  tokenContracts = [TARGET]
  upstream = await startJsonRpcFixture(async (payload) => {
    if (payload.method !== 'eth_call') throw new Error('Unexpected RPC method')
    const observedAmount = amount
    if (hold) await hold
    if (failure) return { result: '0x' }
    const [call, block] = payload.params
    expect(block).toBe('latest')
    expect(tokenContracts).toContain(call.to)
    const decoded = contract.decodeFunctionData('allowance', call.data)
    expect(decoded.owner.toLowerCase()).toBe(ACCOUNT)
    expect(decoded.spender.toLowerCase()).toBe(spender)
    return { result: contract.encodeFunctionResult('allowance', [observedAmount]) }
  })
  storage = profileStorage(`observed-token-approvals-${++fixtureSequence}.json`)
  service = createService()
})

afterEach(async () => {
  await upstream.close()
})

function createService() {
  const rpc = createDappClient(upstream.url, 'https://wren-test.invalid')
  return new TokenApprovalsService({
    load: () => storage.load(),
    save: (value) => storage.save(value),
    accounts: () => savedAccounts,
    chainEnabled: (chainId) => enabled && chainId === 1,
    rpc: (chainId, method, params) => {
      expect(chainId).toBe(1)
      return rpc.request(method, params)
    }
  })
}

it('retains an observed pair across restart, reads its live allowance, and prepares a zero-amount review', async () => {
  service.observeSubmitted(transaction(), hash)
  const [observed] = service.list(ACCOUNT)
  expect(observed).toMatchObject({
    account: ACCOUNT,
    token: TARGET,
    spender,
    chainId: 1,
    status: 'unchecked'
  })
  expect(storage.load()).toEqual([
    expect.objectContaining({ account: ACCOUNT, token: TARGET, spender, chainId: 1, transactionHash: hash })
  ])

  service = createService()
  expect(service.list(ACCOUNT)[0].status).toBe('unchecked')
  const [checked] = await service.refresh(ACCOUNT, [observed.id])
  expect(checked).toMatchObject({ status: 'current', amount: '100' })

  const revoke = await service.prepareRevocation(ACCOUNT, observed.id)
  expect(revoke).toMatchObject({ from: ACCOUNT, to: TARGET, chainId: '0x1', value: '0x0' })
  const decoded = contract.decodeFunctionData('approve', revoke.data)
  expect(decoded.spender.toLowerCase()).toBe(spender)
  expect(decoded.amount).toBe(0n)
  expect(upstream.requests.every(({ payload }) => payload.method === 'eth_call')).toBe(true)
  expect(JSON.stringify(storage.load())).not.toMatch(/"amount"|"data"|"value"|"checkedAt"/)

  amount = 0n
  await service.afterExecution(1, hash)
  expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '0' })
  await expect(service.prepareRevocation(ACCOUNT, observed.id)).rejects.toThrow('No allowance to revoke')
})

it('keeps malformed RPC evidence distinct from zero and rechecks before revocation', async () => {
  service.observeSubmitted(transaction(), hash)
  const [{ id }] = service.list(ACCOUNT)
  await service.refresh(ACCOUNT, [id])
  failure = true

  await expect(service.prepareRevocation(ACCOUNT, id)).rejects.toThrow('Allowance unavailable. Try again.')
  expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'unavailable' })
  expect(service.list(ACCOUNT)[0].amount).toBeUndefined()

  enabled = false
  const requestCount = upstream.requests.length
  expect(await service.refresh(ACCOUNT, [id])).toMatchObject([{ status: 'network-off' }])
  expect(upstream.requests).toHaveLength(requestCount)
})

it('checks each confirmed approval when multiple submissions share a pair and block', async () => {
  const earlier = `0x${'cd'.repeat(32)}`
  service.observeSubmitted(transaction(), earlier)
  service.observeSubmitted(transaction({ data: contract.encodeFunctionData('approve', [spender, 0]) }), hash)
  const [{ id }] = service.list(ACCOUNT)
  await service.refresh(ACCOUNT, [id])
  const receipt = {
    transactionHash: earlier,
    status: '0x1',
    logs: [
      { address: TARGET, ...contract.encodeEventLog(contract.getEvent('Approval'), [ACCOUNT, spender, 999]) }
    ]
  }
  amount = 50n
  await service.afterExecution(1, earlier, 'same block and status', { ...receipt, transactionHash: hash })
  expect(service.list(ACCOUNT)[0].amount).toBe('100')
  await service.afterExecution(1, earlier, 'same block and status', receipt)
  expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '50' })
  amount = 0n
  await service.afterExecution(1, hash, 'same block and status')
  expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '0' })
  service.invalidateAccountAllowances(1, otherAccount)
  expect(service.list(ACCOUNT)[0].status).toBe('current')
  service.invalidateAccountAllowances(1, ACCOUNT)
  expect(service.list(ACCOUNT)[0].status).toBe('unchecked')
})

it('rejects foreign candidates and forged references without querying an arbitrary token', async () => {
  service.observeSubmitted(transaction({ from: otherAccount }), hash)
  service.observeSubmitted(transaction({ data: '0x095ea7b3' }), hash)
  service.observeSubmitted(transaction(), 'not-a-hash')
  expect(service.list(ACCOUNT)).toEqual([])

  service.observeSubmitted(transaction(), hash)
  await expect(service.refresh(ACCOUNT, ['0'.repeat(64)])).rejects.toThrow('Approval is no longer available')
  await expect(service.refresh(otherAccount, [service.list(ACCOUNT)[0].id])).rejects.toThrow(
    'Account is unavailable'
  )
  expect(upstream.requests).toHaveLength(0)
})

it('does not restore cleared or removed-account data when an earlier RPC read finishes', async () => {
  service.observeSubmitted(transaction(), hash)
  const [{ id }] = service.list(ACCOUNT)
  let release
  hold = new Promise((resolve) => {
    release = resolve
  })
  const pending = service.refresh(ACCOUNT, [id])
  const deadline = Date.now() + 2_000
  while (!upstream.requests.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5))
  if (!upstream.requests.length) {
    release()
    throw new Error('Allowance read did not reach the configured RPC')
  }
  service.clear(ACCOUNT)
  release()
  await pending
  expect(service.list(ACCOUNT)).toEqual([])
  expect(storage.load()).toEqual([])

  hold = undefined
  service.observeSubmitted(transaction(), hash)
  savedAccounts = []
  await expect(service.prepareRevocation(ACCOUNT, id)).rejects.toThrow('Account is unavailable')
  expect(upstream.requests).toHaveLength(1)
})

it('uses a new post-execution read when an older allowance reply is still in flight', async () => {
  service.observeSubmitted(transaction(), hash)
  const [{ id }] = service.list(ACCOUNT)
  let release
  hold = new Promise((resolve) => {
    release = resolve
  })
  const previous = service.refresh(ACCOUNT, [id])
  const started = Date.now() + 2_000
  while (!upstream.requests.length && Date.now() < started)
    await new Promise((resolve) => setTimeout(resolve, 5))
  amount = 0n
  hold = undefined
  const afterExecution = service.afterExecution(1, hash)
  const refreshed = Date.now() + 2_000
  while (upstream.requests.length < 2 && Date.now() < refreshed)
    await new Promise((resolve) => setTimeout(resolve, 5))
  release()
  await Promise.all([previous, afterExecution])
  expect(upstream.requests).toHaveLength(2)
  expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '0' })
})

it.each(['clear', 'remove'])('stops queued allowance lookups after history %s', async (change) => {
  tokenContracts = [TARGET, ...['33', '44', '55', '66'].map((byte) => `0x${byte.repeat(20)}`)]
  tokenContracts.forEach((token, index) =>
    service.observeSubmitted(transaction({ to: token }), `0x${(index + 1).toString(16).repeat(64)}`)
  )
  const ids = service.list(ACCOUNT).map(({ id }) => id)
  let release
  hold = new Promise((resolve) => {
    release = resolve
  })
  const pending = service.refresh(ACCOUNT, ids)
  try {
    const deadline = Date.now() + 2000
    while (upstream.requests.length < 4 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5))
    expect(upstream.requests).toHaveLength(4)
    if (change === 'clear') service.clear(ACCOUNT)
    else savedAccounts = []
  } finally {
    release()
    await pending
  }
  expect(upstream.requests).toHaveLength(4)
  if (change === 'clear') expect(service.list(ACCOUNT)).toEqual([])
})

it('invalidates every affected allowance before waiting for receipt refreshes', async () => {
  tokenContracts = [TARGET, ...['33', '44', '55', '66'].map((byte) => `0x${byte.repeat(20)}`)]
  tokenContracts.forEach((token, index) =>
    service.observeSubmitted(transaction({ to: token }), `0x${(index + 1).toString(16).repeat(64)}`)
  )
  await service.refresh(
    ACCOUNT,
    service.list(ACCOUNT).map(({ id }) => id)
  )
  expect(service.list(ACCOUNT).every(({ status }) => status === 'current')).toBe(true)
  let release
  hold = new Promise((resolve) => {
    release = resolve
  })
  const receiptHash = `0x${'77'.repeat(32)}`
  const pending = service.afterExecution(1, receiptHash, 'confirmed multi-token call', {
    transactionHash: receiptHash,
    status: '0x1',
    logs: tokenContracts.map((address) => ({
      address,
      ...contract.encodeEventLog(contract.getEvent('Approval'), [ACCOUNT, spender, 0])
    }))
  })
  try {
    expect(service.list(ACCOUNT).every(({ status }) => status === 'unchecked')).toBe(true)
  } finally {
    release()
    await pending
  }
  expect(service.list(ACCOUNT).every(({ status }) => status === 'current')).toBe(true)
})

it('queues only a normal zero-allowance review and blocks duplicate clicks', async () => {
  service.observeSubmitted(transaction(), hash)
  const [{ id }] = service.list(ACCOUNT)
  const queued = []
  const revocations = new TokenApprovalRevocations({
    service,
    canReview: (account) => account === ACCOUNT,
    queue: async (tx) => {
      queued.push(tx)
      return '11111111-1111-4111-8111-111111111111'
    }
  })
  const review = revocations.request(ACCOUNT, id)
  await expect(revocations.request(ACCOUNT, id)).rejects.toThrow('Revocation review is already opening')
  expect(await review).toEqual({
    account: ACCOUNT,
    handlerId: '11111111-1111-4111-8111-111111111111',
    type: 'transaction'
  })
  expect(queued).toHaveLength(1)
  expect(contract.decodeFunctionData('approve', queued[0].data).amount).toBe(0n)
  expect(upstream.requests.every(({ payload }) => payload.method === 'eth_call')).toBe(true)
})

it('does not queue when the selected signer changes during a fresh allowance check', async () => {
  service.observeSubmitted(transaction(), hash)
  const [{ id }] = service.list(ACCOUNT)
  let current = true
  let release
  hold = new Promise((resolve) => {
    release = resolve
  })
  const queued = []
  const revocations = new TokenApprovalRevocations({
    service,
    canReview: () => current,
    queue: async (tx) => {
      queued.push(tx)
      return '11111111-1111-4111-8111-111111111111'
    }
  })
  const pending = revocations.request(ACCOUNT, id)
  while (!upstream.requests.length) await new Promise((resolve) => setTimeout(resolve, 5))
  current = false
  release()
  await expect(pending).rejects.toThrow('Select an available signing account')
  expect(queued).toEqual([])
})

it('keeps observed history private through profile load, renderer updates, backup, and restore', () => {
  service.observeSubmitted(transaction(), hash)
  const legacy = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../main/store/migrate/fixtures/v41-current-state.json'), 'utf8')
  ).state
  const config = { main: { __: { 41: legacy } } }
  const migrated = migratePersistedConfiguration(config)
  const records = storage.load()
  migrated.main.observedTokenApprovals = [...records, { ...records[0], observedAt: -1 }, { corrupt: true }]
  const loaded = MainSchema.partial().parse(migrated.main)
  expect(loaded.observedTokenApprovals).toEqual(records)
  expect(loaded.accounts).toEqual(migrated.main.accounts)
  expect(Object.keys(loaded.networks.ethereum)).toEqual(Object.keys(migrated.main.networks.ethereum))
  for (const [id, network] of Object.entries(migrated.main.networks.ethereum)) {
    expect(loaded.networks.ethereum[id]).toMatchObject({ id: network.id, name: network.name, on: network.on })
    const configuration = (endpoints) =>
      endpoints.map(({ id, current, custom, on }) => ({ id, current, custom, on }))
    expect(configuration(loaded.networks.ethereum[id].connection.endpoints)).toEqual(
      configuration(network.connection.endpoints)
    )
  }
  expect(rendererVisibleState({ main: loaded }).main).not.toHaveProperty('observedTokenApprovals')
  expect(
    rendererVisibleActions([{ updates: [{ path: 'main.observedTokenApprovals', value: records }] }])
  ).toEqual([])

  const source = path.join(process.env.WREN_E2E_PROFILE, 'approval-backup-source')
  const target = path.join(process.env.WREN_E2E_PROFILE, 'approval-backup-restored')
  fs.mkdirSync(source, { mode: 0o700 })
  fs.mkdirSync(target, { mode: 0o700 })
  fs.writeFileSync(
    path.join(source, 'config.json'),
    JSON.stringify({ main: { __: { [migrations.latest]: { main: migrated.main } } } }),
    { mode: 0o600 }
  )
  const password = 'isolated regression profile backup'
  const backup = createEncryptedProfileBackup(source, password)
  const backupPath = path.join(process.env.WREN_E2E_PROFILE, 'approval-history.wrenbackup')
  fs.writeFileSync(backupPath, backup, { mode: 0o600 })
  stageEncryptedProfileRestore(backupPath, password, target)
  expect(runPendingProfileRestore(target).status).toBe('applied')
  const restored = migratePersistedConfiguration(
    JSON.parse(fs.readFileSync(path.join(target, 'config.json'), 'utf8'))
  ).main
  expect(restored).not.toHaveProperty('observedTokenApprovals')
  expect(Object.keys(restored.accounts)).toEqual(Object.keys(migrated.main.accounts))
  for (const [id, network] of Object.entries(migrated.main.networks.ethereum)) {
    expect(restored.networks.ethereum[id]).toMatchObject({
      id: network.id,
      name: network.name,
      on: network.on
    })
    expect(restored.networks.ethereum[id].connection.endpoints).toHaveLength(
      network.connection.endpoints.length
    )
  }
})
