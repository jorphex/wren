import React from 'react'
import Restore from 'react-restore'
import link from '../link'

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
                className='windowsControlsButton'
                aria-label='Minimize window'
                onClick={this.handleMin}
              >
                <svg aria-hidden='true' focusable='false' width='11' height='1' viewBox='0 0 11 1'>
                  <path d='m11 0v1h-11v-1z' />
                </svg>
              </button>
              {maximized || fullscreen ? (
                <button
                  type='button'
                  className='windowsControlsButton'
                  aria-label='Restore window'
                  onClick={this.handleUnmax}
                >
                  <svg aria-hidden='true' focusable='false' width='11' height='11' viewBox='0 0 11 11'>
                    <path d='m11 8.7978h-2.2021v2.2022h-8.7979v-8.7978h2.2021v-2.2022h8.7979zm-3.2979-5.5h-6.6012v6.6011h6.6012zm2.1968-2.1968h-6.6012v1.1011h5.5v5.5h1.1011z' />
                  </svg>
                </button>
              ) : (
                <button
                  type='button'
                  className='windowsControlsButton'
                  aria-label='Maximize window'
                  onClick={this.handleMax}
                >
                  <svg aria-hidden='true' focusable='false' width='10' height='10' viewBox='0 0 10 10'>
                    <path d='m10-1.6667e-6v10h-10v-10zm-1.001 1.001h-7.998v7.998h7.998z' />
                  </svg>
                </button>
              )}
              <button
                type='button'
                className='windowsControlsButton'
                aria-label='Close window'
                onClick={this.handleClose}
              >
                <svg aria-hidden='true' focusable='false' width='12' height='12' viewBox='0 0 12 12'>
                  <path d='m6.8496 6 5.1504 5.1504-0.84961 0.84961-5.1504-5.1504-5.1504 5.1504-0.84961-0.84961 5.1504-5.1504-5.1504-5.1504 0.84961-0.84961 5.1504 5.1504 5.1504-5.1504 0.84961 0.84961z' />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className='linuxGrab' />
            <div className='linuxControls'>
              <button
                type='button'
                className='linuxControlsButton'
                aria-label='Minimize window'
                onClick={this.handleMin}
              >
                <svg
                  aria-hidden='true'
                  focusable='false'
                  className='linuxControlsMin'
                  width='11'
                  height='1'
                  viewBox='0 0 11 1'
                >
                  <path d='m11 0v1h-11v-1z' />
                </svg>
              </button>
              {maximized || fullscreen ? (
                <button
                  type='button'
                  className='linuxControlsButton'
                  aria-label='Restore window'
                  onClick={this.handleUnmax}
                >
                  <svg
                    aria-hidden='true'
                    focusable='false'
                    className='linuxControlsMax'
                    width='11'
                    height='11'
                    viewBox='0 0 11 11'
                  >
                    <path d='m11 8.7978h-2.2021v2.2022h-8.7979v-8.7978h2.2021v-2.2022h8.7979zm-3.2979-5.5h-6.6012v6.6011h6.6012zm2.1968-2.1968h-6.6012v1.1011h5.5v5.5h1.1011z' />
                  </svg>
                </button>
              ) : (
                <button
                  type='button'
                  className='linuxControlsButton'
                  aria-label='Maximize window'
                  onClick={this.handleMax}
                >
                  <svg
                    aria-hidden='true'
                    focusable='false'
                    className='linuxControlsMax'
                    width='10'
                    height='10'
                    viewBox='0 0 10 10'
                  >
                    <path d='m10-1.6667e-6v10h-10v-10zm-1.001 1.001h-7.998v7.998h7.998z' />
                  </svg>
                </button>
              )}
              <button
                type='button'
                className='linuxControlsButton'
                aria-label='Close window'
                onClick={this.handleClose}
              >
                <svg
                  aria-hidden='true'
                  focusable='false'
                  className='linuxControlsClose'
                  width='12'
                  height='12'
                  viewBox='0 0 12 12'
                >
                  <path d='m6.8496 6 5.1504 5.1504-0.84961 0.84961-5.1504-5.1504-5.1504 5.1504-0.84961-0.84961 5.1504-5.1504-5.1504-5.1504 0.84961-0.84961 5.1504 5.1504 5.1504-5.1504 0.84961 0.84961z' />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    )
  }
}

export default Restore.connect(NativeControls)
