import React from 'react'
import Restore from 'react-restore'
import link from '../link'
import Icon from '../Components/Icon'

export class NativeControls extends React.Component {
  handleClose() {
    link.send('frame:close')
  }

  handleMin() {
    link.send('frame:min')
  }

  handleMax() {
    link.send('frame:max')
  }

  handleUnmax() {
    link.send('frame:unmax')
  }

  render() {
    const platform = this.store('platform')
    const { fullscreen, maximized } = this.store('main.frames', window.frameId)
    return (
      <div className='nativeControls'>
        {platform === 'darwin' ? (
          <>
            <div className='macGrab' />
            <div className='macControls'></div>
          </>
        ) : platform === 'win32' ? (
          <>
            <div className='windowsGrab' />
            <div className='windowsControls'>
              <button
                type='button'
                className='windowsControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                aria-label='Minimize window'
                onClick={this.handleMin}
              >
                <Icon name='minimize' size={14} />
              </button>
              {maximized || fullscreen ? (
                <button
                  type='button'
                  className='windowsControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                  aria-label='Restore window'
                  onClick={this.handleUnmax}
                >
                  <Icon name='restore' size={14} />
                </button>
              ) : (
                <button
                  type='button'
                  className='windowsControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                  aria-label='Maximize window'
                  onClick={this.handleMax}
                >
                  <Icon name='maximize' size={14} />
                </button>
              )}
              <button
                type='button'
                className='windowsControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                aria-label='Close window'
                onClick={this.handleClose}
              >
                <Icon name='close' size={14} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className='linuxGrab' />
            <div className='linuxControls'>
              <button
                type='button'
                className='linuxControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                aria-label='Minimize window'
                onClick={this.handleMin}
              >
                <Icon name='minimize' size={14} />
              </button>
              {maximized || fullscreen ? (
                <button
                  type='button'
                  className='linuxControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                  aria-label='Restore window'
                  onClick={this.handleUnmax}
                >
                  <Icon name='restore' size={14} />
                </button>
              ) : (
                <button
                  type='button'
                  className='linuxControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                  aria-label='Maximize window'
                  onClick={this.handleMax}
                >
                  <Icon name='maximize' size={14} />
                </button>
              )}
              <button
                type='button'
                className='linuxControlsButton wrenControl wrenControlSecondary wrenControlChrome'
                aria-label='Close window'
                onClick={this.handleClose}
              >
                <Icon name='close' size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    )
  }
}

export default Restore.connect(NativeControls)
