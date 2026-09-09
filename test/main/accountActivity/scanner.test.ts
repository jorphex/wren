import { Interface } from 'ethers'
import { createAccountActivityScanner, ACTIVITY_BLOCK_BATCH } from '../../../main/accountActivity/scanner'
import { ActivityEntrySchema, type ActivityEntry } from '../../../main/store/state/types/activity'
import {
  pruneAccountActivityCursors,
  type AccountActivityCursor
} from '../../../main/store/state/types/accountActivity'

const a = `0x${'1'.repeat(40)}`,
  b = `0x${'2'.repeat(40)}`,
  outside = `0x${'3'.repeat(40)}`,
  token = `0x${'4'.repeat(40)}`
const hex = (n: number) => `0x${n.toString(16)}`
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const abi = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function approve(address spender,uint256 amount)',
  'function deposit(uint256 assets,address receiver)',
  'function withdraw(uint256 amount)'
])
function fixture() {
  let head = 2,
    enabled = true,
    cleared = 0
  let accounts = [a, b]
  let cursor: AccountActivityCursor | undefined
  const entries = new Map<string, ActivityEntry>()
  const branches = new Map<number, number>()
  const transactions = new Map<
    number,
    Array<{ hash: string; from: string; to: string | null; value: string; input: string }>
  >()
  const receipts = new Map<
    string,
    {
      transactionHash: string
      blockHash: string
      blockNumber: string
      status: string
      logs: Array<Record<string, unknown>>
    }
  >()
  const localActivity = jest.fn()
  const notify = jest.fn()
  const blockHash = (n: number) => hash(n + (branches.get(n) || 1000))
  const rpc = jest.fn(async (_chain, method, params) => {
    if (method === 'eth_blockNumber') return hex(head)
    if (method === 'eth_getBlockByNumber') {
      const number = Number(BigInt(params[0]))
      return {
        number: hex(number),
        hash: blockHash(number),
        parentHash: blockHash(number - 1),
        timestamp: hex(1700000000 + number),
        transactions: transactions.get(number) || []
      }
    }
    if (method === 'eth_getLogs')
      return [...receipts.values()]
        .filter(
          (r) =>
            BigInt(r.blockNumber) >= BigInt(params[0].fromBlock) &&
            BigInt(r.blockNumber) <= BigInt(params[0].toBlock)
        )
        .flatMap((r) => r.logs)
    if (method === 'eth_getTransactionReceipt') return receipts.get(params[0])
    throw new Error(method)
  })
  const commit = jest.fn((_chain, next, additions, reorgAfter) => {
    cursor = JSON.parse(JSON.stringify(next))
    if (reorgAfter !== undefined)
      for (const [id, entry] of entries)
        if (entry.observed!.blockNumber > reorgAfter) entries.set(id, { ...entry, outcome: 'reorged' })
    additions.forEach((entry: ActivityEntry) => entries.set(entry.id, ActivityEntrySchema.parse(entry)))
  })
  const deps = {
    rpc,
    accounts: () => accounts,
    cursor: () => cursor,
    localActivity,
    commit,
    notify,
    clearedAt: () => cleared,
    active: () => enabled
  }
  const scanner = createAccountActivityScanner(deps)
  function tx(
    number: number,
    from = a,
    to: string | null = outside,
    input = '0x',
    logs: unknown[] = [],
    status = '0x1'
  ) {
    const txHash = hash(number + 9000 + (transactions.get(number)?.length || 0))
    const transaction = { hash: txHash, from, to, value: '0x1', input }
    transactions.set(number, [...(transactions.get(number) || []), transaction])
    receipts.set(txHash, {
      transactionHash: txHash,
      blockHash: blockHash(number),
      blockNumber: hex(number),
      status,
      logs: logs.map((log) => ({
        ...(log as object),
        transactionHash: txHash,
        blockHash: blockHash(number),
        blockNumber: hex(number)
      }))
    })
    return transaction
  }
  return {
    scanner,
    deps,
    rpc,
    notify,
    localActivity,
    commit,
    entries,
    tx,
    branches,
    transactions,
    receipts,
    head: (n: number) => {
      head = n
    },
    stop: () => {
      enabled = false
    },
    clear: (n: number) => {
      cleared = n
    },
    accounts: (next: string[]) => {
      accounts = next
    },
    cursor: () => cursor
  }
}
const transfer = (from = outside, to = b) => ({
  address: token,
  ...abi.encodeEventLog(abi.getEvent('Transfer')!, [from, to, 50n])
})

