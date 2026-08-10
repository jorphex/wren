import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBuildIdentity } from './build-identity.mjs'
import { readWorkingSourceIdentity } from './source-identity.mjs'

const root = fileURLToPath(new URL('../bundle', import.meta.url))
const scriptTagPattern = /<script\b[^>]*>/gi
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export function applyScriptNonce(html, fileName) {
  const nonceMatches = [...html.matchAll(/'nonce-([^']+)'/g)]
  const nonces = new Set(nonceMatches.map((match) => match[1]))

  if (nonces.size !== 1) {
    throw new Error(`${fileName} must declare exactly one CSP script nonce`)
  }

  const [nonce] = nonces
  let scriptCount = 0
  const output = html.replace(scriptTagPattern, (tag) => {
    scriptCount += 1
    const existingNonce = tag.match(/\bnonce\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    if (existingNonce) {
      const value = existingNonce[1] || existingNonce[2] || existingNonce[3]
      if (value !== nonce) throw new Error(`${fileName} contains a script with the wrong CSP nonce`)
      return tag
    }

    return tag.replace(/^<script\b/i, `<script nonce="${nonce}"`)
  })

  if (scriptCount === 0) throw new Error(`${fileName} contains no scripts`)
  return output
}

if (!existsSync(root)) throw new Error('bundle directory does not exist')

for (const file of readdirSync(root).filter((entry) => entry.endsWith('.html'))) {
  const filePath = join(root, file)
  const html = readFileSync(filePath, 'utf8')
  const output = applyScriptNonce(html, basename(filePath))
  if (output !== html) writeFileSync(filePath, output)
}

const buildIdentity = createBuildIdentity(readWorkingSourceIdentity(), packageJson.version)
writeFileSync(join(root, 'build-identity.json'), `${JSON.stringify(buildIdentity, null, 2)}\n`, {
  mode: 0o600
})

console.log(
  `Applied CSP nonces and recorded renderer identity ${buildIdentity.sourceCommit}${
    buildIdentity.sourceDirty ? ' (dirty)' : ''
  }.`
)
