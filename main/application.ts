import { app, protocol, clipboard, powerMonitor } from 'electron'
import crypto from 'crypto'
import path from 'path'
import url from 'url'

// DO NOT MOVE - env var below is required for app init and must be set before all local imports
process.env.BUNDLE_LOCATION = process.env.BUNDLE_LOCATION || path.resolve(__dirname, './../..', 'bundle')

import { purgeLegacyLogFiles } from './security/logSanitization'

purgeLegacyLogFiles(app.getPath('userData'))

import log from 'electron-log'
import windows from './windows'
import menu from './menu'
import store from './store'
import { requireStoreAction } from './store/action'
import { addRequestedChain } from './chains/addRequestedChain'
import dapps from './dapps'
import accounts from './accounts'
import provider from './provider'
import * as launch from './launch'
import updater from './updater'
import signers from './signers'
import persist, { commitMainState } from './store/persist'
import {
  openProfileBackupDialog,
  saveProfileBackupDialog,
  showUnhandledExceptionDialog
} from './windows/dialog'
import { openBlockExplorer, openContractVerificationResult, openExternal } from './windows/window'
import Erc20Contract from './contracts/erc20'
import { getErrorCode } from '../resources/utils'
import walletCallEvidenceRuntime from './provider/walletCallEvidenceRuntime'
import operationLifecycleRuntime from './operationLifecycle/runtime'
import operationLifecycleProjectionRuntime from './operationLifecycle/projectionRuntime'
import walletCallBatchLedger from './provider/walletCallLedger'
import { showWalletCallStatus } from './provider/walletCallStatusView'
import { applyAccountPermissionRendererAction } from './provider/accountPermissionActions'
import { applyDappGuardrailRendererAction } from './provider/dappGuardrailActions'
import {
  applyNetworkRouteRendererAction,
  applyOriginChainRendererAction
} from './provider/originChainActions'
import { handleRenderer, onRenderer } from './ipc/renderer'
import { isPathInsideRoot } from './security/fileAccess'
import { assertSandboxEnabled } from './security/sandbox'
import yearn from './yearn'
import send, { revalidateNativeMaxBeforeSign } from './send'
import addressBookFiles from './addressBook/files'
import { installShutdownHandlers } from './lifecycle/shutdown'
import { persistAddressBookEntry, persistCustomToken, resetApplicationProfile } from './applicationMutations'
import { installSignerPowerLockHandlers } from './security/signerLockLifecycle'
import {
  inspectEncryptedProfileBackupFile,
  stageInspectedProfileRestore,
  type ProfileBackupFileBinding,
  writeEncryptedProfileBackup
} from './profileBackup'
import { osSignerStorage } from './signers/hot/runtimeStorage'
import chains from './chains'
import { inspect } from './inspector'
import recentRecipientsRuntime, { applyRecentRecipientPrivacyAction } from './recentRecipients/runtime'
import deployment from './deployment/runtime'
import contractVerification, {
  contractVerificationArtifactIntake,
  contractVerificationPollingRuntime
} from './contractVerification/runtime'
import { ContractVerificationArtifactIntakeError } from './contractVerification/artifactIntake'
import { wakeContractVerificationPollingForActiveResult } from './contractVerification/pollingRuntime'
import { createSecretClipboard } from './security/secretClipboard'

const isDev = process.env.NODE_ENV === 'development'
assertSandboxEnabled(app.commandLine)
provider.registerNativeMaxRevalidator(revalidateNativeMaxBeforeSign)

if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
} else {
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas', 'true')
  app.commandLine.appendSwitch('enable-gpu-rasterization', 'true')
  app.commandLine.appendSwitch('force-gpu-rasterization', 'true')
  app.commandLine.appendSwitch('ignore-gpu-blacklist', 'true')
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers', 'true')
}
app.commandLine.appendSwitch('force-color-profile', 'srgb')

log.transports.console.level = process.env.LOG_LEVEL || (isDev ? 'verbose' : 'info')

if (process.env.LOG_LEVEL === 'debug') {
  log.transports.file.level = 'debug'
  log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs/debug.log')
} else {
  log.transports.file.level = ['development', 'test'].includes(process.env.NODE_ENV) ? false : 'verbose'
}

require('./rpc')

log.info(`Chrome: v${process.versions.chrome}`)
log.info(`Electron: v${process.versions.electron}`)
log.info(`Node: v${process.versions.node}`)

