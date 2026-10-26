import { createHash } from 'crypto'

import {
  MAX_TOKEN_APPROVAL_REFRESH,
  pruneObservedTokenApprovals,
  type TokenApprovalObservation,
  type TokenApprovalView
} from '../../resources/domain/tokenApprovals'
import {
  buildErc20AllowanceCalldata,
  parseErc20AllowanceResult,
  parseErc20ApprovalIntent
} from '../../resources/domain/transaction/allowance'
import { parseRpcQuantity } from '../../resources/domain/transaction/quantity'
import { erc20Interface } from '../../resources/contracts'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const HASH = /^0x[0-9a-f]{64}$/u
const CHECK_LIFETIME_MS = 60_000
const RPC_DEADLINE_MS = 5_000

export type ObservedTokenApprovalCall = {
  from: string
  to: string
  data: string
  hash: string
}

interface Dependencies {
  load(): unknown
  save(value: TokenApprovalObservation[]): void
  accounts(): readonly string[]
  chainEnabled(chainId: number): boolean
  rpc(chainId: number, method: string, params: unknown[]): Promise<unknown>
}

type Check = {
  observation: string
  status: 'current' | 'unavailable'
  amount?: string
  checkedAt: number
}

const identifier = (entry: Pick<TokenApprovalObservation, 'account' | 'chainId' | 'token' | 'spender'>) =>
  createHash('sha256')
    .update(`${entry.account}:${entry.chainId}:${entry.token}:${entry.spender}`)
    .digest('hex')
const generation = (entry: TokenApprovalObservation) => `${entry.transactionHash}:${entry.observedAt}`

export class TokenApprovalsService {
  private checks = new Map<string, Check>()
  private pending = new Map<string, Promise<void>>()
  private revisions = new Map<string, number>()
  private executions = new Map<string, string>()
  private historyRevisions = new Map<string, number>()
  private sequence = 0

  constructor(private dependencies: Dependencies) {}

  private version(entry: TokenApprovalObservation) {
    return `${generation(entry)}:${this.revisions.get(entry.id) || 0}:${this.historyRevisions.get(entry.account) || 0}`
  }

  private invalidate(id: string) {
    this.revisions.set(id, ++this.sequence)
    this.checks.delete(id)
  }

  private observations() {
    return pruneObservedTokenApprovals(this.dependencies.load()).filter(
      (entry) => identifier(entry) === entry.id
    )
  }

  private requireAccount(account: string) {
    if (
      !ADDRESS.test(account) ||
      !this.dependencies.accounts().some((saved) => saved.toLowerCase() === account.toLowerCase())
    ) {
      throw new Error('Account is unavailable')
    }
    return account.toLowerCase()
  }

  private mergeSubmitted(
    observations: TokenApprovalObservation[],
    transaction: { from?: unknown; to?: unknown; chainId?: unknown; data?: unknown },
    hash: unknown
  ) {
    if (
      typeof transaction.from !== 'string' ||
      typeof transaction.to !== 'string' ||
      !ADDRESS.test(transaction.to) ||
      typeof hash !== 'string' ||
      !HASH.test(hash)
    )
      return observations
    const account = transaction.from.toLowerCase()
    if (!this.dependencies.accounts().some((saved) => saved.toLowerCase() === account)) return observations
    const chainId = Number(parseRpcQuantity(transaction.chainId))
    const intent = parseErc20ApprovalIntent(transaction.data)
    if (!Number.isSafeInteger(chainId) || chainId < 1 || !intent || !this.dependencies.chainEnabled(chainId))
      return observations
    const entry = {
      account,
      chainId,
      token: transaction.to.toLowerCase(),
      spender: intent.spender,
      transactionHash: hash,
      observedAt: Date.now()
    }
    const id = identifier(entry)
    if (observations.some((item) => item.id === id && item.transactionHash === hash)) return observations
    return pruneObservedTokenApprovals([{ ...entry, id }, ...observations.filter((item) => item.id !== id)])
  }

  private observationsChanged(previous: TokenApprovalObservation[]) {
    const observations = this.observations()
    const generations = new Map(previous.map((entry) => [entry.id, generation(entry)]))
    for (const entry of observations) {
      if (generations.get(entry.id) === generation(entry)) continue
      this.invalidate(entry.id)
      this.executions.delete(entry.id)
    }
    const retained = new Set(observations.map((item) => item.id))
    for (const key of this.checks.keys()) if (!retained.has(key)) this.checks.delete(key)
    for (const key of this.revisions.keys()) if (!retained.has(key)) this.revisions.delete(key)
    for (const key of this.executions.keys()) if (!retained.has(key)) this.executions.delete(key)
  }

  observeSubmitted(
    transaction: { from?: unknown; to?: unknown; chainId?: unknown; data?: unknown },
    hash: unknown
  ) {
    const previous = this.observations()
    const next = this.mergeSubmitted(previous, transaction, hash)
    if (next === previous) return
    this.dependencies.save(next)
    this.observationsChanged(previous)
  }

  captureObservationGuard() {
    const captured = new Map(
      this.dependencies.accounts().map((account) => {
        const owner = account.toLowerCase()
        return [owner, this.historyRevisions.get(owner) || 0] as const
      })
    )
    return (account: string) =>
      captured.has(account.toLowerCase()) &&
      captured.get(account.toLowerCase()) === (this.historyRevisions.get(account.toLowerCase()) || 0)
  }

