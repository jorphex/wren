import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../resources/Components/Icon'

export class ChainRequest extends React.Component {
  render() {
    const { status, notice, chain } = this.props.req
    const origin = this.props.originName || 'Unknown'

    let requestClass = 'signerRequest'
    if (status === 'success') requestClass += ' signerRequestSuccess'
    if (status === 'declined') requestClass += ' signerRequestDeclined'
    if (status === 'pending') requestClass += ' signerRequestPending'
    if (status === 'error') requestClass += ' signerRequestError'

    let originClass = 'requestProviderOrigin'
    if (origin.length > 28) originClass = 'requestProviderOrigin requestProviderOrigin18'
    if (origin.length > 36) originClass = 'requestProviderOrigin requestProviderOrigin12'
    return (
      <div key={this.props.req.id || this.props.req.handlerId} className={requestClass}>
        <div className='approveRequest'>
          {notice ? (
            <div className='requestNotice'>
              {status === 'pending' ? (
                <div className='requestNoticeInner'>
                  <div>
                    <div className='loader' />
                  </div>
                </div>
              ) : status === 'success' ? (
                <div className='requestNoticeInner'>
                  <Icon name='check' size={80} />
                </div>
              ) : status === 'error' || status === 'declined' ? (
                <div className='requestNoticeInner'>
                  <Icon name='blocked' size={80} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className='approveTransactionPayload'>
              <div className='requestChainInner'>
                <div className={originClass}>{origin}</div>
                <div className={'requestChainOriginSub'}>wants to add chain</div>
                <div className='requestChainName'>{chain.name}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
}

export default Restore.connect(ChainRequest)
