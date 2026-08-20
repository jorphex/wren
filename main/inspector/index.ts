import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import {
  parseInspectorInput,
  type InspectorInput,
  type InspectorTransaction,
  type ParsedInspectorSubject
} from '../../resources/domain/inspector'
import { getTypedDataContext, parseTypedMessage } from '../../resources/domain/typedData'
import { GasFeesSource, type TransactionData } from '../../resources/domain/transaction'
import { simulateTransaction, type TransactionSimulation } from '../transaction/simulation'
import { decodeLocalCalldata } from './localDecode'
import { InspectorInvokeResultSchema, type InspectorInvokeResult } from './schema'

type ChainSend = (
  payload: JSONRPCRequestPayload,
  callback: RPCRequestCallback,
  targetChain: { type: 'ethereum'; id: number }
) => void

export interface InspectorDependencies {
  send: ChainSend
  timeoutMs?: number
}

class InspectorRequestError extends Error {}

const boundedReason = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback

const lowerAddress = (value: string | undefined) => value?.toLowerCase()

function failure(error: string): InspectorInvokeResult {
  return InspectorInvokeResultSchema.parse({
    success: false,
    error: boundedReason(error, 'Inspection failed')
  })
}

function validatedResult(value: unknown): InspectorInvokeResult {
  const parsed = InspectorInvokeResultSchema.safeParse(value)
  return parsed.success ? parsed.data : failure('Inspector could not safely produce evidence for this input')
}

function normalizedTransaction(
  subject: Extract<ParsedInspectorSubject, { kind: 'transaction' | 'calldata' }>
) {
  const transaction: InspectorTransaction =
    subject.kind === 'transaction'
      ? subject.transaction
      : {
          ...subject.context,
          type: '0x0'
        }
  const source = subject.source.kind === 'json-rpc' ? subject.source : undefined
  const accessList = transaction.accessList

  return {
    ...(transaction.chainId ? { chainId: transaction.chainId } : {}),
    ...(transaction.type ? { type: transaction.type } : {}),
    ...(transaction.nonce ? { nonce: transaction.nonce } : {}),
    ...(transaction.from ? { from: transaction.from.toLowerCase() } : {}),
    ...(subject.kind === 'transaction'
      ? { to: transaction.to ? transaction.to.toLowerCase() : null }
      : transaction.to
        ? { to: transaction.to.toLowerCase() }
        : {}),
    ...(transaction.value ? { value: transaction.value } : {}),
    data: transaction.data || '0x',
    ...(transaction.gas ? { gas: transaction.gas } : {}),
    ...(transaction.gasPrice ? { gasPrice: transaction.gasPrice } : {}),
    ...(transaction.maxFeePerGas ? { maxFeePerGas: transaction.maxFeePerGas } : {}),
    ...(transaction.maxPriorityFeePerGas ? { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas } : {}),
    ...(accessList
      ? {
          accessList: {
            addresses: accessList.length,
            storageKeys: accessList.reduce((count, entry) => count + entry.storageKeys.length, 0)
          }
        }
      : {}),
    ...(source?.block ? { requestedBlock: source.block } : {})
  }
}

function publicAccountCode(simulation: TransactionSimulation) {
  const evidence = simulation.accountCodeEvidence
  if (!evidence) return
  return [evidence.sender, ...evidence.targets].slice(0, 17).map((entry) => ({
    role: entry.role,
    account: entry.account.toLowerCase(),
    status: entry.status,
    ...('codeHash' in entry && entry.codeHash ? { codeHash: entry.codeHash.toLowerCase() } : {}),
    ...(entry.status === 'delegated'
      ? {
          delegate: entry.delegate.toLowerCase(),
          delegateCodeStatus: entry.delegateCodeStatus
        }
      : {}),
    ...(entry.status === 'unavailable'
      ? { reason: boundedReason(entry.reason, 'Account code evidence is unavailable') }
      : {})
  }))
}