test('baselines without notifying old activity, then monitors both accounts and survives restart', async () => {
  const f = fixture()
  f.tx(1)
  await f.scanner.scan(1)
  expect(f.entries.size).toBe(0)
  f.tx(3, outside, b)
  f.tx(4, a, outside, abi.encodeFunctionData('approve', [outside, 99n]))
  f.head(6)
  await f.scanner.scan(1)
  expect([...f.entries.values()].map((e) => [e.account, e.observed?.action])).toEqual([
    [b, 'received'],
    [a, 'approve']
  ])
  expect(f.notify).toHaveBeenCalledTimes(2)
  await createAccountActivityScanner(f.deps).scan(1)
  expect(f.notify).toHaveBeenCalledTimes(2)
  expect(f.entries.size).toBe(2)
})
test('discovers standard transfers from untracked contracts and merges events within each transaction', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.tx(3, outside, token, '0x12345678', [transfer(), transfer(outside, b)])
  f.head(5)
  await f.scanner.scan(1)
  expect([...f.entries.values()].map((e) => e.observed?.action)).toEqual(['received'])
  expect(f.notify).toHaveBeenCalledTimes(1)
})
test.each(['deposit', 'withdraw'])('recognises %s from an externally submitted call', async (method) => {
  const f = fixture()
  await f.scanner.scan(1)
  f.tx(3, a, token, abi.encodeFunctionData(method, method === 'deposit' ? [10n, a] : [10n]))
  f.head(5)
  await f.scanner.scan(1)
  expect([...f.entries.values()][0].observed?.action).toBe(method)
})
test('records failed unknown calls without treating reverted logs as incoming transfers', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.tx(3, a, token, '0x12345678', [transfer()], '0x0')
  f.head(5)
  await f.scanner.scan(1)
  expect([...f.entries.values()].map((e) => [e.account, e.outcome, e.observed?.action])).toEqual([
    [a, 'failed', 'call']
  ])
})
test('does not duplicate a Wren operation or notify again for another watched recipient', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.localActivity.mockReturnValue({ account: a, origin: 'https://app.example' })
  f.tx(3, a, b)
  f.head(5)
  await f.scanner.scan(1)
  expect([...f.entries.values()].map((e) => [e.account, e.observed?.source])).toEqual([[b, 'wren']])
  expect(f.notify).not.toHaveBeenCalled()
})
test('keeps progress before an incomplete block and retries after a receipt failure', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  const tx = f.tx(3)
  f.head(5)
  const receipt = f.receipts.get(tx.hash)
  f.receipts.delete(tx.hash)
  await expect(f.scanner.scan(1)).rejects.toThrow()
  expect(f.cursor()?.number).toBe(2)
  expect(f.notify).not.toHaveBeenCalled()
  f.receipts.set(tx.hash, receipt)
  await f.scanner.scan(1)
  expect(f.cursor()?.number).toBe(3)
  expect(f.notify).toHaveBeenCalledTimes(1)
})
test('replays changed ancestry, marks orphaned activity and avoids duplicate alerts', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  const tx = f.tx(3)
  f.head(5)
  await f.scanner.scan(1)
  f.branches.set(3, 2000)
  f.transactions.set(3, [])
  f.receipts.delete(tx.hash)
  await f.scanner.scan(1)
  expect([...f.entries.values()][0].outcome).toBe('reorged')
  f.branches.set(3, 3000)
  f.transactions.set(3, [tx])
  f.receipts.set(tx.hash, {
    transactionHash: tx.hash,
    blockHash: hash(3003),
    blockNumber: '0x3',
    status: '0x1',
    logs: []
  })
  await f.scanner.scan(1)
  expect([...f.entries.values()][0].outcome).toBe('confirmed')
  expect(f.notify).toHaveBeenCalledTimes(1)
})
test('does not commit a block replaced during receipt collection', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.tx(3)
  f.head(5)
  const original = f.deps.rpc
  f.deps.rpc = async (...args) => {
    const result = await original(...args)
    if (args[1] === 'eth_getTransactionReceipt') f.branches.set(3, 2000)
    return result
  }
  await expect(createAccountActivityScanner(f.deps).scan(1)).rejects.toThrow('changed during scan')
  expect(f.cursor()?.number).toBe(2)
  expect(f.entries.size).toBe(0)
})
test('bounds catch-up and skips token RPC calls for an empty bloom', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.head(100)
  const original = f.deps.rpc
  f.deps.rpc = async (...args) => {
    const result = await original(...args)
    return args[1] === 'eth_getBlockByNumber' ? { ...result, logsBloom: `0x${'0'.repeat(512)}` } : result
  }
  expect(await createAccountActivityScanner(f.deps).scan(1)).toBe(true)
  expect(f.cursor()?.number).toBe(ACTIVITY_BLOCK_BATCH)
  expect(f.rpc.mock.calls.filter((call) => call[1] === 'eth_getLogs')).toHaveLength(0)
})
test('stops in-flight work and keeps cleared history from replaying', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.tx(3)
  f.head(5)
  f.clear(1800000000000)
  await f.scanner.scan(1)
  expect(f.entries.size).toBe(0)
  f.stop()
  await f.scanner.scan(1)
  expect(f.cursor()?.number).toBe(3)
})
test('validates persisted cursors and rejects malformed state', () => {
  expect(pruneAccountActivityCursors({ '1': { number: -1 }, '0': {} })).toEqual({})
})

test('does not advance after stopping during an RPC request', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.tx(3)
  f.head(5)
  const original = f.deps.rpc
  f.deps.rpc = async (...args) => {
    const result = await original(...args)
    if (args[1] === 'eth_getTransactionReceipt') f.stop()
    return result
  }
  await expect(createAccountActivityScanner(f.deps).scan(1)).rejects.toThrow('stopped')
  expect(f.cursor()?.number).toBe(2)
  expect(f.notify).not.toHaveBeenCalled()
})

test('shares four transfer-log queries across a full block batch', async () => {
  const f = fixture()
  await f.scanner.scan(1)
  f.head(100)
  await f.scanner.scan(1)
  expect(f.rpc.mock.calls.filter((call) => call[1] === 'eth_getLogs')).toHaveLength(4)
})
