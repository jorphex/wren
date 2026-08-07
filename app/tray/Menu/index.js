import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

export class Menu extends React.Component {
  componentWillUnmount() {
    clearTimeout(this.clickTimer)
  }
  render() {
    return (
      <div className='panelMenu'>
        <button
          type='button'
          className={'panelMenuItem panelMenuItemOpen'}
          aria-label='Open dashboard'
          onClick={() => {
            link.send('tray:action', 'setDash', {
              showing: !this.store('windows.dash.showing')
            })
          }}
        >
          <Icon name='sidebar' size={19} />
        </button>
        <button
          type='button'
          className={'panelMenuItem panelMenuItemSend'}
          aria-label='Open Wren Send'
          onClick={() => {
            clearTimeout(this.clickTimer)
            this.clickTimer = setTimeout(() => {
              link.send('*:addFrame', 'dappLauncher')
              link.send('tray:action', 'setDash', { showing: false })
            }, 50)
          }}
        >
          <Icon name='send' size={19} />
        </button>
      </div>
    )
  }
}

export default Restore.connect(Menu)
