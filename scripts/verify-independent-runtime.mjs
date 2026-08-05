import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = ['app', 'main', 'resources']
const forbidden = [
  { label: 'Pylon RPC/data/proxy endpoint', pattern: /(?:^|[./])pylon\.link\b/iu },
  { label: 'Nebula hosted IPFS endpoint', pattern: /ipfs\.nebula\.land\b/iu },
  { label: 'Frame asset CDN', pattern: /frame\.nyc3\.cdn\.digitaloceanspaces\.com\b/iu },
  { label: 'Frame Labs runtime package', pattern: /@framelabs\/(?:pylon-client|logger)\b/iu }
]

const ignoredDirectories = new Set(['node_modules', 'bundle', 'compiled', 'dist', '.parcel-cache'])
const historicalMigrationLiterals = new Map([
  [
    'main/store/migrate/migrations/40/index.ts',
    ["'https://frame.nyc3.cdn.digitaloceanspaces.com/baseiconcolor.png'"]
  ],
  [
    'main/store/migrate/migrations/41/index.ts',
    ["'https://frame.nyc3.cdn.digitaloceanspaces.com/baseiconcolor.png'", "'wss://evm.pylon.link/goerli'"]
  ],
  [
    'main/store/migrate/migrations/53/index.ts',
    ["'evm.pylon.link'", "'frame.nyc3.cdn.digitaloceanspaces.com'"]
  ],
  [
    'main/store/migrate/migrations/legacy/index.ts',
    [
      "'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/optimism.svg'",
      "'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/gnosis.svg'",
      "'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/polygon.svg'",
      "'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/arbitrum.svg'",
      "'https://frame.nyc3.cdn.digitaloceanspaces.com/baseiconcolor.png'"
    ]
  ]
])

function applicationFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) return []
      return applicationFiles(absolute)
    }
    return /\.(?:css|html|js|json|jsx|mjs|styl|svg|ts|tsx)$/u.test(entry.name) ? [absolute] : []
  })
}

const failures = []
for (const sourceRoot of sourceRoots) {
  for (const file of applicationFiles(path.join(root, sourceRoot))) {
    const relative = path.relative(root, file)
    let source = fs.readFileSync(file, 'utf8')
    for (const literal of historicalMigrationLiterals.get(relative) || []) {
      source = source.replace(literal, '')
    }
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) failures.push(`${relative}: ${rule.label}`)
    }
  }
}

for (const packageFile of ['package.json', 'package-lock.json']) {
  const source = fs.readFileSync(path.join(root, packageFile), 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) failures.push(`${packageFile}: ${rule.label}`)
  }
}

if (failures.length > 0) {
  console.error(
    `Inherited runtime boundary verification failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
  )
  process.exit(1)
}

console.log('Verified active Wren source and dependencies contain no inherited Frame/Pylon runtime service.')
