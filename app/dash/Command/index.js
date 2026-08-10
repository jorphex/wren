import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import svg from '../../../resources/svg'

export class Command extends React.Component {
  renderSignerIcon(type) {
    if (type === 'ledger') {
      return <div className='expandedSignerIcon'>{svg.ledger(20)}</div>
    } else if (type === 'trezor') {
      return <div className='expandedSignerIcon'>{svg.trezor(20)}</div>
    } else if (type === 'seed' || type === 'ring') {
      return (
        <div className='expandedSignerIcon'>
          <Icon name='hot' size={23} />
        </div>
      )
    } else if (type === 'lattice') {
      return <div className='expandedSignerIcon'>{svg.lattice(22)}</div>
    } else {
      return (
        <div className='expandedSignerIcon'>
          <Icon name='hardware' size={20} />
        </div>
      )
    }
  }
  renderSignerTitle() {
    const { data = {} } = this.store('windows.dash.nav')[0] || { view: '', data: {} }
    const signer = data.signer ? this.store('main.signers', data.signer) : {}
    if (!signer) return null
    return (
      <div className='expandedSignerTitle'>
        {/* <div className='signerType' style={this.props.inSetup ? {top: '21px'} : {top: '24px'}}>{this.props.model}</div> */}
        {this.renderSignerIcon(signer.type)}
        <div className='signerName'>{signer.name}</div>
      </div>
    )
  }
  render() {
    const { view } = this.store('windows.dash.nav')[0] || { view: '', data: {} }
    const titles = {
      accounts: 'Accounts',
      addressBook: 'Contacts',
      chains: 'Networks',
      earn: 'Earn',
      default: 'Wren',
      settings: 'Settings',
      send: 'Send',
      tokens: 'Tokens'
    }
    const title = titles[view || 'default'] || view
    return (
      <div className='command'>
        {this.store('windows.dash.nav').length ? (
          <button
            type='button'
            aria-label='Back'
            className='commandItem commandItemBack cardShow wrenControl wrenControlSecondary wrenControlIcon wrenShellNav'
            onClick={() => {
              link.send('tray:action', 'backDash')
            }}
          >
            <Icon name='back' size={19} />
          </button>
        ) : null}
        <div key={view} className='commandTitle cardShow'>
          {view === 'expandedSigner' ? this.renderSignerTitle() : title}
        </div>
        <button
          type='button'
          aria-label='Close'
          className='commandItem commandItemClose wrenControl wrenControlSecondary wrenControlIcon wrenShellNav'
          onClick={() => {
            link.send('tray:action', 'closeDash')
          }}
        >
          <Icon name='close' size={19} />
        </button>
      </div>
    )
  }
}

export default Restore.connect(Command)