// prevent showing the exit dialog more than once
let closing = false
let walletCallEvidenceLifecycleReady = false
let operationLifecycleReady = false
let contractVerificationPollingReady = false
let removeSignerPowerLockHandlers = () => {}
let profileRestoreRelaunchTimer: ReturnType<typeof setTimeout> | undefined
const PROFILE_INSPECTION_TOKEN_TTL_MS = 5 * 60 * 1000
const profileInspectionTokens = new Map<
  string,
  { source: string; binding: ProfileBackupFileBinding; expiresAt: number }
>()
const managedClipboard = createSecretClipboard(clipboard, {
  onError: (error) => log.warn('Could not clear expired sensitive clipboard data', error)
})

function startWalletCallEvidenceRuntime() {
  if (!walletCallEvidenceLifecycleReady) {
    walletCallEvidenceLifecycleReady = true
    powerMonitor.on('suspend', () => walletCallEvidenceRuntime.stop())
    powerMonitor.on('resume', () => walletCallEvidenceRuntime.start())
    removeSignerPowerLockHandlers = installSignerPowerLockHandlers(powerMonitor, (reason) =>
      signers.lockHotSigners(reason)
    )
  }
  walletCallEvidenceRuntime.start()
}

function startOperationLifecycleRuntime() {
  if (!operationLifecycleReady) {
    operationLifecycleReady = true
    powerMonitor.on('suspend', () => operationLifecycleRuntime.stop())
    powerMonitor.on('resume', () => operationLifecycleRuntime.start())
  }
  operationLifecycleProjectionRuntime.start()
  operationLifecycleRuntime.start()
}

function startContractVerificationPollingRuntime() {
  if (!contractVerificationPollingReady) {
    contractVerificationPollingReady = true
    powerMonitor.on('suspend', () => contractVerificationPollingRuntime.stop())
    powerMonitor.on('resume', () => contractVerificationPollingRuntime.start())
  }
  contractVerificationPollingRuntime.start()
}

process.on('uncaughtException', (e) => {
  log.error('Uncaught Exception!', e)

  const errorCode = getErrorCode(e) ?? ''

  if (errorCode === 'EPIPE') {
    log.error('uncaught EPIPE error', e)
    return
  }

  if (!closing) {
    closing = true

    showUnhandledExceptionDialog(e.message, errorCode)
  }
})

process.on('unhandledRejection', (e) => {
  log.error('Unhandled Rejection!', e)
})

function startUpdater() {
  powerMonitor.on('resume', () => {
    log.debug('System resuming, starting updater')

    updater.start()
  })

  powerMonitor.on('suspend', () => {
    log.debug('System suspending, stopping updater')

    updater.stop()
  })

  updater.start()
}

global.eval = () => {
  throw new Error(`This app does not support global.eval()`)
}

onRenderer('tray:resetAllSettings', () => {
  if (
    !resetApplicationProfile({
      removeContractVerificationCredential: () => contractVerification.removeCredential(),
      clearPersistedState: () => persist.clear()
    })
  ) {
    return
  }

  if (updater.updateReady) {
    managedClipboard.dispose()
    return updater.quitAndInstall()
  }

  app.relaunch()
  managedClipboard.dispose()
  app.exit(0)
})

onRenderer('tray:clipboardData', (e, data) => {
  if (data) managedClipboard.writePublic(data)
})

handleRenderer('tray:writeClipboard', async (e, request) => {
  if (request.secret) managedClipboard.writeSecret(request.value)
  else managedClipboard.writePublic(request.value)
  return { success: true as const }
})

handleRenderer('settings:clearRecentRecipients', async (e, action) => {
  const result = applyRecentRecipientPrivacyAction(action, {
    updateSession: (requestedAction) => {
      if (requestedAction === 'disable') requireStoreAction('setRememberRecentRecipients')(false)
      else requireStoreAction('clearRecentRecipients')()
    },
    clearPendingMetadata: () => recentRecipientsRuntime.clearCandidates(),
    commit: () => commitMainState(store('main'))
  })
  if (!result.success) {
    log.error('Recent-recipient privacy clearing was limited to the current session', {
      reason: result.error
    })
  }
  return result
})

