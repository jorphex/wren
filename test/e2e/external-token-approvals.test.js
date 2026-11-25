import { Interface } from 'ethers'

import actions from '../../main/store/actions'
import { createAccountActivityScanner } from '../../main/accountActivity/scanner'
import { createTokenDiscovery } from '../../main/tokenDiscovery'
import TokenLoader from '../../main/externalData/inventory/tokens'
import { TokenApprovalsService } from '../../main/tokenApprovals/service'
import { ACCOUNT, TARGET, createDappClient, profileStorage, startJsonRpcFixture } from './support/harness'

const spender = '0x3333333333333333333333333333333333333333'
const outside = '0x4444444444444444444444444444444444444444'
const hex = (value) => `0x${value.toString(16)}`
const hash = (value) => `0x${value.toString(16).padStart(64, '0')}`
const abi = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
])
let fixtureSequence = 0
let f

async function fixture() {
  const storage = profileStorage(`external-approvals-${++fixtureSequence}.json`)
  storage.save({ main: { activity: [], observedTokenApprovals: [], accountActivityCursors: {} } })
  let head = 2
  let active = true
  let accounts = [ACCOUNT]
  let amount = 125n
  let tokenBalance = 500n
  let failCommit = false
  let receiptTransform = (receipt) => receipt
  let beforeHeader = () => {}
  let beforeAllowance = () => {}
  const branches = new Map()
  const transactions = new Map()
  const receipts = new Map()
  const notifications = []
  const blockHash = (number) => hash(number + (branches.get(number) || 1000))
  const upstream = await startJsonRpcFixture(async ({ method, params }) => {
    if (method === 'eth_blockNumber') return { result: hex(head) }
    if (method === 'eth_getBlockByNumber') {
      const number = Number(BigInt(params[0]))
      await beforeHeader(number, params[1])
      return {
        result: {
          number: hex(number),
          hash: blockHash(number),
          parentHash: blockHash(number - 1),
          timestamp: hex(Math.floor(Date.now() / 1000) - 100 + number),
          logsBloom: `0x${'0'.repeat(512)}`,
          transactions: transactions.get(number) || []
        }
      }
    }
    if (method === 'eth_getLogs') return { result: [] }
    if (method === 'eth_getTransactionReceipt') return { result: receiptTransform(receipts.get(params[0])) }
    if (method === 'eth_getCode') return { result: '0x6000' }
    if (method === 'eth_call') {
      const call = abi.getFunction(params[0].data.slice(0, 10))
      if (call?.name === 'balanceOf') {
        expect(abi.decodeFunctionData('balanceOf', params[0].data)[0].toLowerCase()).toBe(ACCOUNT)
        return { result: abi.encodeFunctionResult('balanceOf', [tokenBalance]) }
      }
      const values = { name: 'Receipt Token', symbol: 'RCT', decimals: 2n, totalSupply: 1000n }
      if (call?.name in values) return { result: abi.encodeFunctionResult(call.name, [values[call.name]]) }
      const snapshot = amount
      await beforeAllowance()
      expect(params[1]).toBe('latest')
      expect(params[0].to).toBe(TARGET)
      const decoded = abi.decodeFunctionData('allowance', params[0].data)
      expect(decoded.owner.toLowerCase()).toBe(ACCOUNT)
      expect(decoded.spender.toLowerCase()).toBe(spender)
      return { result: abi.encodeFunctionResult('allowance', [snapshot]) }
    }
    throw new Error(`Unexpected RPC method ${method}`)
  })
  const rpc = createDappClient(upstream.url, 'https://wren-test.invalid')
  const approvalDependencies = {
    load: () => storage.load().main.observedTokenApprovals,
    save: (entries) => {
      const state = storage.load()
      state.main.observedTokenApprovals = entries
      storage.save(state)
    },
    accounts: () => accounts,
    chainEnabled: (chainId) => chainId === 1,
    rpc: (chainId, method, params) => {
      expect(chainId).toBe(1)
      return rpc.request(method, params)
    }
  }
  const service = new TokenApprovalsService(approvalDependencies)
  const deps = {
    rpc: (chainId, method, params) => {
      expect(chainId).toBe(1)
      return rpc.request(method, params)
    },
    accounts: () => accounts,
    active: () => active,
    cursor: (chainId) => storage.load().main.accountActivityCursors[chainId],
    clearedAt: () => 0,
    localActivity: () => undefined,
    tokenApprovals: service,
    commit: (chainId, cursor, entries, reorgAfter, approvals) => {
      if (failCommit && entries.length) throw new Error('Simulated commit failure')
      const state = storage.load()
      actions.commitAccountActivity(
        (path, update) => {
          const keys = path.split('.')
          const key = keys.pop()
          const parent = keys.reduce((object, item) => object[item], state)
          parent[key] = update(parent[key])
        },
        chainId,
        cursor,
        entries,
        reorgAfter,
        approvals
      )
      storage.save(state)
    },
    notify: (entry) => notifications.push(entry)
  }
  const scanner = createAccountActivityScanner(deps)
  function tx(number, overrides = {}, status = '0x1') {
    const transaction = {
      hash: hash(9000 + number + (transactions.get(number)?.length || 0)),
      from: ACCOUNT,
      to: TARGET,
      value: '0x0',
      input: abi.encodeFunctionData('approve', [spender, 999n]),
      ...overrides
    }
    transactions.set(number, [...(transactions.get(number) || []), transaction])
    receipts.set(transaction.hash, {
      transactionHash: transaction.hash,
      blockHash: blockHash(number),
      blockNumber: hex(number),
      status,
      logs: []
    })
    return transaction
  }
  return {
    scanner,
    service,
    storage,
    tx,
    branches,
    transactions,
    receipts,
    notifications,
    upstream,
    deps,
    restartApprovals: () => {
      const restarted = new TokenApprovalsService(approvalDependencies)
      deps.tokenApprovals = restarted
      return restarted
    },
    head: (value) => (head = value),
    amount: (value) => (amount = value),
    tokenBalance: (value) => (tokenBalance = value),
    accounts: (value) => (accounts = value),
    active: (value) => (active = value),
    failCommit: (value) => (failCommit = value),
    receiptTransform: (value) => (receiptTransform = value),
    beforeHeader: (value) => (beforeHeader = value),
    beforeAllowance: (value) => (beforeAllowance = value)
  }
}

