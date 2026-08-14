import React from 'react'
import Restore from 'react-restore'
import emptyBalances from 'url:../../../asset/ui/wren-empty-balances-v2.png'

import Icon from '../../../resources/Components/Icon'
import AssetMark from '../../../resources/Components/AssetMark'
import { resolveChainIdentityColor } from '../../../resources/Components/ChainIdentityMark'
import WrenEmptyState from '../../../resources/Components/WrenEmptyState'
import link from '../../../resources/link'
import { createBalance, isNativeCurrency, sortByTotalValue } from '../../../resources/domain/balance'
import { resolveLocalAddressIdentity } from '../../../resources/domain/addressBook/identity'
import {
  formatTokenBaseUnitAmount,
  parseTokenBaseUnitAmount,
  parseTokenDecimalAmount
} from '../../../resources/domain/token/amount'
import { isNetworkConnected } from '../../../resources/utils/chains'
import { isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { maxSendAmount, queueSend, resolveSendRecipient } from './api'

const CONFIRMED_CLOSE_DWELL_MS = 3000

const COPY = Object.freeze({
  accountChanged: 'The selected account changed. Re-check the recipient and amount before trying again.',
  amount: 'Amount',
  amountExceedsBalance: 'Amount exceeds available balance',
  amountInvalid: 'Enter a valid amount',
  asset: 'Asset',
  assetUnavailable: 'This asset is no longer available to send on this network. Choose another asset.',
  close: 'Close',
  chooseAsset: 'Choose an asset',
  chooseContact: 'Choose contact',
  chooseAContact: 'Choose a contact',
  clearRecipient: 'Clear recipient',
  currentAccount: 'Current account',
  declinedBody: 'You declined this transaction. Nothing was signed or sent.',
  declinedHeading: 'Transaction declined',
  errorBody: 'The network did not accept this transaction.',
  errorHeading: 'Transaction failed',
  fee: 'Network fee',
  feeReview: 'Calculated during review',
  maxNeedsRecipient: 'Enter a recipient to enable Max so we can estimate gas.',
  noAccount: 'Select an account to send',
  noAssets: 'No sendable assets on this network',
  noAssetsFound: 'No assets found',
  noContacts: 'No saved contacts yet.',
  activeAccounts: 'Active accounts',
  activeWrenAccount: 'Active Wren account',
  primaryDisabled: 'Enter send details',
  primaryReady: 'Review send',
  primarySubmitting: 'Sending…',
  queuedBody: 'Your transaction is waiting to be submitted.',
  queuedHeading: 'Transaction queued',
  recipient: 'Recipient',
  recipientInvalid: 'Enter a valid address',
  recipientPlaceholder: 'Enter an address',
  recipientResolved: 'Address verified',
  recipientResolving: 'Checking address…',
  reviewFee: 'Wren estimates gas before anything is signed.',
  savedContacts: 'Saved contacts',
  searchContacts: 'Search accounts and contacts',
  searchAssets: 'Search assets',
  confirmedBody: 'Your transaction has been confirmed on the network.',
  confirmedHeading: 'Transaction confirmed',
  submittedBody:
    'Your transaction has been sent to the network and is waiting for confirmation. You can close this panel; Wren will keep tracking it.',
  submittedHeading: 'Transaction submitted',
  tryAgain: 'Try again',
  watchOnly: 'Watch-only accounts cannot sign transactions.'
})

const errorCopy = Object.freeze({
  'account-changed': COPY.accountChanged,
  'amount-exceeds-balance': COPY.amountExceedsBalance,
  'amount-invalid': COPY.amountInvalid,
  'asset-unavailable': COPY.assetUnavailable,
  'fee-unavailable': 'Fee estimate unavailable',
  'network-unavailable': 'Network unavailable. Check your connection and try again.',
  'recipient-invalid': COPY.recipientInvalid,
  'watch-only': COPY.watchOnly
})

const assetKey = (asset) => `${asset.chainId}:${asset.address.toLowerCase()}`
const displayedAsset = (rawBalance, networks, metadata, rates) => {
  const network = networks[rawBalance.chainId]
  const chainMeta = metadata[rawBalance.chainId] || {}
  const native = isNativeCurrency(rawBalance.address)
  const nativeCurrency = chainMeta.nativeCurrency || {}
  const rate = native ? nativeCurrency.usd : rates[rawBalance.address || rawBalance.symbol]
  const balance = createBalance(
    {
      ...rawBalance,
      decimals: native ? nativeCurrency.decimals || 18 : rawBalance.decimals,
      name: native ? nativeCurrency.name || network.name : rawBalance.name,
      symbol: native ? nativeCurrency.symbol || rawBalance.symbol : rawBalance.symbol
    },
    network.isTestnet ? { price: 0 } : rate
  )

  return {
    ...balance,
    chainColor: resolveChainIdentityColor(rawBalance.chainId, network.isTestnet, chainMeta.primaryColor)
      .color,
    chainName: network.name,
    connected: isNetworkConnected(network),
    native,
    primaryColor: chainMeta.primaryColor
  }
}

export class Send extends React.Component {
  constructor(...args) {
    super(...args)
    this.lastRequest = null
    this.maxSequence = 0
    this.queueSequence = 0
    this.recipientSequence = 0
    this.mounted = false
    this.confirmedRequestKey = ''
    this.confirmedCloseSent = false
    this.successPointerInside = false
    this.successFocusWithin = false
    this.assetTriggerRef = React.createRef()
    this.contactTriggerRef = React.createRef()
    this.pickerStep = ''
    this.pickerReturnTarget = null
    this.state = {
      amount: '',
      assetFilter: '',
      contactFilter: '',
      queueError: '',
      queueing: false,
      recipient: '',
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: '',
      requestAccount: '',
      requestId: '',
      selectedAsset: ''
    }
  }

  componentDidMount() {
    this.mounted = true
    this.accountId = this.store('selected.current') || ''
    this.pickerStep = this.store('windows.dash.nav')[0]?.data?.step || ''
    this.lockInitialAsset()
    this.syncConfirmedAutoClose()
  }

  componentDidUpdate() {
    const step = this.store('windows.dash.nav')[0]?.data?.step || ''
    if (this.pickerStep && !step) {
      this.pickerReturnTarget?.current?.focus()
      this.pickerReturnTarget = null
    }
    this.pickerStep = step

    const accountId = this.store('selected.current') || ''
    if (accountId === this.accountId) {
      this.lockInitialAsset()
      this.syncConfirmedAutoClose()
      return
    }
    this.accountId = accountId
    this.lastRequest = null
    this.maxSequence += 1
    this.queueSequence += 1
    this.recipientSequence += 1
    this.resetConfirmedAutoClose()
    if (step === 'assetPicker' || step === 'contactPicker') link.send('nav:back', 'dash')
    this.setState({
      amount: '',
      contactFilter: '',
      queueError: '',
      queueing: false,
      recipient: '',
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: '',
      requestAccount: '',
      requestId: '',
      selectedAsset: ''
    })
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.recipientTimer)
    this.clearConfirmedAutoClose()
    this.maxSequence += 1
    this.queueSequence += 1
    this.recipientSequence += 1
  }

  requestForState() {
    if (!this.state.requestId) return null
    const request = this.store('main.accounts', this.state.requestAccount, 'requests', this.state.requestId)
    if (request) this.lastRequest = { notice: request.notice, status: request.status }
    return request || this.lastRequest
  }

  confirmedRequestKeyForState() {
    const request = this.requestForState()
    return request?.status === 'confirmed' ? `${this.state.requestAccount}:${this.state.requestId}` : ''
  }

  clearConfirmedAutoClose() {
    clearTimeout(this.confirmedAutoCloseTimer)
    this.confirmedAutoCloseTimer = null
  }

  resetConfirmedAutoClose() {
    this.clearConfirmedAutoClose()
    this.confirmedRequestKey = ''
    this.confirmedCloseSent = false
    this.successPointerInside = false
    this.successFocusWithin = false
  }

  successSurfaceInteracting() {
    return this.successPointerInside || this.successFocusWithin
  }

  scheduleConfirmedAutoClose() {
    const requestKey = this.confirmedRequestKeyForState()
    if (
      !requestKey ||
      this.confirmedCloseSent ||
      this.successSurfaceInteracting() ||
      this.confirmedAutoCloseTimer
    ) {
      return
    }
    this.confirmedAutoCloseTimer = setTimeout(() => {
      this.confirmedAutoCloseTimer = null
      if (
        !this.mounted ||
        this.confirmedCloseSent ||
        this.successSurfaceInteracting() ||
        this.confirmedRequestKeyForState() !== requestKey
      ) {
        return
      }
      this.confirmedCloseSent = true
      link.send('tray:action', 'closeDash')
    }, CONFIRMED_CLOSE_DWELL_MS)
  }

  syncConfirmedAutoClose() {
    const requestKey = this.confirmedRequestKeyForState()
    if (requestKey !== this.confirmedRequestKey) {
      this.clearConfirmedAutoClose()
      this.confirmedRequestKey = requestKey
      this.confirmedCloseSent = false
      this.successPointerInside = false
      this.successFocusWithin = false
    }
    this.scheduleConfirmedAutoClose()
  }

  closeConfirmedRequest() {
    this.clearConfirmedAutoClose()
    this.confirmedCloseSent = true
    link.send('tray:action', 'closeDash')
  }

  setSuccessSurfaceInteraction(type, event) {
    if (type === 'focus' && event.currentTarget.contains(event.relatedTarget)) return
    if (type === 'blur' && event.currentTarget.contains(event.relatedTarget)) return
    if (type === 'pointer-enter') this.successPointerInside = true
    if (type === 'pointer-leave') this.successPointerInside = false
    if (type === 'focus') this.successFocusWithin = true
    if (type === 'blur') this.successFocusWithin = false
    this.clearConfirmedAutoClose()
    if (!this.successSurfaceInteracting()) this.scheduleConfirmedAutoClose()
  }

  lockInitialAsset() {
    if (this.state.selectedAsset) return
    const selected = this.getContext().assets[0]
    if (selected) this.setState({ selectedAsset: assetKey(selected) })
  }

  getContext() {
    const accountId = this.store('selected.current')
    const account = accountId ? this.store('main.accounts', accountId) : undefined
    const networks = this.store('main.networks.ethereum') || {}
    const metadata = this.store('main.networksMeta.ethereum') || {}
    const rates = this.store('main.rates') || {}
    const rawBalances = account?.address ? this.store('main.balances', account.address) || [] : []
    const assets = rawBalances
      .filter((balance) => networks[balance.chainId] && isNetworkConnected(networks[balance.chainId]))
      .map((balance) => displayedAsset(balance, networks, metadata, rates))
      .filter((asset) => parseTokenBaseUnitAmount(asset.balance) > 0n)
      .sort(sortByTotalValue)
    const selected = this.state.selectedAsset
      ? assets.find((asset) => assetKey(asset) === this.state.selectedAsset)
      : assets[0]

    return { account, accountId, assets, selected }
  }

  amountError(asset) {
    if (!this.state.amount) return ''
    const amount = parseTokenDecimalAmount(this.state.amount, asset.decimals)
    if (amount === undefined) return COPY.amountInvalid
    const balance = parseTokenBaseUnitAmount(asset.balance)
    return balance === undefined || amount > balance ? COPY.amountExceedsBalance : ''
  }

  async resolveRecipient(value) {
    const sequence = ++this.recipientSequence
    this.setState({
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: 'resolving'
    })
    const result = await resolveSendRecipient(value)
    if (sequence !== this.recipientSequence || value !== this.state.recipient.trim()) return

    if (!result.success) {
      this.setState({ recipientError: COPY.recipientInvalid, recipientStatus: 'invalid' })
      return
    }

    const accounts = this.store('main.accounts') || {}
    const resolvedAddress = result.address.toLowerCase()
    const matchedAccount = Object.values(accounts).find((account) => {
      const address = account?.address || account?.id
      return typeof address === 'string' && address.toLowerCase() === resolvedAddress
    })
    const identity = resolveLocalAddressIdentity(this.store('main.addressBook'), accounts, result.address)
    const currentAccount = this.store('selected.current') || ''
    const matchedAccountId = matchedAccount?.id || matchedAccount?.address || ''
    const isCurrentAccount =
      Boolean(matchedAccount) && matchedAccountId.toLowerCase() === currentAccount.toLowerCase()
    this.setState({
      recipientError: '',
      recipientName: matchedAccount?.ensName || matchedAccount?.name || identity?.label || result.name || '',
      recipientSource: matchedAccount
        ? isCurrentAccount
          ? COPY.currentAccount
          : COPY.activeWrenAccount
        : identity?.source || '',
      recipientResolved: result.address,
      recipientStatus: 'resolved'
    })
  }

  updateRecipient(recipient) {
    clearTimeout(this.recipientTimer)
    this.maxSequence += 1
    this.recipientSequence += 1
    this.setState({
      queueError: '',
      recipient,
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: ''
    })
    const value = recipient.trim()
    if (value) {
      const delay = /^0x[0-9a-fA-F]{40}$/.test(value) ? 0 : 320
      this.recipientTimer = setTimeout(() => this.resolveRecipient(value), delay)
    }
  }

  async setMax(asset) {
    const sequence = ++this.maxSequence
    const accountId = this.store('selected.current') || ''
    const selectedAsset = assetKey(asset)
    const result = await maxSendAmount(
      asset.chainId,
      asset.address,
      this.state.recipientResolved || undefined
    )
    if (
      !this.mounted ||
      sequence !== this.maxSequence ||
      accountId !== (this.store('selected.current') || '') ||
      selectedAsset !== this.state.selectedAsset
    ) {
      return
    }
    if (!result.success) return this.setState({ queueError: errorCopy[result.error] || COPY.errorBody })
    const amount = formatTokenBaseUnitAmount(result.amount, asset.decimals)
    this.setState({ amount: amount || '', queueError: '' })
  }

  async submit(event, context) {
    event.preventDefault()
    const { account, selected } = context
    const amountError = selected ? this.amountError(selected) : ''
    if (
      !account ||
      !selected ||
      !this.state.recipientResolved ||
      amountError ||
      this.state.queueing ||
      this.state.requestId
    ) {
      return
    }

    const sequence = ++this.queueSequence
    const requestAccount = account.id
    this.setState({ queueError: '', queueing: true })
    const result = await queueSend({
      account: account.id,
      amount: this.state.amount,
      assetAddress: selected.address,
      chainId: selected.chainId,
      recipient: this.state.recipientResolved
    })

    if (
      !this.mounted ||
      sequence !== this.queueSequence ||
      requestAccount !== (this.store('selected.current') || '')
    ) {
      return
    }

    if (!result.success) {
      this.setState({ queueError: errorCopy[result.error] || COPY.errorBody, queueing: false })
      return
    }
    this.lastRequest = null
    this.setState({ queueing: false, requestAccount: account.id, requestId: result.handlerId })
  }

  resetRequest(clearDraft = false) {
    this.resetConfirmedAutoClose()
    this.lastRequest = null
    this.setState({
      ...(clearDraft
        ? { amount: '', recipient: '', recipientName: '', recipientResolved: '', recipientSource: '' }
        : {}),
      queueError: '',
      requestAccount: '',
      requestId: ''
    })
  }

  openPicker(step, title) {
    this.pickerReturnTarget = step === 'assetPicker' ? this.assetTriggerRef : this.contactTriggerRef
    link.send('nav:update', 'dash', { data: { step, title } })
  }

  closePicker() {
    link.send('nav:back', 'dash')
  }

  renderAssetPicker(context) {
    const filter = this.state.assetFilter.trim().toLowerCase()
    const assets = context.assets.filter((asset) =>
      !filter
        ? true
        : [asset.name, asset.symbol, asset.chainName].some((value) => value.toLowerCase().includes(filter))
    )
    return (
      <section className='sendPicker cardShow' aria-label={COPY.chooseAsset}>
        <div className='sendPickerSearch'>
          <Icon name='search' size={15} />
          <input
            autoFocus
            className='wrenInput wrenInputQuiet'
            onChange={(event) => this.setState({ assetFilter: event.target.value })}
            placeholder={COPY.searchAssets}
            value={this.state.assetFilter}
          />
        </div>
        <div className='sendAssetList'>
          {assets.length ? (
            assets.map((asset) => {
              const selected = context.selected && assetKey(asset) === assetKey(context.selected)
              return (
                <button
                  aria-label={`Select ${asset.symbol}`}
                  className='sendAssetOption'
                  key={assetKey(asset)}
                  onClick={() => {
                    this.setState(() => {
                      this.maxSequence += 1
                      return {
                        amount: '',
                        assetFilter: '',
                        queueError: '',
                        selectedAsset: assetKey(asset)
                      }
                    })
                    this.closePicker()
                  }}
                  type='button'
                >
                  <AssetMark asset={asset} />
                  <span className='sendAssetIdentity'>
                    <strong>{asset.symbol}</strong>
                    <span>{asset.chainName}</span>
                  </span>
                  <span className='sendAssetBalance'>
                    <strong>{asset.displayBalance}</strong>
                    <span>{asset.name}</span>
                  </span>
                  <span className='sendAssetSelection'>
                    {selected ? <Icon name='check' size={17} /> : null}
                  </span>
                </button>
              )
            })
          ) : (
            <div className='sendPickerEmpty'>{COPY.noAssetsFound}</div>
          )}
        </div>
      </section>
    )
  }

  renderContactPicker() {
    const filter = this.state.contactFilter.trim().toLowerCase()
    const accounts = Object.values(this.store('main.accounts') || {})
      .filter(({ address = '', ensName = '', id = '', name = '', status = 'ok' }) => {
        if (status !== 'ok') return false
        return !filter
          ? true
          : [address, ensName, id, name].some(
              (value) => typeof value === 'string' && value.toLowerCase().includes(filter)
            )
      })
      .sort((left, right) =>
        (left.ensName || left.name || left.address || left.id).localeCompare(
          right.ensName || right.name || right.address || right.id
        )
      )
    const contacts = Object.values(this.store('main.addressBook') || {})
      .filter(({ address = '', name = '', note = '' }) =>
        !filter ? true : [address, name, note].some((value) => value.toLowerCase().includes(filter))
      )
      .sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address))

    return (
      <section className='sendPicker sendContactPicker cardShow' aria-label={COPY.chooseAContact}>
        <div className='sendPickerSearch'>
          <Icon name='search' size={15} />
          <input
            autoFocus
            className='wrenInput wrenInputQuiet'
            onChange={(event) => this.setState({ contactFilter: event.target.value })}
            placeholder={COPY.searchContacts}
            value={this.state.contactFilter}
          />
        </div>
        <div className='sendContactList'>
          {accounts.length ? (
            <div className='sendPickerSection'>
              <h3>{COPY.activeAccounts}</h3>
              {accounts.map((account) => {
                const address = account.address || account.id
                const current =
                  (account.id || address).toLowerCase() ===
                  (this.store('selected.current') || '').toLowerCase()
                return (
                  <button
                    className='sendContactOption'
                    key={`account:${account.id || address}`}
                    onClick={() => {
                      this.updateRecipient(address)
                      this.setState({ contactFilter: '' })
                      this.closePicker()
                    }}
                    type='button'
                  >
                    <span className='sendContactIcon' aria-hidden='true'>
                      <Icon name='accounts' size={17} />
                    </span>
                    <span className='sendContactIdentity'>
                      <strong>{account.ensName || account.name || 'Account'}</strong>
                      <span>{address}</span>
                    </span>
                    <span className='sendContactContext'>
                      {current ? COPY.currentAccount : COPY.activeWrenAccount}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
          {contacts.length ? <h3 className='sendPickerSectionTitle'>{COPY.savedContacts}</h3> : null}
          {contacts.length ? (
            contacts.map((contact) => (
              <button
                className='sendContactOption'
                key={contact.address.toLowerCase()}
                onClick={() => {
                  this.updateRecipient(contact.address)
                  this.setState({ contactFilter: '' })
                  this.closePicker()
                }}
                type='button'
              >
                <span className='sendContactIcon' aria-hidden='true'>
                  <Icon name='contacts' size={17} />
                </span>
                <span className='sendContactIdentity'>
                  <strong>{contact.name}</strong>
                  <span>{contact.address}</span>
                </span>
                <Icon name='next' size={14} />
              </button>
            ))
          ) : !accounts.length ? (
            <div className='sendPickerEmpty'>{COPY.noContacts}</div>
          ) : null}
        </div>
      </section>
    )
  }

  renderRequestState(request) {
    const status = request?.status
    const declined = status === 'declined'
    const failed = status === 'error'
    const confirmed = status === 'confirmed'
    const submitted = ['success', 'verifying', 'sent', 'confirming'].includes(status)
    const heading = declined
      ? COPY.declinedHeading
      : failed
        ? COPY.errorHeading
        : confirmed
          ? COPY.confirmedHeading
          : submitted
            ? COPY.submittedHeading
            : COPY.queuedHeading
    const body = declined
      ? COPY.declinedBody
      : failed
        ? request?.notice || COPY.errorBody
        : confirmed
          ? COPY.confirmedBody
          : submitted
            ? COPY.submittedBody
            : COPY.queuedBody

    return (
      <section
        className={`sendRequestState cardShow ${confirmed ? 'sendRequestStateSuccess' : ''}`}
        onBlur={confirmed ? (event) => this.setSuccessSurfaceInteraction('blur', event) : undefined}
        onFocus={confirmed ? (event) => this.setSuccessSurfaceInteraction('focus', event) : undefined}
        onMouseEnter={
          confirmed ? (event) => this.setSuccessSurfaceInteraction('pointer-enter', event) : undefined
        }
        onMouseLeave={
          confirmed ? (event) => this.setSuccessSurfaceInteraction('pointer-leave', event) : undefined
        }
      >
        <div className='sendRequestGlyph'>
          <Icon name={confirmed ? 'check' : failed ? 'alert' : declined ? 'close' : 'pending'} size={28} />
        </div>
        <div
          aria-atomic={confirmed ? 'true' : undefined}
          aria-live={confirmed ? 'polite' : undefined}
          role={confirmed ? 'status' : undefined}
        >
          <h2>{heading}</h2>
          <p>{body}</p>
        </div>
        {declined || failed ? (
          <button
            className='wrenControl wrenControlPrimary wrenControlLarge'
            onClick={() => this.resetRequest(false)}
            type='button'
          >
            {COPY.tryAgain}
          </button>
        ) : confirmed ? (
          <button
            className='wrenControl wrenControlGhost wrenControlLarge'
            onClick={() => this.closeConfirmedRequest()}
            type='button'
          >
            {COPY.close}
          </button>
        ) : null}
      </section>
    )
  }

  render() {
    const context = this.getContext()
    const { account, assets, selected } = context
    const { data = {} } = this.store('windows.dash.nav')[0] || {}
    if (data.step === 'assetPicker') return this.renderAssetPicker(context)
    if (data.step === 'contactPicker') return this.renderContactPicker()

    if (this.state.requestId) {
      return this.renderRequestState(this.requestForState())
    }

    if (!account || !assets.length) {
      return (
        <div className='sendUnavailable'>
          <WrenEmptyState
            expanded={true}
            image={emptyBalances}
            title={account ? COPY.noAssets : COPY.noAccount}
            transparentImage={true}
          />
        </div>
      )
    }
    if (!selected) {
      return (
        <div className='sendUnavailable sendUnavailableAsset'>
          <span>{COPY.assetUnavailable}</span>
          <button
            className='wrenControl wrenControlSecondary wrenControlLarge'
            ref={this.assetTriggerRef}
            onClick={() => this.openPicker('assetPicker', COPY.chooseAsset)}
            type='button'
          >
            {COPY.chooseAsset}
          </button>
        </div>
      )
    }

    const amountError = this.amountError(selected)
    const watchOnly = isWatchOnlyAccountType(account.lastSignerType)
    const maxNeedsRecipient = selected.native && !this.state.recipientResolved
    const canSubmit =
      !watchOnly &&
      !amountError &&
      Boolean(this.state.amount && this.state.recipientResolved) &&
      !this.state.queueing
    const recipientHint =
      this.state.recipientStatus === 'resolving'
        ? COPY.recipientResolving
        : this.state.recipientStatus === 'resolved'
          ? this.state.recipientName
            ? `${this.state.recipientName}${this.state.recipientSource ? ` · ${this.state.recipientSource}` : ''}`
            : COPY.recipientResolved
          : ''

    return (
      <form className='sendComposer cardShow' onSubmit={(event) => this.submit(event, context)}>
        <div className='sendLedger'>
          <div className='sendLedgerRow sendAssetRow'>
            <span className='sendRowLabel'>{COPY.asset}</span>
            <button
              aria-label={COPY.chooseAsset}
              className='sendRowValue sendAssetValue'
              ref={this.assetTriggerRef}
              onClick={() => this.openPicker('assetPicker', COPY.chooseAsset)}
              type='button'
            >
              <span className='sendAssetIdentityCluster'>
                <AssetMark asset={selected} />
                <span>
                  <strong>{selected.symbol}</strong>
                  <small>{selected.chainName}</small>
                </span>
              </span>
              <Icon name='next' size={17} />
            </button>
          </div>

          <div className={`sendLedgerRow sendInputRow ${this.state.recipientError ? 'sendRowError' : ''}`}>
            <label className='sendRowLabel' htmlFor='send-recipient'>
              {COPY.recipient}
            </label>
            <span
              className={`sendInputWrap wrenInputGroup ${this.state.recipientError ? 'wrenInputGroupError' : ''}`}
            >
              <input
                autoComplete='off'
                aria-invalid={this.state.recipientError ? 'true' : undefined}
                className='sendRecipientInput wrenInput'
                id='send-recipient'
                maxLength={255}
                onChange={(event) => this.updateRecipient(event.target.value)}
                placeholder={COPY.recipientPlaceholder}
                spellCheck={false}
                value={this.state.recipient}
              />
              <button
                aria-label={COPY.chooseContact}
                className='sendInlineAction'
                ref={this.contactTriggerRef}
                onClick={() => {
                  this.setState({ contactFilter: '' })
                  this.openPicker('contactPicker', COPY.chooseAContact)
                }}
                type='button'
              >
                <Icon name='contacts' size={16} />
              </button>
              {this.state.recipient ? (
                <button
                  aria-label={COPY.clearRecipient}
                  className='sendInlineAction'
                  onClick={() => this.updateRecipient('')}
                  type='button'
                >
                  <Icon name='close' size={14} />
                </button>
              ) : null}
            </span>
            <span className='sendRowHint' role={this.state.recipientError ? 'alert' : undefined}>
              {this.state.recipientError || recipientHint}
            </span>
          </div>

          <div className={`sendLedgerRow sendInputRow sendAmountRow ${amountError ? 'sendRowError' : ''}`}>
            <label className='sendRowLabel' htmlFor='send-amount'>
              {COPY.amount}
            </label>
            <span className={`sendInputWrap wrenInputGroup ${amountError ? 'wrenInputGroupError' : ''}`}>
              <input
                autoComplete='off'
                aria-invalid={amountError ? 'true' : undefined}
                className='sendAmountInput wrenInput'
                id='send-amount'
                inputMode='decimal'
                onChange={(event) => {
                  this.maxSequence += 1
                  this.setState({ amount: event.target.value, queueError: '' })
                }}
                placeholder='0.00'
                spellCheck={false}
                value={this.state.amount}
              />
              <span className='sendAmountSymbol'>{selected.symbol}</span>
              <button
                aria-describedby={maxNeedsRecipient && !amountError ? 'sendMaxReason' : undefined}
                className='sendMaxAction wrenControl wrenControlGhost wrenControlCompact'
                disabled={maxNeedsRecipient}
                onClick={() => {
                  this.setMax(selected)
                }}
                type='button'
              >
                Max
              </button>
            </span>
            <span
              className={`sendRowHint ${!amountError ? 'sendAmountHints' : ''}`}
              role={amountError ? 'alert' : undefined}
            >
              {amountError || (
                <>
                  <span className='sendAvailableHint'>
                    {`Available: ${selected.displayBalance} ${selected.symbol}`}
                  </span>
                  {maxNeedsRecipient ? (
                    <span className='sendMaxReason' id='sendMaxReason'>
                      {COPY.maxNeedsRecipient}
                    </span>
                  ) : null}
                </>
              )}
            </span>
          </div>

          <div className='sendLedgerRow sendFeeRow'>
            <span className='sendRowLabel'>{COPY.fee}</span>
            <span className='sendFeeValue'>{COPY.feeReview}</span>
            <span className='sendRowHint'>{COPY.reviewFee}</span>
          </div>
        </div>

        {watchOnly || this.state.queueError ? (
          <div
            className={watchOnly ? 'sendComposerError sendComposerNotice' : 'sendComposerError'}
            role='alert'
          >
            {watchOnly ? COPY.watchOnly : this.state.queueError}
          </div>
        ) : null}

        <div className='sendActionShelf'>
          <button
            className='wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
            disabled={!canSubmit}
            type='submit'
          >
            {this.state.queueing
              ? COPY.primarySubmitting
              : canSubmit
                ? COPY.primaryReady
                : COPY.primaryDisabled}
          </button>
        </div>
      </form>
    )
  }
}

export default Restore.connect(Send)
