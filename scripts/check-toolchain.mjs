import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { npmCliInvocation } from './toolchain.mjs'

const expectedNode = (await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim()
const packageFile = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedNpm = packageFile.packageManager.split('@').at(-1)
const npm = npmCliInvocation()
const npmVersion = execFileSync(npm.executable, npm.args, {
  encoding: 'utf8'
}).trim()

if (process.version !== `v${expectedNode}`) {
  console.error(`Expected Node ${expectedNode}; run "nvm install && nvm use".`)
  process.exit(1)
}

if (npmVersion !== expectedNpm) {
  console.error(`Expected npm ${expectedNpm}; run "npm install --global npm@${expectedNpm}".`)
  process.exit(1)
}

console.log(`Using Node ${process.version} and npm ${npmVersion}`)
