import React from 'react'
import Restore from 'react-restore'

import Command from './Command'
import Main from './Main'
import Accounts from './Accounts'
import Signer from './Signer'
import Chains from './Chains'
import Notify from './Notify'
import Tokens from './Tokens'
import Settings from './Settings'
import Earn from './Earn'
import Send from './Send'
import AddressBook from './AddressBook'
import Icon from '../../resources/Components/Icon'
import link from '../../resources/link'
import { capitalize } from '../../resources/utils'

function itemName(view) {
  return capitalize(view.slice(0, -1))
}

const AddNewItemButton = ({ view, req }) => {
  const dataMap = {
    accounts: { showAddAccounts: true },
    chains: { newChain: {} },
    tokens: { notify: 'addToken', notifyData: req }
  }

  return (
    <div className='dashFooter'>
      <button
        type='button'
        className='dashFooterButton wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
        onClick={() => link.send('tray:action', 'navDash', { view, data: dataMap[view] })}
      >
        <div className='newAccountIcon'>
          <Icon name='add' size={16} />
        </div>
        Add New {itemName(view)}
      </button>
    </div>
  )
}

export class Dash extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.input = React.createRef()
    this.state = {
      showAddAccounts: false,
      selected: 'home'
    }
    this.onKeyDown = this.onKeyDown.bind(this)
  }

  componentDidMount() {
    document.addEventListener('keydown', this.onKeyDown)
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.onKeyDown)
  }

  onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    const nav = this.store('windows.dash.nav') || []
    if (nav.length) link.send('tray:action', 'backDash')
    else link.send('tray:action', 'closeDash')
  }

  renderPanel(view, data) {
    if (view === 'accounts') return <Accounts data={data} />
    if (view === 'earn') return <Earn data={data} />
    if (view === 'addressBook') return <AddressBook data={data} />
    if (view === 'expandedSigner' && data.signer) {
      const signerId = data.signer
      const signer = this.store('main.signers', signerId)

      return <Signer key={signerId} expanded={true} {...signer} />
    }
    if (view === 'chains') return <Chains data={data} />
    if (view === 'tokens') return <Tokens data={data} />
    if (view === 'settings') return <Settings data={data} />
    if (view === 'notify') return <Notify data={data} />
    if (view === 'send') return <Send />
    return <Main />
  }

  render() {
    const { view, data } = this.store('windows.dash.nav')[0] || { view: 'default', data: {} }
    const showAddButton =
      ['chains', 'accounts', 'tokens'].includes(view) && (!data || Object.keys(data).length === 0)

    return (
      <div className='dash'>
        <Command />
        <div className='dashMain' style={showAddButton ? { bottom: '78px' } : undefined}>
          <div className='dashMainOverlay' />
          <div className='dashMainScroll'>{this.renderPanel(view, data)}</div>
        </div>
        {showAddButton && <AddNewItemButton view={view} req={this.props.req} />}
      </div>
    )
  }
}

export default Restore.connect(Dash)
