import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import tar from 'tar-fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { default: createIpfs } = require('../compiled/main/nebula/ipfs')
const { installDappArchive } = require('../compiled/main/dapps/cache')
const fixtureCid = 'bafybeib4nfqoovh6nwreq3nsmtakyapnsbxuk7vn643la45zvl4jkw6mgq'
const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'wren-ipfs-install-'))
const bundleRoot = path.join(fixtureRoot, fixtureCid)
await mkdir(path.join(bundleRoot, 'assets'), { recursive: true })
await mkdir(path.join(bundleRoot, '.well-known'))
await writeFile(path.join(bundleRoot, 'index.html'), '<h1>Frame fixture</h1>\n')
await writeFile(path.join(bundleRoot, 'assets', 'app.js'), 'console.log("frame")\n')
await writeFile(path.join(bundleRoot, '.well-known', 'frame.json'), '{"frame":true}\n')
const archiveChunks = []
for await (const chunk of tar.pack(fixtureRoot, { entries: [fixtureCid] })) archiveChunks.push(chunk)
const bundle = Buffer.concat(archiveChunks)
const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gue3ohqgs2a6ihz7ukwxh4ze'
const requests = []
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  requests.push({ method: request.method, url, authorization: request.headers.authorization })
  const content = url.searchParams.get('arg') || url.pathname
  if (content.endsWith('/bundle')) {
    response.end(bundle)
    return
  }
  if (content.endsWith('/hang')) return
  if (content.endsWith('/body-hang')) {
    response.write('{')
    return
  }
  if (content.endsWith('/declared-large')) {
    response.writeHead(200, { 'content-length': '256' })
    response.end('x'.repeat(256))
    return
  }
  if (content.endsWith('/error')) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end('{"Message":"not found"}')
  } else if (content.endsWith('/disconnect')) {
    response.write('partial')
    setImmediate(() => response.destroy())
  } else if (content.endsWith('/large')) {
    response.write('x'.repeat(256))
    response.end()
  } else if (url.pathname.endsWith('/get') || url.searchParams.get('format') === 'tar') {
    response.write('archive-')
    response.end('content')
  } else {
    response.write('{"ok":')
    response.end('true}')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}`
const collect = async (source) => {
  const chunks = []
  for await (const chunk of source) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

try {
  for (const base of ['', '/api/v0/', '/custom/api']) {
    const ipfs = createIpfs(undefined, 32, 64, {
      env: { WREN_IPFS_API_URL: endpoint + base, WREN_IPFS_AUTH_TOKEN: 'fixture-token' },
      timeoutMs: 1000
    })
    assert.deepEqual(await ipfs.getJson(`/ipfs/${cid}/folder%20name/file.json`), { ok: true })
    const cat = requests.at(-1)
    const apiPath = base.replace(/\/$/, '') || '/api/v0'
    assert.equal(cat.method, 'POST')
    assert.equal(cat.url.pathname, `${apiPath}/cat`)
    assert.equal(cat.url.searchParams.get('arg'), `/ipfs/${cid}/folder name/file.json`)
    assert.equal(cat.authorization, `Basic ${Buffer.from('fixture-token:').toString('base64')}`)
    assert.equal(await collect(ipfs.get(cid, { archive: true })), 'archive-content')
    assert.equal(requests.at(-1).url.pathname, `${apiPath}/get`)
    assert.equal(requests.at(-1).url.searchParams.get('archive'), 'true')
    assert.equal(await collect(ipfs.get(cid)), 'archive-content')
    assert.notEqual(requests.at(-1).url.searchParams.get('archive'), 'true')
    await assert.rejects(ipfs.getJson(`${cid}/large`), /exceeds 32 bytes/)
    await assert.rejects(ipfs.getJson(`${cid}/declared-large`), /exceeds 32 bytes/)
    await assert.rejects(collect(ipfs.get(`${cid}/large`, { archive: true })), /exceeds 64 bytes/)
    await assert.rejects(ipfs.getJson(`${cid}/error`))
    await assert.rejects(ipfs.getJson(`${cid}/disconnect`))
    const previous = requests.length
    await assert.rejects(ipfs.getJson(`${cid}/%2e%2e/secret`), /Invalid IPFS path/)
    await assert.rejects(ipfs.getJson('invalid-cid'), /Invalid IPFS CID/)
    assert.equal(requests.length, previous)
  }
  const legacy = createIpfs(undefined, 32, 64, {
    env: { FRAME_IPFS_API_URL: endpoint, NEBULA_AUTH_TOKEN: 'legacy-token' }
  })
  assert.deepEqual(await legacy.getJson(cid), { ok: true })
  assert.equal(requests.at(-1).authorization, `Basic ${Buffer.from('legacy-token:').toString('base64')}`)

  const gateway = createIpfs(undefined, 32, 64, {
    env: { WREN_IPFS_GATEWAY_URL: `${endpoint}/content/` }
  })
  assert.deepEqual(await gateway.getJson(cid), { ok: true })
  assert.equal(requests.at(-1).method, 'GET')
  assert.equal(requests.at(-1).url.pathname, `/content/ipfs/${cid}`)
  assert.equal(requests.at(-1).authorization, undefined)
  assert.equal(await collect(gateway.get(cid, { archive: true })), 'archive-content')
  const timeout = createIpfs(undefined, 32, 64, {
    env: { WREN_IPFS_API_URL: endpoint },
    timeoutMs: 50
  })
  await assert.rejects(timeout.getJson(`${cid}/hang`), /timed out after 50ms/)
  await assert.rejects(timeout.getJson(`${cid}/body-hang`), /timed out after 50ms/)
  assert.deepEqual(await timeout.getJson(cid), { ok: true })

  const cacheRoot = path.join(fixtureRoot, 'cache')
  for (const env of [{ WREN_IPFS_API_URL: endpoint }, { WREN_IPFS_GATEWAY_URL: endpoint }]) {
    const ipfs = createIpfs(undefined, 32, 65536, { env })
    await installDappArchive({
      archive: ipfs.get(`${fixtureCid}/bundle`, { archive: true }),
      cacheRoot,
      contentCID: fixtureCid,
      dappId: 'fixture'
    })
    assert.equal(
      await readFile(path.join(cacheRoot, 'fixture', 'index.html'), 'utf8'),
      '<h1>Frame fixture</h1>\n'
    )
    assert.equal(
      await readFile(path.join(cacheRoot, 'fixture', '.well-known', 'frame.json'), 'utf8'),
      '{"frame":true}\n'
    )
    await assert.rejects(
      installDappArchive({
        archive: ipfs.get(`${fixtureCid}/bundle`, { archive: true }),
        cacheRoot,
        contentCID: cid,
        dappId: 'fixture'
      }),
      /CID mismatch/
    )
    assert.equal(
      await readFile(path.join(cacheRoot, 'fixture', 'index.html'), 'utf8'),
      '<h1>Frame fixture</h1>\n'
    )
  }

  await mkdir('compiled', { recursive: true })
  await writeFile(
    path.resolve('compiled/ipfs-integration-report.json'),
    JSON.stringify(
      {
        transport: 'real loopback HTTP',
        requests: requests.length,
        passed: [
          'RPC paths and POST',
          'auth and legacy config',
          'archive flags',
          'gateway GET',
          'stream limits',
          'HTTP errors',
          'disconnect',
          'unsafe paths',
          'timeout and recovery',
          'download, extract and verify CID',
          'preserve cache on CID mismatch'
        ]
      },
      null,
      2
    ) + '\n'
  )
  console.log('Verified IPFS RPC and gateway requests through a real HTTP server')
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(fixtureRoot, { recursive: true, force: true })
}
