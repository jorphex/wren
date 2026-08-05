import EventEmitter from 'events'
import log from 'electron-log'
import { Notification } from 'electron'
import { addHexPrefix, intToHex } from '@ethereumjs/util'
import { v5 as uuidv5 } from 'uuid'
import { toBeHex } from 'ethers'

import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import FrameAccount from './Account'
import ExternalDataScanner, { DataScanner } from '../externalData'
import Signer from '../signers/Signer'
import { signerCompatibility as transactionCompatibility, maxFee, SignerCompatibility } from '../transaction'

import { weiIntToEthInt, hexToInt } from '../../resources/utils'
import { accountPanelCrumb, signerPanelCrumb } from '../../resources/domain/nav'
import { usesBaseFee, TransactionData, GasFeesSource } from '../../resources/domain/transaction'
import {
  WATCH_ONLY_SIGNING_ERROR,
  findUnavailableSigners,
  isSignerReady,
  isWatchOnlyAccountType
} from '../../resources/domain/signer'
import { isCancelableRequest, isSignatureRequest, isTransactionRequest } from '../../resources/domain/request'

import {
  AccountRequest,
  AnyAccountRequest,
  AccessRequest,
  TransactionRequest,
  TransactionReceipt,
  ReplacementType,
  RequestStatus,
  RequestMode,
  TypedMessage,
  PermitSignatureRequest,
  ApprovalData,
  PreviousFee,
  WalletCallsRequest,
  WalletCallsResponder
} from './types'

import type { Chain } from '../chains'
import { ActionType } from '../transaction/actions'
import { openBlockExplorer } from '../windows/window'
import { ApprovalType } from '../../resources/constants'
import { accountNS } from '../../resources/domain/account'
import { chainUsesOptimismFees } from '../../resources/utils/chains'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { parseTokenBaseUnitAmount } from '../../resources/domain/token/amount'
import type { PreparedWalletCallExecutionSnapshot } from '../provider/walletCallPreparedExecution'

const MAX_FEE_PER_GAS = 9_999n * 1_000_000_000n
const MAX_GAS_LIMIT = 12_500_000n

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTransactionReceipt(value: unknown): value is TransactionReceipt {
  return (
    isRecord(value) &&
    parseRpcQuantity(value['gasUsed']) !== undefined &&
    parseRpcQuantity(value['blockNumber']) !== undefined &&
    parseRpcQuantity(value['status']) !== undefined
  )
}

function notify(title: string, body: string, action: (event: Electron.Event) => void) {
  const notification = new Notification({ title, body })
  notification.on('click', action)

  setTimeout(() => notification.show(), 1000)
}

function toTransactionsByLayer(requests: Record<string, AccountRequest>, chainId?: number) {
  return Object.entries(requests)
    .filter(([_, req]) => req.type === 'transaction')
    .reduce(
      ({ l1Transactions, l2Transactions }, [id, req]) => {
        const txRequest = req as TransactionRequest
        if (
          !txRequest.locked &&
          !txRequest.feesUpdatedByUser &&
          txRequest.data.gasFeesSource === GasFeesSource.Frame &&
          (!chainId || parseInt(txRequest.data.chainId, 16) === chainId)
        ) {
          l1Transactions.push([id, txRequest])
        }

        if (chainUsesOptimismFees(parseInt(txRequest.data.chainId, 16))) {
          l2Transactions.push([id, txRequest])
        }

        return { l1Transactions, l2Transactions }
      },
      { l1Transactions: [] as RequestWithId[], l2Transactions: [] as RequestWithId[] }
    )
}

const frameOriginId = uuidv5('frame-internal', uuidv5.DNS)

const storeApi = {
  getAccounts: function () {
    return (store('main.accounts') || {}) as Record<string, Account>
  },
  getAccount: function (id: string) {
    return (store('main.accounts', id) || {}) as Account
  },
  getSigners: function () {
    return Object.values(store('main.signers') || {})
  }
}

export {
  RequestMode,
  AccountRequest,
  AccessRequest,
  TransactionRequest,
  SignTypedDataRequest,
  AddChainRequest,
  AddTokenRequest,
  WalletCallsRequest
} from './types'

type RequestWithId = [string, TransactionRequest]

export class Accounts extends EventEmitter {
  _current: string
  accounts: Record<string, FrameAccount>

  private readonly dataScanner: DataScanner

  constructor() {
    super()

    this.accounts = Object.entries(storeApi.getAccounts()).reduce(
      (accounts, [id, account]) => {
        accounts[id] = new FrameAccount(JSON.parse(JSON.stringify(account)), this)

        return accounts
      },
      {} as Record<string, FrameAccount>
    )

    this._current = Object.values(this.accounts).find((acct) => acct.active)?.id || ''

    this.dataScanner = ExternalDataScanner()
  }

  get(id: string) {
    return this.accounts[id] && this.accounts[id].summary()
  }

  private getTransactionRequest(account: FrameAccount, id: string): TransactionRequest {
    return account.getRequest(id)
  }

  async add(address: Address, name = '', options = {}, cb: Callback<FrameAccount> = () => {}) {
    if (!address) return cb(new Error('No address, will not add account'))
    address = address.toLowerCase()

    let account = this.accounts[address]
    if (!account) {
      log.info('Account not found, creating account')

      const created = 'new:' + Date.now()
      const accountMetaId = uuidv5(address, accountNS)
      const accountMeta = store('main.accountsMeta', accountMetaId) || { name }
      this.accounts[address] = new FrameAccount(
        { address, name: accountMeta.name, created, options, active: false },
        this
      )
      account = this.accounts[address]
    }

    return cb(null, account)
  }

  rename(id: string, name: string) {
    const frameAccount = this.accounts[id]
    if (!frameAccount) throw new Error(`Could not find account ${id}`)
    frameAccount.rename(name)
    const account = frameAccount.summary()
    this.update(account)
  }

  update(account: Account) {
    if (!this.accounts || this.accounts[account.id]) {
      requireStoreAction('updateAccount')(account)
    }
  }

  current() {
    return this._current ? this.accounts[this._current] : null
  }

  private requestAccount(handlerId: string, accountId?: string) {
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    const request = account?.getRequest(handlerId)
    if (!account || !request) return undefined
    if (
      (typeof request.account === 'string' && request.account.toLowerCase() !== account.id) ||
      (accountId !== undefined && typeof request.account !== 'string')
    ) {
      throw new Error('Request does not belong to account')
    }
    return account
  }

