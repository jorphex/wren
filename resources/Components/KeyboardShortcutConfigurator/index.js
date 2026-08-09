import { useEffect } from 'react'
import hotkeys from 'hotkeys-js'

import link from '../../../resources/link'
import { getShortcutFromKeyEvent, getDisplayShortcut, isShortcutKey } from '../../keyboard'

const EnterShortcut = ({ platform, shortcutName }) => {
  useEffect(() => {
    hotkeys('*', { capture: true }, (event) => {
      event.preventDefault()

      const allowedModifierKeys = ['Meta', 'Alt', 'Control', 'Command']
      const isModifierKey = allowedModifierKeys.includes(event.key)

      // Ignore modifier-only keypresses and disabled keys.
      if (!isModifierKey && isShortcutKey(event)) {
        const newShortcut = getShortcutFromKeyEvent(event, hotkeys.getPressedKeyCodes(), platform)
        link.send('tray:action', 'setShortcut', shortcutName, {
          ...newShortcut,
          configuring: false,
          enabled: true
        })
      }

      return false
    })

    return () => hotkeys.unbind()
  }, [platform, shortcutName])

  const labelId = `shortcut-${shortcutName.toLowerCase()}-configure`
  return (
    <div style={{ display: 'flex' }}>
      <label id={labelId}>Press a new keyboard shortcut</label>
      <div className='loaderWrap'>
        <div className='loader' />
      </div>
    </div>
  )
}

const DisplayShortcut = ({ actionText, modifierKeys, shortcutKey, shortcutName }) => {
  const labelId = `shortcut-${shortcutName.toLowerCase()}-display`
  return (
    <>
      <label id={labelId}>To {actionText}, press</label>

      <span className='keyCommand' aria-labelledby={labelId}>
        {[...modifierKeys, shortcutKey].map((displayKey, index, displayKeys) =>
          index === displayKeys.length - 1 ? (
            displayKey
          ) : (
            <span key={index}>
              {displayKey}
              <span style={{ padding: '0px 3px' }}>+</span>
            </span>
          )
        )}
      </span>
    </>
  )
}

const KeyboardShortcutConfigurator = ({ actionText = '', platform, shortcut, shortcutName }) => {
  const { modifierKeys, shortcutKey } = getDisplayShortcut(platform, shortcut)

  return (
    <span>
      {shortcut.configuring ? (
        <EnterShortcut platform={platform} shortcutName={shortcutName} />
      ) : (
        <DisplayShortcut
          actionText={actionText}
          modifierKeys={modifierKeys}
          shortcutKey={shortcutKey}
          shortcutName={shortcutName}
        />
      )}
    </span>
  )
}

export default KeyboardShortcutConfigurator