beforeEach(async () => {
  f = await fixture()
  await f.scanner.scan(1)
})
afterEach(async () => {
  await f.upstream.close()
})

it('commits an external approve with Activity, then reads the current allowance and prepares reviewed revocation', async () => {
  const tx = f.tx(3)
  f.head(5)
  await f.scanner.scan(1)
  const [entry] = f.service.list(ACCOUNT)
  expect(entry).toMatchObject({ account: ACCOUNT, chainId: 1, token: TARGET, spender, status: 'unchecked' })
  expect(f.storage.load().main.activity).toMatchObject([
    { outcome: 'confirmed', observed: { hash: tx.hash, source: 'external', action: 'approve' } }
  ])
  expect(f.notifications).toHaveLength(1)
  expect(f.upstream.requests.filter(({ payload }) => payload.method === 'eth_call')).toHaveLength(0)
  const [checked] = await f.service.refresh(ACCOUNT, [entry.id])
  expect(checked).toMatchObject({ status: 'current', amount: '125' })
  const revoke = await f.service.prepareRevocation(ACCOUNT, entry.id)
  expect(abi.decodeFunctionData('approve', revoke.data).amount).toBe(0n)
  expect(JSON.stringify(f.storage.load().main.observedTokenApprovals)).not.toMatch(/input|data|amount|999/)
  expect(f.upstream.requests.some(({ payload }) => payload.method === 'eth_sendRawTransaction')).toBe(false)
})

it('skips failed, incoming, malformed, and unrelated calls without scanning old approvals', async () => {
  f.tx(1)
  f.tx(3, {}, '0x0')
  f.tx(3, { from: outside, to: ACCOUNT })
  f.tx(3, { input: '0x095ea7b3' })
  f.tx(3, { input: '0x' })
  f.tx(3, { from: outside })
  f.head(5)
  await f.scanner.scan(1)
  expect(f.service.list(ACCOUNT)).toEqual([])
  expect(f.storage.load().main.accountActivityCursors[1].number).toBe(3)
})

it('does not save an approval when a receipt or final block check is inconsistent, and retries it', async () => {
  f.tx(3)
  f.head(5)
  f.receiptTransform((receipt) => ({ ...receipt, blockHash: hash(99999) }))
  await expect(f.scanner.scan(1)).rejects.toThrow('receipt block mismatch')
  expect(f.service.list(ACCOUNT)).toEqual([])
  f.receiptTransform((receipt) => receipt)
  f.beforeHeader((number, full) => {
    if (number === 3 && !full) f.branches.set(3, 2000)
  })
  await expect(f.scanner.scan(1)).rejects.toThrow('block changed during scan')
  expect(f.service.list(ACCOUNT)).toEqual([])
  const state = f.storage.load().main
  expect(state.accountActivityCursors[1].number).toBe(2)
  expect(state.activity).toEqual([])
  expect(f.notifications).toHaveLength(0)
  f.beforeHeader(() => {})
  f.branches.delete(3)
  await f.scanner.scan(1)
  expect(f.service.list(ACCOUNT)).toHaveLength(1)
})