  updateNonce(reqId: string, nonce: string, accountId?: string) {
    log.info('Update Nonce: ', reqId, nonce)

    const currentAccount = this.requestAccount(reqId, accountId)

    if (currentAccount) {
      const txRequest = this.getTransactionRequest(currentAccount, reqId)

      txRequest.data.nonce = nonce
      currentAccount.update()

      return txRequest
    }

    return undefined
  }

  confirmRequestApproval(
    reqId: string,
    approvalType: ApprovalType,
    approvalData?: ApprovalData,
    accountId?: string
  ) {
    log.info('confirmRequestApproval', reqId, approvalType)

    const currentAccount = this.requestAccount(reqId, accountId)
    const request = currentAccount?.getRequest(reqId) as
      (TransactionRequest | PermitSignatureRequest) | undefined
    if (currentAccount && request && request.status === undefined) {
      const approval = (request.approvals || []).find((a) => a.type === approvalType)

      if (approval) {
        approval.approve(approvalData)
      }
    }
  }

  // TODO: can we make this typed for the action type?
  updateRequest(reqId: string, data: Record<string, unknown> = {}, actionId: ActionType, accountId?: string) {
    log.verbose('updateRequest', { reqId, actionId })

    const currentAccount = this.requestAccount(reqId, accountId)
    const request = currentAccount?.getRequest(reqId)
    if (!currentAccount || !request) return
    if (request.status !== undefined) return

    if (request.type === 'transaction') {
      const transactionReq = request as TransactionRequest
      if (!actionId || transactionReq.locked) return

      const action = (transactionReq.recognizedActions || []).find((a) => a.id === actionId)
      if (!action?.update) return

      let updated = false
      try {
        updated = action.update(transactionReq, data)
      } catch {
        log.warn('Transaction action update failed', { reqId, actionId })
      }
      if (!updated) {
        log.warn('Ignored invalid transaction action update', { reqId, actionId })
        return
      }
      currentAccount.refreshTransactionSimulation(transactionReq)
      return
    }

    if (request.type === 'signErc20Permit') {
      const permitReq = request as PermitSignatureRequest
      const amount = parseTokenBaseUnitAmount(data['amount'])
      if (amount === undefined || !permitReq.typedMessage?.data?.message || !permitReq.permit) {
        log.warn('Ignored invalid token permit amount update', { reqId })
        return
      }

      const normalizedAmount = amount.toString(10)
      permitReq.typedMessage.data.message.value = normalizedAmount
      permitReq.permit.value = normalizedAmount
      currentAccount.syncPermitApprovalRisk(permitReq)
      currentAccount.update()
    }
  }

  async replaceTx(accountId: string, id: string, type: ReplacementType) {
    const currentAccount = this.requestAccount(id, accountId)

    return new Promise<void>((resolve, reject) => {
      if (!currentAccount || !currentAccount.requests[id]) return reject(new Error('Could not find request'))
      if (currentAccount.requests[id].type !== 'transaction')
        return reject(new Error('Request is not transaction'))

      const txRequest = this.getTransactionRequest(currentAccount, id)

      const data = JSON.parse(JSON.stringify(txRequest.data))
      const targetChain = { type: 'ethereum', id: parseInt(data.chainId, 16) }
      const { levels } = store('main.networksMeta', targetChain.type, targetChain.id, 'gas.price')

      // Set the gas default to asap
      requireStoreAction('setGasDefault')(targetChain.type, targetChain.id, 'asap', levels.asap)

      const params =
        type === ReplacementType.Speed
          ? [data]
          : [
              {
                from: currentAccount.getSelectedAddress(),
                to: currentAccount.getSelectedAddress(),
                value: '0x0',
                nonce: data.nonce,
                chainId: addHexPrefix(targetChain.id.toString(16))
              }
            ]

      const _origin = type === ReplacementType.Speed ? currentAccount.requests[id].origin : frameOriginId

      const tx = {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_sendTransaction',
        chainId: addHexPrefix(targetChain.id.toString(16)),
        params,
        _origin
      }

      this.sendRequest(tx, (res: RPCResponsePayload) => {
        if (res.error) return reject(new Error(res.error.message))
        resolve()
      })
    })
  }

  private sendRequest(
    {
      method,
      params,
      chainId,
      _origin = frameOriginId
    }: { method: string; params: unknown[]; chainId: string; _origin?: string },
    cb: RPCRequestCallback
  ) {
    provider.send({ id: 1, jsonrpc: '2.0', method, params, chainId, _origin }, cb)
  }

