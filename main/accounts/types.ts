import type {
  MessageTypes,
  SignTypedDataVersion,
  TypedDataV1,
  TypedMessage as BaseTypedMessage
} from '@metamask/eth-sig-util'
import type { DecodedCallData } from '../contracts'
import type { Chain } from '../chains'
import type { TransactionData } from '../../resources/domain/transaction'
import type { WalletCallBatchAdjustment } from '../provider/walletCallAdjustment'
import type { Action } from '../transaction/actions'
import type { TokenData } from '../contracts/erc20'
import type { Token } from '../store/state'
import type { TransactionSimulation, WalletCallsSimulation } from '../transaction/simulation'
import type { AddressSafetyAssessment } from '../addressSafety/types'

export enum ReplacementType {
  Speed = 'speed',
  Cancel = 'cancel'
}

export enum RequestMode {
  Normal = 'normal',
  Monitor = 'monitor'
}

export enum RequestStatus {
  Pending = 'pending',
  Sending = 'sending',
  Verifying = 'verifying',
  Confirming = 'confirming',
  Confirmed = 'confirmed',
  Sent = 'sent',
  Declined = 'declined',
  Error = 'error',
  Success = 'success'
}

export type TypedSignatureRequestType = 'signTypedData' | 'signErc20Permit'

export type SignatureRequestType = 'sign' | TypedSignatureRequestType

export type RequestType =
  SignatureRequestType | 'transaction' | 'access' | 'addChain' | 'addToken' | 'walletCalls' | 'eip7702Revoke'

interface Request {
  type: RequestType
  handlerId: string
}

export type Identity = {
  address: Address
  ens: string
  type: string
}

export interface AccountRequest<T extends RequestType = RequestType> extends Request {
  type: T
  origin: string
  payload: JSONRPCRequestPayload
  account: string
  status?: RequestStatus
  mode?: RequestMode
  notice?: string
  created?: number
  activityId?: string
  queueIndex?: number
  res?: RPCRequestCallback
}

export interface TransactionReceipt {
  gasUsed: string
  blockNumber: string
  status: string
  [field: string]: unknown
}

export type ApprovalData = Record<string, unknown>

export interface Approval {
  type: string
  data: ApprovalData
  approved: boolean
  approve: (data?: ApprovalData) => void
}

export interface Permit {
  deadline: string | number
  spender: string
  value: string | number
  owner: string
  verifyingContract: string
  chainId: number
  nonce: string | number
}

export enum TxClassification {
  CONTRACT_DEPLOY = 'CONTRACT_DEPLOY',
  CONTRACT_CALL = 'CONTRACT_CALL',
  SEND_DATA = 'SEND_DATA',
  NATIVE_TRANSFER = 'NATIVE_TRANSFER'
}

export interface TransactionRequest extends AccountRequest<'transaction'> {
  payload: RPC.SendTransaction.Request
  data: TransactionData
  decodedData?: DecodedCallData
  chainData?: {
    optimism?: {
      l1Fees: string
    }
  }
  tx?: {
    receipt?: TransactionReceipt
    hash?: string
    confirmations: number
  }
  approvals: Approval[]
  locked?: boolean
  recipient?: string // resolved ENS name; local labels are applied by the renderer
  updatedFees?: boolean
  feeAtTime?: string
  completed?: number
  feesUpdatedByUser: boolean
  recipientType: string
  recognizedActions: Action<unknown>[]
  classification: TxClassification
  simulation: TransactionSimulation
  addressSafety?: AddressSafetyAssessment
  recoverableError?: {
    code: 'account-code-evidence-unavailable' | 'account-code-evidence-changed'
    message: string
    data?: unknown
  }
  retainedPreBroadcastError?: {
    responderPending: boolean
  }
}

export interface SignRequest extends AccountRequest<'sign'> {
  data: {
    rawMessage: string
    decodedMessage: string
    context: MessageSigningContext
  }
  approvals: Approval[]
}

export type MessageSigningMethod = 'personal_sign' | 'eth_sign'

export type MessageSigningRisk =
  | 'legacy-eth-sign'
  | 'opaque-message'
  | 'siwe-malformed'
  | 'siwe-origin-unverified'
  | 'siwe-origin-mismatch'
  | 'siwe-address-mismatch'
  | 'siwe-chain-mismatch'
  | 'siwe-expired'
  | 'siwe-not-yet-valid'
  | 'siwe-issued-in-future'