it('keeps approval and cursor writes together when the profile commit fails', async () => {
  f.tx(3)
  f.head(5)
  f.failCommit(true)
  await expect(f.scanner.scan(1)).rejects.toThrow('Simulated commit failure')
  expect(f.service.list(ACCOUNT)).toEqual([])
  expect(f.storage.load().main.accountActivityCursors[1].number).toBe(2)
  expect(f.notifications).toHaveLength(0)
  f.failCommit(false)
  await f.scanner.scan(1)
  expect(f.service.list(ACCOUNT)).toHaveLength(1)
  expect(f.notifications).toHaveLength(1)
})

it('invalidates current allowances on a reorg and keeps a replayed approval as one pair', async () => {
  const tx = f.tx(3)
  f.head(5)
  await f.scanner.scan(1)
  const [{ id }] = f.service.list(ACCOUNT)
  await f.service.refresh(ACCOUNT, [id])
  f.branches.set(3, 2000)
  f.transactions.set(3, [])
  await f.scanner.scan(1)
  expect(f.service.list(ACCOUNT)[0].status).toBe('unchecked')
  expect(f.storage.load().main.activity[0].outcome).toBe('reorged')
  f.branches.set(3, 3000)
  f.transactions.set(3, [tx])
  f.receipts.set(tx.hash, { ...f.receipts.get(tx.hash), blockHash: hash(3003) })
  await f.scanner.scan(1)
  expect(f.service.list(ACCOUNT)).toHaveLength(1)
  expect(f.storage.load().main.activity).toMatchObject([
    { outcome: 'confirmed', observed: { hash: tx.hash, blockHash: hash(3003) } }
  ])
  await f.service.refresh(ACCOUNT, [id])
  const state = f.storage.load()
  const saved = state.main.observedTokenApprovals
  state.main.accountActivityCursors[1] = {
    ...state.main.accountActivityCursors[1],
    number: 2,
    hash: hash(1002),
    history: []
  }
  f.storage.save(state)
  await createAccountActivityScanner(f.deps).scan(1)
  expect(f.storage.load().main.observedTokenApprovals).toEqual(saved)
  expect(f.service.list(ACCOUNT)[0].status).toBe('current')
  expect(f.notifications).toHaveLength(1)
})

it('does not let a pre-update allowance read overwrite a newly observed external change', async () => {
  f.tx(3)
  f.head(5)
  await f.scanner.scan(1)
  const [{ id }] = f.service.list(ACCOUNT)
  let release
  let started
  const waiting = new Promise((resolve) => (started = resolve))
  f.beforeAllowance(
    () =>
      new Promise((resolve) => {
        release = resolve
        started()
      })
  )
  const old = f.service.refresh(ACCOUNT, [id])
  await waiting
  try {
    f.tx(4)
    f.amount(0n)
    f.head(6)
    await f.scanner.scan(1)
    f.beforeAllowance(() => {})
    await f.service.refresh(ACCOUNT, [id])
  } finally {
    release()
  }
  await old
  expect(f.service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '0' })
})

it.each([false, true])(
  'refreshes a Wren submission after older external activity for the same pair (restart: %s)',
  async (restart) => {
    const submittedHash = hash(80000)
    f.service.observeSubmitted(
      { from: ACCOUNT, to: TARGET, chainId: '0x1', data: abi.encodeFunctionData('approve', [spender, 0]) },
      submittedHash
    )
    f.tx(3)
    f.head(5)
    await f.scanner.scan(1)
    const service = restart ? f.restartApprovals() : f.service
    const [{ id }] = service.list(ACCOUNT)
    await service.refresh(ACCOUNT, [id])
    expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '125' })

    f.amount(0n)
    await service.afterExecution(1, submittedHash, 'canonical receipt')
    expect(service.list(ACCOUNT)[0]).toMatchObject({ status: 'current', amount: '0' })
    expect(service.list(ACCOUNT)[0]).not.toHaveProperty('submittedTransactionHash')
    const reads = f.upstream.requests.filter(({ payload }) => payload.method === 'eth_call').length
    await service.afterExecution(1, submittedHash, 'canonical receipt')
    expect(f.upstream.requests.filter(({ payload }) => payload.method === 'eth_call')).toHaveLength(reads)
  }
)