  commitActivity(
    chainId: number,
    calls: readonly ObservedTokenApprovalCall[],
    reorgAfter: number | undefined,
    commit: (observations?: TokenApprovalObservation[]) => void
  ) {
    const previous = this.observations()
    let next = previous
    for (const call of calls) {
      next = this.mergeSubmitted(next, { ...call, chainId: `0x${chainId.toString(16)}` }, call.hash)
    }
    // Persist observations and scanner progress together. Failed commits remain retryable.
    commit(next === previous ? undefined : next)
    if (next !== previous) this.observationsChanged(previous)
    if (reorgAfter !== undefined) {
      for (const entry of this.observations()) {
        if (entry.chainId === chainId) {
          this.invalidate(entry.id)
          this.executions.delete(entry.id)
        }
      }
    }
  }

  list(account: string): TokenApprovalView[] {
    const owner = this.requireAccount(account)
    return this.observations()
      .filter((entry) => entry.account === owner)
      .map((entry) => this.view(entry))
  }

  private view(entry: TokenApprovalObservation): TokenApprovalView {
    const { transactionHash: _hash, ...visible } = entry
    if (!this.dependencies.chainEnabled(entry.chainId)) return { ...visible, status: 'network-off' }
    const checked = this.checks.get(entry.id)
    const age = checked ? Date.now() - checked.checkedAt : -1
    if (!checked || checked.observation !== this.version(entry) || age < 0 || age > CHECK_LIFETIME_MS) {
      return { ...visible, status: 'unchecked' }
    }
    return checked.status === 'current' && checked.amount !== undefined
      ? { ...visible, status: 'current', amount: checked.amount, checkedAt: checked.checkedAt }
      : { ...visible, status: 'unavailable' }
  }

  private async read(entry: TokenApprovalObservation) {
    if (!this.dependencies.chainEnabled(entry.chainId)) return
    const version = this.version(entry)
    const key = `${entry.id}:${version}`
    const inProgress = this.pending.get(key)
    if (inProgress) return inProgress
    const operation = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let amount: string | undefined
      try {
        const result = await Promise.race([
          this.dependencies.rpc(entry.chainId, 'eth_call', [
            { to: entry.token, data: buildErc20AllowanceCalldata(entry.account, entry.spender) },
            'latest'
          ]),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Allowance request timed out')), RPC_DEADLINE_MS)
            timer.unref?.()
          })
        ])
        amount = parseErc20AllowanceResult(result)
      } catch {
        amount = undefined
      } finally {
        if (timer) clearTimeout(timer)
      }
      const current = this.observations().find((candidate) => candidate.id === entry.id)
      if (
        !current ||
        this.version(current) !== version ||
        !this.dependencies.accounts().some((account) => account.toLowerCase() === entry.account)
      )
        return
      this.checks.set(entry.id, {
        observation: version,
        status: amount === undefined ? 'unavailable' : 'current',
        ...(amount === undefined ? {} : { amount }),
        checkedAt: Date.now()
      })
    })()
    this.pending.set(key, operation)
    try {
      await operation
    } finally {
      if (this.pending.get(key) === operation) this.pending.delete(key)
    }
  }

  async refresh(account: string, ids: readonly string[]): Promise<TokenApprovalView[]> {
    const owner = this.requireAccount(account)
    if (
      !Array.isArray(ids) ||
      ids.length > MAX_TOKEN_APPROVAL_REFRESH ||
      ids.some((id) => typeof id !== 'string' || !/^[0-9a-f]{64}$/u.test(id))
    )
      throw new Error('Invalid approval selection')
    const observations = this.observations()
    const selected = [...new Set(ids)].map((id) => {
      const entry = observations.find((candidate) => candidate.id === id && candidate.account === owner)
      if (!entry) throw new Error('Approval is no longer available')
      return entry
    })
    let index = 0
    await Promise.all(
      Array.from({ length: Math.min(4, selected.length) }, async () => {
        while (index < selected.length) await this.read(selected[index++]!)
      })
    )
    return this.dependencies.accounts().some((saved) => saved.toLowerCase() === owner)
      ? this.list(owner).filter((entry) => ids.includes(entry.id))
      : []
  }

  async prepareRevocation(account: string, id: string) {
    if (!this.list(account).some((entry) => entry.id === id))
      throw new Error('Approval is no longer available')
    this.invalidate(id)
    const [checked] = await this.refresh(account, [id])
    if (!checked || checked.status !== 'current') throw new Error('Allowance unavailable. Try again.')
    if (checked.amount === '0') throw new Error('No allowance to revoke')
    return Object.freeze({
      from: checked.account,
      to: checked.token,
      chainId: `0x${checked.chainId.toString(16)}`,
      value: '0x0',
      data: erc20Interface.encodeFunctionData('approve', [checked.spender, '0'])
    })
  }

  async afterExecution(chainId: number, hash: string, evidence?: string) {
    const entries = this.observations().filter(
      (entry) => entry.chainId === chainId && entry.transactionHash === hash
    )
    for (const entry of entries) {
      if (evidence && this.executions.get(entry.id) === evidence) continue
      if (evidence) this.executions.set(entry.id, evidence)
      this.invalidate(entry.id)
      if (this.dependencies.accounts().some((saved) => saved.toLowerCase() === entry.account))
        await this.refresh(entry.account, [entry.id])
    }
  }

  clear(account: string) {
    const owner = this.requireAccount(account)
    const entries = this.observations()
    this.dependencies.save(entries.filter((entry) => entry.account !== owner))
    this.historyRevisions.set(owner, ++this.sequence)
    for (const entry of entries)
      if (entry.account === owner) {
        this.checks.delete(entry.id)
        this.revisions.delete(entry.id)
        this.executions.delete(entry.id)
      }
  }
}
