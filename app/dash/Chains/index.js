import React from 'react'
import Restore from 'react-restore'

import Chain from './Chain'
import ControlNavigation from '../ControlNavigation'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { safeNetworkMetadata } from '../../../resources/domain/networkMetadata'

export class Settings extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.newNetworkIdDefault = 'ID'
    this.newNetworkNameDefault = 'New Network'
    this.newNetworkExplorerDefault = 'Block Explorer'
    this.newNetworkSymbolDefault = 'ETH'
    this.newNetworkType = 'ethereum'
    this.state = {
      newNetworkId: this.newNetworkIdDefault,
      newNetworkName: this.newNetworkNameDefault,
      newNetworkExplorer: this.newNetworkExplorerDefault,
      newNetworkSymbol: this.newNetworkSymbolDefault,
      newNetworkType: this.newNetworkType,
      localShake: {},
      resetConfirm: false,
      expandNetwork: false,
      findFocus: false,
      findHover: false,
      findInput: '',
      scope: 'active'
    }
  }

  addNetwork = () => {
    link.send('tray:action', 'navDash', { view: 'chains', data: { newChain: {} } })
  }

  renderConnections(testnetsOnly = false) {
    const nets = []
    const networks = this.store('main.networks')
    const metadata = this.store('main.networksMeta')
    const { filter } = this.state

    Object.keys(networks).forEach((type) => {
      nets.push(
        <div key={type}>
          {Object.keys(networks[type])
            .map((id) => parseInt(id))
            .sort((a, b) => a - b)
            .filter((id) => networks[type][id].isTestnet === testnetsOnly)
            .filter((id) => this.state.scope === 'all' || networks[type][id].on)
            .sort((a, b) => {
              const aOn = networks[type][a].on
              const bOn = networks[type][b].on
              return (aOn && bOn) || (!aOn && !bOn) ? 0 : aOn && !bOn ? -1 : 1
            })
            .map((id) => {
              const key = type + id
              const { explorer, isTestnet, connection, on, name } = networks[type][id]
              const {
                nativeCurrency: { symbol, name: nativeCurrencyName, icon: nativeCurrencyIcon },
                icon
              } = safeNetworkMetadata(metadata?.[type]?.[id], networks[type][id])
              const chain = {
                id,
                type,
                symbol,
                explorer,
                isTestnet,
                connection,
                on,
                filter,
                name,
                nativeCurrencyName,
                nativeCurrencyIcon,
                icon
              }
              return <Chain key={key} {...chain} compact view={'preview'} />
            })}
        </div>
      )
    })
    return nets
  }

  renderChains() {
    const networks = this.store('main.networks')
    const allNetworks = Object.values(networks).flatMap((typeNetworks) => Object.values(typeNetworks))
    const visibleNetworks = allNetworks.filter((network) => this.state.scope === 'all' || network.on)
    const visibleTestnets = visibleNetworks.some((network) => network.isTestnet)
    const counts = {
      accounts: Object.keys(this.store('main.accounts') || {}).length,
      networks: allNetworks.filter((network) => network.on).length,
      dapps: Object.keys(this.store('main.origins') || {}).length
    }

    return (
      <div key={'chainList'} className='localSettings dashNetworksPerch cardShow'>
        <div className='localSettingsWrap'>
          <ControlNavigation counts={counts} current='chains' replace />
          <section className='dashHomeCard dashNetworksCard' aria-labelledby='dash-networks-title'>
            <div className='dashNetworksCardHeader'>
              <h2 id='dash-networks-title'>{this.state.scope === 'active' ? 'Connected' : 'Networks'}</h2>
              <div className='dashNetworkScopeControls' role='group' aria-label='Network scope'>
                {[
                  ['all', 'All'],
                  ['active', 'Active']
                ].map(([scope, label]) => (
                  <button
                    type='button'
                    aria-pressed={this.state.scope === scope}
                    className={
                      this.state.scope === scope
                        ? 'dashNetworkScopeButton dashNetworkScopeButtonSelected'
                        : 'dashNetworkScopeButton'
                    }
                    key={scope}
                    onClick={() => this.setState({ scope })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type='button'
                className='dashNetworksAdd wrenControl wrenControlGhost'
                onClick={this.addNetwork}
              >
                <Icon name='add' size={15} />
                <span>Add</span>
              </button>
            </div>
            <div className='dashNetworksLedger'>
              {this.renderConnections()}
              {visibleTestnets ? (
                <div className='networkBreak'>
                  <div className='networkBreakLayer'>Testnets</div>
                </div>
              ) : null}
              {visibleTestnets ? this.renderConnections(true) : null}
            </div>
          </section>
        </div>
      </div>
    )
  }

  renderChain(chain) {
    const { id, type } = chain
    const networks = this.store('main.networks')
    const metadata = this.store('main.networksMeta')
    const network = networks?.[type]?.[id]
    if (!network) return null
    const networkMetadata = safeNetworkMetadata(metadata?.[type]?.[id], network)
    return (
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <Chain
            key={type + id}
            id={id}
            name={network.name}
            symbol={networkMetadata.nativeCurrency.symbol}
            explorer={network.explorer}
            isTestnet={network.isTestnet}
            type={type}
            connection={network.connection}
            on={network.on}
            nativeCurrencyName={networkMetadata.nativeCurrency.name}
            nativeCurrencyDecimals={networkMetadata.nativeCurrency.decimals}
            nativeCurrencyIcon={networkMetadata.nativeCurrency.icon}
            icon={networkMetadata.icon}
            view={'expanded'}
          />
        </div>
      </div>
    )
  }

  renderNewChain(newChain, requestReference) {
    return (
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <Chain
            key={newChain.type + newChain.id}
            id={newChain.id}
            name={newChain.name}
            symbol={newChain.symbol}
            explorer={newChain.explorer}
            isTestnet={newChain.isTestnet}
            type={newChain.type}
            rpcUrls={newChain.rpcUrls}
            nativeCurrencyName={newChain.nativeCurrencyName}
            nativeCurrencyIcon={newChain.nativeCurrencyIcon}
            icon={newChain.icon}
            nativeCurrencyDecimals={newChain.nativeCurrencyDecimals}
            requestReference={requestReference}
            view={'setup'}
          />
        </div>
      </div>
    )
  }

  render() {
    const { selectedChain, newChain, requestReference } = this.props.data
    if (selectedChain) {
      return this.renderChain(selectedChain)
    } else if (newChain) {
      return this.renderNewChain(newChain, requestReference)
    } else {
      return this.renderChains()
    }
  }
}

export default Restore.connect(Settings)
