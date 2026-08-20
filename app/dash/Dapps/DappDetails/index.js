import React from 'react'
import Restore from 'react-restore'
import link from '../../../../resources/link'
import Icon from '../../../../resources/Components/Icon'
import ChainIdentityMark from '../../../../resources/Components/ChainIdentityMark'

export class DappDetails extends React.Component {
  state = { switchingChainId: null }

  componentDidMount() {
    this.mounted = true
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.switchTimer)
  }

  switchOriginChain(id, selected) {
    if (selected || this.switchPending) return
    const origin = this.store('main.origins', this.props.originId)
    const chain = this.store('main.networks.ethereum', id)
    if (!origin || !chain?.on || origin.chain?.id === id) return

    this.switchPending = true
    this.setState({ switchingChainId: id })
    link.send('tray:action', 'switchOriginChain', this.props.originId, id, 'ethereum')
    this.switchTimer = setTimeout(() => {
      this.switchPending = false
      if (this.mounted) this.setState({ switchingChainId: null })
    }, 500)
  }

  updateOriginChain(origin) {
    return (
      <div className='originSwapChainList'>
        {Object.keys(this.store('main.networks.ethereum'))
          .filter((id) => {
            return this.store('main.networks.ethereum', id, 'on')
          })
          .map((id) => {
            const chain = this.store('main.networks.ethereum', id)
            const selected = origin.chain.id === parseInt(id)
            const { primaryColor, icon } = this.store('main.networksMeta.ethereum', id)
            return (
              <button
                type='button'
                aria-pressed={selected}
                key={id}
                className={'originChainItem'}
                disabled={selected || this.state.switchingChainId !== null}
                onClick={() => this.switchOriginChain(parseInt(id), selected)}
              >
                <div className='originChainItemIcon'>
                  <ChainIdentityMark
                    chainId={chain.id}
                    icon={icon}
                    isTestnet={chain.isTestnet}
                    primaryColor={primaryColor}
                  />
                </div>

                {chain.name}

                <div className='originChainItemCheck'>
                  {selected ? <Icon name='check' size={28} /> : null}
                </div>
              </button>
            )
          })}
      </div>
    )
  }

  render() {
    const origin = this.store('main.origins', this.props.originId)
    if (!origin) {
      return (
        <div className='connectedApps cardShow connectedAppMissing' role='status'>
          This connected app is no longer available.
        </div>
      )
    }

    return (
      <div className='connectedApps connectedAppsDetails cardShow'>
        <div className='originSwapOrigin'>
          <Icon name='apps' size={20} />
          <div className='originSwapOriginText'>{origin.name}</div>
        </div>
        <div className='originSwapTitle'>Default network</div>
        <div>{this.updateOriginChain(origin)}</div>
      </div>
    )
  }
}

export default Restore.connect(DappDetails)
