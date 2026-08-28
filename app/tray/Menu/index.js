import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

export class Menu extends React.Component {
  render() {
    const workspaceOpen = Boolean(this.store('windows.dash.showing'))

    return (
      <div className='panelMenu'>
        <button
          type='button'
          className='panelMenuItem panelMenuItemOpen panelWorkspaceToggle wrenControl wrenControlGhost wrenControlIcon wrenShellNav'
          aria-label={workspaceOpen ? 'Close dashboard' : 'Open dashboard'}
          aria-pressed={workspaceOpen}
          onClick={() => {
            link.send('tray:action', 'setDash', {
              showing: !workspaceOpen
            })
          }}
        >
          <Icon name={workspaceOpen ? 'panelSplit' : 'panelSingle'} size={19} />
        </button>
      </div>
    )
  }
}

export default Restore.connect(Menu)
