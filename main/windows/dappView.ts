import { URL } from 'url'
import type { WebContentsView } from 'electron'

import server from '../dapps/server'

export interface DappViewDescriptor {
  id: string
  ready: boolean
  dappId: string
  ens: string
  url: string
}

export const embeddedDappOrigin = (ens: string) => `http://${ens}.localhost:8421`

export const extractDappSession = (location: string) => {
  const url = new URL(location)
  return {
    session: url.searchParams.get('session') || '',
    ens: url.port === '8421' ? url.hostname.replace('.localhost', '') || '' : ''
  }
}

export function loadDappView(viewInstance: WebContentsView, view: DappViewDescriptor, onLoaded: () => void) {
  const { session } = extractDappSession(view.url)

  viewInstance.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!details || !details.frame) return callback({ cancel: true })

    const appUrl = details.frame.url

    if (details.resourceType === 'mainFrame' && details.url === view.url && !appUrl) {
      return callback({ requestHeaders: details.requestHeaders })
    }
    if (details.url.startsWith('devtools://')) {
      return callback({ requestHeaders: details.requestHeaders })
    }
    if (appUrl !== view.url) return callback({ cancel: true })

    const request = extractDappSession(appUrl)
    if (request.ens !== view.ens || !server.sessions.verify(request.ens, request.session)) {
      return callback({ cancel: true })
    }

    details.requestHeaders['Origin'] = embeddedDappOrigin(view.ens)
    return callback({ requestHeaders: details.requestHeaders })
  })

  viewInstance.webContents.once('did-finish-load', onLoaded)

  return viewInstance.webContents.session.cookies
    .set({
      url: view.url,
      name: '__frameSession',
      value: session
    })
    .then(() => viewInstance.webContents.loadURL(view.url))
}
