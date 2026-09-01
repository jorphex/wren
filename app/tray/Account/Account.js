import React from 'react'
import { safeNetworkMetadata } from '../../../resources/domain/networkMetadata'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import Icon from '../../../resources/Components/Icon'
import QrCode from '../../../resources/Components/QrCode'
import useCopiedMessage from '../../../resources/Hooks/useCopiedMessage'
import link from '../../../resources/link'
import { isNetworkConnected } from '../../../resources/utils/chains'
import { createBalance, formatUsdRate, isNativeCurrency } from '../../../resources/domain/balance'

import Default from './Default'

import Chains from './Chains'
import Balances from './Balances'
import Activity, { ACTIVITY_PREVIEW_LIMIT } from './Activity'
import Gas from '../../../resources/Components/Monitor'
import Inventory from './Inventory'
import Permissions from './Permissions'
import Requests, { byRequestQueueOrder, isReviewQueueRequest } from './Requests'
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
import Eip7702RevokeRequest from './Requests/Eip7702RevokeRequest'
import WalletCallsStatus from './WalletCallsStatus'
import { isHardwareSigner } from '../../../resources/domain/signer'
import { accountViewTitles, isPendingSigningRequest } from '../../../resources/domain/request'
import { getOriginDisplayName } from '../../../resources/domain/origin'

const requests = {
  sign: SignatureRequest,
  signTypedData: SignTypedDataRequest,
  signErc20Permit: SignPermitRequest,
  transaction: TransactionRequest,
  access: ProviderRequest,
  addChain: ChainRequest,
  switchChain: ChainRequest,
  addToken: AddTokenRequest,
  walletCalls: WalletCallsRequest,
  eip7702Revoke: Eip7702RevokeRequest
}

const modules = {
  gas: Gas,
  requests: Requests,
  chains: Chains,
  inventory: Inventory,
  permissions: Permissions,
  balances: Balances,
  activity: Activity,
  signer: Signer,
  settings: Settings
}

const portfolioSummary = (store, accountId) => {
  const account = store('main.accounts', accountId) || {}
  const address = account.address || accountId
  const networks = store('main.networks.ethereum') || {}
  const networksMeta = store('main.networksMeta.ethereum') || {}
  const rates = store('main.rates') || {}
  const balances = (store('main.balances', address) || [])
    .filter((balance) => isNetworkConnected(networks[balance.chainId]))
    .map((balance) => {
      const native = isNativeCurrency(balance.address)
      const nativeCurrency = safeNetworkMetadata(
        networksMeta[balance.chainId],
        networks[balance.chainId]
      ).nativeCurrency
      const quote = native ? nativeCurrency.usd : rates[balance.address || balance.symbol]?.usd
      const decimals = native ? nativeCurrency.decimals || 18 : balance.decimals
      return createBalance(
        { ...balance, decimals },
        networks[balance.chainId]?.isTestnet ? { price: 0 } : quote
      )
    })
  const total = balances.reduce((sum, balance) => sum.plus(balance.totalValue), BigNumber(0))
  return { count: balances.length, total: total.isZero() ? '0.00' : formatUsdRate(total, 0) }
}