handleRenderer('activity:clear', async () => {
  const result = applyRecentRecipientPrivacyAction('activity', {
    updateSession: () => requireStoreAction('clearActivity')(),
    clearPendingMetadata: () => recentRecipientsRuntime.clearCandidates({ outbound: true }),
    commit: () => commitMainState(store('main'))
  })
  if (!result.success) {
    log.error('Activity privacy clearing was limited to the current session', {
      reason: result.error
    })
  }
  return result
})

handleRenderer('tray:revokeAccess', async (e, account, permissionId) => {
  let revokedInMemory = false
  let committed = false
  try {
    const action = permissionId ? 'toggleAccess' : 'clearPermissions'
    const args = permissionId ? [account, permissionId, false] : [account]
    const accepted = applyAccountPermissionRendererAction(action, args, {
      accounts,
      provider,
      getPermissions: (address) => store('main.permissions', address) || {},
      mutate: (address, ...mutationArgs) => {
        requireStoreAction(action)(address, ...mutationArgs)
        revokedInMemory = true
      },
      removeGuardrails: (address, originIds) =>
        requireStoreAction('removeDappGuardrailsForOrigins')(address, originIds),
      commit: () => {
        commitMainState(store('main'))
        committed = true
      },
      onNotificationError: (notificationError) =>
        log.warn('Could not notify origins after in-memory permission revocation', notificationError)
    })
    return accepted
      ? { success: true as const }
      : { success: false as const, error: 'Permission could not be revoked' }
  } catch (error) {
    log.warn('Could not revoke account permission', error)
    if (committed) return { success: true as const }
    return revokedInMemory
      ? {
          success: false as const,
          uncertain: true as const,
          sessionOnly: true as const,
          error: 'persistence-failed' as const
        }
      : { success: false as const, error: 'Permission could not be revoked' }
  }
})

onRenderer('tray:installAvailableUpdate', () => {
  requireStoreAction('updateBadge')('')

  updater.fetchUpdate()
})

onRenderer('tray:dismissUpdate', (e, version, remind) => {
  if (!remind) {
    requireStoreAction('dontRemind')(version)
  }

  requireStoreAction('updateBadge')('')

  updater.dismissUpdate()
})

onRenderer('tray:renameAccount', (e, id, name) => {
  accounts.rename(id, name)
})

onRenderer('dash:reloadSigner', (e, id) => {
  signers.reload(id)
})

onRenderer('dash:dismissHardwarePrompt', (e, id) => {
  signers.dismissHardwarePrompt(id)
})

onRenderer('tray:rejectRequest', (e, req) => {
  const err = { code: 4001, message: 'User rejected the request' }
  accounts.rejectRequestForAccount(req.account, req.handlerId, err)
})

onRenderer('tray:clearRequests', (e, account) => {
  accounts.clearRequests(account)
})

onRenderer('tray:openExternal', (e, url) => {
  openExternal(url)
  requireStoreAction('setDash')({ showing: false })
})

onRenderer('tray:openExplorer', (e, chain, hash, account) => {
  openBlockExplorer(chain, hash, account)
})

onRenderer('tray:copyTxHash', (e, hash) => {
  if (hash) managedClipboard.writePublic(hash)
})

onRenderer('tray:giveAccess', (e, req, access) => {
  accounts.setAccess(req, access)
})

handleRenderer('tray:addChain', async (e, chain, requestReference) => {
  try {
    if (requestReference) {
      await addRequestedChain(chain, requestReference)
    } else {
      requireStoreAction('addNetwork')(chain)
    }

    return { success: true }
  } catch (error) {
    log.warn('Could not add requested chain', error)
    return { success: false, error: (error as Error).message }
  }
})

handleRenderer('tray:getTokenDetails', async (e, contractAddress, chainId) => {
  try {
    const contract = new Erc20Contract(contractAddress, chainId)
    return await contract.getTokenData()
  } catch (e) {
    log.warn('Could not load token data for contract', { contractAddress, chainId })
    return {}
  }
})

