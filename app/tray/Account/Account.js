import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

import Default from './Default'

import Activity from './Activity'
import Chains from './Chains'
import Balances from './Balances'
import Gas from '../../../resources/Components/Monitor'
import Inventory from './Inventory'
import Permissions from './Permissions'
import Requests from './Requests'
import Settings from './Settings'
import Signer from './Signer'

// move
import ProviderRequest from './Requests/ProviderRequest'
import TransactionRequest from './Requests/TransactionRequest'
import SignatureRequest from './Requests/SignatureRequest'
import ChainRequest from './Requests/ChainRequest'
import AddTokenRequest from './Requests/AddTokenRequest'
import SignTypedDataRequest from './Requests/SignTypedDataRequest'
import SignPermitRequest from './Requests/SignPermitRequest'
import WalletCallsRequest from './Requests/WalletCallsRequest'
import WalletCallsStatus from './WalletCallsStatus'
import { isHardwareSigner } from '../../../resources/domain/signer'
import { accountViewTitles } from '../../../resources/domain/request'
import { getOriginDisplayName } from '../../../resources/domain/origin'

const requests = {
  sign: SignatureRequest,
  signTypedData: SignTypedDataRequest,
  signErc20Permit: SignPermitRequest,
  transaction: TransactionRequest,
  access: ProviderRequest,
  addChain: ChainRequest,
  addToken: AddTokenRequest,
  walletCalls: WalletCallsRequest
}

const modules = {
  gas: Gas,
  requests: Requests,
  chains: Chains,
  activity: Activity,
  inventory: Inventory,
  permissions: Permissions,
  balances: Balances,
  signer: Signer,
  settings: Settings
}

class _AccountModule extends React.Component {
  getModule(moduleId, account, expanded, expandedData, filter) {
    const Module = modules[moduleId] || Default

    return (
      <Module
        account={account}
        expanded={expanded}
        expandedData={expandedData}
        filter={filter}
        moduleId={moduleId}
      />
    )
  }

  render() {
    const { id, module, top, index, expanded, expandedData, account, filter } = this.props
    let hidden = false
    let style = {
      transform: `translateY(${top}px)`,
      zIndex: 9999 - index,
      height: module.height,
      opacity: 1
    }

    if (hidden) {
      style = {
        transform: `translateY(${top}px)`,
        zIndex: 9999 - index,
        height: 0,
        opacity: 0,
        overflow: 'hidden'
      }
    }

    if (expanded) {
      return this.getModule(id, account, expanded, expandedData, filter)
    } else {
      return (
        <div className={'accountModule'} ref={this.moduleRef} style={style}>
          <div className='accountModuleInner cardShow'>
            <div className='accountModuleCard'>
              {this.getModule(id, account, expanded, expandedData, filter)}
            </div>
          </div>
        </div>
      )
    }
  }
}

const AccountModule = Restore.connect(_AccountModule)

// account module is position absolute and with a translateX
class _AccountMain extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      expandedModule: ''
    }
  }
  renderAccountFilter() {
    return (
      <div className='panelFilterAccount'>
        <div className='panelFilterIcon'>
          <Icon name='search' size={12} />
        </div>
        <div className='panelFilterInput'>
          <input
            aria-label='Filter account details'
            type='text'
            spellCheck='false'
            onChange={(e) => {
              const value = e.target.value
              this.setState({ accountModuleFilter: value })
            }}
            value={this.state.accountModuleFilter}
          />
        </div>
        {this.state.accountModuleFilter ? (
          <button
            type='button'
            aria-label='Clear account view filter'
            className='panelFilterClear'
            onClick={() => {
              this.setState({ accountModuleFilter: '' })
            }}
          >
            <Icon name='close' size={12} />
          </button>
        ) : null}
      </div>
    )
  }

  render() {
    const accountModules = this.store('panel.account.modules')
    const accountModuleOrder = this.store('panel.account.moduleOrder')
    let slideHeight = 0
    const modules = accountModuleOrder.map((id, i) => {
      const module = accountModules[id] || { height: 0 }
      slideHeight += module.height + 12
      return (
        <AccountModule
          key={id}
          id={id}
          account={this.props.id}
          module={module}
          top={slideHeight - module.height - 12}
          index={i}
          filter={this.state.accountModuleFilter}
        />
      )
    })
    const footerHeight = this.store('windows.panel.footer.height')
    return (
      <div className='accountMain' style={{ bottom: footerHeight + 'px' }}>
        <div className='accountMainScroll'>
          {this.renderAccountFilter()}
          <div className='accountMainSlide' style={{ height: slideHeight + 'px' }}>
            {modules}
          </div>
        </div>
      </div>
    )
  }
}

const AccountMain = Restore.connect(_AccountMain)

// AccountView is a reusable template that provides the option to nav back to main
class _AccountView extends React.Component {
  render() {
    const accountOpen = this.store('selected.open')
    const footerHeight = this.store('windows.panel.footer.height')
    return (
      <div
        className='accountView'
        style={{ top: accountOpen ? '140px' : '80px', bottom: footerHeight + 'px' }}
      >
        <div className='accountViewMenu cardShow'>
          <button
            type='button'
            aria-label='Back'
            className='accountViewBack'
            onClick={() => this.props.back()}
          >
            <Icon name='back' size={16} />
          </button>
          <div className='accountViewTitle'>
            <div className='accountViewIcon'>{this.props.accountViewIcon}</div>
            <div className='accountViewText'>{this.props.accountViewTitle}</div>
          </div>
        </div>
        <div className='accountViewMain cardShow'>{this.props.children}</div>
      </div>
    )
  }
}

