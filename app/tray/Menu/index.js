import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

export class Menu extends React.Component {
  render() {
    return (
      <div className='panelMenu'>
        <button
          type='button'
          className='panelMenuItem panelMenuItemOpen wrenControl wrenControlSecondary wrenControlIcon wrenShellNav'
          aria-label='Open dashboard'
          onClick={() => {
            link.send('tray:action', 'setDash', {
              showing: !this.store('windows.dash.showing')
            })
          }}
        >
          <Icon name='sidebar' size={19} />
        </button>
      </div>
    )
  }
}

export default Restore.connect(Menu)