handleRenderer('tray:adjustWalletCalls', async (e, request) => {
  try {
    accounts.adjustWalletCallsRequest(request.account, request.handlerId, request.adjustment)
    return { success: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wallet-call adjustment failed'
    log.warn('Wallet-call adjustment failed', { reason: message.slice(0, 240) })
    return {
      success: false as const,
      error: message.trim().slice(0, 240) || 'Wallet-call adjustment failed'
    }
  }
})

handleRenderer('tray:refreshWalletCallsStatus', async (e, request) => {
  try {
    const status = walletCallBatchLedger.getStatus(request.origin, request.account, request.id)
    showWalletCallStatus({
      account: request.account,
      originName: request.origin,
      status
    })
    return { success: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wallet-call status refresh failed'
    log.warn('Wallet-call status refresh failed', { reason: message.slice(0, 240) })
    return {
      success: false as const,
      error: message.trim().slice(0, 240) || 'Wallet-call status refresh failed'
    }
  }
})

const addressBookMutation = async (operation: () => Promise<unknown> | unknown) => {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Contact operation failed'
    log.warn('Contact operation failed', { reason: message.slice(0, 240) })
    return { success: false as const, error: message.trim().slice(0, 240) || 'Contact operation failed' }
  }
}

handleRenderer('addressBook:save', async (e, request) =>
  addressBookMutation(() =>
    persistAddressBookEntry(request, {
      save: (value) => requireStoreAction('saveAddressBookEntry')(value),
      current: () => store('main.addressBook')
    })
  )
)
handleRenderer('addressBook:remove', async (e, address) =>
  addressBookMutation(() => {
    requireStoreAction('removeAddressBookEntry')(address)
    return { success: true as const }
  })
)
handleRenderer('addressBook:import', async () => addressBookMutation(() => addressBookFiles.importFile()))
handleRenderer('addressBook:export', async () => addressBookMutation(() => addressBookFiles.exportFile()))
handleRenderer('inspector:inspect', async (e, input) => inspect(input, { send: chains.send.bind(chains) }))
handleRenderer('deployment:prepare', async (e, draft) => deployment.prepare(draft))
handleRenderer('deployment:queue', async (e, request) => {
  const result = await deployment.queue(request)
  return result.success ? { success: true, handlerId: result.handlerId } : result
})

const contractVerificationArtifactMutation = async (operation: () => Promise<unknown> | unknown) => {
  try {
    return await operation()
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof ContractVerificationArtifactIntakeError ? error.code : ('invalid-file' as const)
    }
  }
}

handleRenderer('contractVerification:inspectArtifact', async () =>
  contractVerificationArtifactMutation(async () => {
    const artifact = await contractVerificationArtifactIntake.inspect()
    return artifact
      ? { success: true as const, artifact }
      : { success: false as const, canceled: true as const }
  })
)
handleRenderer('contractVerification:selectArtifact', async (e, token, contractIdentifier) =>
  contractVerificationArtifactMutation(() => ({
    success: true as const,
    artifact: contractVerificationArtifactIntake.select(token, contractIdentifier)
  }))
)
handleRenderer('contractVerification:prepare', async (e, request) => contractVerification.prepare(request))
handleRenderer('contractVerification:publish', async (e, request) => {
  const result = await contractVerification.publish(request)
  if (result.success) contractVerificationPollingRuntime.wake()
  return result
})
handleRenderer('contractVerification:list', async () => contractVerification.list())
handleRenderer('contractVerification:openResult', async (e, request) => {
  const result = contractVerification.get(request.jobId)
  if (!result.success) return { success: false as const, error: 'job-unavailable' as const }
  const destination = result.job.destinations.find((entry) => entry.destination === request.destination)
  if (
    !destination?.explorerUrl ||
    !openContractVerificationResult(destination.destination, destination.explorerUrl)
  ) {
    return { success: false as const, error: 'job-unavailable' as const }
  }
  return { success: true as const }
})
handleRenderer('contractVerification:get', async (e, jobId) => contractVerification.get(jobId))
handleRenderer('contractVerification:refresh', async (e, jobId) => {
  const result = await contractVerification.refresh(jobId)
  return wakeContractVerificationPollingForActiveResult(contractVerificationPollingRuntime, result)
})
handleRenderer('contractVerification:reselect', async (e, request) => contractVerification.reselect(request))
handleRenderer('contractVerification:publishEtherscan', async (e, request) => {
  const result = await contractVerification.publishEtherscan(request)
  return wakeContractVerificationPollingForActiveResult(contractVerificationPollingRuntime, result)
})
handleRenderer('contractVerification:credentialStatus', async () => contractVerification.credentialStatus())
handleRenderer('contractVerification:saveCredential', async (e, apiKey) =>
  contractVerification.saveCredential(apiKey)
)
handleRenderer('contractVerification:removeCredential', async () => contractVerification.removeCredential())
handleRenderer('tray:continueContractVerification', async (e, request) => {
  const target = accounts.confirmedDeploymentOperation(request.handlerId, request.account)
  return target
    ? { success: true as const, ...target }
    : { success: false as const, error: 'operation-not-confirmed' as const }
})

