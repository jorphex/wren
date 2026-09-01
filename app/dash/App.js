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
import Dapps from './Dapps'
import Inspector from './Inspector'
import Contracts from './Contracts'
import ControlNavigation from './ControlNavigation'
import Icon from '../../resources/Components/Icon'
import link from '../../resources/link'
import { capitalize } from '../../resources/utils'
import { MAX_TIMER_DELAY, selectConnectedAppSummary } from '../../resources/domain/connectedApps'
import { requestDashNavigation } from './navigationGuard'

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
        Add {itemName(view).toLowerCase()}
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
    this.scheduleControlCountExpiry()
  }

  componentDidUpdate() {
    this.scheduleControlCountExpiry()
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.onKeyDown)
    clearTimeout(this.controlCountExpiryTimer)
    this.controlCountExpiryDeadline = undefined
  }

  connectedAppSummary(now = Date.now()) {
    return selectConnectedAppSummary({
      networks: this.store('main.networks.ethereum') || {},
      origins: this.store('main.origins') || {},
      permissions: this.store('main.permissions') || {},
      now
    })
  }

  scheduleControlCountExpiry() {
    const now = Date.now()
    const { nextExpiry } = this.connectedAppSummary(now)
    if (nextExpiry === this.controlCountExpiryDeadline) return

    clearTimeout(this.controlCountExpiryTimer)
    this.controlCountExpiryDeadline = nextExpiry
    if (nextExpiry !== undefined) {
      const delay = Math.max(1, Math.min(nextExpiry - now, MAX_TIMER_DELAY))
      this.controlCountExpiryTimer = setTimeout(() => {
        this.controlCountExpiryDeadline = undefined
        this.setState((state) => ({ controlCountTick: (state?.controlCountTick || 0) + 1 }))
      }, delay)
    }
  }

  controlCounts(now = Date.now()) {
    const allNetworks = Object.values(this.store('main.networks') || {}).flatMap((networks) =>
      Object.values(networks)
    )

    return {
      accounts: Object.keys(this.store('main.accounts') || {}).length,
      networks: allNetworks.filter((network) => network?.on).length,
      dapps: this.connectedAppSummary(now).count
    }
  }

  onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    const hardwarePrompt = this.store('windows.dash.hardwarePrompt')
    if (hardwarePrompt?.signerId) {
      if (hardwarePrompt.dismissible) link.send('dash:dismissHardwarePrompt', hardwarePrompt.signerId)
      return
    }
    const nav = this.store('windows.dash.nav') || []
    if (nav.length) {
      requestDashNavigation('back', () => link.send('tray:action', 'backDash'))
    } else {
      requestDashNavigation('close', () => link.send('tray:action', 'closeDash'))
    }
  }

  renderPanel(view, data, hardwarePrompt) {
    if (view === 'accounts') return <Accounts data={data} />
    if (view === 'earn') return <Earn data={data} />
    if (view === 'addressBook') return <AddressBook data={data} />
    if (view === 'dapps') return <Dapps data={data} />
    if (view === 'inspector') return <Inspector />
    if (['contracts', 'deployment', 'contractVerification'].includes(view)) {
      const initialMode = view === 'contractVerification' || data?.mode === 'verify' ? 'verify' : 'deploy'
      return (
        <Contracts
          initialMode={initialMode}
          data={data}
          accounts={this.store('main.accounts') || {}}
          signers={this.store('main.signers') || {}}
          currentAccount={this.store('selected.current') || ''}
          networks={this.store('main.networks.ethereum') || {}}
          networksMeta={this.store('main.networksMeta.ethereum') || {}}
        />
      )
    }
    if (view === 'expandedSigner' && data.signer) {
      const signerId = data.signer
      const signer = this.store('main.signers', signerId)

      return (
        <Signer
          key={signerId}
          authenticationOwnedByPrompt={hardwarePrompt?.signerId === signerId}
          expanded={true}
          {...signer}
        />
      )
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
    const hardwarePrompt = this.store('windows.dash.hardwarePrompt')
    const promptSigner = hardwarePrompt?.signerId
      ? this.store('main.signers', hardwarePrompt.signerId)
      : undefined
    const showAddButton = view === 'tokens' && (!data || Object.keys(data).length === 0)
    const topLevelControlView =
      !view ||
      view === 'default' ||
      (['accounts', 'chains', 'dapps', 'settings'].includes(view) &&
        (!data || Object.keys(data).length === 0))
    const controlCounts = this.controlCounts()
    const controlCurrent = view === 'default' || !view ? 'overview' : view

    return (
      <div className='dash'>
        <Command />
        <div className='dashMain' style={showAddButton ? { bottom: '78px' } : undefined}>
          <div className='dashMainOverlay' />
          <div className='dashMainScroll'>
            {topLevelControlView ? (
              <div className='dashControlShell'>
                <ControlNavigation counts={controlCounts} current={controlCurrent} replace />
                <div className='dashControlContent'>{this.renderPanel(view, data, hardwarePrompt)}</div>
              </div>
            ) : (
              this.renderPanel(view, data, hardwarePrompt)
            )}
          </div>
        </div>
        {promptSigner ? (
          <Signer
            key={`hardware-prompt-${promptSigner.id}`}
            promptOnly
            promptDismissible={hardwarePrompt.dismissible}
            {...promptSigner}
          />
        ) : null}
        {showAddButton && <AddNewItemButton view={view} req={this.props.req} />}
      </div>
    )
  }
}

export default Restore.connect(Dash)
