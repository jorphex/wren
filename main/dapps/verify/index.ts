import path from 'path'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import { app } from 'electron'

import { loadUnixFsModule } from '../../nebula/modules'

async function assertRegularTree(directory: string) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isSymbolicLink()) throw new Error(`Dapp cache contains a symbolic link: ${entryPath}`)
    if (entry.isDirectory()) await assertRegularTree(entryPath)
    else if (!entry.isFile()) throw new Error(`Dapp cache contains a non-file entry: ${entryPath}`)
  }
}

export async function hashDirectory(directory: string) {
  await assertRegularTree(directory)
  const { importer } = await loadUnixFsModule()

  async function* directorySource(
    current: string,
    relative = ''
  ): AsyncGenerator<{ path: string; content?: AsyncIterable<Uint8Array> }> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      const sourcePath = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`Dapp cache contains a symbolic link: ${entryPath}`)
      if (entry.isDirectory()) {
        yield { path: sourcePath }
        yield* directorySource(entryPath, sourcePath)
      } else if (entry.isFile()) {
        yield { path: sourcePath, content: createReadStream(entryPath) }
      } else {
        throw new Error(`Dapp cache contains a non-file entry: ${entryPath}`)
      }
    }
  }

  let rootCID
  const blockstore = { put: async () => {} }

  for await (const entry of importer(directorySource(directory), blockstore, {
    profile: 'unixfs-v0-2015',
    wrapWithDirectory: true
  })) {
    rootCID = entry.cid
  }

  if (!rootCID) throw new Error(`Could not hash empty dapp directory: ${directory}`)
  return rootCID
}

export function getDappCacheDir() {
  return path.join(app.getPath('userData'), 'DappCache')
}

export async function dappPathExists(dappId: string) {
  const cachedDappPath = `${getDappCacheDir()}/${dappId}`

  try {
    await fs.access(cachedDappPath)
    return true
  } catch (e) {
    return false
  }
}

export async function isDappVerified(dappId: string, contentCID: string) {
  const path = `${getDappCacheDir()}/${dappId}`
  const cid = await hashDirectory(path)

  return cid?.toV1().toString() === contentCID
}