const profileBackupMutation = async (publicError: string, operation: () => Promise<unknown> | unknown) => {
  try {
    return await operation()
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error
    const errorCode =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code.slice(0, 64)
        : undefined
    log.warn('Profile backup operation failed', { errorName, ...(errorCode ? { errorCode } : {}) })
    return {
      success: false as const,
      error: publicError
    }
  }
}

handleRenderer('profile:export', async (e, password) =>
  profileBackupMutation('Encrypted backup could not be exported', async () => {
    const destination = await saveProfileBackupDialog()
    if (!destination) return { success: false as const, canceled: true as const }
    persist.writeUpdates()
    const { bytes } = writeEncryptedProfileBackup(
      app.getPath('userData'),
      destination,
      password,
      new Date(),
      { readSignerFiles: () => osSignerStorage.readAllSignerFiles() }
    )
    return { success: true as const, bytes }
  })
)

const signerProtectionMutation = async (operation: () => Promise<unknown> | unknown) => {
  try {
    const status = await operation()
    await signers.rescanHotSigners()
    return { success: true as const, status }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error
    log.warn('OS signer protection operation failed', { errorName })
    try {
      const status = osSignerStorage.status()
      if (status.enabled || status.state === 'recovery-required') {
        signers.unloadHotSigners('OS signer protection failure')
      }
    } catch {
      signers.unloadHotSigners('OS signer protection status failure')
    }
    return { success: false as const, error: 'Software signer protection could not be changed' }
  }
}

handleRenderer('signers:protectionStatus', async () => {
  try {
    const status = osSignerStorage.status()
    if (status.state === 'enabled') await signers.rescanHotSigners()
    else if (status.enabled || status.state === 'recovery-required') {
      signers.unloadHotSigners('OS signer protection unavailable')
    }
    return { success: true as const, status }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error
    log.warn('OS signer protection status failed', { errorName })
    signers.unloadHotSigners('OS signer protection status failure')
    return { success: false as const, error: 'Software signer protection status is unavailable' }
  }
})

handleRenderer('signers:enableProtection', async (e, confirmation) => {
  if (confirmation !== 'ENABLE_OS_SIGNER_PROTECTION') {
    return { success: false as const, error: 'Software signer protection was not confirmed' }
  }
  return signerProtectionMutation(() => osSignerStorage.enable())
})

handleRenderer('signers:disableProtection', async (e, confirmation) => {
  if (confirmation !== 'DISABLE_OS_SIGNER_PROTECTION') {
    return { success: false as const, error: 'Software signer protection was not confirmed' }
  }
  return signerProtectionMutation(() => osSignerStorage.disable())
})

handleRenderer('profile:inspectBackup', async (e, password) =>
  profileBackupMutation('Encrypted backup could not be inspected', async () => {
    const source = await openProfileBackupDialog()
    if (!source) return { success: false as const, canceled: true as const }
    const now = Date.now()
    for (const [token, inspection] of profileInspectionTokens) {
      if (inspection.expiresAt <= now) profileInspectionTokens.delete(token)
    }
    while (profileInspectionTokens.size >= 8) {
      const oldest = profileInspectionTokens.keys().next().value
      if (!oldest) break
      profileInspectionTokens.delete(oldest)
    }
    const binding = inspectEncryptedProfileBackupFile(source, password)
    const token = crypto.randomUUID()
    const expiresAt = now + PROFILE_INSPECTION_TOKEN_TTL_MS
    profileInspectionTokens.set(token, { source, binding, expiresAt })
    return {
      success: true as const,
      backup: binding.backup,
      restoreToken: token,
      tokenExpiresAt: new Date(expiresAt).toISOString()
    }
  })
)

handleRenderer('profile:stageRestore', async (e, restoreToken, password, confirmation) =>
  profileBackupMutation('Encrypted backup could not be staged for restore', async () => {
    if (confirmation !== 'REPLACE_PROFILE_ON_RESTART') {
      throw new Error('Profile replacement was not explicitly confirmed')
    }
    const inspection = profileInspectionTokens.get(restoreToken)
    profileInspectionTokens.delete(restoreToken)
    if (!inspection || inspection.expiresAt <= Date.now()) {
      throw new Error('Profile backup inspection expired; inspect the backup again')
    }
    const restore = stageInspectedProfileRestore(
      inspection.source,
      password,
      inspection.binding,
      app.getPath('userData')
    )
    if (profileRestoreRelaunchTimer) clearTimeout(profileRestoreRelaunchTimer)
    profileRestoreRelaunchTimer = setTimeout(() => {
      profileRestoreRelaunchTimer = undefined
      app.relaunch()
      app.quit()
    }, 250)
    profileRestoreRelaunchTimer.unref?.()
    return { success: true as const, restore }
  })
)

