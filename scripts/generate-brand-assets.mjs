import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer'

const root = process.cwd()
const masterPath = path.join(root, 'asset/brand/wren-mark.svg')
const reviewDirectory = path.join(root, 'asset/review/wren-brand-release-v1')
const master = await readFile(masterPath, 'utf8')
const defs = master.match(/<defs>([\s\S]*?)<\/defs>/)?.[1]

if (!defs) throw new Error(`Could not read vector definitions from ${masterPath}`)

const palette = {
  tile: '#141313',
  tray: '#c07b45',
  light: '#e7eee8',
  dark: '#10130f'
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })

const svg = ({ content, viewBox = '0 0 1000 1000' }) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
    <defs>${defs}</defs>
    ${content}
  </svg>
`

const mark = ({ fill, symbol = 'wren-silhouette', scale = 1, x = 0, y = 0 }) => {
  const offset = (1000 - 1000 * scale) / 2
  return svg({
    content: `<g transform="translate(${offset + x} ${offset + y}) scale(${scale})"><use href="#${symbol}" fill="${fill}" /></g>`
  })
}

const colorMark = () => svg({ content: '<use href="#wren-color" />' })

const appIcon = () =>
  svg({
    content: `<rect x="16" y="16" width="968" height="968" rx="214" fill="${palette.tile}" /><use href="#wren-color" />`
  })

const render = async (source, outputPath, size) => {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`
    )
    const output = await page.screenshot({ omitBackground: true, type: 'png' })
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, output)
  } finally {
    await page.close()
  }
}

const writeProductionAssets = async () => {
  const appOutput = path.join(reviewDirectory, 'wren-app-icon-512.png')
  await render(appIcon(), appOutput, 512)

  for (const outputPath of [
    'asset/WrenIcon.png',
    'asset/png/WrenLogo512.png',
    'main/windows/AppIcon.png',
    'build/icons/512x512.png',
    'build/icons/icon.png'
  ]) {
    await writeFile(path.join(root, outputPath), await readFile(appOutput))
  }

  const trayAssets = [
    ['Icon.png', 24, palette.tray, 'wren-silhouette-24', 1.17, -42],
    ['Icon@2x.png', 48, palette.tray, 'wren-silhouette-32', 1.17, -42],
    ['IconTemplate.png', 24, '#000000', 'wren-silhouette-24', 1.15245, -42],
    ['IconTemplate@2x.png', 48, '#000000', 'wren-silhouette-32', 1.15245, -42],
    ['LinuxTray.png', 24, palette.light, 'wren-silhouette-24', 1.15245, -42],
    ['LinuxTray@2x.png', 48, palette.light, 'wren-silhouette-32', 1.15245, -42]
  ]

  for (const [name, size, fill, symbol, scale, y] of trayAssets) {
    await render(mark({ fill, symbol, scale, y }), path.join(root, 'main/windows', name), size)
  }
}

const proofTile = ({ label, background, fill, size, symbol, scale = 1, x = 0, y = 0 }) => `
  <figure>
    <div class="sample" style="background:${background}">
      <div style="width:${size}px;height:${size}px">${mark({ fill, symbol, scale, x, y })}</div>
    </div>
    <figcaption>${label}</figcaption>
  </figure>
`

const writeProofSheet = async () => {
  const app = appIcon()
  const color = colorMark()
  const html = `
    <style>
      *{box-sizing:border-box} body{margin:0;padding:44px;background:#ebe8e0;color:#161816;font-family:Inter,Arial,sans-serif}
      h1{margin:0 0 8px;font-size:30px} p{margin:0 0 32px;color:#61645f;font-size:15px}
      h2{margin:30px 0 14px;font-size:16px;letter-spacing:.08em;text-transform:uppercase}
      .row{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
      figure{margin:0;width:178px}.sample{height:178px;border-radius:22px;display:grid;place-items:center;box-shadow:0 1px 0 rgba(0,0,0,.08)}
      figcaption{padding-top:9px;color:#555a54;font-size:12px;text-align:center}
      .large figure{width:268px}.large .sample{height:268px}
      svg{display:block;width:100%;height:100%}
      .checker{background-color:#b8bab6;background-image:linear-gradient(45deg,#d9dbd7 25%,transparent 25%),linear-gradient(-45deg,#d9dbd7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d9dbd7 75%),linear-gradient(-45deg,transparent 75%,#d9dbd7 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
    </style>
    <h1>Wren Character-flat release proof</h1>
    <p>One shared contour · flat production palette · optically corrected mono and native-size reductions</p>
    <h2>Primary marks</h2>
    <div class="row large">
      <figure><div class="sample" style="background:#cbc8c0"><div style="width:230px;height:230px">${app}</div></div><figcaption>App icon · 512 source</figcaption></figure>
      <figure><div class="sample checker"><div style="width:230px;height:230px">${color}</div></div><figcaption>Full-color transparent mark</figcaption></figure>
      ${proofTile({ label: 'Mono light · optically centered', background: palette.tile, fill: palette.light, size: 230, symbol: 'wren-silhouette', scale: 0.985, x: -8, y: -51 })}
      ${proofTile({ label: 'Mono dark · optically centered', background: '#f4f1e9', fill: palette.dark, size: 230, symbol: 'wren-silhouette', x: -8, y: -51 })}
    </div>
    <h2>Native-size silhouette checks</h2>
    <div class="row">
      ${proofTile({ label: '48 px · color tray', background: palette.tile, fill: palette.tray, size: 48, symbol: 'wren-silhouette-32', scale: 1.17, y: -42 })}
      ${proofTile({ label: '32 px · hinted', background: palette.tile, fill: palette.light, size: 32, symbol: 'wren-silhouette-32', scale: 1.15245, y: -42 })}
      ${proofTile({ label: '24 px · hinted', background: palette.tile, fill: palette.light, size: 24, symbol: 'wren-silhouette-24', scale: 1.15245, y: -42 })}
      ${proofTile({ label: '16 px · silhouette first', background: palette.tile, fill: palette.light, size: 16, symbol: 'wren-silhouette-16', scale: 1.15245, y: -42 })}
      ${proofTile({ label: '24 px · dark polarity', background: '#f4f1e9', fill: palette.dark, size: 24, symbol: 'wren-silhouette-24', scale: 1.17, y: -42 })}
      ${proofTile({ label: '16 px · dark polarity', background: '#f4f1e9', fill: palette.dark, size: 16, symbol: 'wren-silhouette-16', scale: 1.17, y: -42 })}
    </div>
  `
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 1240, height: 1100, deviceScaleFactor: 1 })
    await page.setContent(html)
    await mkdir(reviewDirectory, { recursive: true })
    await page.screenshot({ path: path.join(reviewDirectory, 'proof-sheet.png'), fullPage: true })
  } finally {
    await page.close()
  }
}

try {
  await mkdir(reviewDirectory, { recursive: true })
  await writeProductionAssets()
  await writeProofSheet()
} finally {
  await browser.close()
}

console.log('Wren brand assets generated')
