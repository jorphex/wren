import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

export class Menu extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      glitchOnSend: false,
      glitchOnSidebar: false
    }
  }
  componentWillUnmount() {
    clearTimeout(this.clickTimer)
  }
  glitch(el, on) {
    return (
      <div className={on ? 'glitch glitchOn' : 'glitch'}>
        {[...Array(10).keys()].map((i) => (
          <div key={i + 'hg'} className='line'>
            {el}
          </div>
        ))}
        {!on ? <div className='line lastLine'>{el}</div> : null}
      </div>
    )
  }
  render() {
    return (
      <div className='panelMenu'>
        <button
          type='button'
          className={'panelMenuItem panelMenuItemOpen'}
          aria-label='Open dashboard'
          onClick={() => {
            this.setState({ glitchOnSidebar: false })
            link.send('tray:action', 'setDash', {
              showing: !this.store('windows.dash.showing')
            })
          }}
          onMouseEnter={() => this.setState({ glitchOnSidebar: true })}
          onMouseOver={() => this.setState({ glitchOnSidebar: true })}
          onMouseLeave={() => this.setState({ glitchOnSidebar: false })}
        >
          {this.glitch(<Icon name='sidebar' size={15} />, this.state.glitchOnSidebar)}
        </button>
        <button
          type='button'
          className={'panelMenuItem panelMenuItemSend'}
          aria-label='Open Wren Send'
          onClick={() => {
            clearTimeout(this.clickTimer)
            this.clickTimer = setTimeout(() => {
              this.setState({ glitchOnSend: false })
              link.send('*:addFrame', 'dappLauncher')
              link.send('tray:action', 'setDash', { showing: false })
            }, 50)
          }}
          onMouseEnter={() => this.setState({ glitchOnSend: true })}
          onMouseOver={() => this.setState({ glitchOnSend: true })}
          onMouseLeave={() => this.setState({ glitchOnSend: false })}
        >
          {this.glitch(<Icon name='send' size={15} />, this.state.glitchOnSend)}
        </button>
      </div>
    )
  }
}

export default Restore.connect(Menu)
