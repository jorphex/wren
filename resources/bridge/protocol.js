export const BRIDGE_SOURCE = 'bridge:link'
export const LINK_SOURCE = 'tray:link'
import { RENDERER_ROLE_ARGUMENT, hasRendererCapability, isRendererRole } from './roles'

export const MAX_MESSAGE_LENGTH = 16 * 1024 * 1024
const MAX_ARGUMENTS = 64
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const requestEventChannels = new Set([
  '*:contextmenu',
  'dash:dismissHardwarePrompt',
  'dash:reloadSigner',
  'frame:close',
  'frame:max',
  'frame:min',
  'frame:unmax',
  'nav:back',
  'nav:forward',
  'nav:update',
  'tray:action',
  'tray:addToken',
  'tray:adjustNonce',
  'tray:clearRequests',
  'tray:clipboardData',
  'tray:copyTxHash',
  'tray:dismissUpdate',
  'tray:giveAccess',
  'tray:installAvailableUpdate',
  'tray:mouseout',
  'tray:openExplorer',
  'tray:openExternal',
  'tray:quit',
  'tray:ready',
  'tray:rejectRequest',
  'tray:removeToken',
  'tray:renameAccount',
  'tray:resetAllSettings',
  'tray:resetNonce',
  'tray:updateRestart'
])

export const requestInvokeChannels = new Set([
  'activity:clear',
  'addressBook:export',
  'addressBook:import',
  'addressBook:remove',
  'addressBook:save',
  'contractVerification:credentialStatus',
  'contractVerification:get',
  'contractVerification:inspectArtifact',
  'contractVerification:list',
  'contractVerification:openResult',
  'contractVerification:prepare',
  'contractVerification:publish',
  'contractVerification:publishEtherscan',
  'contractVerification:refresh',
  'contractVerification:removeCredential',
  'contractVerification:reselect',
  'contractVerification:saveCredential',
  'contractVerification:selectArtifact',
  'deployment:prepare',
  'deployment:queue',
  'inspector:inspect',
  'profile:export',
  'profile:inspectBackup',
  'profile:stageRestore',
  'settings:clearRecentRecipients',
  'signers:protectionStatus',
  'signers:enableProtection',
  'signers:disableProtection',
  'send:maxAmount',
  'send:queue',
  'send:quoteSweep',
  'send:queueSweep',
  'send:resolveRecipient',
  'tokens:save',
  'tray:addChain',
  'tray:adjustWalletCalls',
  'tray:continueContractVerification',
  'tray:refreshWalletCallsStatus',
  'tray:getTokenDetails',
  'tray:revokeAccess',
  'tray:writeClipboard',
  'yearn:getCatalog',
  'yearn:getPositions',
  'yearn:getWorkflows',
  'yearn:startWorkflow',
  'yearn:resumeWorkflow',
  'yearn:cancelWorkflow',
  'yearn:revokeWorkflow'
])
export const responseEventChannels = new Set(['action', 'flex'])
const methods = new Set(['event', 'invoke', 'rpc'])

const isRecord = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const hasValidId = (message) => typeof message.id === 'string' && UUID_PATTERN.test(message.id)
const hasValidArgs = (message) => Array.isArray(message.args) && message.args.length <= MAX_ARGUMENTS
const hasOnlyKeys = (message, allowedKeys) => Object.keys(message).every((key) => allowedKeys.has(key))

const hasRoleCapability = (message, rendererRole) => {
  return hasRendererCapability(rendererRole, message.method, message.args)
}

const hasOnlySafePathSegments = (path) =>
  path === '*' ||
  (typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 1024 &&
    path.split('.').every((part) => part && !['__proto__', 'constructor', 'prototype'].includes(part)))

