// @ts-expect-error -- getos does not ship declarations compatible with this TypeScript version.
import getos from 'getos'
import path from 'path'
import { app, screen, BrowserWindow, Menu, KeyboardEvent, Rectangle, Tray as ElectronTray } from 'electron'

import { capitalize } from '../../resources/utils'

const isMacOS = process.platform === 'darwin'
let isUbuntu23OrGreater = false

interface LinuxOsInfo {
  dist?: string
  release?: string
}

if (process.platform === 'linux') {
  try {
    getos((error: Error | null, osInfo: LinuxOsInfo) => {
      if (error) {
        console.error('Could not determine Linux version', error)
      } else {
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
  private electronTray?: ElectronTray

  constructor(clickHandlers: SystemTrayEventHandlers) {
    this.clickHandlers = clickHandlers
  }

  init(mainWindow: BrowserWindow) {
    // Electron Tray can only be instantiated when the app is ready
    this.electronTray = new ElectronTray(path.join(__dirname, isMacOS ? './IconTemplate.png' : './Icon.png'))
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
      show: 'Summon'
    }
    const label = menuItemLabelMap[type as keyof typeof menuItemLabelMap]
    const eventName = `click${capitalize(type)}`
    const actionMenuItem: Electron.MenuItemConstructorOptions = {
      label,
      click: () => this.clickHandlers[eventName as keyof typeof this.clickHandlers](),
      toolTip: `${label} Wren`
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
      setTimeout(() => this.electronTray?.setContextMenu(menu), delaySettingContextMenu() ? 200 : 0)
    }
  }

  closeContextMenu() {
    this.electronTray?.closeContextMenu()
  }

  setTitle(title: string) {
    this.electronTray?.setTitle(title)
  }
}
