import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

const copies = [
  ['resources/fonts/Recursive/LICENSE.txt', 'compiled/main/licenses/Recursive.OFL.txt'],
  ['resources/fonts/Recursive/SOURCE.txt', 'compiled/main/licenses/Recursive.SOURCE.txt'],
  ['resources/Components/AssetMark/assets/LICENSE.txt', 'compiled/main/yearn/token-assets.LICENSE.txt'],
  ['resources/Components/AssetMark/assets/SOURCE.txt', 'compiled/main/yearn/token-assets.SOURCE.txt']
]
const images = (await readdir('main/windows')).filter((name) => name.endsWith('.png'))
if (!images.length) throw new Error('Window image assets are missing')
for (const name of images) copies.push([`main/windows/${name}`, `compiled/main/windows/${name}`])
await Promise.all(
  copies.map(async ([source, destination]) => {
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(source, destination)
  })
)