const AccountView = Restore.connect(_AccountView)

class _AccountBody extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      view: 'request'
    }
  }

  getRequestComponent({ type }) {
    return requests[type]
  }

  getChainData(req) {
    if (req.type === 'walletCalls') {
      const chainId = parseInt(req.chainId, 16)
      const nativeCurrency = this.store('main.networksMeta.ethereum', chainId, 'nativeCurrency') || {}
      return {
        chainId,
        chainName: this.store('main.networks.ethereum', chainId, 'name') || `Chain ${chainId}`,
        nativeCurrencySymbol: nativeCurrency.symbol || '?',
        nativeCurrencyDecimals: nativeCurrency.decimals ?? 18
      }
    }

    const requestChainId =
      req.type === 'sign' ? req.data?.context?.requestChainId : req.context?.requestChainId
    const requestChainName =
      requestChainId !== undefined ? this.store('main.networks.ethereum', requestChainId, 'name') : undefined

    if (req.type !== 'signErc20Permit') return { requestChainId, requestChainName }
    const chainId = req.typedMessage.data.domain.chainId
    const chainName = this.store('main.networks.ethereum', chainId, 'name')
    const { primaryColor: chainColor, icon } = this.store('main.networksMeta.ethereum', chainId)

    return { chainId, chainName, chainColor, icon, requestChainId, requestChainName }
  }

  renderRequest(req, data = {}) {
    const Request = this.getRequestComponent(req)
    if (!Request) return null

    const { handlerId } = req
    const { step } = data

    const activeAccount = this.store('main.accounts', this.props.id)
    const activeSigner = activeAccount.signer ? this.store('main.signers', activeAccount.signer) : undefined
    const originName = getOriginDisplayName(this.store('main.origins', req.origin, 'name'))
    const chainData = this.getChainData(req)
    const addressBook = this.store('main.addressBook') || {}
    const accounts = this.store('main.accounts') || {}

    const signingDelay = isHardwareSigner(activeAccount.lastSignerType) ? 200 : 1500

    return (
      <Request
        key={handlerId}
        req={req}
        step={step}
        signingDelay={signingDelay}
        chainId={chainData.chainId}
        originName={originName}
        chainData={chainData}
        addressBook={addressBook}
        accounts={accounts}
        signer={activeSigner}
      />
    )
  }

  getAccountViewTitle({ type }) {
    return accountViewTitles[type]
  }

  render() {
    const crumb = this.store('windows.panel.nav')[0] || {}

    if (crumb.view === 'requestView') {
      const { accountId, requestId } = crumb.data
      const req = this.store('main.accounts', accountId, 'requests', requestId)
      const accountViewTitle = (req && this.getAccountViewTitle(req)) || ''

      return (
        <AccountView
          back={() => {
            link.send('nav:back', 'panel')
          }}
          {...this.props}
          accountViewTitle={accountViewTitle}
        >
          {req && this.renderRequest(req, crumb.data)}
        </AccountView>
      )
    } else if (crumb.view === 'walletCallsStatus') {
      const { accountId, originName, status } = crumb.data || {}
      const validChainId =
        typeof status?.chainId === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(status.chainId)
      if (accountId !== this.props.id || !validChainId) return <AccountMain {...this.props} />

      const chainId = Number(BigInt(status.chainId))
      const chainName = this.store('main.networks.ethereum', chainId, 'name') || `Chain ${chainId}`

      return (
        <AccountView
          back={() => {
            link.send('nav:back', 'panel')
          }}
          {...this.props}
          accountViewTitle='Batch Status'
        >
          <WalletCallsStatus
            accountId={accountId}
            chainName={chainName}
            originName={getOriginDisplayName(originName)}
            status={status}
          />
        </AccountView>
      )
    } else if (crumb.view === 'expandedModule') {
      return (
        <AccountView
          back={() => {
            link.send('nav:back', 'panel')
          }}
          {...this.props}
          accountViewTitle={crumb.data.id}
        >
          <div
            className='accountsModuleExpand cardShow'
            onMouseDown={() => this.setState({ expandedModule: false })}
          >
            <div
              className='moduleExpanded'
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
            >
              <AccountModule
                id={crumb.data.id}
                account={crumb.data.account}
                module={{ height: 'auto' }}
                top={0}
                index={0}
                expanded={true}
                expandedData={crumb.data}
              />
            </div>
          </div>
        </AccountView>
      )
    } else {
      return <AccountMain {...this.props} />
    }
  }
}

const AccountBody = Restore.connect(_AccountBody)

class Account extends React.Component {
  render() {
    const minimized = this.store('selected.minimized')

    return (
      <AccountBody
        id={this.props.id}
        addresses={this.props.addresses}
        minimized={minimized}
        status={this.props.status}
        signer={this.props.signer}
      />
    )
  }
}

export default Restore.connect(Account)
