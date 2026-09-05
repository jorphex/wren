import React from 'react'
import Restore from 'react-restore'
import {
  LightweightRequest,
  RequestFact,
  RequestFactGrid,
  RequestNote,
  RequestSection
} from '../LightweightRequest'

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
      >
        <RequestSection title='Token details'>
          <RequestFactGrid>
            <RequestFact label='Token' value={symbol ? `${tokenName} · ${symbol}` : tokenName} />
            <RequestFact label='Network' value={`${chainName} · ${token.chainId}`} />
            <RequestFact label='Contract' value={token.address} copyLabel='Copy proposed token contract' />
            <RequestFact label='Decimals' value={String(token.decimals)} technical={true} />
            <RequestFact label='Requested by' value={originName} technical={true} />
          </RequestFactGrid>
          <RequestNote icon='alert' warning={true}>
            Token identity supplied by the site. Check the contract address.
          </RequestNote>
        </RequestSection>
      </LightweightRequest>
    )
  }
}

export default Restore.connect(AddTokenRequest)
