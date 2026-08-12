import { z } from 'zod'

import {
  MAX_OPERATION_LIFECYCLE_AGE_MS,
  OperationLifecycle,
  OperationLifecycleSchema,
  OperationLifecycles,
  pruneOperationLifecycles
} from '../../../state/types/operationLifecycle'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const HASH = /^0x[0-9a-fA-F]{64}$/u
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u

const StateSchema = z.object({ main: z.object({}).passthrough() }).passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const quantity = (value: unknown) =>
  typeof value === 'string' && QUANTITY.test(value) && value.length <= 66 ? value.toLowerCase() : undefined

const chainId = (value: unknown) => {
  const parsed = quantity(value)
  if (!parsed) return
  try {
    const numeric = Number(BigInt(parsed))
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined
  } catch (_error) {
    return
  }
}

const timestamp = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

const receiptEvidence = (value: unknown, transactionHash: string) => {
  if (!isRecord(value)) return
  const blockHash = value['blockHash']
  const blockNumber = quantity(value['blockNumber'])
  const status = value['status']
  if (
    typeof blockHash !== 'string' ||
    !HASH.test(blockHash) ||
    !blockNumber ||
    (status !== '0x0' && status !== '0x1')
  ) {
    return
  }
  return {
    transactionHash,
    blockHash: blockHash.toLowerCase(),
    blockNumber,
    status
  } as const
}

const baseOperation = (
  request: Record<string, unknown>,
  account: string
):
  | Omit<OperationLifecycle, 'kind' | 'state' | 'transaction' | 'walletCalls' | 'eip7702Revoke'>
  | undefined => {
  const id = request['activityId']
  const origin = request['origin']
  const createdAt = timestamp(request['created'])
  const requestAccount = request['account']
  if (
    typeof id !== 'string' ||
    !z.uuid().safeParse(id).success ||
    typeof origin !== 'string' ||
    origin.length < 1 ||
    origin.length > 256 ||
    Buffer.byteLength(origin, 'utf8') > 256 ||
    createdAt === undefined ||
    typeof requestAccount !== 'string' ||
    requestAccount.toLowerCase() !== account
  ) {
    return
  }

  return {
    id,
    account,
    origin,
    chainId: 1,
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + MAX_OPERATION_LIFECYCLE_AGE_MS,
    visibleInActivity: true,
    notification: {}
  }
}

const migratedOperation = (requestValue: unknown, account: string): OperationLifecycle | undefined => {
  if (!isRecord(requestValue)) return
  if (!['sent', 'verifying', 'confirming'].includes(String(requestValue['status']))) return
  const base = baseOperation(requestValue, account)
  if (!base) return
  const tx = isRecord(requestValue['tx']) ? requestValue['tx'] : undefined
  const hash = tx?.['hash']
  if (typeof hash !== 'string' || !HASH.test(hash)) return
  const normalizedHash = hash.toLowerCase()
  const receipt = receiptEvidence(tx?.['receipt'], normalizedHash)

  let candidate: unknown
  if (requestValue['type'] === 'transaction') {
    const data = isRecord(requestValue['data']) ? requestValue['data'] : undefined
    const requestChainId = chainId(data?.['chainId'])
    const nonce = quantity(data?.['nonce'])
    if (!requestChainId || !nonce) return
    candidate = {
      ...base,
      kind: 'transaction',
      chainId: requestChainId,
      state: receipt ? 'confirming' : 'submitted',
      transaction: { hash: normalizedHash, nonce },
      ...(receipt ? { receipt } : {})
    }
  } else if (requestValue['type'] === 'eip7702Revoke') {
    const requestChainId = chainId(requestValue['chainId'])
    const evidence = isRecord(requestValue['evidence']) ? requestValue['evidence'] : undefined
    const latestNonce = quantity(evidence?.['latestNonce'])
    if (!requestChainId || !latestNonce) return
    let expectedFinalNonce: string
    try {
      expectedFinalNonce = `0x${(BigInt(latestNonce) + 2n).toString(16)}`
    } catch (_error) {
      return
    }
    candidate = {
      ...base,
      kind: 'eip7702Revoke',
      chainId: requestChainId,
      state: receipt ? 'confirming' : 'submitted',
      eip7702Revoke: { hash: normalizedHash, expectedFinalNonce },
      ...(receipt ? { receipt } : {})
    }
  } else {
    return
  }

  const parsed = OperationLifecycleSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const accounts = isRecord(parsed.data.main['accounts']) ? parsed.data.main['accounts'] : {}
  const operationLifecycles: OperationLifecycles = {}
  const sanitizedAccounts = Object.fromEntries(
    Object.entries(accounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([accountId, accountValue]) => {
        if (!isRecord(accountValue)) return [accountId, accountValue]
        const normalizedAccount = accountId.toLowerCase()
        const requests = isRecord(accountValue['requests']) ? accountValue['requests'] : {}
        if (ADDRESS.test(accountId)) {
          Object.entries(requests)
            .sort(([left], [right]) => left.localeCompare(right))
            .forEach(([_handlerId, request]) => {
              const operation = migratedOperation(request, normalizedAccount)
              if (operation && !operationLifecycles[operation.id]) {
                operationLifecycles[operation.id] = operation
              }
            })
        }

        const { requests: _requests, activeRequestId: _activeRequestId, ...persistedAccount } = accountValue
        return [accountId, { ...persistedAccount, requests: {} }]
      })
  )

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      accounts: sanitizedAccounts,
      operationLifecycles: pruneOperationLifecycles(operationLifecycles, -1)
    }
  }
}

export default { version: 61, migrate }
