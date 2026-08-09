import React from 'react'
import Restore from 'react-restore'
import {
  LightweightRequest,
  RequestFact,
  RequestFactGrid,
  RequestNote,
  RequestSection
} from '../LightweightRequest'

export class ChainRequest extends React.Component {
  render() {
    const { req } = this.props
    const { chain } = req
    const originName = this.props.originName || 'Unknown origin'
    const currency = chain.symbol || chain.nativeCurrencyName || 'Unknown'
    const decimals = chain.nativeCurrencyDecimals
    const currencyDisplay = decimals === undefined ? currency : `${currency} · ${decimals} decimals`

    return (
      <LightweightRequest
        req={req}
        icon='network'
        eyebrow='Network proposal'
        title={`Add ${chain.name} to Wren?`}
        help='Inspect the network identity and endpoints before continuing to Wren’s network editor.'
      >
        <RequestSection title='Network details'>
          <RequestFactGrid>
            <RequestFact label='Network' value={chain.name} />
            <RequestFact label='Chain ID' value={String(chain.id)} technical={true} />
            <RequestFact label='Native currency' value={currencyDisplay} />
            <RequestFact label='Requested by' value={originName} technical={true} />
          </RequestFactGrid>
        </RequestSection>
        <RequestSection title='Endpoints'>
          <RequestFactGrid>
            <RequestFact
              label='RPC'
              value={chain.rpcUrls?.[0] || 'Not supplied'}
              copyLabel={chain.rpcUrls?.[0] ? 'Copy proposed RPC endpoint' : undefined}
              technical={true}
            />
            <RequestFact
              label='Block explorer'
              value={chain.explorer || 'Not supplied'}
              copyLabel={chain.explorer ? 'Copy proposed block explorer' : undefined}
              technical={true}
            />
          </RequestFactGrid>
          <RequestNote>
            Nothing is added yet. <strong>Review network</strong> opens Wren’s editor so you can verify and
            save these settings.
          </RequestNote>
        </RequestSection>
      </LightweightRequest>
    )
  }
}

export default Restore.connect(ChainRequest)
