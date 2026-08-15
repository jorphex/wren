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
      setTitle('Open Wren quickly')
      setProceed({ action: 'skip', text: 'Skip shortcut' })
    } else if (!trayOpen) {
      setTitle('Bring Wren back')
      setProceed({ action: 'skip', text: 'Skip shortcut' })
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
            Use one shortcut to show or hide Wren whenever you need it.
          </SlideItem>
          <SlideItem>
            <span>{'Press '}</span>
            <Shortcut>{keyboardShortcut}</Shortcut>
            <span>{' to hide Wren.'}</span>
          </SlideItem>
        </SlideBody>
      ) : !trayOpen ? (
        <SlideBody key={2}>
          <SlideItem>
            <span>{'Press '}</span>
            <Shortcut>{keyboardShortcut}</Shortcut>
            <span>{' to bring Wren back.'}</span>
          </SlideItem>
        </SlideBody>
      ) : (
        <SlideBody key={3}>
          <SlideItem>
            <span>{'When you stop using Wren, it hides automatically. Press '}</span>
            <Shortcut>{keyboardShortcut}</Shortcut>
            <span>{' to show it again.'}</span>
          </SlideItem>
        </SlideBody>
      )}
    </Slide>
  )
}

export default Access
