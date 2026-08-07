const fs = require('fs')
const log = require('electron-log')
const { randomBytes } = require('crypto')
import { isAddress } from 'ethers'
import { openFileDialog } from '../windows/dialog'
import { openBlockExplorer } from '../windows/window'
import { routeWalletCallRequest } from './walletCalls'
import { applyRequestUpdate } from './updateRequest'
import { enforceRequestOriginAuthorization } from './requestAuthorization'
import {
  respondToExtensionPairing,
  revokeExtensionCredential as revokePairedExtension
} from '../api/extensionPairing'
import { disconnectExtensionCredential } from '../api/ws'

const accounts = require('../accounts').default
const signers = require('../signers').default
const provider = require('../provider').default
const store = require('../store').default
const nebulaApi = require('../nebula').default

const { arraysEqual, randomLetters } = require('../../resources/utils')
const { isSignatureRequest } = require('../signatures')
const { default: TrezorBridge } = require('../../main/signers/trezor/bridge')
const { onRendererRpc } = require('../ipc/renderer')
const { encodeRendererRpcValues, parseRendererRpcResponse } = require('../ipc/rpcSchemas')

const callbackWhenDone = (fn, cb) => {
  try {
    fn()
    cb(null)
  } catch (e) {
    cb(e)
  }
}