  private async confirmations(account: FrameAccount, id: string, hash: string, targetChain: Chain) {
    return new Promise<number>((resolve, reject) => {
      // TODO: Route to account even if it's not current
      if (!account) return reject(new Error('Unable to determine target account'))
      if (!targetChain || !targetChain.type || !targetChain.id)
        return reject(new Error('Unable to determine target chain'))
      const targetChainId = addHexPrefix(targetChain.id.toString(16))

      this.sendRequest(
        { method: 'eth_blockNumber', params: [], chainId: targetChainId },
        (res: RPCResponsePayload) => {
          if (res.error) return reject(new Error(JSON.stringify(res.error)))
          const blockHeight = parseRpcQuantity(res.result)
          if (blockHeight === undefined) return reject(new Error('Invalid block number response'))

          this.sendRequest(
            { method: 'eth_getTransactionReceipt', params: [hash], chainId: targetChainId },
            (receiptRes: RPCResponsePayload) => {
              if (receiptRes.error) return reject(receiptRes.error)
              if (!this.accounts[account.address]) return reject(new Error('account closed'))

              const receipt = isTransactionReceipt(receiptRes.result) ? receiptRes.result : undefined
              if (receiptRes.result && !receipt)
                return reject(new Error('Invalid transaction receipt response'))

              if (receipt && account.requests[id]) {
                const txRequest = this.getTransactionRequest(account, id)

                txRequest.tx = {
                  ...txRequest.tx,
                  receipt,
                  confirmations: txRequest.tx?.confirmations || 0
                }

                account.update()

                if (!txRequest.feeAtTime) {
                  const network = targetChain
                  if (network.type === 'ethereum' && network.id === 1) {
                    const ethPrice = store('main.networksMeta.ethereum.1.nativeCurrency.usd.price')

                    if (
                      typeof ethPrice === 'number' &&
                      Number.isFinite(ethPrice) &&
                      txRequest.tx &&
                      txRequest.tx.receipt &&
                      this.accounts[account.address]
                    ) {
                      const { gasUsed } = txRequest.tx.receipt

                      txRequest.feeAtTime = (
                        Math.round(
                          weiIntToEthInt(
                            hexToInt(gasUsed) * hexToInt(txRequest.data.gasPrice || '0x0') * ethPrice
                          ) * 100
                        ) / 100
                      ).toFixed(2)
                      account.update()
                    }
                  } else {
                    txRequest.feeAtTime = '?'
                    account.update()
                  }
                }

                if (receipt.status === '0x1' && txRequest.status === RequestStatus.Verifying) {
                  txRequest.status = RequestStatus.Confirming
                  txRequest.notice = 'Confirming'
                  txRequest.completed = Date.now()
                  const hash = txRequest.tx?.hash || ''
                  const h = hash.substring(0, 6) + '...' + hash.substring(hash.length - 4)
                  const body = `Transaction ${h} successful! \n Click for details`

                  // Drop any other pending txs with same nonce
                  Object.keys(account.requests).forEach((k) => {
                    const txReq = this.getTransactionRequest(account, k)
                    if (
                      txReq.status === RequestStatus.Verifying &&
                      txReq.data.nonce === (account.requests[id] as TransactionRequest).data.nonce
                    ) {
                      txReq.status = RequestStatus.Error
                      txReq.notice = 'Dropped'
                      setTimeout(() => this.accounts[account.address] && this.removeRequest(account, k), 8000)
                    }
                  })

                  // If Wren is hidden, trigger a native notification.
                  notify('Transaction Successful', body, () => {
                    openBlockExplorer(targetChain, hash)
                  })
                }
                const receiptBlock = parseRpcQuantity(receipt.blockNumber)
                if (receiptBlock === undefined) return reject(new Error('Invalid receipt block number'))
                resolve(Number(blockHeight - receiptBlock))
              }
            }
          )
        }
      )
    })
  }

  private async txMonitor(account: FrameAccount, requestId: string, hash: string) {
    if (!account) return log.error('txMonitor had no target account')

    const txRequest = this.getTransactionRequest(account, requestId)
    const rawTx = txRequest.data
    txRequest.tx = { hash, confirmations: 0 }

    account.update()

    const isChainAvailable = (status: string) => !['disconnected', 'degraded'].includes(status.toLowerCase())

    const setTxSent = () => {
      txRequest.status = RequestStatus.Sent
      txRequest.notice = 'Sent'

      if (txRequest.tx) txRequest.tx.confirmations = 0
      account.update()
    }

    if (!rawTx.chainId) {
      log.error('txMonitor had no target chain')
      setTimeout(() => this.accounts[account.address] && this.removeRequest(account, requestId), 8 * 1000)
    } else {
      const targetChain: Chain = {
        type: 'ethereum',
        id: parseInt(rawTx.chainId, 16)
      }

      const targetChainId = addHexPrefix(targetChain.id.toString(16))
      this.sendRequest(
        { method: 'eth_subscribe', params: ['newHeads'], chainId: targetChainId },
        (newHeadRes: RPCResponsePayload) => {
          if (newHeadRes.error) {
            log.warn(newHeadRes.error)
            const monitor = async () => {
              if (!this.accounts[account.address]) {
                clearTimeout(monitorTimer)
                return log.error('txMonitor internal monitor had no target account')
              }

              let confirmations
              try {
                confirmations = await this.confirmations(account, requestId, hash, targetChain)
                txRequest.tx = { ...txRequest.tx, confirmations }

                account.update()

                if (confirmations > 12) {
                  txRequest.status = RequestStatus.Confirmed
                  txRequest.notice = 'Confirmed'
                  account.update()
                  setTimeout(
                    () => this.accounts[account.address] && this.removeRequest(account, requestId),
                    8000
                  )
                  clear()
                }
              } catch (e) {
                log.error('error awaiting confirmations', e)
                clear()
                setTxSent()
                setTimeout(
                  () => this.accounts[account.address] && this.removeRequest(account, requestId),
                  60 * 1000
                )
                return
              }
            }

            setTimeout(() => monitor(), 3000)
            const monitorTimer = setInterval(monitor, 15000)

            const statusHandler = (status: string) => {
              if (!isChainAvailable(status)) {
                setTxSent()
                clear()
              }
            }

            const { type, id } = targetChain

            provider.on(`status:${type}:${id}`, statusHandler)

            const clear = () => {
              clearInterval(monitorTimer)
              provider.off(`status:${type}:${id}`, statusHandler)
            }
          } else if (typeof newHeadRes.result === 'string') {
            const headSub = newHeadRes.result

            const removeSubscription = async (requestRemoveTimeout: number) => {
              setTimeout(
                () => this.accounts[account.address] && this.removeRequest(account, requestId),
                requestRemoveTimeout
              )
              provider.off(`data:${targetChain.type}:${targetChain.id}`, handler)
              provider.off(`status:${targetChain.type}:${targetChain.id}`, statusHandler)
              this.sendRequest(
                { method: 'eth_unsubscribe', chainId: targetChainId, params: [headSub] },
                (res: RPCResponsePayload) => {
                  if (res.error) {
                    log.error('error sending message eth_unsubscribe', res)
                  }
                }
              )
            }

            const statusHandler = (status: string) => {
              if (!isChainAvailable(status)) {
                setTxSent()
                removeSubscription(60 * 1000)
              }
            }

            const handler = async (payload: RPC.Susbcription.Response) => {
              if (payload.params.subscription === headSub) {
                // const newHead = payload.params.result
                let confirmations
                try {
                  confirmations = await this.confirmations(account, requestId, hash, targetChain)
                } catch (e) {
                  log.error(e)

                  setTxSent()
                  return removeSubscription(60 * 1000)
                }

                txRequest.tx = { ...txRequest.tx, confirmations }
                account.update()

                if (confirmations > 12) {
                  txRequest.status = RequestStatus.Confirmed
                  txRequest.notice = 'Confirmed'
                  account.update()

                  removeSubscription(8000)
                }
              }
            }

            const { type, id } = targetChain

            provider.on(`status:${type}:${id}`, statusHandler)
            provider.on(`data:${type}:${id}`, handler)
          }
        }
      )
    }
  }

