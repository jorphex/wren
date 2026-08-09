import React from 'react'
import Restore from 'react-restore'

import link from '../../../resources/link'

const sendDappId = '0xe8d705c28f65bc3fe10df8b22f9daa265b99d0e1893b2df49fd38120f0410bca'

export class Send extends React.Component {
  render() {
    const sendDapp = this.store('main.dapps', sendDappId) || {}
    const mainnet = this.store('main.networks.ethereum.1') || {}
    const endpoints = mainnet.connection?.endpoints || []
    const isMainnetConnected = !!mainnet.on && endpoints.some((endpoint) => endpoint.connected)
    const failed = sendDapp.status === 'failed'

    if (!failed) {
      return (
        <div className='sendRouteStatus' aria-label='Loading Send'>
          <div className='loader' />
        </div>
      )
    }

    return (
      <div className='sendRouteStatus'>
        <div className='sendRouteMessage'>
          {isMainnetConnected ? (
            <div>{'Send is unavailable.'}</div>
          ) : (
            <>
              <div>{'Ethereum Mainnet connection required'}</div>
              <div>{'to resolve ENS for Send'}</div>
            </>
          )}
        </div>
        {!isMainnetConnected && (
          <button
            type='button'
            className='wrenControl wrenControlPrimary'
            onClick={() => link.send('tray:action', 'navDash', { view: 'chains', data: {} })}
          >
            View Networks
          </button>
        )}
      </div>
    )
  }
}

export default Restore.connect(Send)
