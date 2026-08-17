import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer'

const root = process.cwd()
const masterPath = path.join(root, 'asset/brand/wren-mark.svg')
const grainPath = path.join(root, 'resources/svg/wren-grain.svg')
const socialHeaderSourcePath = path.join(root, 'asset/social/source/wren-night-rounds-v1.png')
const reviewDirectory = path.join(root, 'asset/review/wren-brand-release-v1')
const socialDirectory = path.join(root, 'asset/social')
const master = await readFile(masterPath, 'utf8')
const grain = await readFile(grainPath, 'utf8')
const socialHeaderSource = await readFile(socialHeaderSourcePath)
const defs = master.match(/<defs>([\s\S]*?)<\/defs>/)?.[1]
const grainDataUrl = `data:image/svg+xml;base64,${Buffer.from(grain).toString('base64')}`
const socialHeaderSourceDataUrl = `data:image/png;base64,${socialHeaderSource.toString('base64')}`

if (!defs) throw new Error(`Could not read vector definitions from ${masterPath}`)

const palette = {
  tile: '#141313',
  tray: '#c07b45',
  light: '#e7eee8',
  dark: '#10130f',
  canvas: '#090c0a',
  elevated: '#141a16',
  panel: '#171d19',
  accent: '#a68a61'
}
const appMarkScale = 1.2

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })

const svg = ({ content, viewBox = '0 0 1000 1000', extraDefs = '' }) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
    <defs>${defs}${extraDefs}</defs>
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

const appIcon = () => {
  const markOffset = (1000 - 1000 * appMarkScale) / 2
  return svg({
    content: `<rect x="16" y="16" width="968" height="968" rx="214" fill="${palette.tile}" /><g transform="translate(${markOffset} ${markOffset}) scale(${appMarkScale})"><use href="#wren-color" /></g>`
  })
}

const socialTextureDefs = ({ gradientId, centerX, centerY }) => `
  <radialGradient id="${gradientId}" cx="${centerX}" cy="${centerY}" r="72%">
    <stop offset="0" stop-color="${palette.panel}" />
    <stop offset="0.52" stop-color="${palette.elevated}" />
    <stop offset="1" stop-color="${palette.canvas}" />
  </radialGradient>
  <radialGradient id="wren-social-glow" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.1" />
    <stop offset="1" stop-color="${palette.accent}" stop-opacity="0" />
  </radialGradient>
  <pattern id="wren-social-grain" width="144" height="144" patternUnits="userSpaceOnUse">
    <image href="${grainDataUrl}" width="144" height="144" />
  </pattern>
`

const socialAvatar = () =>
  svg({
    viewBox: '0 0 400 400',
    extraDefs: socialTextureDefs({ gradientId: 'wren-avatar-field', centerX: '50%', centerY: '44%' }),
    content: `
      <rect width="400" height="400" fill="${palette.canvas}" />
      <rect width="400" height="400" fill="url(#wren-avatar-field)" />
      <ellipse cx="200" cy="190" rx="175" ry="155" fill="url(#wren-social-glow)" />
      <rect width="400" height="400" fill="url(#wren-social-grain)" />
      <g transform="translate(20 22) scale(0.36)"><use href="#wren-color" /></g>
    `
  })

const socialHeader = () =>
  svg({
    viewBox: '0 0 1500 500',
    content: `
      <image href="${socialHeaderSourceDataUrl}" width="1500" height="500" preserveAspectRatio="xMidYMid slice" />
    `
  })

const render = async (source, outputPath, width, height = width) => {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
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
    ['LinuxTray.png', 24, palette.light, 'wren-silhouette-16', 1.28, -42, -10],
    ['LinuxTray@2x.png', 48, palette.light, 'wren-silhouette-16', 1.28, -42, -10]
  ]

  for (const [name, size, fill, symbol, scale, y, x = 0] of trayAssets) {
    await render(mark({ fill, symbol, scale, x, y }), path.join(root, 'main/windows', name), size)
  }

  await render(socialAvatar(), path.join(socialDirectory, 'wren-profile-400.png'), 400)
  await render(socialHeader(), path.join(socialDirectory, 'wren-x-header-1500x500.png'), 1500, 500)
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
  const avatar = socialAvatar()
  const header = socialHeader()
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
      .social-avatar{width:178px;height:178px;border-radius:50%;overflow:hidden;box-shadow:0 1px 0 rgba(0,0,0,.18)}
      .social-header{width:720px}.social-header .sample{width:720px;height:240px;position:relative;overflow:hidden;background:${palette.canvas}}
      .social-header-preview{width:720px;height:240px}
      .crop-guide{position:absolute;left:0;right:0;height:29px;background:rgba(166,138,97,.08);border-color:rgba(166,138,97,.28);pointer-events:none}
      .crop-guide.top{top:0;border-bottom:1px dashed}.crop-guide.bottom{bottom:0;border-top:1px dashed}
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
      ${proofTile({ label: '16 px · Linux panel', background: palette.tile, fill: palette.light, size: 16, symbol: 'wren-silhouette-16', scale: 1.28, x: -10, y: -42 })}
      ${proofTile({ label: '24 px · dark polarity', background: '#f4f1e9', fill: palette.dark, size: 24, symbol: 'wren-silhouette-24', scale: 1.17, y: -42 })}
      ${proofTile({ label: '16 px · dark polarity', background: '#f4f1e9', fill: palette.dark, size: 16, symbol: 'wren-silhouette-16', scale: 1.17, y: -42 })}
    </div>
    <h2>Social surfaces</h2>
    <div class="row">
      <figure><div class="social-avatar">${avatar}</div><figcaption>400 px profile · circular crop</figcaption></figure>
      <figure class="social-header"><div class="sample"><div class="social-header-preview">${header}</div><div class="crop-guide top"></div><div class="crop-guide bottom"></div></div><figcaption>1500 × 500 X header · possible crop area shown</figcaption></figure>
    </div>
  `
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 1240, height: 1380, deviceScaleFactor: 1 })
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
