import React from 'react'
import Restore from 'react-restore'

import Chain from './Chain'
import link from '../../../resources/link'
import { WREN_SUPPORT_URL } from '../../../resources/constants'
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
      findInput: ''
    }
  }

  discord() {
    return (
      <button
        type='button'
        className='discordInvite'
        onClick={() => link.send('tray:openExternal', WREN_SUPPORT_URL)}
      >
        <span>Need help?</span>
        <span className='discordLink'>Open GitHub issues</span>
      </button>
    )
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
              return <Chain key={key} {...chain} view={'preview'} />
            })}
        </div>
      )
    })
    return nets
  }

  renderChains() {
    const networks = this.store('main.networks')
    const networkOptions = []
    Object.keys(networks).forEach((type) => {
      Object.keys(networks[type]).forEach((id) => {
        networkOptions.push({ text: networks[type][id].name, value: type + ':' + id })
      })
    })

    return (
      <div key={'chainList'} className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          {this.renderConnections()}
          <div className='networkBreak'>
            <div className='networkBreakLayer'>Testnets</div>
          </div>
          {this.renderConnections(true)}
          {this.discord()}
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