  // Set Current Account
  setSigner(id: string, cb: Callback<Account>) {
    const previouslyActiveAccount = this.current()

    this._current = id
    const currentAccount = this.current()

    if (!currentAccount) {
      const err = new Error('could not set signer')
      log.error(`no current account with id: ${id}`, err.stack)

      return cb(err)
    }

    currentAccount.active = true
    currentAccount.update()

    const summary = currentAccount.summary()
    cb(null, summary)

    if (previouslyActiveAccount && previouslyActiveAccount.address !== currentAccount.address) {
      previouslyActiveAccount.active = false
      previouslyActiveAccount.update()
    }

    requireStoreAction('setAccount')(summary)

    if (currentAccount.status === 'ok')
      this.verifyAddress(false, (err, verified) => {
        if (!err && !verified) {
          currentAccount.signer = ''
          currentAccount.update()
        }
      })

    // If the account has any current requests, make sure fees are current
    this.updatePendingFees()
  }

  updatePendingFees(chainId?: number) {
    const currentAccount = this.current()

    if (currentAccount) {
      // If chainId, update pending tx requests from that chain, otherwise update all pending tx requests
      const { l1Transactions, l2Transactions } = toTransactionsByLayer(currentAccount.requests, chainId)
      const walletCalls = Object.values(currentAccount.requests)
        .filter((request): request is WalletCallsRequest => request.type === 'walletCalls')
        .filter(
          (request) =>
            request.status === undefined &&
            (chainId === undefined || parseInt(request.chainId, 16) === chainId)
        )

      walletCalls.forEach((request) => currentAccount.refreshWalletCallsPreparation(request))

      l1Transactions.forEach(([id, req]) => {
        try {
          const tx = req.data
          const chain = { type: 'ethereum', id: parseInt(tx.chainId, 16) }
          const gas = store('main.networksMeta', chain.type, chain.id, 'gas')

          if (usesBaseFee(tx)) {
            const { maxBaseFeePerGas, maxPriorityFeePerGas } = gas.price.fees || {}
            if (!maxBaseFeePerGas || !maxPriorityFeePerGas) {
              throw new Error(`Network ${chain.id} has no EIP-1559 fee estimate`)
            }
            this.setPriorityFee(maxPriorityFeePerGas, id, false)
            this.setBaseFee(maxBaseFeePerGas, id, false)
          } else {
            const gasPrice = gas.price.levels.fast
            if (!gasPrice) throw new Error(`Network ${chain.id} has no fast gas-price estimate`)
            this.setGasPrice(gasPrice, id, false)
          }
        } catch (e) {
          log.error('Could not update gas fees for transaction', e)
        }
      })

      if (chainId === 1) {
        l2Transactions.forEach(async ([_id, req]) => {
          let estimate = ''
          try {
            estimate = toBeHex(await provider.getL1GasCost(req.data))
          } catch (e) {
            log.error('Error estimating L1 gas cost', e)
          }

          req.chainData = {
            ...req.chainData,
            optimism: {
              l1Fees: estimate
            }
          }

          currentAccount.update()
        })
      }
    }
  }

  unsetSigner(cb: Callback<{ id: string; status: string }>) {
    const summary = { id: '', status: '' }
    if (cb) cb(null, summary)

    requireStoreAction('unsetAccount')()

    // setTimeout(() => { // Clear signer requests when unset
    //   if (s) {
    //     s.requests = {}
    //     s.update()
    //   }
    // })
  }

  verifyAddress(display: boolean, cb: Callback<boolean>) {
    const currentAccount = this.current()
    if (currentAccount && currentAccount.verifyAddress) currentAccount.verifyAddress(display, cb)
  }

  getSelectedAddresses() {
    const currentAccount = this.current()
    return currentAccount ? currentAccount.getSelectedAddresses() : []
  }

  getAccounts(cb?: Callback<Array<string>>) {
    const currentAccount = this.current()
    if (!currentAccount) {
      if (cb) cb(new Error('No Account Selected'))
      return
    }

    return currentAccount.getAccounts(cb)
  }

