export type PinnedDappManifest = {
  content: string
  version: string
}

const pinnedDappManifests: Readonly<Record<string, PinnedDappManifest>> = Object.freeze({})

export function getPinnedDappManifest(ens: string) {
  return pinnedDappManifests[ens]
}
