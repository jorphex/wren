import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import Icon from '../../../resources/Components/Icon'
import useCopiedMessage from '../../../resources/Hooks/useCopiedMessage'
import link from '../../../resources/link'
import { getAddress } from '../../../resources/utils'
import { createBalance, formatUsdRate, isNativeCurrency } from '../../../resources/domain/balance'
import { isNetworkConnected } from '../../../resources/utils/chains'

import Default from './Default'

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
  inventory: Inventory,
  permissions: Permissions,
  balances: Balances,
  signer: Signer,
  settings: Settings
}

export const AccountAddressActions = ({ address, explorerChain }) => {
  const [copied, copyAddress] = useCopiedMessage(address, 1800)

  return (
    <div className='accountHomeAddressActions'>
      <button type='button' className='accountHomeAddress' aria-label='Copy address' onClick={copyAddress}>
        <span>{address}</span>
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      {explorerChain ? (
        <button
          type='button'
          className='accountHomeExplorer wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
          aria-label='Open account in block explorer'
          onClick={() => link.send('tray:openExplorer', explorerChain, null, address)}
        >
          <Icon name='external' size={14} />
        </button>
      ) : null}
      <span className='clusterStatus' role='status' aria-live='polite'>
        {copied ? 'Address copied' : ''}
      </span>
    </div>
  )
}

export class AccountNameEditor extends React.Component {
  constructor(props) {
    super(props)
    this.state = { editing: false, draft: props.name }
    this.renameButtonRef = React.createRef()
  }

  componentDidUpdate(previousProps) {
    if (
      !this.state.editing &&
      previousProps.name !== this.props.name &&
      this.state.draft !== this.props.name
    ) {
      this.setState({ draft: this.props.name })
    }
  }

  beginEdit() {
    this.setState({ editing: true, draft: this.props.name })
  }

  finishEdit(save) {
    const name = this.state.draft.trim()
    if (save && name && name !== this.props.name) link.send('tray:renameAccount', this.props.account, name)
    this.setState({ editing: false, draft: name || this.props.name }, () => {
      window.setTimeout(() => this.renameButtonRef.current?.focus(), 0)
    })
  }

