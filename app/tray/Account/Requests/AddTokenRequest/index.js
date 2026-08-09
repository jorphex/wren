import React from 'react'
import Restore from 'react-restore'
import {
  LightweightRequest,
  RequestFact,
  RequestFactGrid,
  RequestNote,
  RequestPermission,
  RequestSection
} from '../LightweightRequest'

const shortAddress = (address = '') =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address

export class AddTokenRequest extends React.Component {
  render() {
    const { chainData = {}, originName = 'Unknown origin', req } = this.props
    const { token } = req
    const symbol = (token.symbol || '').toUpperCase()
    const tokenName = token.name || symbol || 'Unknown token'
    const chainName = chainData.chainName || `Chain ${token.chainId}`

    return (
      <LightweightRequest
        req={req}
        icon='tokens'
        eyebrow='Token suggestion'
        title={`Add ${symbol || tokenName} to your token list?`}
        help='The site supplied this token identity. Compare the contract with a source you trust.'
      >
        <RequestSection title='Token details'>
          <RequestFactGrid>
            <RequestFact label='Token' value={symbol ? `${tokenName} · ${symbol}` : tokenName} />
            <RequestFact label='Network' value={`${chainName} · ${token.chainId}`} />
            <RequestFact
              label='Contract'
              value={token.address}
              displayValue={shortAddress(token.address)}
              copyLabel='Copy proposed token contract'
            />
            <RequestFact label='Decimals' value={String(token.decimals)} technical={true} />
            <RequestFact label='Requested by' value={originName} technical={true} />
          </RequestFactGrid>
          <RequestNote icon='alert' warning={true}>
            <strong>Token names and symbols can be copied.</strong> The contract address is the token’s
            reliable identity.
          </RequestNote>
        </RequestSection>
        <RequestSection title='What happens next'>
          <div className='lightweightRequestPermissionList'>
            <RequestPermission
              icon='settings'
              title='Review the full token entry in Wren'
              detail='Nothing is added until you confirm it in the token editor.'
            />
          </div>
        </RequestSection>
      </LightweightRequest>
    )
  }
}

export default Restore.connect(AddTokenRequest)