export function projectInspectorSimulation(simulation: TransactionSimulation) {
  const accountCode = publicAccountCode(simulation)
  const nativeBalanceChanges = simulation.nativeBalanceChanges
    ? {
        status: simulation.nativeBalanceChanges.status,
        ...(simulation.nativeBalanceChanges.status === 'succeeded'
          ? {
              changes: simulation.nativeBalanceChanges.changes.slice(0, 128).map((change) => ({
                ...change,
                account: change.account.toLowerCase()
              })),
              ...(simulation.nativeBalanceChanges.truncated ||
              simulation.nativeBalanceChanges.changes.length > 128
                ? { truncated: true }
                : {})
            }
          : {
              reason: boundedReason(
                simulation.nativeBalanceChanges.reason,
                'Native balance-change evidence is unavailable'
              )
            })
      }
    : undefined
  const proxyImplementation = simulation.proxyImplementationCheck
    ? {
        status: simulation.proxyImplementationCheck.status,
        ...(simulation.proxyImplementationCheck.status === 'succeeded'
          ? {
              changes: simulation.proxyImplementationCheck.changes.slice(0, 32).map((change) => ({
                proxy: change.proxy.toLowerCase(),
                kind: change.kind,
                ...(change.beforeImplementation
                  ? { beforeImplementation: change.beforeImplementation.toLowerCase() }
                  : {}),
                ...(change.afterImplementation
                  ? { afterImplementation: change.afterImplementation.toLowerCase() }
                  : {})
              })),
              ...(simulation.proxyImplementationCheck.truncated ||
              simulation.proxyImplementationCheck.changes.length > 32
                ? { truncated: true }
                : {})
            }
          : {
              reason: boundedReason(
                simulation.proxyImplementationCheck.reason,
                'Proxy implementation evidence is unavailable'
              )
            })
      }
    : undefined

  return {
    status: simulation.status,
    ...(simulation.source ? { source: simulation.source } : {}),
    ...(simulation.gasUsed ? { gasUsed: simulation.gasUsed.toLowerCase() } : {}),
    ...(simulation.reason ? { reason: boundedReason(simulation.reason, 'Simulation failed') } : {}),
    ...(simulation.effects
      ? {
          effects: simulation.effects.slice(0, 100).map((effect) => ({
            ...effect,
            token: effect.token.toLowerCase(),
            ...('from' in effect ? { from: effect.from.toLowerCase() } : {}),
            ...('to' in effect ? { to: effect.to.toLowerCase() } : {}),
            ...('owner' in effect ? { owner: effect.owner.toLowerCase() } : {}),
            ...('spender' in effect ? { spender: effect.spender.toLowerCase() } : {}),
            ...('operator' in effect ? { operator: effect.operator.toLowerCase() } : {})
          })),
          ...(simulation.effectsTruncated || simulation.effects.length > 100
            ? { effectsTruncated: true }
            : {})
        }
      : {}),
    ...(simulation.allowance
      ? {
          allowance: {
            token: simulation.allowance.token.toLowerCase(),
            owner: simulation.allowance.owner.toLowerCase(),
            spender: simulation.allowance.spender.toLowerCase(),
            currentAmount: simulation.allowance.currentAmount,
            requestedAmount: simulation.allowance.requestedAmount
          }
        }
      : {}),
    ...(simulation.delegation
      ? {
          delegation: {
            status: simulation.delegation.status,
            account: simulation.delegation.account.toLowerCase(),
            ...(simulation.delegation.delegate
              ? { delegate: simulation.delegation.delegate.toLowerCase() }
              : {}),
            ...(simulation.delegation.reason
              ? { reason: boundedReason(simulation.delegation.reason, 'Delegation evidence is unavailable') }
              : {})
          }
        }
      : {}),
    ...(accountCode ? { accountCode } : {}),
    ...(nativeBalanceChanges ? { nativeBalanceChanges } : {}),
    ...(simulation.callTrace
      ? {
          callTrace: {
            calls: simulation.callTrace.calls.slice(0, 100).map((call) => ({
              ...call,
              from: call.from.toLowerCase(),
              ...(call.to ? { to: call.to.toLowerCase() } : {}),
              ...(call.selector ? { selector: call.selector.toLowerCase() } : {}),
              ...(call.failure ? { failure: boundedReason(call.failure, 'Call failed') } : {})
            })),
            ...(simulation.callTrace.truncated || simulation.callTrace.calls.length > 100
              ? { truncated: true }
              : {})
          }
        }
      : {}),
    ...(proxyImplementation ? { proxyImplementation } : {}),
    ...(simulation.advancedChecks ? { advancedStatus: simulation.advancedChecks.status } : {})
  }
}

