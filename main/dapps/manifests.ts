export type PinnedDappManifest = {
  content: string
  version: string
}

const pinnedDappManifests: Readonly<Record<string, PinnedDappManifest>> = Object.freeze({
  'send.frame.eth': Object.freeze({
    content: 'bafybeiag6x7b2xh3c23fochm565boiuygmomi3vqjxjad4wax5oldwh6bi',
    version: '0.2-e37d2f3'
  })
})

export function getPinnedDappManifest(ens: string) {
  return pinnedDappManifests[ens]
}