export interface SiweMessageData {
  scheme?: string
  domain: string
  address: string
  statement?: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt?: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

export interface MessageSigningContext {
  method: MessageSigningMethod
  requestChainId: number
  origin: string
  encoding: 'utf8' | 'hex'
  byteLength: number
  risks: MessageSigningRisk[]
  siwe?: SiweMessageData
}

export type TypedData<T extends MessageTypes = MessageTypes> = BaseTypedMessage<T>
export type LegacyTypedData = TypedDataV1

export interface TypedMessage<V extends SignTypedDataVersion = SignTypedDataVersion> {
  data: V extends SignTypedDataVersion.V1 ? LegacyTypedData : TypedData
  version: V
}

export type TypedDataRisk =
  | 'legacy-v1'
  | 'domain-chain-missing'
  | 'domain-chain-invalid'
  | 'domain-chain-mismatch'
  | 'permit2-allowance'
  | 'permit2-transfer'
  | 'permit2-maximum-amount'
  | 'permit2-noncanonical-contract'
  | 'eip3009-transfer'
  | 'eip3009-maximum-amount'

export interface Permit2Permission {
  token: string
  amount: string
  expiration?: string
}

export interface Permit2Authority {
  kind: 'allowance' | 'transfer'
  primaryType:
    | 'PermitSingle'
    | 'PermitBatch'
    | 'PermitTransferFrom'
    | 'PermitBatchTransferFrom'
    | 'PermitWitnessTransferFrom'
    | 'PermitBatchWitnessTransferFrom'
  verifyingContract: string
  canonicalContract: boolean
  spender: string
  deadline: string
  permissions: Permit2Permission[]
  batch: boolean
  witness: boolean
  grantsAuthority: boolean
  maximumAmount: boolean
}

export interface Eip3009Authorization {
  kind: 'transfer' | 'receive' | 'cancel'
  primaryType: 'TransferWithAuthorization' | 'ReceiveWithAuthorization' | 'CancelAuthorization'
  verifyingContract: string
  authorizer: string
  from?: string
  to?: string
  value?: string
  validAfter?: string
  validBefore?: string
  nonce: string
  grantsAuthority: boolean
  maximumAmount: boolean
}

export interface TypedDataContext {
  requestChainId: number
  domainChainId?: string
  risks: TypedDataRisk[]
  permit2?: Permit2Authority
  eip3009?: Eip3009Authorization
}

export type SignTypedDataRequest = DefaultSignTypedDataRequest | PermitSignatureRequest

export type SignatureRequest = SignTypedDataRequest | SignRequest

export interface DefaultSignTypedDataRequest extends AccountRequest<'signTypedData'> {
  payload: RPC.SignTypedData.Request
  typedMessage: TypedMessage
  context: TypedDataContext
  approvals: Approval[]
}

interface EIP2612PermitDomain {
  chainId: number
  verifyingContract: string
}

export interface EIP2612TypedData {
  types: MessageTypes
  primaryType: 'Permit'
  domain: EIP2612PermitDomain
  message: Omit<Permit, 'chainId' | 'verifyingContract'>
}

interface PermitData extends Omit<Permit, 'spender' | 'verifyingContract'> {
  spender: Identity
  verifyingContract: Identity
}

export interface PermitSignatureRequest extends AccountRequest<'signErc20Permit'> {
  payload: RPC.SignTypedData.Request
  typedMessage: {
    data: EIP2612TypedData
    version: SignTypedDataVersion
  }
  permit: PermitData
  tokenData: TokenData
  context: TypedDataContext
  approvals: Approval[]
}

export interface AccessRequest extends AccountRequest<'access'> {
  permission: import('../store/state').Permission
}

export interface AddChainRequest extends AccountRequest<'addChain'> {
  chain: Chain
}

export interface AddTokenRequest extends AccountRequest<'addToken'> {
  token: Token
}

export interface WalletCallsRequest extends AccountRequest<'walletCalls'> {
  version: '2.0.0'
  batchId: string
  chainId: string
  atomic: false
  calls: Array<{
    to?: string
    data: string
    value: string
  }>
  callDetails?: readonly Readonly<{
    label: string
    source: string
    method?: string
  } | null>[]
  locked?: boolean
  adjustment?: Readonly<WalletCallBatchAdjustment>
  preparation: WalletCallsPreparation
  simulation: WalletCallsSimulation
  addressSafety?: AddressSafetyAssessment
  res?: WalletCallsResponder | RPCRequestCallback
}

export interface Eip7702RevokeRequest extends AccountRequest<'eip7702Revoke'> {
  version: '1'
  chainId: string
  evidence: Readonly<{
    source: 'eth_getCode'
    authority: string
    delegate: string
    codeHash: string
    latestNonce: string
    pendingNonce: string
  }>
  fees: {
    gasLimit: string
    maxFeePerGas: string
    maxPriorityFeePerGas: string
    maxFee: string
  }
  feesUpdatedByUser: boolean
  locked?: boolean
  operationVersion: number
  failureReason?: 'evidence-changed' | 'not-delegated' | 'unavailable'
  submission?: Readonly<{
    status: 'unconfirmed'
    detail: string
  }>
  tx?: {
    hash: string
    receipt?: TransactionReceipt
    confirmations: number
  }
  result?: Readonly<{
    receiptStatus: 'success' | 'failed' | 'unavailable'
    revocationStatus: 'cleared' | 'skipped' | 'unavailable'
    reason: 'code-cleared' | 'code-remains' | 'receipt-unavailable' | 'code-unavailable'
    checkedAtBlock?: string
  }>
  completed?: number
}

export interface WalletCallsResponder {
  (response?: RPCResponsePayload): void
  readonly walletCallsLifecycle: true
  accept(id: string): void
}

export type AnyAccountRequest =
  | TransactionRequest
  | SignatureRequest
  | AccessRequest
  | AddChainRequest
  | AddTokenRequest
  | WalletCallsRequest
  | Eip7702RevokeRequest

export type WalletCallsPreparation =
  | { status: 'pending' }
  | { status: 'failed'; reason: string }
  | {
      status: 'succeeded'
      calls: readonly Readonly<{
        transaction: Readonly<TransactionData>
        maxFee: string
      }>[]
      maxFee: string
    }
