import { hash } from 'eth-ens-namehash'
import log from 'electron-log'
import crypto from 'crypto'

import store from '../store'
import { requireStoreAction } from '../store/action'
import nebulaApi from '../nebula'
import server from './server'
import extractColors from '../windows/extractColors'
import { installDappArchive } from './cache'
import { getPinnedDappManifest } from './manifests'
import { dappPathExists, getDappCacheDir, isDappVerified } from './verify'

import type { Dapp } from '../store/state'

const nebula = nebulaApi()

function getDapp(dappId: string): Dapp {
  const dapp = store('main.dapps', dappId)
  if (!dapp) throw new Error(`Dapp ${dappId} is not installed`)
  return dapp
}

async function getDappColors(dappId: string) {
  const dapp = getDapp(dappId)
  const session = crypto.randomBytes(6).toString('hex')
  server.sessions.add(dapp.ens, session)

  const url = `http://${dapp.ens}.localhost:8421/?session=${session}`
  try {
    const colors = await extractColors(url, dapp.ens)
    requireStoreAction('updateDapp')(dappId, { colors })
  } catch (e) {
    log.error(e)
  } finally {
    server.sessions.remove(dapp.ens, session)
  }
}

const cacheDapp = async (dappId: string, hash: string) => {
  await installDappArchive({
    archive: nebula.ipfs.get(hash, { archive: true }),
    cacheRoot: getDappCacheDir(),
    contentCID: hash,
    dappId,
    onCleanupError: (error) => log.warn('Could not remove previous dapp cache', error)
  })

  await getDappColors(dappId)

  return dappId
}

async function updateDappContent(dappId: string, content: string, manifest: Record<string, unknown>) {
  // Only publish a downloaded cache after its full directory CID is verified.
  await cacheDapp(dappId, content)
  requireStoreAction('updateDapp')(dappId, { content, manifest })
}

let retryTimer: NodeJS.Timeout

// Takes dappId and checks if the dapp is up to date
async function checkStatus(dappId: string) {
  clearTimeout(retryTimer)
  const dapp = store('main.dapps', dappId) as Dapp | undefined
  if (!dapp) {
    log.warn(`Stopped status check for removed dapp ${dappId}`)
    return
  }
  const { checkStatusRetryCount, openWhenReady } = dapp

  try {
    const pinnedManifest = getPinnedDappManifest(dapp.ens)
    const { record, manifest } = pinnedManifest
      ? { record: { content: pinnedManifest.content }, manifest: pinnedManifest }
      : await nebula.resolve(dapp.ens)
    const { version, content } = manifest || {}

    if (!content) {
      log.error(
        `Attempted load dapp with id ${dappId} (${dapp.ens}) but manifest contained no content`,
        manifest
      )
      return
    }

    log.info(`Resolved content for ${dapp.ens}, version: ${version || 'unknown'}`)

    requireStoreAction('updateDapp')(dappId, { record })

    const isDappCurrent = async () => {
      return (
        dapp.content === content && (await dappPathExists(dappId)) && (await isDappVerified(dappId, content))
      )
    }

    // Checks if all assets are up to date with current manifest
    if (!(await isDappCurrent())) {
      log.info(`Updating content for dapp ${dappId} from hash ${content}`)
      // Sets status to 'updating' when updating the bundle
      requireStoreAction('updateDapp')(dappId, { status: 'updating' })
      // Update dapp assets
      await updateDappContent(dappId, content, manifest)
    } else {
      log.info(`Dapp ${dapp.ens} already up to date: ${content}`)
    }
    // Sets status to 'ready' when done
    requireStoreAction('updateDapp')(dappId, { status: 'ready', openWhenReady: false })

    // The frame id 'dappLauncher' needs to refrence target frame
    if (openWhenReady) surface.open('dappLauncher', dapp.ens)
  } catch (e) {
    log.error('Check status error', e)
    const retry = checkStatusRetryCount || 0
    if (retry < 4) {
      retryTimer = setTimeout(() => {
        requireStoreAction('updateDapp')(dappId, {
          status: 'initial',
          checkStatusRetryCount: retry + 1
        })
      }, 1000)
    } else {
      requireStoreAction('updateDapp')(dappId, { status: 'failed', checkStatusRetryCount: 0 })
    }
  }
}

const refreshDapps = ({ statusFilter = '' } = {}) => {
  const dapps = store('main.dapps')

  Object.keys(dapps || {})
    .filter((id) => {
      const dapp = dapps[id]
      return dapp !== undefined && (!statusFilter || dapp.status === statusFilter)
    })
    .forEach((id) => {
      requireStoreAction('updateDapp')(id, { status: 'loading' })
      if (nebula.ready()) {
        checkStatus(id)
      } else {
        nebula.once('ready', () => checkStatus(id))
      }
    })
}

const checkNewDapps = () => refreshDapps({ statusFilter: 'initial' })

// Check all dapps on startup
refreshDapps()

// Check all dapps every hour
setInterval(() => refreshDapps(), 1000 * 60 * 60)

// Check any new dapps that are added
store.observer(checkNewDapps)

let nextId = 0
const getId = () => (++nextId).toString()

const surface = {
  manifest: (_ens: string) => {
    // gets the dapp manifest and returns all options and details for user to confirm before installing
  },
  add: (dapp: Dapp) => {
    const { ens, config } = dapp

    const id = hash(ens)
    const status = 'initial'

    const existingDapp = store('main.dapps', id)

    // If ens name has not been installed, start install
    if (!existingDapp) requireStoreAction('appDapp')({ id, ens, status, config, manifest: {}, current: {} })
  },
  addServerSession(_namehash: string /* , session */) {
    // server.sessions.add(namehash, session)
  },
  unsetCurrentView(frameId: string) {
    requireStoreAction('setCurrentFrameView')(frameId, '')
  },
  open(frameId: string, ens: string) {
    const dappId = hash(ens)

    const dapp = getDapp(dappId)

    if (dapp.status === 'ready') {
      if (!store('main.frames', frameId)) {
        log.warn(`Attempted to open frame "${frameId}" for ${ens} but frame does not exist`)
        return
      }

      const session = crypto.randomBytes(6).toString('hex')
      const url = `http://${ens}.localhost:8421/?session=${session}`
      const view = {
        id: getId(),
        ready: false,
        dappId,
        ens,
        url
      }

      server.sessions.add(ens, session)
      requireStoreAction('addFrameView')(frameId, view)
    } else {
      requireStoreAction('updateDapp')(dappId, { ens, status: 'initial', openWhenReady: true })
    }
  }
}

export default surface
