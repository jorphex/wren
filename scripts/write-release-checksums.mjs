import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeReleaseChecksums } from './release-manifest.mjs'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const artifacts = await writeReleaseChecksums({
  dist: path.resolve('dist'),
  version: packageJson.version,
  includeMacos: true,
  includeWindows: true
})
console.log(`Checksummed ${artifacts.join(', ')}`)
