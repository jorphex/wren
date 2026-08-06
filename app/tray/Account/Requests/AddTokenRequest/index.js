import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../resources/Components/Icon'
import { getOriginDisplayName } from '../../../../../resources/domain/origin'

class AddTokenRequest extends React.Component {
  render() {
    const status = this.props.req.status
    const notice = this.props.req.notice

    let requestClass = 'signerRequest'
    if (status === 'success') requestClass += ' signerRequestSuccess'
    if (status === 'declined') requestClass += ' signerRequestDeclined'
    if (status === 'pending') requestClass += ' signerRequestPending'
    if (status === 'error') requestClass += ' signerRequestError'

    const originName = getOriginDisplayName(this.store('main.origins', this.props.req.origin, 'name'))
    let originClass = 'requestTokenOrigin'
    if (originName.length > 28) originClass = 'requestTokenOrigin requestTokenOrigin18'
    if (originName.length > 36) originClass = 'requestTokenOrigin requestTokenOrigin12'

    const mode = this.props.req.mode
    const height = mode === 'monitor' ? '80px' : '340px'
    const token = this.props.req.token
    return (
      <div
        key={this.props.req.id || this.props.req.handlerId}
        className={requestClass}
        style={{ transform: `translateY(${this.props.pos}px)`, height }}
      >
        <div className='approveRequest'>
          {notice ? (
            <div className='requestNotice'>
              {((_) => {
                if (status === 'pending') {
                  return (
                    <div className='requestNoticeInner scaleIn'>
                      <div>
                        <div className='loader' />
                      </div>
                    </div>
                  )
                } else if (status === 'success') {
                  return (
                    <div className='requestNoticeInner scaleIn'>
                      <Icon name='check' size={80} />
                    </div>
                  )
                } else if (status === 'error' || status === 'declined') {
                  return (
                    <div className='requestNoticeInner scaleIn'>
                      <Icon name='blocked' size={80} />
                    </div>
                  )
                }
              })()}
            </div>
          ) : (
            <div className='approveTransactionPayload'>
              {
                <div className='approveRequestHeader approveTransactionHeader'>
                  <div className='approveRequestHeaderIcon'>
                    <Icon name='permissions' size={20} />
                  </div>
                  <div className='approveRequestHeaderLabel'> Add Token</div>
                </div>
              }
              <div className='requestToken scaleIn'>
                <div className='requestTokenInner'>
                  <div className={originClass}>{originName}</div>
                  <div className={'requestTokenOriginSub'}>{'wants to add a token'}</div>
                  <div className='requestTokenInfo'>
                    <div className='requestTokenSymbol'>{token.symbol.toUpperCase()}</div>
                    <div className='requestTokenName'>{token.name}</div>
                    <div className='requestTokenAddress'>{token.address}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
}

export default Restore.connect(AddTokenRequest)
