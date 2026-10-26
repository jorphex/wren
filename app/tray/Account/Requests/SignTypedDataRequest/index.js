import React from 'react'
import Restore from 'react-restore'

import {
  getTypedDataDeviceWarning,
  SimpleTypedData as TypedSignatureOverview
} from '../../../../../resources/Components/SimpleTypedData'
import { getSignatureRequestClass } from '../../../../../resources/domain/request'
import { getOriginDisplayName } from '../../../../../resources/domain/origin'

export class SignTypedDataRequest extends React.Component {
  render() {
    const { req, signer } = this.props
    const originName = getOriginDisplayName(this.store('main.origins', req.origin, 'name'))
    const requestChainId = req.context?.requestChainId
    const chainName =
      requestChainId !== undefined ? this.store('main.networks.ethereum', requestChainId, 'name') : undefined
    const requestClass = getSignatureRequestClass(req)
    const deviceWarning = getTypedDataDeviceWarning(signer)
    const tokenMetadata = [
      req.account && this.store('main.balances', req.account),
      req.account && this.store('main.tokens.known', req.account),
      this.store('main.tokens.custom')
    ].flatMap((tokens) => (Array.isArray(tokens) ? tokens : []))

    return (
      <div key={req.id || req.handlerId} className={requestClass}>
        <TypedSignatureOverview {...{ chainName, deviceWarning, originName, req, tokenMetadata }} />
      </div>
    )
  }
}

export default Restore.connect(SignTypedDataRequest)
