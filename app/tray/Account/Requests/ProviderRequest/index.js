import React from 'react'
import Restore from 'react-restore'
import {
  LightweightRequest,
  RequestFact,
  RequestFactGrid,
  RequestPermission,
  RequestSection
} from '../LightweightRequest'

const shortAddress = (address = '') =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address

export class ProviderRequest extends React.Component {
  render() {
    const { accountName = 'Account', originName = 'Unknown origin', req } = this.props
    const address = req.account || ''

    return (
      <LightweightRequest
        req={req}
        icon='apps'
        eyebrow='Connection request'
        title={`Share ${accountName} with this site?`}
        help='This connects one account. Wren will still ask before every signature or transaction.'
      >
        <RequestSection title='Account being shared'>
          <RequestFactGrid>
            <RequestFact label='Account' value={accountName} />
            <RequestFact label='Scope' value='This account only' />
            <RequestFact
              label='Public address'
              value={address}
              displayValue={shortAddress(address)}
              copyLabel='Copy shared account address'
            />
            <RequestFact label='Site' value={originName} technical={true} />
          </RequestFactGrid>
        </RequestSection>
        <RequestSection title='This site can'>
          <div className='lightweightRequestPermissionList'>
            <RequestPermission
              icon='watch'
              title='See this public account address'
              detail='Balances and activity tied to a public address can be viewed onchain.'
            />
            <RequestPermission
              icon='send'
              title='Ask Wren to sign messages and transactions'
              detail='Each request appears separately for your review.'
            />
          </div>
        </RequestSection>
      </LightweightRequest>
    )
  }
}

export default Restore.connect(ProviderRequest)
