import { createHash } from 'crypto'
import { z } from 'zod'
import { keccak256 } from 'ethers'
import { decodeLocalCalldata } from '../inspector/localDecode'
import { parseSimulationEffects } from '../transaction/effects'
import type { ActivityEntry } from '../store/state/types/activity'
import type { AccountActivityCursor, ObservedActivity } from '../store/state/types/accountActivity'

export const ACTIVITY_BLOCK_BATCH = 20
export const ACTIVITY_CONFIRMATION_DEPTH = 2
const ADDRESS = /^0x[0-9a-f]{40}$/u
const Hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase())
const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => value.toLowerCase())
const Quantity = z
  .string()
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u)
  .max(66)
  .transform((value) => value.toLowerCase())
const Transaction = z.object({
  hash: Hash,
  from: Address,
  to: Address.nullable(),
  value: Quantity,
  input: z
    .string()
    .regex(/^0x(?:[0-9a-fA-F]{2})*$/u)
    .transform((value) => value.toLowerCase())
})
const Header = z.object({
  number: Quantity,
  hash: Hash,
  parentHash: Hash,
  timestamp: Quantity,
  logsBloom: z
    .string()
    .regex(/^0x[0-9a-fA-F]{512}$/u)
    .transform((value) => value.toLowerCase())
    .optional()
})
const Block = Header.extend({ transactions: z.array(Transaction).max(10000) })
const Receipt = z.object({
  transactionHash: Hash,
  blockHash: Hash,
  blockNumber: Quantity,
  status: z.enum(['0x0', '0x1']),
  logs: z.array(z.unknown()).max(10000)
})
const Log = z.object({
  transactionHash: Hash,
  blockHash: Hash,
  blockNumber: Quantity,
  removed: z.boolean().optional()
})
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
const hex = (n: number) => `0x${n.toString(16)}`
const height = (value: string) => {
  const number = Number(BigInt(Quantity.parse(value)))
  if (!Number.isSafeInteger(number)) throw new Error('Invalid activity block height')
  return number
}
function bloomContains(bloom: string, value: string) {
  const digest = keccak256(value).slice(2)
  const bits = BigInt(bloom)
  return [0, 4, 8].every(
    (offset) => (bits & (1n << BigInt(parseInt(digest.slice(offset, offset + 4), 16) & 2047))) !== 0n
  )
}
export function observedActivityId(chainId: number, account: string, hash: string) {
  const digest = createHash('sha256').update(`${chainId}:${account}:${hash}`).digest('hex').slice(0, 32)
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`
}
type LocalActivity = { account: string; origin: string }
export interface ActivityScannerDependencies {
  rpc: (chainId: number, method: string, params: readonly unknown[]) => Promise<unknown>
  accounts: () => string[]
  cursor: (chainId: number) => AccountActivityCursor | undefined
  localActivity: (chainId: number, hash: string) => LocalActivity | undefined
  commit: (
    chainId: number,
    cursor: AccountActivityCursor,
    entries: ActivityEntry[],
    reorgAfter?: number
  ) => void
  notify: (entry: ActivityEntry) => void
  clearedAt: () => number
  active: () => boolean
}

export function createAccountActivityScanner(deps: ActivityScannerDependencies) {
  const running = new Set<number>()
  async function scan(chainId: number): Promise<boolean> {
    if (running.has(chainId) || !deps.active()) return false
    running.add(chainId)
    const check = () => {
      if (!deps.active()) throw new Error('Activity scanner stopped')
    }
    const rpc = async (method: string, params: readonly unknown[]) => {
      check()
      const value = await deps.rpc(chainId, method, params)
      check()
      return value
    }
    try {
      const accounts = [
        ...new Set(
          deps
            .accounts()
            .map((a) => a.toLowerCase())
            .filter((a) => ADDRESS.test(a))
        )
      ].slice(0, 500)
      if (!accounts.length) return false
      const head = height(Quantity.parse(await rpc('eth_blockNumber', [])))
      const safeHead = Math.max(0, head - ACTIVITY_CONFIRMATION_DEPTH)
      let cursor = deps.cursor(chainId)
      if (!cursor) {
        const initial = Header.parse(await rpc('eth_getBlockByNumber', [hex(safeHead), false]))
        if (height(initial.number) !== safeHead) throw new Error('Activity baseline block mismatch')
        deps.commit(
          chainId,
          {
            number: safeHead,
            hash: initial.hash,
            history: [],
            watchFrom: Object.fromEntries(accounts.map((a) => [a, head + 1])),
            notified: []
          },
          []
        )
        return false
      }
      cursor = {
        ...cursor,
        watchFrom: Object.fromEntries(accounts.map((a) => [a, cursor!.watchFrom[a] ?? head + 1]))
      }
      // Validate the last committed block before accepting more evidence.
      const canonical = Header.parse(await rpc('eth_getBlockByNumber', [hex(cursor.number), false]))
      if (height(canonical.number) !== cursor.number) throw new Error('Activity checkpoint block mismatch')
      if (canonical.hash !== cursor.hash) {
        let ancestor: { number: number; hash: string } | undefined
        for (const previous of [...cursor.history].reverse()) {
          const block = Header.parse(await rpc('eth_getBlockByNumber', [hex(previous.number), false]))
          if (height(block.number) === previous.number && block.hash === previous.hash) {
            ancestor = previous
            break
          }
        }
        // For a deeper reorg, replay from the earliest monitored address baseline.
        if (!ancestor) {
          const number = Math.max(
            0,
            Math.min(safeHead, ...Object.values(cursor.watchFrom).map((start) => start - 1))
          )
          const block = Header.parse(await rpc('eth_getBlockByNumber', [hex(number), false]))
          if (height(block.number) !== number) throw new Error('Activity rewind block mismatch')
          ancestor = { number, hash: block.hash }
        }
        cursor = {
          ...cursor,
          ...ancestor,
          history: cursor.history.filter((b) => b.number < ancestor!.number)
        }
        deps.commit(chainId, cursor, [], ancestor.number)
      }
      deps.commit(chainId, cursor, [])
      const end = Math.min(safeHead, cursor.number + ACTIVITY_BLOCK_BATCH)
      const blocks: Array<z.infer<typeof Block>> = []
      let parentHash = cursor.hash
      for (let number = cursor.number + 1; number <= end; number++) {
        const block = Block.parse(await rpc('eth_getBlockByNumber', [hex(number), true]))
        if (height(block.number) !== number || block.parentHash !== parentHash)
          throw new Error('Activity block ancestry changed')
        blocks.push(block)
        parentHash = block.hash
      }
      const eligible = accounts.filter((account) => end >= cursor!.watchFrom[account]!)
      const transfersByBlock = new Map<number, Set<string>>()
      for (let offset = 0; blocks.length && offset < eligible.length; offset += 50) {
        const topics = eligible
          .slice(offset, offset + 50)
          .map((account) => `0x${account.slice(2).padStart(64, '0')}`)
        for (const filter of [
          [TRANSFER, topics],
          [TRANSFER, null, topics],
          [[SINGLE, BATCH], null, topics],
          [[SINGLE, BATCH], null, null, topics]
        ]) {
          const possible = blocks.some(
            (block) =>
              !block.logsBloom ||
              filter.every(
                (topic) =>
                  topic === null ||
                  (Array.isArray(topic) ? topic : [topic]).some((value) =>
                    bloomContains(block.logsBloom!, value)
                  )
              )
          )
          if (!possible) continue
          const logs = z
            .array(Log)
            .max(10000)
            .parse(
              await rpc('eth_getLogs', [
                { fromBlock: hex(cursor.number + 1), toBlock: hex(end), topics: filter }
              ])
            )
          for (const log of logs) {
            const number = height(log.blockNumber)
            const block = blocks[number - cursor.number - 1]
            if (log.removed || !block || log.blockHash !== block.hash)
              throw new Error('Activity log block mismatch')
            const hashes = transfersByBlock.get(number) ?? new Set<string>()
            hashes.add(log.transactionHash)
            transfersByBlock.set(number, hashes)
          }
        }
      }
      for (const block of blocks) {
        const number = height(block.number)
        const watched = accounts.filter((account) => number >= cursor!.watchFrom[account]!)
        const transactionsByHash = new Map(block.transactions.map((tx) => [tx.hash, tx]))
        const candidates = new Set(
          block.transactions
            .filter((tx) => watched.includes(tx.from) || (tx.to && watched.includes(tx.to)))
            .map((tx) => tx.hash)
        )
        if (watched.length) transfersByBlock.get(number)?.forEach((hash) => candidates.add(hash))
        const entries: ActivityEntry[] = []
        const notifications: ActivityEntry[] = []
        const notified: Set<string> = new Set(cursor.notified)
        for (const hash of candidates) {
          const tx = transactionsByHash.get(hash)
          if (!tx) throw new Error('Activity log transaction missing from block')
          const receipt = Receipt.parse(await rpc('eth_getTransactionReceipt', [hash]))
          if (
            receipt.transactionHash !== hash ||
            receipt.blockHash !== block.hash ||
            height(receipt.blockNumber) !== number
          )
            throw new Error('Activity receipt block mismatch')
          const effects =
            receipt.status === '0x1'
              ? receipt.logs
                  .flatMap((log) => parseSimulationEffects([log]).effects)
                  .filter((e) => e.type === 'transfer')
              : []
          const local = deps.localActivity(chainId, hash)
          const decoded =
            tx.input.length <= 524290 ? decodeLocalCalldata(tx.input) : { status: 'unavailable' as const }
          for (const account of watched) {
            if (local?.account === account) continue
            const transfers = effects.filter((e) => e.from === account || e.to === account)
            if (tx.from !== account && tx.to !== account && !transfers.length) continue
            const outgoing = tx.from === account
            let action: ObservedActivity['action'] =
              outgoing ||
              (!transfers.some((e) => e.to === account) && (tx.input !== '0x' || BigInt(tx.value) === 0n))
                ? 'call'
                : 'received'
            if (outgoing && tx.to === null) action = 'deploy'
            else if (outgoing && tx.input === '0x' && BigInt(tx.value) > 0n)
              action = tx.to === account ? 'transfer' : 'sent'
            else if (outgoing && decoded.status === 'decoded') {
              if (['approve', 'deposit', 'withdraw', 'redeem', 'mint'].includes(decoded.method))
                action = decoded.method as ObservedActivity['action']
              else if (decoded.method === 'setApprovalForAll') action = 'approve'
              else if (
                ['transfer', 'transferFrom', 'safeTransferFrom', 'safeBatchTransferFrom'].includes(
                  decoded.method
                )
              )
                action = decoded.method === 'transfer' ? 'sent' : 'transfer'
            } else if (!outgoing && !transfers.some((e) => e.to === account) && tx.to !== account)
              action = 'sent'
            const timestamp = height(block.timestamp) * 1000
            if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid activity timestamp')
            if (timestamp <= deps.clearedAt()) continue
            const entry: ActivityEntry = {
              id: observedActivityId(chainId, account, hash),
              account,
              chainId,
              origin: local?.origin ?? 'wren:external',
              type: 'transaction',
              outcome: receipt.status === '0x1' ? 'confirmed' : 'failed',
              createdAt: timestamp,
              completedAt: timestamp,
              observed: {
                hash,
                from: tx.from,
                blockHash: block.hash,
                blockNumber: number,
                source: local ? 'wren' : 'external',
                action
              }
            }
            entries.push(entry)
            if (entries.length > 500) entries.shift()
            if (!local && !notified.has(hash)) {
              notifications.push(entry)
              if (notifications.length > 1000) notifications.shift()
              notified.add(hash)
            }
          }
        }
        // Recheck the block after collecting receipts/logs to avoid committing a replaced block.
        const verified = Header.parse(await rpc('eth_getBlockByNumber', [hex(number), false]))
        if (verified.hash !== block.hash || height(verified.number) !== number)
          throw new Error('Activity block changed during scan')
        cursor = {
          ...cursor,
          number,
          hash: block.hash,
          history: [...cursor.history, { number: cursor.number, hash: cursor.hash }].slice(-12),
          notified: [...notified].slice(-1000)
        }
        check()
        deps.commit(chainId, cursor, entries)
        notifications.forEach(deps.notify)
      }
      return cursor.number < safeHead
    } finally {
      running.delete(chainId)
    }
  }
  return { scan }
}