const isValidStateSync = (value) => {
  if (typeof value !== 'string' || value.length > MAX_MESSAGE_LENGTH) return false

  let actions
  try {
    actions = JSON.parse(value)
  } catch {
    return false
  }
  if (!Array.isArray(actions) || actions.length > 4096) return false

  let updateCount = 0
  return actions.every((action) => {
    if (!isRecord(action)) return false
    if (!hasOnlyKeys(action, new Set(['name', 'count', 'deferred', 'internal', 'updates']))) return false
    if (typeof action.name !== 'string' || action.name.length === 0 || action.name.length > 256) return false
    if (!Number.isSafeInteger(action.count) || action.count < 0) return false
    if (typeof action.deferred !== 'boolean') return false
    if ('internal' in action && typeof action.internal !== 'boolean') return false
    if (!Array.isArray(action.updates) || action.updates.length > 4096) return false
    updateCount += action.updates.length
    if (updateCount > 16384) return false

    return action.updates.every(
      (update) =>
        isRecord(update) &&
        hasOnlyKeys(update, new Set(['path', 'value'])) &&
        hasOnlySafePathSegments(update.path) &&
        'value' in update
    )
  })
}

const isValidResponseEvent = (message) => {
  if (!hasValidArgs(message) || !responseEventChannels.has(message.channel)) return false
  if (message.channel === 'flex') {
    const [event, value] = message.args
    if (event === 'shortcutActivated') return message.args.length === 1
    if (event === 'shellLayout') {
      return message.args.length === 2 && (value === 'adjacent' || value === 'overlay')
    }
    if (event === 'shellContent') {
      return message.args.length === 2 && ['prepare', 'conceal', 'reveal'].includes(value)
    }
    if (event === 'shellJoined') {
      return message.args.length === 2 && (value === 'true' || value === 'false')
    }
    return false
  }
  return message.args.length === 2 && message.args[0] === 'stateSync' && isValidStateSync(message.args[1])
}

const isValidRequest = (message, rendererRole) => {
  if (!hasValidArgs(message)) return false

  if (message.method === 'event') {
    return (
      !('id' in message) &&
      hasOnlyKeys(message, new Set(['args', 'method', 'source'])) &&
      requestEventChannels.has(message.args[0]) &&
      hasRoleCapability(message, rendererRole)
    )
  }

  if (!hasValidId(message) || !hasOnlyKeys(message, new Set(['args', 'id', 'method', 'source']))) return false
  if (message.method === 'invoke') {
    return requestInvokeChannels.has(message.args[0]) && hasRoleCapability(message, rendererRole)
  }

  return (
    typeof message.args[0] === 'string' &&
    message.args[0].length > 0 &&
    message.args[0].length <= 128 &&
    hasRoleCapability(message, rendererRole)
  )
}

const isValidResponse = (message) => {
  if (message.method === 'event') {
    return (
      !('id' in message) &&
      hasOnlyKeys(message, new Set(['args', 'channel', 'method', 'source'])) &&
      isValidResponseEvent(message)
    )
  }

  if (!hasValidId(message) || !hasOnlyKeys(message, new Set(['args', 'id', 'method', 'source']))) return false
  if (message.method === 'invoke') return 'args' in message

  return hasValidArgs(message)
}

export const encodeBridgeMessage = (message) => JSON.stringify(message)

export const decodeBridgeMessage = (value, expectedSource, rendererRole) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MESSAGE_LENGTH) return null

  let message
  try {
    message = JSON.parse(value)
  } catch {
    return null
  }

  if (!isRecord(message) || message.source !== expectedSource || !methods.has(message.method)) return null

  const valid =
    expectedSource === LINK_SOURCE ? isValidRequest(message, rendererRole) : isValidResponse(message)
  return valid ? message : null
}

export const getRendererRole = (args) => {
  if (!Array.isArray(args)) return null

  const roleArguments = args.filter(
    (arg) => typeof arg === 'string' && arg.startsWith(RENDERER_ROLE_ARGUMENT)
  )
  if (roleArguments.length !== 1) return null

  const role = roleArguments[0].slice(RENDERER_ROLE_ARGUMENT.length)
  return isRendererRole(role) ? role : null
}

export const isTrustedBridgeEvent = (event, currentWindow, safeOrigins) =>
  event.source === currentWindow && safeOrigins.includes(event.origin)

export const getRendererTargetOrigin = (location) => (location.protocol === 'file:' ? '*' : location.origin)
