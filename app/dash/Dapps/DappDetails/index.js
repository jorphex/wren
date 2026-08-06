import React from 'react'
import Restore from 'react-restore'
import link from '../../../../resources/link'
import Icon from '../../../../resources/Components/Icon'
import RingIcon from '../../../../resources/Components/RingIcon'

export class DappDetails extends React.Component {
  updateOriginChain() {
    const origin = this.store('main.origins', this.props.originId)
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
                onClick={() => {
                  link.send('tray:action', 'switchOriginChain', this.props.originId, parseInt(id), 'ethereum')
                }}
              >
                <div className='originChainItemIcon'>
                  <RingIcon color={`var(--${primaryColor})`} img={icon} />
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
    return (
      <div className='cardShow'>
        <div className='originSwapOrigin'>
          <Icon name='apps' size={20} />
          <div className='originSwapOriginText'>{origin.name}</div>
        </div>
        <div className='originSwapTitle'>default chain</div>
        <div>{this.updateOriginChain()}</div>
        {/* <div 
          className='clearOriginsButton'
          style={{ color: 'var(--good)' }}
          onClick={() => {
            link.send('tray:openExternal', `https://${origin.name}/`)
          }
        }>{'launch dapp'}</div> */}
        {/* <div 
          className='clearOriginsButton' 
          style={{ color: 'var(--bad)' }}
          onClick={() => {
            link.send('tray:removeOrigin', this.props.originId)
            link.send('tray:action', 'navDash', { view: 'dapps', data: {}})
          }}
        >
          Remove Dapp
        </div>   */}
      </div>
    )
  }
}

export default Restore.connect(DappDetails)
