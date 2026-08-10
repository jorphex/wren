import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../resources/Components/Icon'

class TxBar extends React.Component {
  render() {
    const req = this.props.req
    let position = 0
    let txBarClass = 'txBar'
    let progressIconClass = 'txProgressStepIcon'
    if (req.status === 'pending') position = 1
    else if (req.status === 'sending') position = 2
    else if (req.status === 'verifying') position = 3
    else if (req.status === 'verified') position = 4
    else if (req.status === 'confirming' || req.status === 'confirmed' || req.status === 'sent') {
      position = 4
      progressIconClass += ' txProgressStepIconHidden'
      txBarClass += ' txBarSuccess'
    } else if (req.status === 'error') {
      position = 4
      progressIconClass += ' txProgressStepIconHidden'
      txBarClass += ' txBarError'
    }
    const slideMap = ['375px', '268.5px', '181px', '93.5px', '0px']
    const slide = slideMap[position]

    return (
      <div className={txBarClass}>
        <div className='txProgress'>
          <div className='txProgressBack'>
            <div className='txProgressLine' />
            <div className='txProgressSteps'>
              <div className='txProgressStep'>
                <button
                  type='button'
                  aria-label='Show signing status'
                  aria-hidden={position >= 4 ? 'true' : undefined}
                  className={progressIconClass}
                  disabled={position >= 4}
                  style={{ padding: '10px 11px' }}
                  onClick={() => this.props.infoPane('sign')}
                  onBlur={() => this.props.infoPane('')}
                  onMouseLeave={() => this.props.infoPane('')}
                >
                  <Icon name='sign' size={22} />
                </button>
                <div className='txProgressStepMarker' />
                <div
                  className={
                    position > 1 ? 'txProgressStepCenter txProgressStepCenterOn' : 'txProgressStepCenter'
                  }
                />
              </div>
              <div className='txProgressStep'>
                <button
                  type='button'
                  aria-label='Show broadcast status'
                  aria-hidden={position >= 4 ? 'true' : undefined}
                  className={progressIconClass}
                  disabled={position >= 4}
                  style={{ padding: '11px 12px' }}
                  onClick={() => this.props.infoPane('send')}
                  onBlur={() => this.props.infoPane('')}
                  onMouseLeave={() => this.props.infoPane('')}
                >
                  <Icon name='send' size={15} />
                </button>
                <div className='txProgressStepMarker' />
                <div
                  className={
                    position > 2 ? 'txProgressStepCenter txProgressStepCenterOn' : 'txProgressStepCenter'
                  }
                />
              </div>
              <div className='txProgressStep'>
                <button
                  type='button'
                  aria-label='Show confirmation status'
                  aria-hidden={position >= 4 ? 'true' : undefined}
                  className={progressIconClass}
                  disabled={position >= 4}
                  style={{ padding: '11px 12px' }}
                  onClick={() => this.props.infoPane('block')}
                  onBlur={() => this.props.infoPane('')}
                  onMouseLeave={() => this.props.infoPane('')}
                >
                  <Icon name='check' size={16} />
                </button>
                <div className='txProgressStepMarker' />
                <div
                  className={
                    position > 3 ? 'txProgressStepCenter txProgressStepCenterOn' : 'txProgressStepCenter'
                  }
                />
              </div>
            </div>
          </div>
          <div className='txProgressFront'>
            <div className='txProgressSlide' style={{ right: slide }}>
              <div className='txProgressTail' />
              {position < 4 && (
                <div className='txProgressLoading'>
                  <div className='txProgressLoadingDot' />
                  <div className='txProgressLoadingCenter' />
                  <div className='txProgressLoadingBox' />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(TxBar)
