import React from 'react'
import Restore from 'react-restore'
import DialogSurface from '../../../resources/Components/DialogSurface'
import link from '../../../resources/link'

export class Bridge extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.primaryRef = React.createRef()
  }

  badge() {
    return this.store('view.badge') || {}
  }

  dismiss(badge) {
    if (badge.type === 'updateAvailable') {
      link.send('tray:dismissUpdate', badge.version, true)
    } else {
      link.send('tray:action', 'updateBadge', '')
    }
  }

  render() {
    const badge = this.badge()
    const available = badge.type === 'updateAvailable'
    const ready = badge.type === 'updateReady'
    if (!available && !ready) return null

    const versionSubject = badge.version ? `Wren ${badge.version}` : 'The Wren update'
    const heading = available ? 'Update available' : 'Update ready'
    const body = versionSubject

    return (
      <div className='badgeWrap'>
        <DialogSurface
          as='section'
          className='updateDialog cardShow'
          describedBy='wren-update-body'
          initialFocusRef={this.primaryRef}
          key={`${badge.type}:${badge.version || ''}`}
          labelledBy='wren-update-heading'
          modal
          onCancel={() => this.dismiss(badge)}
        >
          <div className='updateDialogCopy'>
            <span className='updateDialogEyebrow'>Wren desktop</span>
            <h2 id='wren-update-heading'>{heading}</h2>
            <p id='wren-update-body'>{body}</p>
          </div>
          <div className='updateDialogActions'>
            <button
              className='wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
              onClick={() =>
                available ? link.send('tray:installAvailableUpdate') : link.send('tray:updateRestart')
              }
              ref={this.primaryRef}
              type='button'
            >
              {available ? 'Get update' : 'Restart and install'}
            </button>
            <button
              className='wrenControl wrenControlSecondary wrenControlLarge'
              onClick={() => this.dismiss(badge)}
              type='button'
            >
              Later
            </button>
          </div>
          {available ? (
            <button
              className='updateDialogSkip wrenControl wrenControlGhost wrenControlCompact'
              onClick={() => link.send('tray:dismissUpdate', badge.version, false)}
              type='button'
            >
              Skip this version
            </button>
          ) : null}
        </DialogSurface>
      </div>
    )
  }
}

export default Restore.connect(Bridge)