handleRenderer('yearn:getCatalog', async (e, options) => yearn.getCatalog(options))
handleRenderer('yearn:getPositions', async () => yearn.getPositions())
handleRenderer('yearn:getWorkflows', async () => yearn.list())

const yearnMutation = async (operation: () => Promise<unknown> | unknown) => {
  try {
    return { success: true as const, workflow: await operation() }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Yearn workflow failed'
    log.warn('Yearn workflow operation failed', { reason: message.slice(0, 240) })
    return { success: false as const, error: message.trim().slice(0, 240) || 'Yearn workflow failed' }
  }
}

handleRenderer('yearn:startWorkflow', async (e, request) => yearnMutation(() => yearn.start(request)))
handleRenderer('yearn:resumeWorkflow', async (e, request) => yearnMutation(() => yearn.resume(request)))
handleRenderer('yearn:cancelWorkflow', async (e, request) => yearnMutation(() => yearn.cancel(request)))
handleRenderer('yearn:revokeWorkflow', async (e, request) => yearnMutation(() => yearn.revoke(request)))

handleRenderer('send:resolveRecipient', async (e, value) => send.resolveRecipient(value))
handleRenderer('send:maxAmount', async (e, request) => send.maxAmount(request))
handleRenderer('send:queue', async (e, draft) => send.queue(draft))
handleRenderer('send:quoteSweep', async (e, request) => {
  try {
    return { success: true as const, ...(await provider.quoteSweep(request)) }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return {
      success: false as const,
      error: code === 'managed-sweep-changed' ? 'sweep-quote-changed' : 'sweep-unavailable'
    }
  }
})
handleRenderer('send:queueSweep', async (e, request) => {
  try {
    return { success: true as const, ...(await provider.queueSweep(request)) }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return {
      success: false as const,
      error: code === 'managed-sweep-changed' ? 'sweep-quote-changed' : 'sweep-unavailable'
    }
  }
})

