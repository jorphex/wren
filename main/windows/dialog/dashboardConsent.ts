import { dialog } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'

const documents = new WeakMap<WebContents, object>()
let confirming = false

export function dashboardDocument({ sender, senderFrame }: IpcMainInvokeEvent) {
  if (sender.isDestroyed() || !senderFrame || senderFrame !== sender.mainFrame) return undefined
  let document = documents.get(sender)
  if (!document) {
    document = {}
    documents.set(sender, document)
    sender.once('did-start-loading', () => {
      documents.delete(sender)
    })
  }
  return document
}

export async function confirmDashboardAction(
  event: IpcMainInvokeEvent,
  parent: BrowserWindow | undefined,
  action: { message: string; detail: string; confirm: string }
) {
  const document = dashboardDocument(event)
  if (confirming || !document || !parent || parent.isDestroyed()) return false
  confirming = true
  try {
    const result = await dialog.showMessageBox(parent, {
      type: 'warning',
      title: 'Wren',
      message: action.message,
      detail: action.detail,
      buttons: ['Cancel', action.confirm],
      cancelId: 0,
      defaultId: 0,
      noLink: true
    })
    return result.response === 1 && !parent.isDestroyed() && dashboardDocument(event) === document
  } catch {
    return false
  } finally {
    confirming = false
  }
}