const rpc = {
  getState: (cb) => {
    cb(null, store())
  },
  getFrameId(window, cb) {
    if (window.frameId) {
      cb(null, window.frameId)
    } else {
      cb(new Error('No frameId set for this window'))
    }
  },
  // Review
  // getSigners: signers.getSigners,
  setSigner: (id, cb) => {
    const previousAddresses = accounts.getSelectedAddresses()

    accounts.setSigner(id, cb)

    const currentAddresses = accounts.getSelectedAddresses()

    if (!arraysEqual(previousAddresses, currentAddresses)) {
      provider.accountsChanged(currentAddresses)
    }
  },
  // setSignerIndex: (index, cb) => {
  //   accounts.setSignerIndex(index, cb)
  //   provider.accountsChanged(accounts.getSelectedAddresses())
  //   setTimeout(() => {
  //     accounts.balanceScan()
  //   }, 320)
  // },
  unsetSigner: (id, cb) => {
    const previousAddresses = accounts.getSelectedAddresses()

    accounts.unsetSigner(cb)

    const currentAddresses = accounts.getSelectedAddresses()

    if (!arraysEqual(previousAddresses, currentAddresses)) {
      provider.accountsChanged(currentAddresses)
    }
  },
  // setSignerIndex: signers.setSignerIndex,
  // unsetSigner: signers.unsetSigner,
  trezorPin: (id, pin, cb) => {
    cb()
    TrezorBridge.pinEntered(id, pin)
  },
  trezorPhrase: (id, phrase, cb) => {
    cb()
    TrezorBridge.passphraseEntered(id, phrase)
  },
  trezorPairing: (id, payload, cb) => {
    cb()
    TrezorBridge.pairingEntered(id, payload)
  },
  trezorEnterPhrase: (id, cb) => {
    cb()
    TrezorBridge.enterPassphraseOnDevice(id)
  },
  createLattice: (deviceId, deviceName, cb) => {
    if (!deviceId) {
      return cb(new Error('No Device ID'))
    }

    store.updateLattice(deviceId, {
      deviceId,
      baseUrl: 'https://signing.gridpl.us',
      endpointMode: 'default',
      paired: true,
      deviceName: (deviceName || 'GridPlus').substring(0, 14),
      tag: randomLetters(6),
      privKey: randomBytes(32).toString('hex')
    })

    cb(null, { id: 'lattice-' + deviceId })
  },
  async latticePair(id, pin, cb) {
    const signer = signers.get(id)

    if (!signer || !signer.pair) return cb(new Error('Lattice signer is unavailable'))
    try {
      const hasActiveWallet = await signer.pair(pin)
      cb(null, hasActiveWallet)
    } catch (e) {
      cb(e.message)
    }
  },
  confirmRequestApproval(req, approvalType, approvalData, cb) {
    callbackWhenDone(
      () => accounts.confirmRequestApproval(req.handlerId, approvalType, approvalData, req.account),
      cb
    )
  },
  respondToExtensionRequest(requestId, approved, cb) {
    callbackWhenDone(() => {
      if (!respondToExtensionPairing(requestId, approved)) {
        throw new Error('Extension pairing request is no longer active')
      }
    }, cb)
  },
  revokeExtensionCredential(fingerprint, cb) {
    callbackWhenDone(() => {
      revokePairedExtension(fingerprint)
      disconnectExtensionCredential(fingerprint)
    }, cb)
  },
  updateRequest(accountId, reqId, data, actionId, cb) {
    callbackWhenDone(() => applyRequestUpdate(accounts, reqId, data, actionId, accountId), cb)
  },
  approveRequest(req, cb = () => {}) {
    if (
      routeWalletCallRequest(req, accounts, (walletCallsRequest) => {
        provider
          .approveWalletCallsRequest(walletCallsRequest.account, walletCallsRequest.handlerId)
          .catch((error) => log.warn('Wallet-call approval failed', error))
      })
    ) {
      cb(null)
      return
    }

    const currentAccount = accounts.current()
    if (!currentAccount || currentAccount.address.toLowerCase() !== req.account.toLowerCase()) {
      return cb(new Error('Request account is no longer selected'))
    }
    const storedRequest = currentAccount.getRequest(req.handlerId)
    if (!storedRequest) return cb(new Error('Request is no longer pending'))
    req = storedRequest
    const permissions = store('main.permissions', req.account) || {}
    const authorizationError = enforceRequestOriginAuthorization(
      req,
      permissions,
      (account, handlerId, error) => accounts.rejectRequestForAccount(account, handlerId, error)
    )
    if (authorizationError) return cb(authorizationError)
    if ((req.approvals || []).some((approval) => !approval.approved)) {
      return cb(new Error('Request approvals are incomplete'))
    }

    try {
      accounts.setRequestPending(req)
    } catch (error) {
      return cb(error)
    }
    if (req.type === 'transaction') {
      provider.approveTransactionRequest(req, (err, res) => {
        if (err) return accounts.setRequestError(req.handlerId, err, req.account)
        setTimeout(() => accounts.setTxSent(req.handlerId, res, req.account), 1800)
      })
    } else if (req.type === 'sign') {
      provider.approveSign(req, (err) => {
        if (err) return accounts.setRequestError(req.handlerId, err, req.account)
        accounts.setRequestSuccess(req.handlerId, req.account)
      })
    } else if (req.type === 'signTypedData' || req.type === 'signErc20Permit') {
      provider.approveSignTypedData(req, (err) => {
        if (err) return accounts.setRequestError(req.handlerId, err, req.account)
        accounts.setRequestSuccess(req.handlerId, req.account)
      })
    }
    cb(null)
  },
  declineRequest(req, cb) {
    if (
      routeWalletCallRequest(req, accounts, (walletCallsRequest) =>
        provider.declineWalletCallsRequest(walletCallsRequest.account, walletCallsRequest.handlerId)
      )
    ) {
      cb(null)
      return
    }

    const currentAccount = accounts.current()
    if (!currentAccount || currentAccount.address.toLowerCase() !== req.account.toLowerCase()) {
      return cb(new Error('Request account is no longer selected'))
    }
    const storedRequest = currentAccount.getRequest(req.handlerId)
    if (!storedRequest) return cb(new Error('Request is no longer pending'))
    req = storedRequest

    if (req.type === 'transaction' || isSignatureRequest(req)) {
      if (!accounts.declineRequest(req.handlerId, req.account)) {
        return cb(new Error('Request can no longer be cancelled'))
      }
      provider.declineRequest(req)
    }
    cb(null)
  },
  createFromAddress(address, name, cb) {
    if (!isAddress(address)) return cb(new Error('Invalid Address'))
    accounts.add(address, name, { type: 'address' })
    cb()
  },
  createAccount(address, name, options, cb) {
    if (!isAddress(address)) return cb(new Error('Invalid Address'))
    accounts.add(address, name, options)
    cb()
  },
  removeAccount(address, _options, cb) {
    accounts.remove(address)
    cb()
  },
  createFromPhrase(phrase, password, cb) {
    signers.createFromPhrase(phrase, password, cb)
  },
  async locateKeystore(cb) {
    try {
      const file = await openFileDialog()
      const keystore = file || { filePaths: [] }
      if ((keystore.filePaths || []).length > 0) {
        fs.readFile(keystore.filePaths[0], 'utf8', (err, data) => {
          if (err) return cb(err)
          try {
            const parsed = JSON.parse(data)
            if (typeof parsed.version !== 'number') cb('Invalid keystore file')
            if (![1, 3].includes(parsed.version)) cb('Invalid keystore version')
            cb(null, parsed)
          } catch (err) {
            cb(err)
          }
        })
      } else {
        cb(new Error('No Keystore Found'))
      }
    } catch (e) {
      cb(e)
    }
  },
  createFromKeystore(keystore, password, keystorePassword, cb) {
    signers.createFromKeystore(keystore, keystorePassword, password, cb)
  },
  createFromPrivateKey(privateKey, password, cb) {
    signers.createFromPrivateKey(privateKey, password, cb)
  },
  unlockSigner(id, password, cb) {
    const signer = signers.get(id)
    if (!signer || typeof signer.unlock !== 'function') return cb(new Error('Signer is unavailable'))
    signers.unlock(id, password, cb)
  },
  lockSigner(id, cb) {
    const signer = signers.get(id)
    if (!signer || typeof signer.lock !== 'function') return cb(new Error('Signer is unavailable'))
    signers.lock(id, cb)
  },
  async resolveEnsName(name, cb) {
    log.debug('Resolving ENS name', { name })

    const nebula = nebulaApi()

    try {
      const {
        addresses: { eth: ethAddress }
      } = await nebula.ens.resolve(name, { timeout: 8000 })
      cb(null, ethAddress)
    } catch (err) {
      log.warn(`Could not resolve ENS name ${name}:`, err)
      return cb(err)
    }
  },
  verifyAddress(cb) {
    if (!accounts.current()) return cb(new Error('No account selected'))
    const res = (err, data) => cb(err, data || false)
    accounts.verifyAddress(true, res)
  },
  setBaseFee(accountId, fee, handlerId, cb) {
    callbackWhenDone(() => accounts.setBaseFee(fee, handlerId, true, accountId), cb)
  },
  setPriorityFee(accountId, fee, handlerId, cb) {
    callbackWhenDone(() => accounts.setPriorityFee(fee, handlerId, true, accountId), cb)
  },
  setGasPrice(accountId, price, handlerId, cb) {
    callbackWhenDone(() => accounts.setGasPrice(price, handlerId, true, accountId), cb)
  },
  setGasLimit(accountId, limit, handlerId, cb) {
    callbackWhenDone(() => accounts.setGasLimit(limit, handlerId, true, accountId), cb)
  },
  removeFeeUpdateNotice(accountId, handlerId, cb) {
    accounts.removeFeeUpdateNotice(handlerId, cb, accountId)
  },
  signerCompatibility(accountId, handlerId, cb) {
    accounts.signerCompatibility(handlerId, cb, accountId)
  },
  openExplorer(chain, cb) {
    if (store('main.mute.explorerWarning')) {
      openBlockExplorer(chain)
    } else {
      store.notify('openExplorer', { chain })
    }
    cb(null)
  }
}

onRendererRpc((event, id, method, ...args) => {
  const handler = rpc[method]
  let responded = false
  const respond = (...responseArgs) => {
    if (responded) return
    responded = true
    const parsed = parseRendererRpcResponse(method, responseArgs)
    if (!parsed.success) {
      log.warn('Rejected invalid renderer RPC response', { method })
      event.sender.send('main:rpc', id, ...encodeRendererRpcValues(['Invalid renderer RPC response']))
      return
    }
    try {
      event.sender.send('main:rpc', id, ...encodeRendererRpcValues(parsed.data))
    } catch {
      log.warn('Could not encode renderer RPC response', { method })
      event.sender.send('main:rpc', id, ...encodeRendererRpcValues(['Invalid renderer RPC response']))
    }
  }

  try {
    if (method === 'getFrameId') {
      handler(event.sender.getOwnerBrowserWindow(), ...args, respond)
    } else {
      handler(...args, respond)
    }
  } catch (error) {
    respond(error)
  }
})
