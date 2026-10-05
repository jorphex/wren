import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { hashDirectory } = require('../compiled/main/dapps/verify')

const fixtureCid = 'bafybeib4nfqoovh6nwreq3nsmtakyapnsbxuk7vn643la45zvl4jkw6mgq'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-unixfs-test-'))

try {
  await fs.mkdir(path.join(root, 'assets'))
  await fs.mkdir(path.join(root, '.well-known'))
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Frame fixture</h1>\n')
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'console.log("frame")\n')
  await fs.writeFile(path.join(root, '.well-known', 'frame.json'), '{"frame":true}\n')

  assert.equal((await hashDirectory(root)).toV1().toString(), fixtureCid)

  await fs.writeFile(path.join(root, '.well-known', 'frame.json'), '{"frame":false}\n')
  assert.notEqual((await hashDirectory(root)).toV1().toString(), fixtureCid)

  const fixtures = {
    empty: 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354',
    directories: 'bafybeigh223gmx3lsn35b32mjelul5rg3kqifu6wqui4ivrga2nbhwaoli',
    names: 'bafybeifuz46dqy7lot2v4v3o5guritrksttsfs4q6zijsfg7ynmbgp2sly'
  }
  const hashes = { existing: fixtureCid }
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wren-unixfs-compatibility-'))
  try {
    for (const [name, cid] of Object.entries(fixtures)) {
      const directory = path.join(fixtureRoot, name)
      await fs.mkdir(directory)
      if (name === 'directories') {
        await fs.mkdir(path.join(directory, '.hidden', 'empty'), { recursive: true })
        await fs.mkdir(path.join(directory, 'nested', 'empty'), { recursive: true })
        await fs.writeFile(path.join(directory, 'nested', 'data'), 'data\n')
      }
      if (name === 'names') {
        for (const file of ['[a].txt', '{one,two}.txt', 'é space.txt', '.hidden']) {
          await fs.writeFile(path.join(directory, file), `${file}\n`)
        }
      }
      hashes[name] = (await hashDirectory(directory)).toV1().toString()
      assert.equal(hashes[name], cid, `Changed ${name} directory CID`)
    }
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true })
  }

  await fs.symlink(path.join(root, 'index.html'), path.join(root, 'linked-index.html'))
  await assert.rejects(hashDirectory(root), /symbolic link/)

  await fs.writeFile(
    path.resolve('compiled/unixfs-integration-report.json'),
    JSON.stringify({ hashes, hiddenMutationRejected: true, symlinkRejected: true }, null, 2) + '\n'
  )
  console.log('Verified UnixFS CID compatibility, hidden files, empty directories, and symlink rejection')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