  render() {
    return (
      <div className='accountHomeNameRow'>
        {this.state.editing ? (
          <input
            autoFocus
            type='text'
            className='accountHomeNameInput wrenInput'
            aria-label='Account name'
            maxLength={128}
            value={this.state.draft}
            onChange={(event) => this.setState({ draft: event.target.value })}
            onBlur={() => this.finishEdit(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.preventDefault()
                this.finishEdit(false)
              }
            }}
          />
        ) : (
          <>
            <h1 className='accountHomeTitle'>{this.props.name}</h1>
            <button
              ref={this.renameButtonRef}
              type='button'
              className='accountHomeRename wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
              aria-label='Update account name'
              onClick={() => this.beginEdit()}
            >
              <Icon name='pencil' size={14} />
            </button>
          </>
        )}
      </div>
    )
  }
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
            className='wrenInput wrenInputQuiet'
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
            className='panelFilterClear wrenControl wrenControlGhost wrenControlIcon'
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

  getTotalBalance(account) {
    const networks = this.store('main.networks.ethereum') || {}
    const networksMeta = this.store('main.networksMeta.ethereum') || {}
    const rates = this.store('main.rates') || {}
    const balances = this.store('main.balances', account.address) || []

    return balances.reduce((total, balance) => {
      const network = networks[balance.chainId]
      if (!network || !isNetworkConnected(network)) return total

      const nativeCurrency = networksMeta[balance.chainId]?.nativeCurrency || {}
      const native = isNativeCurrency(balance.address)
      const quote = native ? nativeCurrency : rates[balance.address || balance.symbol]
      const displayed = createBalance(
        {
          ...balance,
          decimals: native ? nativeCurrency.decimals || 18 : balance.decimals,
          symbol: native ? nativeCurrency.symbol || balance.symbol : balance.symbol
        },
        network.isTestnet ? { price: 0 } : quote
      )

      return total.plus(displayed.totalValue)
    }, BigNumber(0))
  }

  getAddressExplorerChain() {
    const networks = this.store('main.networks.ethereum') || {}
    const entries = Object.entries(networks)
    const preferred = entries.find(([id, network]) => String(id) === '1' && network?.on && network.explorer)
    const available = preferred || entries.find(([, network]) => network?.on && network.explorer)
    if (!available) return null
    const [id, network] = available
    return { type: 'ethereum', id: network.id ?? Number(id) }
  }

  renderHomeHeader() {
    const account = this.store('main.accounts', this.props.id) || {}
    const address = getAddress(account.address || this.props.id)
    const name = account.ensName || account.name || 'Account'
    const hideBalances = this.store('selected.hideBalances')
    const total = this.getTotalBalance(account)

    return (
      <header className='accountHomeHeader'>
        <div className='accountHomeIdentity'>
          <div className='accountHomeEyebrow'>Selected account</div>
          <AccountNameEditor account={this.props.id} name={name} />
          <AccountAddressActions address={address} explorerChain={this.getAddressExplorerChain()} />
        </div>
        <div className='accountHomeTotal'>
          <div className='accountHomeTotalLabel'>Total balance</div>
          <div className='accountHomeTotalValue'>
            {hideBalances ? (
              <span aria-label='Total balance hidden'>$••••</span>
            ) : (
              `$${formatUsdRate(total, 0)}`
            )}
          </div>
        </div>
        <div className='accountHomeActions' aria-label='Account actions'>
          <button
            type='button'
            className='wrenControl wrenControlPrimary'
            onClick={() => {
              link.send('tray:action', 'navDash', { view: 'send', data: {} })
            }}
          >
            <Icon name='send' size={14} />
            <span>Send</span>
          </button>
        </div>
      </header>
    )
  }

  render() {
    const accountModules = this.store('panel.account.modules')
    const accountModuleOrder = this.store('panel.account.moduleOrder')
    let slideHeight = 0
    const modules = accountModuleOrder.map((id, i) => {
      const module = accountModules[id] || { height: 0 }
      slideHeight += module.height
      return (
        <AccountModule
          key={id}
          id={id}
          account={this.props.id}
          module={module}
          top={slideHeight - module.height}
          index={i}
          filter={this.state.accountModuleFilter}
        />
      )
    })
    const footerHeight = this.store('windows.panel.footer.height')
    return (
      <div className='accountMain' style={{ bottom: footerHeight + 'px' }}>
        <div className='accountMainScroll'>
          {this.renderHomeHeader()}
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
    const { compactTop = false, requestMode = false } = this.props
    const className = [
      'accountView',
      requestMode ? 'accountViewRequest' : '',
      compactTop ? 'accountViewCompact' : ''
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <div
        className={className}
        style={{
          top: requestMode || compactTop ? '68px' : accountOpen ? '140px' : '80px',
          bottom: footerHeight + 'px'
        }}
      >
        <div className='accountViewMenu cardShow'>
          <button
            type='button'
            aria-label='Back'
            className='accountViewBack wrenControl wrenControlIcon wrenShellNav'
            onClick={() => this.props.back()}
          >
            <Icon name='back' size={16} />
          </button>
          <div className='accountViewTitle'>
            <div className='accountViewIcon'>{this.props.accountViewIcon}</div>
            <div className='accountViewText'>{this.props.accountViewTitle}</div>
          </div>
          {requestMode && this.props.accountViewMeta ? (
            <div className='accountViewMeta'>{this.props.accountViewMeta}</div>
          ) : null}
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
        nativeCurrencyDecimals: nativeCurrency.decimals ?? 18,
        nativeCurrencyUsd: nativeCurrency.usd
      }
    }

    if (req.type === 'addToken') {
      const chainId = req.token.chainId
      return {
        chainId,
        chainName: this.store('main.networks.ethereum', chainId, 'name') || `Chain ${chainId}`
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
    const accountName = activeAccount.ensName || activeAccount.name || 'Account'

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
        accountName={accountName}
        requestData={data}
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
      const chainData = req ? this.getChainData(req) : {}
      const transactionChainId =
        req?.type === 'transaction' && typeof req.data?.chainId === 'string'
          ? Number.parseInt(req.data.chainId, 16)
          : undefined
      const transactionChainName = Number.isInteger(transactionChainId)
        ? this.store('main.networks.ethereum', transactionChainId, 'name')
        : undefined
      const accountViewTitle =
        req?.type === 'walletCalls' && crumb.data.step === 'adjustWalletCalls'
          ? 'Adjust Batch Settings'
          : (req && this.getAccountViewTitle(req)) || ''

      return (
        <AccountView
          back={() => {
            link.send('nav:back', 'panel')
          }}
          {...this.props}
          requestMode={true}
          accountViewTitle={accountViewTitle}
          accountViewMeta={chainData.chainName || chainData.requestChainName || transactionChainName}
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
      const nativeCurrency = this.store('main.networksMeta.ethereum', chainId, 'nativeCurrency') || {}
      const activeAccount = this.store('main.accounts', accountId) || {}
      const accountName = activeAccount.ensName || activeAccount.name || ''

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
            accountName={accountName}
            chainName={chainName}
            nativeCurrency={nativeCurrency}
            origin={originName}
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
          compactTop={crumb.data.id === 'requests'}
          accountViewTitle={crumb.data.id === 'requests' ? 'Requests' : crumb.data.id}
        >
          <div className='moduleExpanded'>
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
export { _AccountMain as AccountMain }
