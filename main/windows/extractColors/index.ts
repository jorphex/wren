import log from 'electron-log'
import { BrowserWindow, WebContentsView } from 'electron'

import { createViewInstance } from '../window'
import pixelColor from './pixelColor'

async function getColor(view: WebContentsView) {
  const image = await view.webContents.capturePage()
  return pixelColor(image)
}

function extractSession(l: string) {
  const url = new URL(l)
  const session = url.searchParams.get('session') || ''
  const ens = url.port === '8421' ? url.hostname.replace('.localhost', '') || '' : ''
  return { session, ens }
}

async function extractColors(url: string, ens: string) {
  let window: BrowserWindow | null = new BrowserWindow({
    x: 0,
    y: 0,
    width: 800,
    height: 800,
    show: false,
    focusable: false,
    frame: false,
    titleBarStyle: 'hidden',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
      defaultEncoding: 'utf-8',
      nodeIntegration: false,
      scrollBounce: true,
      navigateOnDragDrop: false,
      disableBlinkFeatures: 'Auxclick',
      backgroundThrottling: false,
      offscreen: true
    }
  })

  let view: WebContentsView | null = createViewInstance(ens, { offscreen: true })

  view.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    if (!details || !details.frame) return cb({ cancel: true }) // Reject the request

    // Block any dapp requests to Wren during color extraction.
    if (details.url.includes('127.0.0.1:1248') || details.url.includes('localhost:1248')) {
      return cb({ cancel: true })
    }

    return cb({ requestHeaders: details.requestHeaders }) // Leave untouched
  })

  window.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 800 })

  const { session } = extractSession(url)

  try {
    await view.webContents.session.cookies.set({
      url: url,
      name: '__frameSession',
      value: session
    })

    await view.webContents.loadURL(url)

    const color = await getColor(view)

    return color
  } catch (e) {
    log.error(`error extracting colors for ${ens}`, e)
  } finally {
    if (view) {
      if (window) window.contentView.removeChildView(view)
      view.webContents.close({ waitForBeforeUnload: false })

      view = null
    }

    if (window) {
      window.destroy()
      window = null
    }
  }

  return undefined
}

export default extractColors
