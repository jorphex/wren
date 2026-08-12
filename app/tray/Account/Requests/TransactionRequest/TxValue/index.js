import React from 'react'
import Restore from 'react-restore'
import { BigNumber } from 'bignumber.js'

import link from '../../../../../../resources/link'
import { DisplayValue } from '../../../../../../resources/Components/DisplayValue'
import {
  Cluster,
  ClusterRow,
  ClusterStatus,
  ClusterValue
} from '../../../../../../resources/Components/Cluster'
import AddressIdentity from '../../../../../../resources/Components/AddressIdentity'
import { addressSafetyTarget } from '../../../../../../resources/Components/AddressSafetyStatus'
import { resolveLocalAddressIdentity } from '../../../../../../resources/domain/addressBook/identity'
import { getAddress } from '../../../../../../resources/utils'

export class TxSending extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      copied: false
    }
  }

  copyAddress(data) {
    link.send('tray:clipboardData', data)
    this.setState({ copied: true })
    clearTimeout(this.copyTimer)
    this.copyTimer = setTimeout(() => this.setState({ copied: false }), 1000)
  }

  componentWillUnmount() {
    clearTimeout(this.copyTimer)
  }

  render() {
    const req = this.props.req
    const value = req.data.value || '0x'
    if (BigNumber(value).isZero()) {
      return null
    }

    const address = req.data.to ? getAddress(req.data.to) : ''
    const ensName = req.recipient && req.recipient.length < 25 ? req.recipient : ''
    const localIdentity = address
      ? resolveLocalAddressIdentity(this.store('main.addressBook'), this.store('main.accounts'), address)
      : undefined
    const isTestnet = this.store('main.networks', this.props.chain.type, this.props.chain.id, 'isTestnet')
    const {
      nativeCurrency,
      nativeCurrency: { symbol: currentSymbol = '?' }
    } = this.store('main.networksMeta', this.props.chain.type, this.props.chain.id)
    const chainName = this.store('main.networks.ethereum', this.props.chain.id, 'name')

    return (
      <div className='_txMain' style={{ animationDelay: 0.1 * this.props.i + 's' }}>
        <div className='_txMainInner'>
          <div className='_txLabel'>
            <div>{`Send ${currentSymbol}`}</div>
          </div>
          <Cluster>
            <ClusterRow>
              <ClusterValue grow={2}>
                <div className='txSendingValue'>
                  <DisplayValue type='ether' value={value} currencySymbol={currentSymbol} />
                </div>
              </ClusterValue>
              <ClusterValue>
                <span className='_txMainTransferringEq'>{isTestnet ? '=' : '≈'}</span>
                <DisplayValue
                  type='fiat'
                  value={value}
                  valueDataParams={{ currencyRate: nativeCurrency.usd, isTestnet }}
                  currencySymbol='$'
                />
              </ClusterValue>
            </ClusterRow>

            {address && req.recipientType === 'contract' ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag'>{`to contract on ${chainName}`}</div>
                </ClusterValue>
              </ClusterRow>
            ) : address ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag'>{`to account on ${chainName}`}</div>
                </ClusterValue>
              </ClusterRow>
            ) : null}

            {address && (
              <ClusterRow>
                <ClusterValue
                  ariaLabel='Copy transfer recipient address'
                  pointerEvents={true}
                  onClick={() => {
                    this.copyAddress(address)
                  }}
                >
                  <div className='clusterAddress'>
                    <AddressIdentity
                      address={address}
                      complete={true}
                      copied={this.state.copied}
                      emphasizeEnds={addressSafetyTarget(req.addressSafety, address)?.state === 'lookalike'}
                      label={localIdentity?.label || ensName}
                      revealOnHover={false}
                      source={localIdentity?.source || (ensName ? 'ENS' : '')}
                    />
                  </div>
                </ClusterValue>
                <ClusterStatus>{this.state.copied ? 'Transfer recipient address copied' : ''}</ClusterStatus>
              </ClusterRow>
            )}
          </Cluster>
        </div>
      </div>
    )
  }
}

export default Restore.connect(TxSending)
