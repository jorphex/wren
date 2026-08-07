import React, { useState, useEffect } from 'react'

import { Slide, SlideBody, SlideItem, Shortcut } from '../../styled'

import link from '../../../../../resources/link'

import { getDisplayShortcut } from '../../../../../resources/keyboard'

const Access = ({ setTitle, setProceed, platform }) => {
  const { modifierKeys, shortcutKey } = getDisplayShortcut(platform, store('main.shortcuts.summon'))
  const keyboardShortcut = modifierKeys.concat(shortcutKey).join(' + ')
  const [shortcutActivated, setShortcutActivated] = useState(false)
  const [trayOpen, setTrayOpen] = useState(store('tray.open'))

  useEffect(() => {
    const handler = (event) => {
      if (event === 'shortcutActivated') setShortcutActivated(true)
    }

    link.send('tray:action', 'navDash', { view: 'settings', data: {} })
    link.on('flex', handler)

    const obs = store.observer(() => {
      setTrayOpen(store('tray.open'))
    })

    return () => {
      link.off('flex', handler)
      obs.remove()
    }
  }, [])

  useEffect(() => {
    if (trayOpen && !shortcutActivated) {
      setTitle('Wren, when you need it')
      setProceed({ action: 'skip', text: 'Skip' })
    } else if (!trayOpen) {
      setTitle('Bring Wren back')
      setProceed({ action: 'skip', text: 'Skip' })
    } else {
      setTitle('Auto-hide')
      setProceed({ action: 'next', text: 'Next' })
    }
  }, [trayOpen, shortcutActivated])

  return (
    <Slide>
      {trayOpen && !shortcutActivated ? (
        <SlideBody key={1}>
          <SlideItem>
            <div>Keep Wren close without keeping it in the way.</div>
            <div>One shortcut opens or dismisses the wallet.</div>
          </SlideItem>
          <SlideItem>
            <span>{'Try dismissing Wren with '}</span>
            <Shortcut>{keyboardShortcut}</Shortcut>
          </SlideItem>
        </SlideBody>
      ) : !trayOpen ? (
        <SlideBody key={2}>
          <SlideItem>
            <span>{'Bring Wren back with '}</span>
            <Shortcut>{keyboardShortcut}</Shortcut>
          </SlideItem>
        </SlideBody>
      ) : (
        <SlideBody key={3}>
          <SlideItem>
            <div>When your work is done, auto-hide moves Wren</div>
            <div>aside. Your shortcut keeps it one step away.</div>
          </SlideItem>
        </SlideBody>
      )}
    </Slide>
  )
}

export default Access
