import getos from 'getos'
import path from 'path'
import { app, screen, BrowserWindow, Menu, KeyboardEvent, Rectangle, Tray as ElectronTray } from 'electron'

import { capitalize } from '../../resources/utils'

const isMacOS = process.platform === 'darwin'
const systemTrayIcon =
  process.platform === 'darwin'
    ? 'IconTemplate.png'
    : process.platform === 'linux'
      ? 'LinuxTray.png'
      : 'Icon.png'
let isUbuntu23OrGreater = false

if (process.platform === 'linux') {
  try {
    getos((error, osInfo) => {
      if (error) {
        console.error('Could not determine Linux version', error)
      } else if (osInfo) {
        if (osInfo.dist === 'Ubuntu' && osInfo.release) {
          const majorVersionText = osInfo.release.split('.')[0]
          if (!majorVersionText) return
          const majorVersion = parseInt(majorVersionText, 10)
          isUbuntu23OrGreater = majorVersion >= 23
        }
      }
    })
  } catch (error) {
    console.error('Could not determine Linux version', error)
  }
}

const delaySettingContextMenu = () => !isMacOS && !isUbuntu23OrGreater

export type SystemTrayEventHandlers = {
  click: () => void
  clickShow: () => void
  clickHide: () => void
}

export class SystemTray {
  private clickHandlers: SystemTrayEventHandlers
  private electronTray: ElectronTray | undefined
  private contextMenuTimeout: NodeJS.Timeout | undefined

  constructor(clickHandlers: SystemTrayEventHandlers) {
    this.clickHandlers = clickHandlers
  }

  init(mainWindow: BrowserWindow) {
    // Electron Tray can only be instantiated when the app is ready
    this.destroy()
    this.electronTray = new ElectronTray(path.join(__dirname, systemTrayIcon))
    this.electronTray.on('click', (_event: KeyboardEvent, bounds: Rectangle) => {
      const mainWindowBounds = mainWindow.getBounds()
      const currentDisplay = screen.getDisplayMatching(bounds)
      const trayClickDisplay = screen.getDisplayMatching(mainWindowBounds)
      if (trayClickDisplay.id !== currentDisplay.id) {
        this.setContextMenu('show', { switchScreen: true })
      }
      this.clickHandlers.click()
    })
  }

  setContextMenu(
    type: string,
    { displaySummonShortcut = false, accelerator = 'Alt+/', switchScreen = false }
  ) {
    const separatorMenuItem = {
      label: 'Wren',
      click: () => {},
      type: 'separator'
    }
    const menuItemLabelMap = {
      hide: 'Dismiss',
      show: 'Show Wren'
    }
    const label = menuItemLabelMap[type as keyof typeof menuItemLabelMap]
    const eventName = `click${capitalize(type)}`
    const actionMenuItem: Electron.MenuItemConstructorOptions = {
      label,
      click: () => this.clickHandlers[eventName as keyof typeof this.clickHandlers](),
      toolTip: label === 'Show Wren' ? label : `${label} Wren`
    }
    const quitMenuItem = {
      label: 'Quit',
      click: () => app.quit()
    }

    if (displaySummonShortcut) {
      actionMenuItem.accelerator = accelerator
      actionMenuItem.registerAccelerator = false
    }

    const menu = Menu.buildFromTemplate([actionMenuItem, separatorMenuItem, quitMenuItem])

    if (switchScreen) {
      this.electronTray?.setContextMenu(menu)
    } else {
      clearTimeout(this.contextMenuTimeout)
      this.contextMenuTimeout = setTimeout(
        () => this.electronTray?.setContextMenu(menu),
        delaySettingContextMenu() ? 200 : 0
      )
    }
  }

  destroy() {
    clearTimeout(this.contextMenuTimeout)
    this.contextMenuTimeout = undefined
    this.electronTray?.destroy()
    this.electronTray = undefined
  }

  closeContextMenu() {
    this.electronTray?.closeContextMenu()
  }

  setTitle(title: string) {
    this.electronTray?.setTitle(title)
  }
}
