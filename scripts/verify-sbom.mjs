import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { readSourceIdentity } from './source-identity.mjs'

const path = process.argv[2]
if (!path) throw new Error('Usage: node scripts/verify-sbom.mjs <sbom.json>')
if (!process.env.npm_execpath) throw new Error('SBOM verification must run through npm')

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageLockBytes = await readFile(new URL('../package-lock.json', import.meta.url))
const packageLock = JSON.parse(packageLockBytes)
const sbom = JSON.parse(await readFile(path, 'utf8'))

if (sbom.bomFormat !== 'CycloneDX' || typeof sbom.specVersion !== 'string') {
  throw new Error('SBOM is not a CycloneDX document')
}
if (sbom.metadata?.component?.name !== packageJson.name) {
  throw new Error('SBOM root component does not match package name')
}
if (sbom.metadata?.component?.version !== packageJson.version) {
  throw new Error('SBOM root component does not match package version')
}
if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
  throw new Error('SBOM has no production components')
}

const { commit: sourceCommit, timestamp: sourceTimestamp } = readSourceIdentity()
const serialBytes = createHash('sha256')
  .update(`${packageJson.name}\0${packageJson.version}\0${sourceCommit}\0`)
  .update(packageLockBytes)
  .digest()
  .subarray(0, 16)
serialBytes[6] = (serialBytes[6] & 0x0f) | 0x50
serialBytes[8] = (serialBytes[8] & 0x3f) | 0x80
const serialHex = serialBytes.toString('hex')
const expectedSerial = `urn:uuid:${serialHex.slice(0, 8)}-${serialHex.slice(8, 12)}-${serialHex.slice(12, 16)}-${serialHex.slice(16, 20)}-${serialHex.slice(20)}`
const sourceProperty = sbom.metadata.component.properties?.find(
  (property) => property?.name === 'wren:source-commit'
)
if (
  sbom.serialNumber !== expectedSerial ||
  sbom.metadata.timestamp !== new Date(sourceTimestamp).toISOString() ||
  sourceProperty?.value !== sourceCommit
) {
  throw new Error('SBOM source identity does not match the clean reviewed commit')
}

const references = new Set()
const componentsByReference = new Map()
for (const component of sbom.components) {
  if (typeof component?.['bom-ref'] !== 'string' || references.has(component['bom-ref'])) {
    throw new Error('SBOM contains a missing or duplicate component reference')
  }
  references.add(component['bom-ref'])
  componentsByReference.set(component['bom-ref'], component)

  const development = component.properties?.some(
    (property) => property?.name === 'cdx:npm:package:development' && property.value === 'true'
  )
  if (development) throw new Error(`SBOM contains development dependency ${component.name || ''}`.trim())
}

const rootReference = sbom.metadata.component['bom-ref']
const rootDependency = sbom.dependencies?.find((dependency) => dependency?.ref === rootReference)
if (!rootDependency || !Array.isArray(rootDependency.dependsOn)) {
  throw new Error('SBOM has no root dependency graph')
}
const rootDependencies = new Set(rootDependency.dependsOn)

for (const dependency of Object.keys(packageJson.dependencies || {})) {
  let lockEntry = packageLock.packages?.[`node_modules/${dependency}`]
  if (lockEntry?.link && typeof lockEntry.resolved === 'string') {
    lockEntry = packageLock.packages?.[lockEntry.resolved]
  }
  const version = lockEntry?.version
  const reference = version && `${dependency}@${version}`
  if (!reference || !componentsByReference.has(reference) || !rootDependencies.has(reference)) {
    throw new Error(`SBOM is missing direct production dependency ${dependency}`)
  }
}

const electronVersion = packageJson.devDependencies?.electron
const electronReference = `pkg:github/electron/electron@v${electronVersion}`
const electron = componentsByReference.get(electronReference)
const packagedRuntime = electron?.properties?.some(
  (property) => property?.name === 'wren:packaged-runtime' && property.value === 'true'
)
if (electron?.version !== electronVersion || !packagedRuntime || !rootDependencies.has(electronReference)) {
  throw new Error('SBOM is missing the packaged Electron runtime')
}

const productionTree = JSON.parse(
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'ls', '--package-lock-only', '--omit=dev', '--all', '--json'],
    {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024
    }
  )
)
const expectedGraph = new Map([[rootReference, new Set([electronReference])]])
expectedGraph.set(electronReference, new Set())
function collectExpectedGraph(dependencies, parentReference) {
  for (const [name, dependency] of Object.entries(dependencies || {})) {
    if (typeof dependency?.version !== 'string') continue

    const reference = `${name}@${dependency.version}`
    expectedGraph.get(parentReference).add(reference)
    if (!expectedGraph.has(reference)) expectedGraph.set(reference, new Set())
    collectExpectedGraph(dependency.dependencies, reference)
  }
}
collectExpectedGraph(productionTree.dependencies, rootReference)

const expectedComponents = new Set(expectedGraph.keys())
expectedComponents.delete(rootReference)
if (
  references.size !== expectedComponents.size ||
  [...expectedComponents].some((reference) => !references.has(reference))
) {
  throw new Error('SBOM components do not match the locked production dependency closure')
}

const dependencyGraph = new Map()
for (const dependency of sbom.dependencies || []) {
  if (
    typeof dependency?.ref !== 'string' ||
    dependencyGraph.has(dependency.ref) ||
    !Array.isArray(dependency.dependsOn)
  ) {
    throw new Error('SBOM contains an invalid or duplicate dependency node')
  }
  dependencyGraph.set(dependency.ref, dependency.dependsOn)
}

if (
  dependencyGraph.size !== expectedGraph.size ||
  [...expectedGraph].some(([reference, expectedDependencies]) => {
    const actualDependencies = dependencyGraph.get(reference)
    return (
      !actualDependencies ||
      actualDependencies.length !== expectedDependencies.size ||
      actualDependencies.some((dependency) => !expectedDependencies.has(dependency))
    )
  })
) {
  throw new Error('SBOM graph does not match the locked production dependency graph')
}

const reachable = new Set()
const pending = [rootReference]
while (pending.length) {
  const reference = pending.pop()
  if (reachable.has(reference)) continue
  const dependencies = dependencyGraph.get(reference)
  if (!dependencies) throw new Error(`SBOM graph is missing dependency node ${reference}`)
  reachable.add(reference)
  for (const dependency of dependencies) {
    if (!componentsByReference.has(dependency)) {
      throw new Error(`SBOM graph references missing component ${dependency}`)
    }
    pending.push(dependency)
  }
}
if (reachable.size !== componentsByReference.size + 1) {
  throw new Error('SBOM contains unreachable production components')
}

console.log(`Verified production CycloneDX SBOM with ${sbom.components.length} components`)
