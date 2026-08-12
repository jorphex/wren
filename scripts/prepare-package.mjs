import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertReleaseBuildIdentity } from './build-identity.mjs'
import { readSourceIdentity } from './source-identity.mjs'

export async function preparePackageOutput() {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const compiledBuildIdentity = JSON.parse(
    await readFile(path.resolve('compiled/main/build-identity.json'), 'utf8')
  )
  const rendererBuildIdentity = JSON.parse(await readFile(path.resolve('bundle/build-identity.json'), 'utf8'))
  const sourceIdentity = readSourceIdentity()

  assertReleaseBuildIdentity(compiledBuildIdentity, sourceIdentity, packageJson.version)
  assertReleaseBuildIdentity(rendererBuildIdentity, sourceIdentity, packageJson.version)

  for (const generatedDirectory of ['compiled', 'bundle']) {
    const stats = await lstat(path.resolve(generatedDirectory))
    assert.ok(
      stats.isDirectory() && !stats.isSymbolicLink(),
      `${generatedDirectory} must be a generated directory`
    )
  }

  const dist = path.resolve('dist')
  try {
    const stats = await lstat(dist)
    assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), 'dist must be a generated directory')
    await rm(dist, { recursive: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(dist, { mode: 0o700 })
  return sourceIdentity
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sourceIdentity = await preparePackageOutput()
  console.log(`Prepared clean package output for ${sourceIdentity.commit}`)
}
