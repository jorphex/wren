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
import persist from './store/persist'
import {
  openProfileBackupDialog,
  saveProfileBackupDialog,
  showUnhandledExceptionDialog
} from './windows/dialog'
import { openBlockExplorer, openExternal } from './windows/window'
import Erc20Contract from './contracts/erc20'
import { getErrorCode } from '../resources/utils'
import walletCallEvidenceRuntime from './provider/walletCallEvidenceRuntime'
import operationLifecycleRuntime from './operationLifecycle/runtime'
import operationLifecycleProjectionRuntime from './operationLifecycle/projectionRuntime'
import walletCallBatchLedger from './provider/walletCallLedger'
import { showWalletCallStatus } from './provider/walletCallStatusView'
import { applyAccountPermissionRendererAction } from './provider/accountPermissionActions'
import { applyOriginChainRendererAction } from './provider/originChainActions'
import { handleRenderer, onRenderer } from './ipc/renderer'
import { isPathInsideRoot } from './security/fileAccess'
import { assertSandboxEnabled } from './security/sandbox'
import yearn from './yearn'
import send from './send'
import addressBookFiles from './addressBook/files'
import { installShutdownHandlers } from './lifecycle/shutdown'
import { persistAddressBookEntry, persistCustomToken } from './applicationMutations'
import { installSignerPowerLockHandlers } from './security/signerLockLifecycle'
import {
  inspectEncryptedProfileBackupFile,
  stageInspectedProfileRestore,
  type ProfileBackupFileBinding,
  writeEncryptedProfileBackup
} from './profileBackup'

const isDev = process.env.NODE_ENV === 'development'
assertSandboxEnabled(app.commandLine)

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
let removeSignerPowerLockHandlers = () => {}
let profileRestoreRelaunchTimer: ReturnType<typeof setTimeout> | undefined
const PROFILE_INSPECTION_TOKEN_TTL_MS = 5 * 60 * 1000
const profileInspectionTokens = new Map<
  string,
  { source: string; binding: ProfileBackupFileBinding; expiresAt: number }
>()

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
  persist.clear()

  if (updater.updateReady) {
    return updater.quitAndInstall()
  }

  app.relaunch()
  app.exit(0)
})

onRenderer('tray:replaceTx', async (e, request, type) => {
  requireStoreAction('navBack')('panel')
  setTimeout(async () => {
    try {
      await accounts.replaceTx(request.account, request.handlerId, type)
    } catch (e) {
      log.error('tray:replaceTx Error', e)
    }
  }, 1000)
})

onRenderer('tray:clipboardData', (e, data) => {
  if (data) clipboard.writeText(data)
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

onRenderer('dash:removeSigner', (e, id) => {
  signers.remove(id)
})

onRenderer('dash:reloadSigner', (e, id) => {
  signers.reload(id)
})

onRenderer('tray:rejectRequest', (e, req) => {
  const err = { code: 4001, message: 'User rejected the request' }
  accounts.rejectRequestForAccount(req.account, req.handlerId, err)
})

onRenderer('tray:clearRequestsByOrigin', (e, account, origin) => {
  accounts.clearRequestsByOrigin(account, origin)
})

onRenderer('tray:openExternal', (e, url) => {
  openExternal(url)
  requireStoreAction('setDash')({ showing: false })
})

onRenderer('tray:openExplorer', (e, chain, hash, account) => {
  openBlockExplorer(chain, hash, account)
})

onRenderer('tray:copyTxHash', (e, hash) => {
  if (hash) clipboard.writeText(hash)
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
    const { bytes } = writeEncryptedProfileBackup(app.getPath('userData'), destination, password)
    return { success: true as const, bytes }
  })
)

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
handleRenderer('send:maxAmount', async (e, chainId, assetAddress, recipient) =>
  send.maxAmount(chainId, assetAddress, recipient)
)
handleRenderer('send:queue', async (e, draft) => send.queue(draft))

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
  startWalletCallEvidenceRuntime()
  startOperationLifecycleRuntime()
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
    if ((action === 'toggleAccess' || action === 'clearPermissions') && typeof args[0] === 'string') {
      return applyAccountPermissionRendererAction(action, args, {
        accounts,
        provider,
        getPermissions: (address) => store('main.permissions', address) || {},
        mutate: (address, ...mutationArgs) => storeAction(address, ...mutationArgs)
      })
    }
    if (action === 'switchOriginChain') {
      return applyOriginChainRendererAction(args, {
        getOrigin: (originId) => store('main.origins', originId),
        getChain: (chainId) => store('main.networks.ethereum', chainId),
        mutate: (originId, chainId, type) => storeAction(originId, chainId, type)
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
  walletCallEvidenceRuntime.stop()
  operationLifecycleRuntime.stop()
  operationLifecycleProjectionRuntime.stop()
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
    profileInspectionTokens.clear()
    removeSignerPowerLockHandlers()
    accounts.close()
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