handleRenderer('tokens:save', async (e, token, req) => {
  try {
    return persistCustomToken(token, req, {
      save: (tokens) => requireStoreAction('addCustomTokens')(tokens),
      resolve: (account, handlerId) => accounts.resolveRequestForAccount(account, handlerId)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    log.warn('Could not save custom token', { reason: message.slice(0, 240) })
    return { success: false as const, error: 'Token could not be saved.' }
  }
})

onRenderer('tray:addToken', (e, token, req) => {
  if (token) {
    log.info('adding custom token', token)
    requireStoreAction('addCustomTokens')([token])
  }
  if (req) accounts.resolveRequestForAccount(req.account, req.handlerId)
})

onRenderer('tray:removeToken', (e, token) => {
  if (token) {
    log.info('removing custom token', token)

    requireStoreAction('removeBalance')(token.chainId, token.address)
    requireStoreAction('removeCustomTokens')([token])
  }
})

onRenderer('tray:adjustNonce', (e, request, nonceAdjust) => {
  accounts.adjustNonce(request.handlerId, nonceAdjust, request.account)
})

onRenderer('tray:resetNonce', (e, request) => {
  accounts.resetNonce(request.handlerId, request.account)
})

onRenderer('tray:ready', () => {
  require('./api')

  if (!isDev) {
    startUpdater()
  }
})

onRenderer('tray:updateRestart', () => {
  managedClipboard.dispose()
  updater.quitAndInstall()
})

onRenderer('frame:close', (e) => {
  windows.close(e)
})

onRenderer('frame:min', (e) => {
  windows.min(e)
})

onRenderer('frame:max', (e) => {
  windows.max(e)
})

onRenderer('frame:unmax', (e) => {
  windows.unmax(e)
})

app.on('ready', () => {
  recentRecipientsRuntime.start()
  walletCallBatchLedger.failAbandonedAdmissions()
  startWalletCallEvidenceRuntime()
  startOperationLifecycleRuntime()
  startContractVerificationPollingRuntime()
  void signers.rescanHotSigners()
  menu()
  windows.init()
  dapps.setEmbeddedOpener((view) => windows.openEmbeddedDapp(view))
  if (app.dock) app.dock.hide()
  if (isDev) {
    const loadDev = async () => {
      const { installDevTools, startCpuMonitoring } = await import('./dev')
      installDevTools()
      startCpuMonitoring()
    }

    void loadDev()
  }

  protocol.interceptFileProtocol('file', (req, cb) => {
    const appOrigin = path.resolve(__dirname, '../../')
    try {
      const filePath = url.fileURLToPath(req.url)
      cb(isPathInsideRoot(appOrigin, filePath) ? { path: filePath } : { error: -10 })
    } catch {
      cb({ error: -10 })
    }
  })
})

onRenderer('tray:action', (e, action, ...args) => {
  const storeAction = typeof action === 'string' ? store[action] : undefined
  if (typeof storeAction === 'function') {
    if (action === 'saveDappGuardrail' || action === 'removeDappGuardrail') {
      return applyDappGuardrailRendererAction(action, args[0], {
        getAccount: (account) => store('main.accounts', account),
        getPermission: (account, originId) => store('main.permissions', account, originId),
        getOrigin: (originId) => store('main.origins', originId),
        getChain: (chainId) => store('main.networks.ethereum', Number(BigInt(chainId))),
        getCompanionCredential: (fingerprint) => store('main.extensionCredentials', fingerprint),
        getNativeCredential: (fingerprint) => store('main.nativePeerCredentials', fingerprint),
        getGuardrails: () => store('main.dappGuardrails') || {},
        save: (guardrail) => requireStoreAction('saveDappGuardrail')(guardrail),
        remove: (request) => requireStoreAction('removeDappGuardrail')(request),
        onPolicyChanged: (account, originId) => provider.refreshDappGuardrails(account, originId)
      })
    }
    if (action === 'switchOriginChain') {
      return applyOriginChainRendererAction(args, {
        getOrigin: (originId) => store('main.origins', originId),
        getChain: (chainId) => store('main.networks.ethereum', chainId),
        rejectUnapprovedRequestsForOriginChain: (originId, chainId) =>
          accounts.rejectUnapprovedRequestsForOriginChain(originId, chainId),
        mutate: (originId, chainId, type) => storeAction(originId, chainId, type)
      })
    }
    if (action === 'activateNetwork' || action === 'removeNetwork') {
      return applyNetworkRouteRendererAction(action, args, {
        getOrigins: () => store('main.origins') || {},
        getNetworks: () => store('main.networks.ethereum') || {},
        rejectUnapprovedRequestsForOriginChain: (originId, chainId) =>
          accounts.rejectUnapprovedRequestsForOriginChain(originId, chainId),
        mutate: (...mutationArgs) => storeAction(...mutationArgs)
      })
    }
    return storeAction(...args)
  }
  log.info('Tray sent unrecognized action: ', action)
})

app.on('second-instance', (event, argv, workingDirectory) => {
  log.info(`second instance requested from directory: ${workingDirectory}`)
  windows.showTray()
})
app.on('activate', () => windows.showTray())

app.on('before-quit', () => {
  managedClipboard.dispose()
  recentRecipientsRuntime.stop()
  walletCallEvidenceRuntime.stop()
  operationLifecycleRuntime.stop()
  operationLifecycleProjectionRuntime.stop()
  contractVerificationPollingRuntime.stop()
  if (!updater.updateReady) {
    updater.stop()
  }
})

installShutdownHandlers(
  app,
  async () => {
    log.info('Application closing')

    // await clients.stop()
    if (profileRestoreRelaunchTimer) clearTimeout(profileRestoreRelaunchTimer)
    profileRestoreRelaunchTimer = undefined
    managedClipboard.dispose()
    profileInspectionTokens.clear()
    contractVerification.dispose()
    removeSignerPowerLockHandlers()
    accounts.close()
    walletCallBatchLedger.failAbandonedAdmissions()
    await signers.close()
    log.info('Application resources closed')
  },
  (error) => log.error('Application shutdown failed', error)
)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let launchStatus = store('main.launch')

store.observer(() => {
  if (launchStatus !== store('main.launch')) {
    launchStatus = store('main.launch')
    if (launchStatus) launch.enable()
    else launch.disable()
  }
})