function simulationEvidence(simulation: TransactionSimulation, disclosure?: string) {
  if (simulation.status === 'failed' || simulation.status === 'unavailable') {
    return {
      kind: 'simulation' as const,
      status: 'unavailable' as const,
      source: 'configured-rpc' as const,
      reason: boundedReason(
        disclosure ? `${disclosure}. ${simulation.reason || 'Simulation unavailable'}` : simulation.reason,
        'Configured-RPC simulation is unavailable'
      )
    }
  }
  const partial = simulation.advancedChecks?.status === 'partly-unavailable'
  return {
    kind: 'simulation' as const,
    status: partial ? ('partly-unavailable' as const) : ('available' as const),
    source: 'configured-rpc' as const,
    ...(partial || disclosure
      ? {
          reason: boundedReason(
            [
              ...(partial ? ['Some optional trace evidence is unavailable from the configured RPC'] : []),
              ...(disclosure ? [disclosure] : [])
            ].join('. '),
            'Configured-RPC evidence is partly unavailable'
          )
        }
      : {})
  }
}

async function inspectTransactionSubject(
  subject: Extract<ParsedInspectorSubject, { kind: 'transaction' | 'calldata' }>,
  dependencies: InspectorDependencies
): Promise<InspectorInvokeResult> {
  const normalized = normalizedTransaction(subject)
  const decode =
    subject.kind === 'transaction' && !normalized.to
      ? {
          status: 'unavailable' as const,
          source: 'bundled-standard-abi' as const,
          reason: 'Contract-creation initcode is not decoded as function calldata'
        }
      : decodeLocalCalldata(normalized.data)
  const missingContext: Array<'chainId' | 'from' | 'to'> = []
  if (!normalized.chainId) missingContext.push('chainId')
  if (!normalized.from) missingContext.push('from')
  if (subject.kind === 'calldata' && !normalized.to) missingContext.push('to')

  const evidence: Array<{
    kind: 'calldata' | 'simulation'
    status: 'available' | 'partly-unavailable' | 'unavailable'
    source: 'local' | 'configured-rpc'
    reason?: string
  }> = [
    decode.status === 'decoded'
      ? { kind: 'calldata', status: 'available', source: 'local' }
      : {
          kind: 'calldata',
          status: decode.status === 'unknown' ? 'partly-unavailable' : 'unavailable',
          source: 'local',
          reason: decode.reason
        }
  ]

  const canSimulate =
    Boolean(normalized.chainId && normalized.from) &&
    (subject.kind === 'transaction' || Boolean(normalized.to))
  const requestedBlock = subject.source.kind === 'json-rpc' ? subject.source.block : undefined
  const requestedNonLatestBlock = Boolean(requestedBlock && requestedBlock !== 'latest')
  let simulation: ReturnType<typeof projectInspectorSimulation> | undefined
  if (canSimulate && !requestedNonLatestBlock) {
    const raw =
      subject.kind === 'transaction'
        ? subject.transaction
        : {
            ...subject.context,
            type: '0x0' as const
          }
    const simulationTransaction: TransactionData = {
      ...raw,
      chainId: raw.chainId as string,
      type: raw.type,
      data: raw.data || '0x',
      gasFeesSource: GasFeesSource.Dapp
    }
    const inspected = await simulateTransaction(simulationTransaction, {
      send: dependencies.send,
      ...(dependencies.timeoutMs === undefined ? {} : { timeoutMs: dependencies.timeoutMs })
    })
    simulation = projectInspectorSimulation(inspected)
    const sourceDisclosure =
      subject.source.kind === 'json-rpc'
        ? `Pasted ${subject.source.method}${subject.source.block ? ` block ${subject.source.block}` : ''} was mapped to inspection and not forwarded; simulation used Wren's current configured-RPC review path`
        : undefined
    evidence.push(simulationEvidence(inspected, sourceDisclosure))
  } else {
    const reason = requestedNonLatestBlock
      ? `Wren does not simulate requested block ${requestedBlock}; only current configured-RPC state is available, so no simulation result is shown`
      : `Simulation requires ${missingContext.join(', ') || 'complete transaction context'}`
    evidence.push({
      kind: 'simulation',
      status: 'unavailable',
      source: 'configured-rpc',
      reason: reason.slice(0, 240)
    })
  }

  return validatedResult({
    success: true,
    inspection: {
      kind: subject.kind,
      source: subject.source.kind,
      ...(subject.source.kind === 'json-rpc' ? { sourceMethod: subject.source.method } : {}),
      normalized,
      decode,
      evidence,
      missingContext,
      ...(simulation ? { simulation } : {})
    }
  })
}

