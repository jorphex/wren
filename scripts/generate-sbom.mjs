import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { releaseSbomSerial } from './sbom-identity.mjs'
import { readSourceIdentity } from './source-identity.mjs'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/generate-sbom.mjs <output.json>')
if (!process.env.npm_execpath) throw new Error('SBOM generation must run through npm')

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const runNpm = (args) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  })
const sbom = JSON.parse(runNpm(['sbom', '--package-lock-only', '--sbom-format', 'cyclonedx']))
const productionTree = JSON.parse(
  runNpm(['ls', '--package-lock-only', '--omit=dev', '--all', '--json'])
)

const rootRef = sbom.metadata?.component?.['bom-ref']
if (typeof rootRef !== 'string') throw new Error('npm SBOM is missing its root component')
const { commit: sourceCommit, timestamp: sourceTimestamp } = readSourceIdentity()
sbom.serialNumber = releaseSbomSerial({
  name: packageJson.name,
  version: packageJson.version,
  sourceCommit,
  packageLock
})
sbom.metadata.timestamp = new Date(sourceTimestamp).toISOString()
sbom.metadata.component.name = packageJson.name
sbom.metadata.component.version = packageJson.version
sbom.metadata.component.properties = [
  ...(sbom.metadata.component.properties || []).filter((property) => property?.name !== 'wren:source-commit'),
  { name: 'wren:source-commit', value: sourceCommit }
].sort((left, right) => left.name.localeCompare(right.name))
const productionReferences = new Set()
const productionGraph = new Map([[rootRef, new Set()]])
function collectProductionReferences(dependencies, parentReference) {
  for (const [name, dependency] of Object.entries(dependencies || {})) {
    if (typeof dependency?.version !== 'string') continue

    const reference = `${name}@${dependency.version}`
    productionReferences.add(reference)
    productionGraph.get(parentReference).add(reference)
    if (!productionGraph.has(reference)) productionGraph.set(reference, new Set())
    collectProductionReferences(dependency.dependencies, reference)
  }
}
collectProductionReferences(productionTree.dependencies, rootRef)

sbom.components = (Array.isArray(sbom.components) ? sbom.components : [])
  .filter((component) => productionReferences.has(component['bom-ref']))
  .map((component) => ({
    ...component,
    properties: (component.properties || []).filter(
      (property) => property?.name !== 'cdx:npm:package:development'
    )
  }))

const electronVersion = packageJson.devDependencies?.electron
if (typeof electronVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(electronVersion)) {
  throw new Error('Electron must have an exact version for SBOM generation')
}

const electronRef = `pkg:github/electron/electron@v${electronVersion}`
sbom.components = [
  ...sbom.components,
  {
    'bom-ref': electronRef,
    type: 'framework',
    name: 'Electron',
    version: electronVersion,
    scope: 'required',
    purl: electronRef,
    properties: [{ name: 'wren:packaged-runtime', value: 'true' }]
  }
].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']))

productionGraph.get(rootRef).add(electronRef)
productionGraph.set(electronRef, new Set())
sbom.dependencies = [...productionGraph.entries()]
  .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
  .sort((left, right) => left.ref.localeCompare(right.ref))

const destination = resolve(output)
const temporary = `${destination}.${process.pid}.tmp`
await mkdir(dirname(destination), { recursive: true })
await writeFile(temporary, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 })
await rename(temporary, destination)