it.each(['clear', 'remove', 'stop'])('honors %s during receipt collection', async (change) => {
  f.tx(3)
  f.head(5)
  f.beforeHeader((number, full) => {
    if (number !== 3 || full) return
    if (change === 'clear') f.service.clear(ACCOUNT)
    if (change === 'remove') f.accounts([])
    if (change === 'stop') f.active(false)
  })
  if (change === 'stop') await expect(f.scanner.scan(1)).rejects.toThrow('stopped')
  else await f.scanner.scan(1)
  expect(f.storage.load().main.observedTokenApprovals).toEqual([])
})

it('previews canonical incoming tokens after restart and tracks only a selected current balance', async () => {
  const tx = f.tx(3, { input: '0x' })
  const receipt = f.receipts.get(tx.hash)
  receipt.logs = [{ address: TARGET, ...abi.encodeEventLog('Transfer', [outside, ACCOUNT, 500n]) }]
  f.head(5)
  f.failCommit(true)
  await expect(f.scanner.scan(1)).rejects.toThrow('Simulated commit failure')
  expect(f.storage.load().main.accountActivityCursors[1].incomingTokens).toBeUndefined()
  f.failCommit(false)
  await createAccountActivityScanner(f.deps).scan(1)

  let routes = 'first RPC'
  const track = jest.fn()
  const network = () => ({
    routes,
    known: new Set(),
    incoming: f.storage.load().main.accountActivityCursors[1].incomingTokens || []
  })
  const discovery = createTokenDiscovery({ rpc: f.deps.rpc, getNetwork: network, track })
  const scope = { account: ACCOUNT, chainId: 1, source: 'activity' }
  const result = await discovery.preview(scope, 0)
  expect(result.matches).toEqual([
    { address: TARGET, chainId: 1, name: 'Receipt Token', symbol: 'RCT', decimals: 2, balance: '0x1f4' }
  ])
  expect(track).not.toHaveBeenCalled()
  f.tokenBalance(0n)
  await expect(discovery.add(scope, TARGET)).rejects.toThrow('no longer available')
  f.tokenBalance(501n)
  await discovery.add(scope, TARGET)
  expect(track).toHaveBeenCalledTimes(1)
  expect(track).toHaveBeenCalledWith(ACCOUNT, expect.objectContaining({ address: TARGET, decimals: 2 }), {
    balance: '0x1f5',
    displayBalance: '5.01'
  })

  const originalRpc = f.deps.rpc
  const changedRoute = createTokenDiscovery({
    rpc: (...args) => {
      routes = 'new RPC'
      return originalRpc(...args)
    },
    getNetwork: network,
    track
  })
  await expect(changedRoute.preview(scope, 0)).rejects.toThrow('lookup changed')

  f.branches.set(3, 3000)
  f.transactions.delete(3)
  await f.scanner.scan(1)
  expect((await discovery.preview(scope, 0)).matches).toEqual([])
  await expect(discovery.add(scope, TARGET)).rejects.toThrow('no longer discoverable')
})

it('paginates catalog checks and keeps exclusions and tracked tokens out of the preview', async () => {
  const tokens = Array.from({ length: 20 }, (_, index) => ({
    address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    chainId: 1,
    name: 'Catalog token',
    symbol: 'CAT',
    decimals: 2
  }))
  tokens[0].extensions = { omitFromDiscovery: true }
  tokens[1].extensions = { omit: true }
  const known = new Set([`1:${tokens[2].address}`])
  const track = jest.fn()
  const discovery = createTokenDiscovery({
    rpc: f.deps.rpc,
    getNetwork: () => ({ routes: 'first RPC', incoming: [], known }),
    catalog: new TokenLoader(tokens),
    track
  })
  const scope = { account: ACCOUNT, chainId: 1, source: 'catalog' }
  const first = await discovery.preview(scope, 0)
  expect(first.matches).toHaveLength(15)
  expect(first.next).toBe(16)
  expect(first.matches[0].address).toBe(tokens[3].address)
  const second = await discovery.preview(scope, first.next)
  expect(second.matches.map(({ address }) => address)).toEqual(tokens.slice(18).map(({ address }) => address))
  expect(second.next).toBeNull()
  expect(track).not.toHaveBeenCalled()
})