function domainSummary(domain: Record<string, unknown>) {
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.length <= max ? value : undefined
  const address = lowerAddress(text(domain['verifyingContract'], 42))
  const rawChainId = domain['chainId']
  const chainId =
    typeof rawChainId === 'string' || typeof rawChainId === 'number' || typeof rawChainId === 'bigint'
      ? String(rawChainId).slice(0, 78)
      : undefined
  return {
    ...(text(domain['name'], 256) ? { name: text(domain['name'], 256) } : {}),
    ...(text(domain['version'], 128) ? { version: text(domain['version'], 128) } : {}),
    ...(chainId ? { chainId } : {}),
    ...(address && /^0x[0-9a-f]{40}$/.test(address) ? { verifyingContract: address } : {})
  }
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)])
      )
    }
    return candidate
  }
  return JSON.stringify(normalize(value))
}

function inspectTypedDataSubject(
  subject: Extract<ParsedInspectorSubject, { kind: 'typed-data' }>
): InspectorInvokeResult {
  const version = subject.version === 'V3' ? SignTypedDataVersion.V3 : SignTypedDataVersion.V4
  const typedMessage = parseTypedMessage(subject.typedData, version)
  const parsedChainId = subject.chainId ? BigInt(subject.chainId) : undefined
  if (parsedChainId !== undefined && parsedChainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InspectorRequestError('Chain ID exceeds configured-RPC range')
  }
  const requestChainId = parsedChainId === undefined ? undefined : Number(parsedChainId)
  const rawContext = getTypedDataContext(typedMessage, requestChainId || 1)
  const risks = requestChainId
    ? rawContext.risks
    : rawContext.risks.filter((risk) => risk !== 'domain-chain-mismatch')
  const authority = rawContext.permit2
    ? {
        standard: 'permit2' as const,
        kind: rawContext.permit2.kind,
        verifyingContract: rawContext.permit2.verifyingContract.toLowerCase(),
        spender: rawContext.permit2.spender.toLowerCase(),
        grantsAuthority: rawContext.permit2.grantsAuthority,
        maximumAmount: rawContext.permit2.maximumAmount
      }
    : rawContext.eip3009
      ? {
          standard: 'eip3009' as const,
          kind: rawContext.eip3009.kind,
          verifyingContract: rawContext.eip3009.verifyingContract.toLowerCase(),
          authorizer: rawContext.eip3009.authorizer.toLowerCase(),
          grantsAuthority: rawContext.eip3009.grantsAuthority,
          maximumAmount: rawContext.eip3009.maximumAmount
        }
      : undefined
  return validatedResult({
    success: true,
    inspection: {
      kind: 'typed-data',
      source: subject.source.kind,
      ...(subject.source.kind === 'json-rpc' ? { sourceMethod: subject.source.method } : {}),
      normalized: {
        version: subject.version,
        primaryType: subject.typedData.primaryType,
        ...(subject.signer ? { signer: subject.signer.toLowerCase() } : {}),
        typedData: canonicalJson(subject.typedData),
        domain: domainSummary(subject.typedData.domain)
      },
      typedContext: {
        ...(requestChainId ? { requestChainId } : {}),
        ...(rawContext.domainChainId ? { domainChainId: rawContext.domainChainId } : {}),
        risks,
        ...(authority ? { authority } : {})
      },
      evidence: [{ kind: 'typed-data', status: 'available', source: 'local' }],
      missingContext: [
        ...(requestChainId ? [] : (['chainId'] as const)),
        ...(subject.signer ? [] : (['signer'] as const))
      ]
    }
  })
}

export async function inspect(input: InspectorInput, dependencies: InspectorDependencies) {
  let subject: ParsedInspectorSubject
  try {
    subject = parseInspectorInput(input)
  } catch (error) {
    return failure(boundedReason(error instanceof Error ? error.message : undefined, 'Inspection failed'))
  }

  try {
    return subject.kind === 'typed-data'
      ? inspectTypedDataSubject(subject)
      : await inspectTransactionSubject(subject, dependencies)
  } catch (error) {
    return error instanceof InspectorRequestError
      ? failure(error.message)
      : failure('Inspector could not safely produce evidence for this input')
  }
}

export { InspectorInvokeResultSchema } from './schema'