  getCoinbase(cb: Callback<Array<string>>) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))

    currentAccount.getCoinbase(cb)
  }

  signMessage(address: Address, message: string, cb: Callback<string>) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))
    if (address.toLowerCase() !== currentAccount.getSelectedAddress().toLowerCase())
      return cb(new Error('signMessage: Wrong Account Selected'))

    currentAccount.signMessage(message, cb)
  }

  signTypedData(address: Address, typedMessage: TypedMessage, cb: Callback<string>) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))
    if (address.toLowerCase() !== currentAccount.getSelectedAddress().toLowerCase())
      return cb(new Error('signMessage: Wrong Account Selected'))

    currentAccount.signTypedData(typedMessage, cb)
  }

  signTransaction(rawTx: TransactionData, cb: Callback<string>) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))

    return this.signTransactionForAccount(currentAccount.id, rawTx, cb)
  }

  signTransactionForAccount(accountId: string, rawTx: TransactionData, cb: Callback<string>) {
    if (typeof accountId !== 'string') return cb(new Error('Invalid signing account'))

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) return cb(new Error('Could not locate signing account'))

    const matchesAccount =
      typeof rawTx?.from === 'string' &&
      rawTx.from.toLowerCase() === account.getSelectedAddress().toLowerCase()

    if (!matchesAccount) return cb(new Error('Transaction does not match signing account'))

    account.signTransaction(rawTx, cb)
  }

  claimWalletCallsRequest(
    accountId: string,
    handlerId: string
  ): Readonly<PreparedWalletCallExecutionSnapshot> {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate wallet-call account')

    return account.claimWalletCallsRequest(handlerId)
  }

  claimWalletCallsRequestWithResponse(accountId: string, handlerId: string) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate wallet-call account')

    const request = account.getRequest<WalletCallsRequest>(handlerId)
    const responder = request?.res as WalletCallsResponder | undefined
    if (
      !request ||
      request.type !== 'walletCalls' ||
      typeof request.account !== 'string' ||
      request.account.toLowerCase() !== account.id ||
      typeof responder !== 'function' ||
      responder.walletCallsLifecycle !== true ||
      typeof responder.accept !== 'function'
    ) {
      throw new Error('Wallet-call response is no longer available')
    }

    const snapshot = account.claimWalletCallsRequest(handlerId)
    if (account.getRequest(handlerId) !== request) {
      throw new Error('Wallet-call request changed during approval')
    }
    delete request.res

    return Object.freeze({ snapshot, responder })
  }

  cancelUnapprovedRequestForAccount(accountId: string, handlerId: string, error: EVMError) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) return false

    const account = this.accounts[accountId.toLowerCase()]
    const request = account?.getRequest<AnyAccountRequest>(handlerId)
    if (!account || !request || request.status !== undefined || ('locked' in request && request.locked)) {
      return false
    }

    account.rejectRequest(request, error)
    return true
  }

  settleWalletCallsRequest(accountId: string, handlerId: string, error?: Error) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) return false
    const request = account.getRequest<WalletCallsRequest>(handlerId)
    if (!request) return false
    if (
      request.type !== 'walletCalls' ||
      typeof request.account !== 'string' ||
      request.account.toLowerCase() !== account.id ||
      !request.locked ||
      request.status !== RequestStatus.Pending
    ) {
      throw new Error('Wallet-call request is not awaiting an execution outcome')
    }

    const previousState = {
      status: request.status,
      notice: request.notice,
      mode: request.mode
    }
    request.status = error ? RequestStatus.Error : RequestStatus.Success
    request.notice = error
      ? (error.message || 'Wallet-call execution failed').slice(0, 240)
      : 'Batch Submitted'
    request.mode = RequestMode.Monitor
    try {
      account.update()
    } catch (updateError) {
      if (previousState.status !== undefined) request.status = previousState.status
      else delete request.status
      if (previousState.notice !== undefined) request.notice = previousState.notice
      else delete request.notice
      if (previousState.mode !== undefined) request.mode = previousState.mode
      else delete request.mode
      throw updateError
    }

    setTimeout(
      () => {
        if (this.accounts[account.id] === account && account.getRequest(handlerId) === request) {
          account.clearRequest(handlerId)
        }
      },
      error ? 8000 : 3300
    )

    return true
  }

  signerCompatibility(handlerId: string, cb: Callback<SignerCompatibility>, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return cb(new Error('Could not locate account'))

    const request = currentAccount.requests[handlerId]
    if (!request) return cb(new Error(`Could not locate request ${handlerId}`))

    if (isWatchOnlyAccountType(currentAccount.lastSignerType)) {
      return cb(new Error(WATCH_ONLY_SIGNING_ERROR))
    }

    const signer = currentAccount.getSigner()

    const signerUnavailable = (knownSigner?: Signer) => {
      const crumb = knownSigner ? signerPanelCrumb(knownSigner) : accountPanelCrumb()

      requireStoreAction('navDash')(crumb)
      return cb(new Error('Signer unavailable'))
    }

    if (!signer) {
      // if no signer is active, check if this account was previously relying on a
      // hardware signer that is currently disconnected
      const unavailableSigners = findUnavailableSigners(currentAccount.lastSignerType, storeApi.getSigners())

      // if there is only one matching disconnected signer, open the signer panel so it can be unlocked
      if (unavailableSigners.length === 1) return signerUnavailable(unavailableSigners[0])

      // if there is more than one matching signer, open the account panel so the user can choose
      if (unavailableSigners.length > 1) return signerUnavailable()

      // otherwise there are no signers that can be found
      return cb(new Error('No signer'))
    }

    if (!isSignerReady(signer)) {
      // if the signer is not ready to sign, open the signer panel so that
      // the user can unlock it or reconnect
      return signerUnavailable(signer)
    }

    const getCompatibility = () => {
      if (request.type === 'transaction') {
        const data = this.getTransactionRequest(currentAccount, handlerId).data
        return transactionCompatibility(data, signer.summary())
      }

      // all requests besides transactions are always compatible
      return { signer: signer.type, tx: '', compatible: true }
    }

    cb(null, getCompatibility())
  }

  close() {
    this.dataScanner.close()
    // usbDetect.stopMonitoring()
  }

  setAccess(req: AccessRequest, access: boolean) {
    const currentAccount = this.requestAccount(req.handlerId, req.account)
    const request = currentAccount?.getRequest<AccessRequest>(req.handlerId)
    if (!currentAccount || !request || request.type !== 'access') return false
    currentAccount.setAccess(request, access)
    return true
  }

  resolveRequest<T>(req: AccountRequest, result?: T) {
    const currentAccount = this.current()
    if (currentAccount && currentAccount.resolveRequest) {
      currentAccount.resolveRequest(req, result)
    }
  }

  resolveRequestForAccount<T>(accountId: string, handlerId: string, result?: T) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid account request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    const request = account?.getRequest(handlerId)
    if (!account || !request) return false
    if (typeof request.account !== 'string' || request.account.toLowerCase() !== account.id) {
      throw new Error('Request does not belong to account')
    }

    account.resolveRequest(request, result)
    return true
  }

  rejectRequest(req: AccountRequest, error: EVMError) {
    const currentAccount = this.requestAccount(req.handlerId, req.account)
    if (currentAccount) {
      const request = currentAccount.getRequest(req.handlerId)
      currentAccount.rejectRequest(request, error)
    }
  }

  rejectRequestForAccount(accountId: string, handlerId: string, error: EVMError) {
    if (
      typeof accountId !== 'string' ||
      typeof handlerId !== 'string' ||
      !handlerId ||
      !error ||
      typeof error !== 'object' ||
      typeof error.code !== 'number' ||
      typeof error.message !== 'string' ||
      !error.message
    ) {
      throw new Error('Invalid account rejection')
    }

    const request = this.getRequestForAccount(accountId, handlerId)
    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')

    account.rejectRequest(request, error)
    return true
  }

  getRequestForAccount<T extends AccountRequest = AccountRequest>(accountId: string, handlerId: string) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid account request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')
    const request = account.getRequest<T>(handlerId)
    if (!request) throw new Error('Could not locate account request')
    if (typeof request.account !== 'string' || request.account.toLowerCase() !== account.id) {
      throw new Error('Request does not belong to account')
    }

    return request
  }

  addRequest(req: AnyAccountRequest, res?: RPCRequestCallback) {
    log.info('addRequest', { handlerId: req.handlerId, type: req.type })

    const currentAccount = this.current()
    if (currentAccount && !currentAccount.requests[req.handlerId]) {
      currentAccount.addRequest(req, res)
    }
  }

  addRequestForAccount(
    accountId: string,
    req: AnyAccountRequest,
    res?: RPCRequestCallback | WalletCallsResponder
  ) {
    if (
      typeof accountId !== 'string' ||
      !req ||
      typeof req !== 'object' ||
      typeof req.handlerId !== 'string' ||
      !req.handlerId ||
      typeof req.account !== 'string'
    ) {
      throw new Error('Invalid account request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')
    if (req.account.toLowerCase() !== account.id) throw new Error('Request does not belong to account')
    if (account.requests[req.handlerId]) throw new Error('Request handler is already in use')

    try {
      account.addRequest(req, res)
      if (account.requests[req.handlerId] !== req) throw new Error('Account did not admit request')
      return true
    } catch (error) {
      if (account.requests[req.handlerId] === req) {
        try {
          account.clearRequest(req.handlerId)
        } catch (cleanupError) {
          const admissionMessage = error instanceof Error ? error.message : String(error)
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          throw new Error(
            `Account request admission failed: ${admissionMessage}; cleanup failed: ${cleanupMessage}`
          )
        }
      }
      throw error
    }
  }

  removeRequests(handlerId: string) {
    Object.values(this.accounts).forEach((account) => {
      if (account.requests[handlerId]) {
        this.removeRequest(account, handlerId)
      }
    })
  }

  removeRequest(account: FrameAccount, handlerId: string) {
    log.info(`removeRequest(${account.id}, ${handlerId})`)

    account.clearRequest(handlerId)
  }

  declineRequest(handlerId: string, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)

    if (currentAccount && currentAccount.requests[handlerId]) {
      const txRequest = this.getTransactionRequest(currentAccount, handlerId)
      if (!isCancelableRequest(txRequest.status || '')) return false

      txRequest.status = RequestStatus.Declined
      txRequest.notice = 'Signature Declined'
      txRequest.mode = RequestMode.Monitor

      setTimeout(
        () => this.accounts[currentAccount.address] && this.removeRequest(currentAccount, handlerId),
        2000
      )
      currentAccount.update()
      return true
    }

    return false
  }

  setRequestPending(req: AccountRequest) {
    const handlerId = req.handlerId
    const currentAccount = this.requestAccount(handlerId, req.account)

    log.info('setRequestPending', handlerId)

    if (!currentAccount) throw new Error('Request is no longer pending')

    const storedRequest = currentAccount.getRequest(handlerId)
    if (!storedRequest) throw new Error('Request is no longer pending')
    if (storedRequest.status !== undefined) {
      throw new Error('Request is already pending or complete')
    }
    if (
      isWatchOnlyAccountType(currentAccount.lastSignerType) &&
      (storedRequest.type === 'transaction' || isSignatureRequest(storedRequest))
    ) {
      throw new Error(WATCH_ONLY_SIGNING_ERROR)
    }
    if (isTransactionRequest(storedRequest) && storedRequest.simulation?.status === 'pending') {
      throw new Error('Transaction execution check is still pending')
    }

    storedRequest.status = RequestStatus.Pending

    const signerType = currentAccount.lastSignerType
    const hwSigner = signerType !== 'seed' && signerType !== 'ring'

    storedRequest.notice = hwSigner ? 'See Signer' : ''
    currentAccount.update()
    return true
  }

  setRequestError(handlerId: string, err: Error, accountId?: string) {
    log.info('setRequestError', handlerId)

    const currentAccount = this.requestAccount(handlerId, accountId)

    if (currentAccount && currentAccount.requests[handlerId]) {
      if (currentAccount.requests[handlerId].status === RequestStatus.Declined) return false
      currentAccount.requests[handlerId].status = RequestStatus.Error
      const errorMessage = (err.message || '').toLowerCase()

      if (errorMessage === 'ledger device: invalid data received (0x6a80)') {
        currentAccount.requests[handlerId].notice = 'Ledger rejected transaction data (0x6a80)'
      } else if (
        err.message === 'ledger device: condition of use not satisfied (denied by the user?) (0x6985)'
      ) {
        currentAccount.requests[handlerId].notice = 'Ledger Signature Declined'
      } else if (errorMessage.includes('insufficient funds')) {
        currentAccount.requests[handlerId].notice = errorMessage.includes('for gas')
          ? 'insufficient funds for gas'
          : 'insufficient funds'
      } else {
        const notice =
          err && typeof err === 'string'
            ? err
            : err && typeof err === 'object' && err.message && typeof err.message === 'string'
              ? err.message
              : 'Unknown Error' // TODO: Update to normalize input type
        currentAccount.requests[handlerId].notice = notice
      }

      if (currentAccount.requests[handlerId].type === 'transaction') {
        setTimeout(() => {
          if (
            this.accounts[currentAccount.address] === currentAccount &&
            currentAccount.requests[handlerId]
          ) {
            currentAccount.requests[handlerId].mode = RequestMode.Monitor
            currentAccount.update()

            setTimeout(
              () =>
                this.accounts[currentAccount.address] === currentAccount &&
                this.removeRequest(currentAccount, handlerId),
              8000
            )
          }
        }, 1500)
      } else {
        setTimeout(
          () => this.accounts[currentAccount.address] && this.removeRequest(currentAccount, handlerId),
          3300
        )
      }

      currentAccount.update()
      return true
    }

    return false
  }

  setTxSigned(handlerId: string, cb: Callback<void>, accountId?: string) {
    log.info('setTxSigned', handlerId)

    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return cb(new Error('No valid request for ' + handlerId))

    if (currentAccount.requests[handlerId]) {
      if (
        currentAccount.requests[handlerId].status === RequestStatus.Declined ||
        currentAccount.requests[handlerId].status === RequestStatus.Error
      ) {
        cb(new Error('Request already declined'))
      } else {
        currentAccount.requests[handlerId].status = RequestStatus.Sending
        currentAccount.requests[handlerId].notice = 'Sending'
        currentAccount.update()
        cb(null)
      }
    } else {
      cb(new Error('No valid request for ' + handlerId))
    }
  }

  setTxSent(handlerId: string, hash: string, accountId?: string) {
    log.info('setTxSent', handlerId, 'Hash', hash)

    const currentAccount = this.requestAccount(handlerId, accountId)
    if (currentAccount && currentAccount.requests[handlerId]?.status === RequestStatus.Sending) {
      currentAccount.requests[handlerId].status = RequestStatus.Verifying
      currentAccount.requests[handlerId].notice = 'Verifying'
      currentAccount.requests[handlerId].mode = RequestMode.Monitor
      currentAccount.update()

      this.txMonitor(currentAccount, handlerId, hash)
      return true
    }

    return false
  }

  setRequestSuccess(handlerId: string, accountId?: string) {
    log.info('setRequestSuccess', handlerId)

    const currentAccount = this.requestAccount(handlerId, accountId)
    if (currentAccount && currentAccount.requests[handlerId]) {
      if (currentAccount.requests[handlerId].status !== RequestStatus.Pending) return false
      currentAccount.requests[handlerId].status = RequestStatus.Success
      currentAccount.requests[handlerId].notice = 'Successful'
      if (currentAccount.requests[handlerId].type === 'transaction') {
        currentAccount.requests[handlerId].mode = RequestMode.Monitor
      } else {
        setTimeout(
          () => this.accounts[currentAccount.address] && this.removeRequest(currentAccount, handlerId),
          3300
        )
      }

      currentAccount.update()
      return true
    }

    return false
  }

  clearRequestsByOrigin(address: string, origin: string) {
    if (address && origin) {
      const account = this.accounts[address]
      if (account) account.clearRequestsByOrigin(origin)
    }
  }

  rejectUnapprovedRequestsForOriginChain(origin: string, chainId: number) {
    Object.values(this.accounts).forEach((account) => {
      account.rejectUnapprovedRequestsForOriginChain(origin, chainId)
    })
  }

  remove(address = '') {
    address = address.toLowerCase()

    const currentAccount = this.current()
    if (currentAccount && currentAccount.address === address) {
      requireStoreAction('unsetAccount')()

      const defaultAccount = (Object.values(this.accounts).filter((a) => a.address !== address) || [])[0]
      if (defaultAccount) {
        this._current = defaultAccount.id
        defaultAccount.active = true
        defaultAccount.update()
      }
    }

    const account = this.accounts[address]
    if (account) account.close()

    requireStoreAction('removeAccount')(address)
    delete this.accounts[address]
  }

  private requiredQuantity(value: unknown, field: string) {
    const quantity = parseRpcQuantity(value)
    if (quantity === undefined) throw new Error(`Invalid ${field}`)
    return quantity
  }

  private limitedQuantity(value: bigint, maximum: bigint) {
    return value > maximum ? maximum : value
  }

  private maxFeePerGasFor(gasLimit: bigint, tx: TransactionData) {
    return gasLimit === 0n ? MAX_UINT256 : maxFee(tx) / gasLimit
  }

  private txFeeUpdate(inputValue: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const input = this.requiredQuantity(inputValue, 'fee update value')

    const selectedAccount = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (!selectedAccount) throw new Error('No account selected while setting base fee')

    const currentAccount = accountId ? this.requestAccount(handlerId, accountId) : selectedAccount
    if (!currentAccount) throw new Error('Could not find transaction request')

    const request = this.getTransactionRequest(currentAccount, handlerId)
    if (!request || request.type !== 'transaction')
      throw new Error(`Could not find transaction request with handlerId ${handlerId}`)
    if (request.locked) throw new Error('Request has already been approved by the user')
    if (request.feesUpdatedByUser && !userUpdate) throw new Error('Fee has been updated by user')

    const tx = request.data
    const gasLimit = this.requiredQuantity(tx.gasLimit, 'transaction gas limit')
    const txType = tx.type
    const baseFeeTransaction = usesBaseFee(tx)

    if (baseFeeTransaction) {
      const maxFeePerGas = this.requiredQuantity(tx.maxFeePerGas, 'transaction max fee per gas')
      const maxPriorityFeePerGas = this.requiredQuantity(
        tx.maxPriorityFeePerGas,
        'transaction max priority fee per gas'
      )
      if (maxPriorityFeePerGas > maxFeePerGas) throw new Error('Priority fee exceeds max fee per gas')
      const currentBaseFee = maxFeePerGas - maxPriorityFeePerGas
      return {
        currentAccount,
        input,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit,
        currentBaseFee,
        baseFeeTransaction,
        txType,
        gasPrice: 0n
      }
    } else {
      const gasPrice = this.requiredQuantity(tx.gasPrice, 'transaction gas price')
      return {
        currentAccount,
        input,
        gasPrice,
        gasLimit,
        baseFeeTransaction,
        txType,
        currentBaseFee: 0n,
        maxPriorityFeePerGas: 0n,
        maxFeePerGas: 0n
      }
    }
  }

  private completeTxFeeUpdate(
    currentAccount: FrameAccount,
    handlerId: string,
    userUpdate: boolean,
    previousFee: PreviousFee | undefined
  ) {
    const txRequest = this.getTransactionRequest(currentAccount, handlerId)

    if (userUpdate) {
      txRequest.feesUpdatedByUser = true
      delete txRequest.automaticFeeUpdateNotice
    } else {
      if (!txRequest.automaticFeeUpdateNotice && previousFee) {
        txRequest.automaticFeeUpdateNotice = { previousFee }
      }
    }

    currentAccount.refreshTransactionSimulation(txRequest, true, !userUpdate)
  }

  setBaseFee(baseFee: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const {
      currentAccount,
      input,
      maxPriorityFeePerGas,
      gasLimit,
      currentBaseFee,
      baseFeeTransaction,
      txType
    } = this.txFeeUpdate(baseFee, handlerId, userUpdate, accountId)
    if (!baseFeeTransaction) throw new Error('Cannot set a base fee on a legacy transaction')

    // New value
    const newBaseFee = this.limitedQuantity(input, MAX_FEE_PER_GAS)

    // No change
    if (newBaseFee === currentBaseFee) return

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const tx = txRequest.data

    // New max fee per gas
    const perGasCap = this.maxFeePerGasFor(gasLimit, tx)
    const limitedPriorityFee = this.limitedQuantity(maxPriorityFeePerGas, perGasCap)
    const limitedBaseFee = this.limitedQuantity(newBaseFee, perGasCap - limitedPriorityFee)
    tx.maxPriorityFeePerGas = toRpcQuantity(limitedPriorityFee)
    tx.maxFeePerGas = toRpcQuantity(limitedBaseFee + limitedPriorityFee)

    // Complete update
    const previousFee = {
      type: txType,
      baseFee: toRpcQuantity(currentBaseFee),
      priorityFee: toRpcQuantity(maxPriorityFeePerGas)
    }

    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate, previousFee)
  }

  setPriorityFee(priorityFee: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const {
      currentAccount,
      input,
      maxPriorityFeePerGas,
      gasLimit,
      currentBaseFee,
      baseFeeTransaction,
      txType
    } = this.txFeeUpdate(priorityFee, handlerId, userUpdate, accountId)
    if (!baseFeeTransaction) throw new Error('Cannot set a priority fee on a legacy transaction')

    // New values
    const newMaxPriorityFeePerGas = this.limitedQuantity(input, MAX_FEE_PER_GAS)

    // No change
    if (newMaxPriorityFeePerGas === maxPriorityFeePerGas) return

    const tx = this.getTransactionRequest(currentAccount, handlerId).data

    // New max fee per gas
    const perGasCap = this.maxFeePerGasFor(gasLimit, tx)
    const limitedBaseFee = this.limitedQuantity(currentBaseFee, perGasCap)
    const limitedPriorityFee = this.limitedQuantity(newMaxPriorityFeePerGas, perGasCap - limitedBaseFee)
    tx.maxPriorityFeePerGas = toRpcQuantity(limitedPriorityFee)
    tx.maxFeePerGas = toRpcQuantity(limitedBaseFee + limitedPriorityFee)

    const previousFee = {
      type: txType,
      baseFee: toRpcQuantity(currentBaseFee),
      priorityFee: toRpcQuantity(maxPriorityFeePerGas)
    }

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate, previousFee)
  }

  setGasPrice(price: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const { currentAccount, input, gasLimit, gasPrice, baseFeeTransaction, txType } = this.txFeeUpdate(
      price,
      handlerId,
      userUpdate,
      accountId
    )
    if (baseFeeTransaction) throw new Error('Cannot set a gas price on an EIP-1559 transaction')

    // New values
    const newGasPrice = this.limitedQuantity(input, MAX_FEE_PER_GAS)

    // No change
    if (newGasPrice === gasPrice) return

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const tx = txRequest.data
    tx.gasPrice = toRpcQuantity(this.limitedQuantity(newGasPrice, this.maxFeePerGasFor(gasLimit, tx)))

    const previousFee = {
      type: txType,
      gasPrice: toRpcQuantity(gasPrice)
    }

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate, previousFee)
  }

  setGasLimit(limit: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const { currentAccount, input, maxFeePerGas, gasPrice, baseFeeTransaction } = this.txFeeUpdate(
      limit,
      handlerId,
      userUpdate,
      accountId
    )

    // New values
    const newGasLimit = this.limitedQuantity(input, MAX_GAS_LIMIT)

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const tx = txRequest.data
    const fee = baseFeeTransaction ? maxFeePerGas : gasPrice
    const feeLimitedGas = fee === 0n ? MAX_GAS_LIMIT : maxFee(tx) / fee
    tx.gasLimit = toRpcQuantity(this.limitedQuantity(newGasLimit, feeLimitedGas))

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate, undefined)
  }

  removeFeeUpdateNotice(handlerId: string, cb: Callback<void>, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return cb(new Error('No account selected while removing fee notice'))

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    if (!txRequest) return cb(new Error(`Could not find request ${handlerId}`))

    delete txRequest.automaticFeeUpdateNotice
    currentAccount.update()

    cb(null)
  }

  adjustNonce(handlerId: string, nonceAdjust: number, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)

    if (nonceAdjust !== 1 && nonceAdjust !== -1) return log.error('Invalid nonce adjustment', nonceAdjust)
    if (!currentAccount) return log.error('No account selected during nonce adjustement', nonceAdjust)

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)

    txRequest.data = Object.assign({}, txRequest.data)

    if (txRequest && txRequest.type === 'transaction') {
      const nonce = txRequest.data && txRequest.data.nonce
      if (nonce) {
        let updatedNonce = parseInt(nonce, 16) + nonceAdjust
        if (updatedNonce < 0) updatedNonce = 0
        const adjustedNonce = intToHex(updatedNonce)

        txRequest.data.nonce = adjustedNonce
        currentAccount.refreshTransactionSimulation(txRequest)
      } else {
        const { from, chainId } = txRequest.data
        this.sendRequest(
          { method: 'eth_getTransactionCount', chainId, params: [from, 'pending'] },
          (res: RPCResponsePayload) => {
            const parsedNonce = parseRpcQuantity(res.result)
            if (parsedNonce !== undefined) {
              const newNonce = Number(parsedNonce)
              let updatedNonce = nonceAdjust === 1 ? newNonce : newNonce + nonceAdjust
              if (updatedNonce < 0) updatedNonce = 0
              const adjustedNonce = intToHex(updatedNonce)
              txRequest.data.nonce = adjustedNonce
              currentAccount.refreshTransactionSimulation(txRequest)
            }
          }
        )
      }
    }
  }

  resetNonce(handlerId: string, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return log.error('No account selected during nonce reset')

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const initialNonce = txRequest.payload.params[0]?.nonce
    if (initialNonce) {
      txRequest.data.nonce = initialNonce
    } else {
      delete txRequest.data.nonce
    }
    currentAccount.refreshTransactionSimulation(txRequest)
  }

  lockRequest(handlerId: string, accountId?: string) {
    // When a request is approved, lock it so that no automatic updates such as fee changes can happen
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (currentAccount && currentAccount.requests[handlerId]) {
      ;(currentAccount.requests[handlerId] as TransactionRequest).locked = true
    } else {
      log.error('Trying to lock request ' + handlerId + ' but there is no current account')
    }
  }

  // removeAllAccounts () {
  //   setTimeout(() => {
  //     Object.keys(this.accounts).forEach(id => {
  //       if (this.accounts[id]) this.accounts[id].close()
  //       store.removeAccount(id)
  //       delete this.accounts[id]
  //     })
  //   }, 1000)
  // }
}

export default new Accounts()
