import React, { useState, useEffect } from 'react'

import onboardingAccess from 'url:../../../../../asset/ui/onboarding-access-v2.png'
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
      setTitle('Wren when you need it')
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
    <Slide $background={onboardingAccess}>
      {trayOpen && !shortcutActivated ? (
        <SlideBody key={1}>
          <SlideItem>
            Keep Wren close without keeping it in the way. One shortcut opens or dismisses the wallet.
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
            When you are done, auto-hide moves Wren aside. Your shortcut keeps it within reach.
          </SlideItem>
        </SlideBody>
      )}
    </Slide>
  )
}

export default Access
