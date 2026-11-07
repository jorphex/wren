import type { TokenApprovalsService } from './service'

type Revocation = Awaited<ReturnType<TokenApprovalsService['prepareRevocation']>>

export class TokenApprovalRevocations {
  private opening = new Set<string>()

  constructor(
    private dependencies: {
      service: TokenApprovalsService
      canReview(account: string): boolean
      queue(transaction: Revocation): Promise<string>
    }
  ) {}

  async request(account: string, id: string) {
    const owner = account.toLowerCase()
    const key = `${owner}:${id}`
    if (this.opening.has(key)) throw new Error('Revocation review is already opening')
    if (!this.dependencies.canReview(owner)) throw new Error('Select an available signing account')
    this.opening.add(key)
    try {
      const transaction = await this.dependencies.service.prepareRevocation(owner, id)
      if (!this.dependencies.canReview(owner)) throw new Error('Select an available signing account')
      const handlerId = await this.dependencies.queue(transaction)
      return { account: owner, handlerId, type: 'transaction' as const }
    } finally {
      this.opening.delete(key)
    }
  }
}
