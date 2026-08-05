import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import bundleSymbols from './bundle-symbols.cjs'

const { findUnresolvedParcelImports } = bundleSymbols

const root = fileURLToPath(new URL('../bundle', import.meta.url))
const renderers = ['tray', 'dash', 'dapp', 'onboard', 'notify']
const deprecatedIdentityPhrases = [
  'Frame Companion',
  'Frame Community Preview',
  'Open Frame Tutorial',
  'Welcome to Frame',
  'use Frame at your own risk'
]

if (!existsSync(root)) throw new Error('bundle directory does not exist')

const files = readdirSync(root)

for (const renderer of renderers) {
  const htmlPath = join(root, `${renderer}.html`)
  if (!existsSync(htmlPath)) throw new Error(`missing ${basename(htmlPath)}`)

  const html = readFileSync(htmlPath, 'utf8')
  const nonceMatches = [...html.matchAll(/'nonce-([^']+)'/g)]
  const nonces = new Set(nonceMatches.map((match) => match[1]))
  if (nonces.size !== 1) throw new Error(`${renderer}.html must declare exactly one CSP script nonce`)

  const [nonce] = nonces
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag)
  if (scriptTags.length === 0) throw new Error(`${renderer}.html contains no scripts`)
  for (const tag of scriptTags) {
    const scriptNonce = tag.match(/\bnonce\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const value = scriptNonce && (scriptNonce[1] || scriptNonce[2] || scriptNonce[3])
    if (value !== nonce) throw new Error(`${renderer}.html contains a script without its CSP nonce`)
  }

  const references = [
    ...html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"#?]+)"|'([^'#?]+)'|([^\s"'<>#?]+))/gi)
  ].map(([, doubleQuoted, singleQuoted, unquoted]) => basename(doubleQuoted || singleQuoted || unquoted))

  for (const reference of references) {
    if (!existsSync(join(root, reference))) {
      throw new Error(`${renderer}.html references missing asset ${reference}`)
    }
  }

  const expectedAssets = references.filter((reference) =>
    new RegExp(`^${renderer}\\.[a-f0-9]+\\.(?:js|css)$`).test(reference)
  )
  const expectedJavaScript = expectedAssets.filter((asset) => asset.endsWith('.js'))
  const expectedStyles = expectedAssets.filter((asset) => asset.endsWith('.css'))
  const actualAssets = files.filter((file) => new RegExp(`^${renderer}\\.[a-f0-9]+\\.(?:js|css)$`).test(file))

  if (expectedJavaScript.length !== 1 || expectedStyles.length !== 2) {
    throw new Error(
      `${renderer}.html must reference one JavaScript and two CSS assets; found ${expectedJavaScript.length} and ${expectedStyles.length}`
    )
  }

  for (const asset of expectedJavaScript) {
    const javascript = readFileSync(join(root, asset), 'utf8')
    const unresolvedImports = findUnresolvedParcelImports(javascript)
    if (unresolvedImports.length > 0) {
      throw new Error(`${renderer} contains unresolved Parcel imports: ${unresolvedImports.join(', ')}`)
    }
    for (const phrase of deprecatedIdentityPhrases) {
      if (javascript.includes(phrase)) {
        throw new Error(`${renderer} contains deprecated product identity: ${phrase}`)
      }
    }
  }

  if (
    actualAssets.length !== expectedAssets.length ||
    actualAssets.some((asset) => !expectedAssets.includes(asset))
  ) {
    throw new Error(`${renderer} has stale or unreferenced assets: ${actualAssets.join(', ')}`)
  }

  const sourceMaps = files.filter((file) =>
    new RegExp(`^${renderer}\\.[a-f0-9]+\\.(?:js|css)\\.map$`).test(file)
  )

  for (const sourceMap of sourceMaps) {
    if (!actualAssets.includes(sourceMap.slice(0, -4))) {
      throw new Error(`${renderer} has stale source map ${sourceMap}`)
    }
  }
}

console.log(`Verified ${renderers.length} renderer bundles, CSP nonces, and no stale assets.`)