export const AccountAddressActions = ({ address, name }) => {
  const [copied, copyAddress] = useCopiedMessage(address, 1800)
  const [qrFocused, setQrFocused] = React.useState(false)
  const [qrHovered, setQrHovered] = React.useState(false)
  const previewId = React.useId()
  const titleId = `${previewId}-title`
  const showQr = qrFocused || qrHovered

  return (
    <div className='accountHomeAddressActions'>
      <button type='button' className='accountHomeAddress' aria-label='Copy address' onClick={copyAddress}>
        <span>{address}</span>
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <div
        className='accountHomeQrDisclosure'
        onMouseEnter={() => setQrHovered(true)}
        onMouseLeave={() => setQrHovered(false)}
      >
        <button
          type='button'
          aria-controls={previewId}
          aria-expanded={showQr}
          aria-label='Account address QR code'
          className='accountHomeQrTrigger wrenControl wrenControlGhost wrenControlIcon'
          title='Hover or focus to show the account address QR code'
          onBlur={() => setQrFocused(false)}
          onFocus={() => setQrFocused(true)}
        >
          <Icon name='qr' size={16} />
        </button>
        {showQr ? (
          <div id={previewId} className='accountAddressQrPopover' aria-labelledby={titleId}>
            <div className='accountAddressQrHeader'>
              <div>
                <h2 id={titleId} className='accountAddressQrTitle'>
                  Account address
                </h2>
                <div className='accountAddressQrAccount'>{name}</div>
              </div>
            </div>
            <QrCode className='accountAddressQrCode' label='QR code for account address' value={address} />
            <div className='accountAddressQrValue'>{address}</div>
          </div>
        ) : null}
      </div>
      <span className='clusterStatus' role='status' aria-live='polite'>
        {copied ? 'Address copied.' : ''}
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
          <h1 className='accountHomeTitle'>
            <button
              ref={this.renameButtonRef}
              type='button'
              className='accountHomeRename wrenControl wrenControlGhost'
              aria-label='Update account name'
              onClick={() => this.beginEdit()}
            >
              <span className='accountHomeNameText'>{this.props.name}</span>
              <Icon name='pencil' size={14} />
            </button>
          </h1>
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
    const {
      id,
      module,
      top,
      height = module.height,
      index,
      expanded,
      expandedData,
      account,
      filter
    } = this.props
    let hidden = false
    let style = {
      transform: `translateY(${top}px)`,
      zIndex: 9999 - index,
      height,
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
        <div className={`accountModule accountModule-${id}`} ref={this.moduleRef} style={style}>
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
const ACCOUNT_MODULE_SECTION_GAP = 12
const PERCH_MODULE_MIN_HEIGHT = {
  requests: 106,
  chains: 66,
  permissions: 100,
  settings: 104
}
export const EMPTY_ACTIVITY_MODULE_HEIGHT = 140
const ACTIVITY_MODULE_CHROME_HEIGHT = 108
const ACTIVITY_ROW_MIN_HEIGHT = 58

export const activityModuleMinHeight = (entryCount) =>
  entryCount > 0
    ? ACTIVITY_MODULE_CHROME_HEIGHT + Math.min(entryCount, ACTIVITY_PREVIEW_LIMIT) * ACTIVITY_ROW_MIN_HEIGHT
    : EMPTY_ACTIVITY_MODULE_HEIGHT

export const accountModuleHeight = (id, measuredHeight, account, activity = []) => {
  if (id === 'activity') {
    const normalizedAccount = String(account).toLowerCase()
    const entryCount = activity.filter(
      (entry) => String(entry.account).toLowerCase() === normalizedAccount
    ).length
    if (!entryCount) return EMPTY_ACTIVITY_MODULE_HEIGHT
    return measuredHeight > 0 ? Math.max(measuredHeight, activityModuleMinHeight(entryCount)) : 0
  }

  return measuredHeight > 0 ? Math.max(measuredHeight, PERCH_MODULE_MIN_HEIGHT[id] || 0) : 0
}
const getAccountModuleGap = () => ACCOUNT_MODULE_SECTION_GAP

// account module is position absolute and with a translateX
class _AccountMain extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      expandedModule: '',
      contentContinues: false
    }
    this.accountScrollRef = React.createRef()
    this.scrollFrame = 0
  }

  componentDidMount() {
    this.scheduleScrollAffordanceUpdate()
  }

  componentDidUpdate() {
    this.scheduleScrollAffordanceUpdate()
  }

  componentWillUnmount() {
    if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame)
  }

  scheduleScrollAffordanceUpdate() {
    if (this.scrollFrame) return
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = 0
      const scroll = this.accountScrollRef.current
      if (!scroll) return
      const contentContinues = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 2
      if (contentContinues !== this.state.contentContinues) this.setState({ contentContinues })
    })
  }
  renderAccountFilter() {
    return (
      <div className='panelFilterAccount'>
        <div className='panelFilterIcon'>
          <Icon name='search' size={15} />
        </div>
        <div className='panelFilterInput'>
          <input
            aria-label='Filter account details'
            className='wrenInput'
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

  renderPortfolioSummary() {
    const { count, total } = portfolioSummary(this.store, this.props.id)
    const hideBalances = this.store('selected.hideBalances')
    return (
      <section className='accountPortfolioCard' aria-label='Portfolio balance'>
        <div className='accountPortfolioGlow' aria-hidden='true' />
        <div className='accountPortfolioHeader'>
          <span>Portfolio balance</span>
        </div>
        <div className='accountPortfolioValue'>
          {hideBalances ? <span aria-label='Portfolio balance hidden'>$••••</span> : `$${total}`}
        </div>
        {!count ? <div className='accountPortfolioMeta'>No assets on this account yet</div> : null}
        <button
          type='button'
          className='accountPortfolioSend wrenControl wrenControlPrimary wrenControlLarge'
          onClick={() => link.send('tray:action', 'navDash', { view: 'send', data: {} })}
        >
          <Icon name='send' size={15} />
          <span>Send</span>
        </button>
      </section>
    )
  }

  render() {
    const accountModules = this.store('panel.account.modules')
    const accountModuleOrder = this.store('panel.account.moduleOrder')
    const activity = this.store('main.activity') || []
    let slideHeight = 0
    let previousVisibleModuleId
    const modules = accountModuleOrder.map((id, i) => {
      const module = accountModules[id] || { height: 0 }
      const measuredHeight = module.height || 0
      const height = accountModuleHeight(id, measuredHeight, this.props.id, activity)
      const gap = height > 0 && previousVisibleModuleId ? getAccountModuleGap(previousVisibleModuleId, id) : 0
      const top = slideHeight + gap
      slideHeight = top + height
      if (height > 0) previousVisibleModuleId = id
      return (
        <AccountModule
          key={id}
          id={id}
          account={this.props.id}
          module={module}
          top={top}
          height={height}
          index={i}
          filter={this.state.accountModuleFilter}
        />
      )
    })
    return (
      <div className='accountMain accountMainPerch'>
        <div
          className='accountMainScroll'
          ref={this.accountScrollRef}
          onScroll={() => this.scheduleScrollAffordanceUpdate()}
        >
          {this.renderPortfolioSummary()}
          <div className='accountMainSlide' style={{ height: slideHeight + 'px' }}>
            {modules}
          </div>
        </div>
        <div
          className={
            this.state.contentContinues ? 'accountScrollFade accountScrollFadeVisible' : 'accountScrollFade'
          }
          aria-hidden='true'
        />
      </div>
    )
  }
}

const AccountMain = Restore.connect(_AccountMain)

// AccountView is a reusable template that provides the option to nav back to main
class _AccountView extends React.Component {
  render() {
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
          top: '0px',
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
    if (req.type === 'eip7702Revoke') {
      const chainId = Number(req.chainId)
      const nativeCurrency = this.store('main.networksMeta.ethereum', chainId, 'nativeCurrency') || {}
      return {
        chainId,
        chainName: this.store('main.networks.ethereum', chainId, 'name') || `Chain ${chainId}`,
        nativeCurrencySymbol: nativeCurrency.symbol || '?',
        nativeCurrencyDecimals: nativeCurrency.decimals ?? 18,
        nativeCurrencyUsd: nativeCurrency.usd
      }
    }

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

    if (req.type === 'switchChain') {
      return {
        sourceChainName:
          this.store('main.networks', req.chain.type, req.sourceChainId, 'name') ||
          `Chain ${req.sourceChainId}`,
        destinationChainName:
          this.store('main.networks', req.chain.type, req.chain.id, 'name') || `Chain ${req.chain.id}`
      }
    }

    const requestChainId =
      req.type === 'sign' ? req.data?.context?.requestChainId : req.context?.requestChainId
    const requestChainName =
      requestChainId !== undefined ? this.store('main.networks.ethereum', requestChainId, 'name') : undefined

    if (req.type !== 'signErc20Permit') return { requestChainId, requestChainName }
    const chainId = req.typedMessage.data.domain.chainId
    const chainName = this.store('main.networks.ethereum', chainId, 'name')
    const { primaryColor: chainColor, icon } = safeNetworkMetadata(
      this.store('main.networksMeta.ethereum', chainId),
      this.store('main.networks.ethereum', chainId)
    )

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
    const reviewQueue = Object.values(activeAccount.requests || {})
      .filter(isReviewQueueRequest)
      .sort(byRequestQueueOrder)
    const queueIndex = reviewQueue.findIndex((request) => request.handlerId === handlerId)
    const queueContext =
      reviewQueue.length > 1 && queueIndex >= 0
        ? {
            position: queueIndex + 1,
            total: reviewQueue.length,
            pendingSignatures: reviewQueue.filter(isPendingSigningRequest).length
          }
        : undefined

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
        queueContext={queueContext}
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
          ? 'Wallet calls'
          : (req && this.getAccountViewTitle(req)) || ''

      return (
        <AccountView
          back={() => {
            link.send('nav:back', 'panel')
          }}
          {...this.props}
          requestMode={true}
          accountViewTitle={accountViewTitle}
          accountViewMeta={
            req && isPendingSigningRequest(req)
              ? ''
              : chainData.chainName || chainData.requestChainName || transactionChainName
          }
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
          compactTop={
            crumb.data.id === 'requests' || crumb.data.id === 'activity' || crumb.data.id === 'balances'
          }
          accountViewTitle={
            crumb.data.id === 'balances'
              ? 'Balances'
              : crumb.data.title ||
                { requests: 'Requests', activity: 'Activity' }[crumb.data.id] ||
                crumb.data.id
          }
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
export { _AccountMain as AccountMain, _AccountBody as AccountBody }
