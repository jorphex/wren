import React from 'react'
import Restore from 'react-restore'
import emptyBalances from 'url:../../../asset/ui/wren-empty-balances-v2.png'

import Icon from '../../../resources/Components/Icon'
import AssetMark from '../../../resources/Components/AssetMark'
import { resolveChainIdentityColor } from '../../../resources/Components/ChainIdentityMark'
import WrenEmptyState from '../../../resources/Components/WrenEmptyState'
import link from '../../../resources/link'
import { createBalance, isNativeCurrency, sortByTotalValue } from '../../../resources/domain/balance'
import {
  lookupAddressBookEntry,
  resolveLocalAddressIdentity
} from '../../../resources/domain/addressBook/identity'
import {
  formatTokenBaseUnitAmount,
  parseTokenBaseUnitAmount,
  parseTokenDecimalAmount
} from '../../../resources/domain/token/amount'
import { projectRecentRecipients } from '../../../resources/domain/recentRecipients/projection'
import { isNetworkConnected } from '../../../resources/utils/chains'
import { isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { maxSendAmount, queueSend, queueSweep, quoteSweep, resolveSendRecipient } from './api'

const COPY = Object.freeze({
  accountChanged: 'The selected account changed. Re-check the recipient and amount before trying again.',
  amount: 'Amount',
  amountExceedsBalance: 'Amount exceeds available balance',
  amountInvalid: 'Enter a valid amount',
  asset: 'From',
  assetUnavailable: 'This asset is no longer available to send on this network. Choose another asset.',
  close: 'Close',
  chooseAsset: 'Choose an asset',
  chooseContact: 'Choose recipient',
  chooseAContact: 'Choose recipient',
  clearRecipient: 'Clear recipient',
  currentAccount: 'Current account',
  declinedBody: 'You declined this transaction. Nothing was signed or sent.',
  declinedHeading: 'Transaction declined',
  errorBody: 'Wren could not prepare this transaction.',
  errorHeading: 'Transaction failed',
  fee: 'Network fee',
  feeReview: 'Calculated during review',
  maxNeedsRecipient: 'Enter a recipient to use Max; Wren needs it to estimate gas.',
  maxQuoteExpired: 'Maximum-send quote expired. Request a fresh quote.',
  maxQuoteFailed: 'Maximum-send quote unavailable. No amount was kept.',
  noAccount: 'Select an account to send',
  noAssets: 'No sendable assets on this network',
  noAssetsCopy: 'Wren found no positive balances available to send.',
  assetsChecking: 'Checking balances…',
  assetsCheckingCopy: 'Wren is refreshing this account before showing sendable assets.',
  assetsDisconnected: 'Asset networks unavailable',
  assetsDisconnectedCopy: 'Reconnect the networks holding these assets before sending.',
  noAssetsFound: 'No assets found',
  noContacts: 'No matching accounts or contacts.',
  noRecipients: 'No matching accounts, contacts, or recent recipients.',
  activeAccounts: 'Active accounts',
  activeWrenAccount: 'Active Wren account',
  primaryDisabled: 'Enter send details',
  primaryReady: 'Review send',
  primarySubmitting: 'Sending…',
  quoteMax: 'Use Max',
  quotingMax: 'Calculating safe maximum…',
  queuedBody: 'Your transaction is waiting to be submitted.',
  queuedHeading: 'Transaction queued',
  recipient: 'To',
  recipientInvalid: 'Enter a valid address',
  recipientLookupUnavailable:
    'Recipient lookup is unavailable. Enter or verify the full address to continue.',
  recipientPlaceholder: 'Enter an address',
  recipientResolved: 'No saved label · verify the full address',
  recipientResolving: 'Checking address…',
  reviewFee: 'Wren estimates gas before anything is signed.',
  savedContacts: 'Saved contacts',
  recentRecipients: 'Recent recipients',
  recentRecipientContext: 'Previously used on this device · verify the full address',
  recentRecipientSource: 'Recent recipient · verify the full address',
  searchContacts: 'Search accounts, contacts, and recent recipients',
  searchAssets: 'Search assets',
  confirmedBody: 'Your transaction has been confirmed on the network.',
  confirmedHeading: 'Transaction confirmed',
  destination: 'Destination',
  saveContact: 'Save contact',
  viewContact: 'View contact',
  submittedBody:
    'Your transaction has been sent to the network and is waiting for confirmation. You can close this panel; Wren will keep tracking it.',
  submittedHeading: 'Transaction submitted',
  unconfirmedBody:
    'Wren attempted one broadcast, but the network response was not confirmed. Wren is checking the signed transaction hash.',
  unconfirmedHeading: 'Submission status unconfirmed',
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
  'origin-unavailable': 'Wren could not prepare Send’s local authorization. Restart Wren, then try again.',
  'pending-chain': 'Finish or decline the pending Send transaction before sending on another network.',
  'recipient-invalid': COPY.recipientInvalid,
  'recipient-lookup-unavailable': COPY.recipientLookupUnavailable,
  'sweep-quote-changed': 'Balances, fees, or nonce changed. Scan a fresh Sweep. Nothing was sent.',
  'sweep-quote-expired': 'Sweep quote expired. Scan again before queueing.',
  'validation-failed': 'Wren could not validate this transfer. Check the recipient, amount, and network.',
  'watch-only': COPY.watchOnly
})

const MAX_SWEEP_ASSETS = 16
const exactValue = (value, suffix = '') =>
  value === undefined || value === null || value === '' ? 'Not provided' : `${String(value)}${suffix}`
const expiryTime = (expiresAt) => {
  const value = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt)
  return Number.isFinite(value) ? value : NaN
}
const expiryLabel = (expiresAt) => {
  const time = expiryTime(expiresAt)
  return Number.isFinite(time) ? new Date(time).toISOString() : exactValue(expiresAt)
}
const quoteExpired = (quote) => {
  const expires = expiryTime(quote?.expiresAt)
  return !Number.isFinite(expires) || expires <= Date.now()
}

const assetKey = (asset) => `${asset.chainId}:${asset.address.toLowerCase()}`
const displayedAsset = (rawBalance, networks, metadata, rates) => {
  const network = networks[rawBalance.chainId]
  const chainMeta = metadata[rawBalance.chainId] || {}
  const native = isNativeCurrency(rawBalance.address)
  const nativeCurrency = chainMeta.nativeCurrency || {}
  const nativeDecimals =
    Number.isInteger(nativeCurrency.decimals) && nativeCurrency.decimals >= 0 ? nativeCurrency.decimals : 18
  const rate = native ? nativeCurrency.usd : rates[rawBalance.address || rawBalance.symbol]
  const balance = createBalance(
    {
      ...rawBalance,
      decimals: native ? nativeDecimals : rawBalance.decimals,
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
    this.sweepQuoteSequence = 0
    this.mounted = false
    this.assetTriggerRef = React.createRef()
    this.amountRef = React.createRef()
    this.contactTriggerRef = React.createRef()
    this.requestHeadingRef = React.createRef()
    this.focusedRequestStateKey = ''
    this.pickerStep = ''
    this.pickerReturnTarget = null
    this.state = {
      amount: '',
      copyStatus: '',
      assetFilter: '',
      contactFilter: '',
      queueError: '',
      queueing: false,
      maxQuote: null,
      maxQuoteStatus: 'idle',
      maxReview: false,
      mode: 'send',
      recipient: '',
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: '',
      requestAccount: '',
      requestRecipient: '',
      requestId: '',
      selectedAsset: '',
      sweepChainId: null,
      sweepIncludeNative: false,
      sweepQuote: null,
      sweepReview: false,
      sweepSelected: [],
      sweepStatus: 'idle'
    }
  }

  componentDidMount() {
    this.mounted = true
    this.accountId = this.store('selected.current') || ''
    this.pickerStep = this.store('windows.dash.nav')[0]?.data?.step || ''
    this.lockInitialAsset()
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
      this.focusRequestStateHeading()
      return
    }
    this.accountId = accountId
    clearTimeout(this.quoteExpiryTimer)
    this.lastRequest = null
    this.focusedRequestStateKey = ''
    this.maxSequence += 1
    this.queueSequence += 1
    this.recipientSequence += 1
    this.sweepQuoteSequence += 1
    if (step === 'assetPicker' || step === 'contactPicker') link.send('nav:back', 'dash')
    this.setState({
      amount: '',
      copyStatus: '',
      contactFilter: '',
      queueError: '',
      queueing: false,
      maxQuote: null,
      maxQuoteStatus: 'idle',
      maxReview: false,
      mode: 'send',
      recipient: '',
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: '',
      requestAccount: '',
      requestRecipient: '',
      requestId: '',
      selectedAsset: '',
      sweepChainId: null,
      sweepIncludeNative: false,
      sweepQuote: null,
      sweepReview: false,
      sweepSelected: [],
      sweepStatus: 'idle'
    })
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.copyStatusTimer)
    clearTimeout(this.recipientTimer)
    clearTimeout(this.quoteExpiryTimer)
    this.maxSequence += 1
    this.queueSequence += 1
    this.recipientSequence += 1
    this.sweepQuoteSequence += 1
  }

  requestForState() {
    if (!this.state.requestId) return null
    const request = this.store('main.accounts', this.state.requestAccount, 'requests', this.state.requestId)
    if (request) {
      this.lastRequest = {
        notice: request.notice,
        status: request.status,
        ...(request.submission ? { submission: request.submission } : {})
      }
    }
    return request || this.lastRequest
  }

  focusRequestStateHeading() {
    if (!this.state.requestId || !this.requestHeadingRef.current) return
    const request = this.requestForState()
    const { key: presentationKey } = this.requestStatePresentation(request)
    const key = `${this.state.requestId}:${presentationKey}`
    if (key === this.focusedRequestStateKey) return
    this.focusedRequestStateKey = key
    this.requestHeadingRef.current.focus()
  }

  requestStatePresentation(request) {
    const status = request?.status
    const declined = status === 'declined'
    const failed = status === 'error'
    const confirmed = status === 'confirmed'
    const unconfirmed = status === 'verifying' && request?.submission?.status === 'unconfirmed'
    const changedSweep = failed && request?.recoverableError?.code === 'managed-sweep-changed'
    const retainedTransactionFailure = failed && Boolean(request?.retainedPreBroadcastError)
    const changedMax = retainedTransactionFailure && Boolean(request?.nativeMax)
    const retainedFailure = changedSweep || retainedTransactionFailure
    const submitted = ['success', 'verifying', 'sent', 'confirming'].includes(status)
    const heading = declined
      ? COPY.declinedHeading
      : retainedFailure
        ? changedSweep
          ? 'Sweep changed'
          : changedMax
            ? 'Maximum send changed'
            : 'Transaction not sent'
        : failed
          ? COPY.errorHeading
          : confirmed
            ? COPY.confirmedHeading
            : unconfirmed
              ? COPY.unconfirmedHeading
              : submitted
                ? COPY.submittedHeading
                : COPY.queuedHeading
    const body = declined
      ? COPY.declinedBody
      : failed
        ? request?.notice || COPY.errorBody
        : confirmed
          ? COPY.confirmedBody
          : unconfirmed
            ? COPY.unconfirmedBody
            : submitted
              ? COPY.submittedBody
              : COPY.queuedBody

    return {
      key: `${heading}\u0000${body}`,
      heading,
      body,
      changedSweep,
      changedMax,
      confirmed,
      declined,
      failed,
      retainedFailure,
      retainedTransactionFailure
    }
  }

  closeRequestPanel() {
    link.send('tray:action', 'closeDash')
  }

  copyAddress(address) {
    if (!address) return
    clearTimeout(this.copyStatusTimer)
    link.send('tray:clipboardData', address)
    this.setState({ copyStatus: 'Address copied' })
    this.copyStatusTimer = setTimeout(() => {
      if (this.mounted) this.setState({ copyStatus: '' })
    }, 4_000)
  }

  confirmedContact() {
    return this.state.requestRecipient
      ? lookupAddressBookEntry(this.store('main.addressBook'), this.state.requestRecipient)
      : undefined
  }

  openConfirmedContact() {
    const saved = this.confirmedContact()
    link.send('tray:action', 'navDash', {
      view: 'addressBook',
      data: {
        screen: 'edit',
        ...(saved ? { address: saved.address } : { seed: this.state.requestRecipient })
      }
    })
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
    const positiveRawBalances = rawBalances.filter(
      (balance) => (parseTokenBaseUnitAmount(balance.balance) || 0n) > 0n
    )
    const assets = positiveRawBalances
      .filter((balance) => networks[balance.chainId] && isNetworkConnected(networks[balance.chainId]))
      .map((balance) => displayedAsset(balance, networks, metadata, rates))
      .filter((asset) => parseTokenBaseUnitAmount(asset.balance) > 0n)
      .sort(sortByTotalValue)
    const selected = this.state.selectedAsset
      ? assets.find((asset) => assetKey(asset) === this.state.selectedAsset)
      : assets[0]

    const scanning = Boolean(account?.address && this.store('main.scanning', account.address))
    const balanceError = account?.address
      ? this.store('main.balanceErrors', account.address) ||
        this.store('main.scanningErrors', account.address)
      : undefined
    const unavailableAssets = positiveRawBalances.some(
      (balance) => !networks[balance.chainId] || !isNetworkConnected(networks[balance.chainId])
    )

    return { account, accountId, assets, balanceError, scanning, selected, unavailableAssets }
  }

  amountError(asset) {
    if (!this.state.amount) return ''
    if (asset.native && this.state.maxQuote && !quoteExpired(this.state.maxQuote)) return ''
    const amount = parseTokenDecimalAmount(this.state.amount, asset.decimals)
    if (amount === undefined) return COPY.amountInvalid
    const balance = parseTokenBaseUnitAmount(asset.balance)
    return balance === undefined || amount > balance ? COPY.amountExceedsBalance : ''
  }

  clearDerivedReview({ clearAmount = false, message = '' } = {}) {
    clearTimeout(this.quoteExpiryTimer)
    this.maxSequence += 1
    this.sweepQuoteSequence += 1
    this.setState({
      ...(clearAmount ? { amount: '' } : {}),
      maxQuote: null,
      maxQuoteStatus: 'idle',
      maxReview: false,
      queueError: message,
      sweepQuote: null,
      sweepReview: false,
      sweepStatus: 'idle'
    })
  }

  scheduleQuoteExpiry(kind, quote) {
    clearTimeout(this.quoteExpiryTimer)
    const expires = expiryTime(quote?.expiresAt)
    if (!Number.isFinite(expires)) return
    this.quoteExpiryTimer = setTimeout(
      () => {
        if (!this.mounted) return
        if (kind === 'max' && this.state.maxQuote?.quoteId === quote.quoteId) {
          this.clearDerivedReview({ clearAmount: true, message: COPY.maxQuoteExpired })
        }
        if (kind === 'sweep' && this.state.sweepQuote?.quoteId === quote.quoteId) {
          this.clearDerivedReview({ message: 'Sweep quote expired. Scan again before queueing.' })
        }
      },
      Math.min(2_147_483_647, Math.max(0, expires - Date.now()))
    )
  }

  async resolveRecipient(value, fallbackSource = '') {
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
      this.setState({
        recipientError: errorCopy[result.error] || COPY.recipientInvalid,
        recipientStatus: result.error === 'recipient-lookup-unavailable' ? 'unavailable' : 'invalid'
      })
      return
    }

    const accounts = this.store('main.accounts') || {}
    const resolvedAddress = result.address.toLowerCase()
    const matchedAccount = Object.values(accounts).find((account) => {
      const address = account?.address || account?.id
      return typeof address === 'string' && address.toLowerCase() === resolvedAddress
    })
    const identity = resolveLocalAddressIdentity(this.store('main.addressBook'), accounts, result.address)
    const recentRecipient =
      this.store('main.rememberRecentRecipients') === true &&
      projectRecentRecipients(this.store('main.recentRecipientUses') || []).some(
        ({ address }) => address === resolvedAddress
      )
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
        : identity?.source || (recentRecipient ? COPY.recentRecipientSource : fallbackSource),
      recipientResolved: result.address,
      recipientStatus: 'resolved'
    })
  }

  updateRecipient(recipient, source = '') {
    clearTimeout(this.copyStatusTimer)
    clearTimeout(this.recipientTimer)
    clearTimeout(this.quoteExpiryTimer)
    this.maxSequence += 1
    this.recipientSequence += 1
    this.sweepQuoteSequence += 1
    this.setState({
      amount: this.state.maxQuote || this.state.maxQuoteStatus === 'loading' ? '' : this.state.amount,
      maxQuote: null,
      maxQuoteStatus: 'idle',
      maxReview: false,
      copyStatus: '',
      queueError: '',
      recipient,
      recipientError: '',
      recipientName: '',
      recipientSource: '',
      recipientResolved: '',
      recipientStatus: '',
      sweepQuote: null,
      sweepReview: false,
      sweepStatus: 'idle'
    })
    const value = recipient.trim()
    if (value) {
      const delay = /^0x[0-9a-fA-F]{40}$/.test(value) ? 0 : 320
      this.recipientTimer = setTimeout(() => this.resolveRecipient(value, source), delay)
    }
  }

  async setMax(asset) {
    const sequence = ++this.maxSequence
    const accountId = this.store('selected.current') || ''
    const selectedAsset = assetKey(asset)
    clearTimeout(this.quoteExpiryTimer)
    this.setState({
      amount: '',
      maxQuote: null,
      maxQuoteStatus: 'loading',
      maxReview: false,
      queueError: ''
    })
    const result = await maxSendAmount({
      account: accountId,
      chainId: asset.chainId,
      assetAddress: asset.address,
      recipient: this.state.recipientResolved || undefined
    })
    if (
      !this.mounted ||
      sequence !== this.maxSequence ||
      accountId !== (this.store('selected.current') || '') ||
      selectedAsset !== this.state.selectedAsset
    ) {
      return
    }
    if (!result.success) {
      return this.setState({
        amount: '',
        maxQuote: null,
        maxQuoteStatus: 'error',
        maxReview: false,
        queueError: errorCopy[result.error] || COPY.maxQuoteFailed
      })
    }
    const amount = formatTokenBaseUnitAmount(result.amount, asset.decimals)
    const maxQuote = asset.native ? result : null
    if (asset.native && (!result.quoteId || !result.reserve || quoteExpired(result))) {
      return this.setState({
        amount: '',
        maxQuote: null,
        maxQuoteStatus: 'error',
        maxReview: false,
        queueError: COPY.maxQuoteFailed
      })
    }
    this.setState({
      amount: amount || '',
      maxQuote,
      maxQuoteStatus: asset.native ? 'ready' : 'idle',
      maxReview: false,
      queueError: ''
    })
    if (maxQuote) this.scheduleQuoteExpiry('max', maxQuote)
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

    if (this.state.maxQuote) {
      if (quoteExpired(this.state.maxQuote)) {
        this.clearDerivedReview({ clearAmount: true, message: COPY.maxQuoteExpired })
        return
      }
      if (!this.state.maxReview) {
        this.setState({ maxReview: true })
        return
      }
    }

    const sequence = ++this.queueSequence
    if (this.state.maxQuote) clearTimeout(this.quoteExpiryTimer)
    const requestAccount = account.id
    const requestRecipient = this.state.recipientResolved
    this.setState({ queueError: '', queueing: true })
    const result = await queueSend({
      account: account.id,
      amount: this.state.amount,
      assetAddress: selected.address,
      chainId: selected.chainId,
      recipient: requestRecipient,
      ...(this.state.maxQuote ? { maxQuoteId: this.state.maxQuote.quoteId } : {})
    })

    if (
      !this.mounted ||
      sequence !== this.queueSequence ||
      requestAccount !== (this.store('selected.current') || '')
    ) {
      return
    }

    if (!result.success) {
      if (this.state.maxQuote) {
        this.clearDerivedReview({
          clearAmount: true,
          message: errorCopy[result.error] || 'Maximum-send quote changed. Request a fresh quote.'
        })
        this.setState({ queueing: false })
      } else {
        this.setState({ queueError: errorCopy[result.error] || COPY.errorBody, queueing: false })
      }
      return
    }
    this.lastRequest = null
    this.focusedRequestStateKey = ''
    this.setState({
      queueing: false,
      requestAccount: account.id,
      requestRecipient,
      requestId: result.handlerId
    })
  }

  setMode(mode, context) {
    if (mode === this.state.mode) return
    clearTimeout(this.quoteExpiryTimer)
    this.maxSequence += 1
    this.sweepQuoteSequence += 1
    const firstChain = context.assets[0]?.chainId || null
    this.setState({
      amount: '',
      maxQuote: null,
      maxQuoteStatus: 'idle',
      maxReview: false,
      mode,
      queueError: '',
      sweepChainId: mode === 'sweep' ? this.state.sweepChainId || firstChain : this.state.sweepChainId,
      sweepIncludeNative: false,
      sweepQuote: null,
      sweepReview: false,
      sweepSelected: [],
      sweepStatus: 'idle'
    })
  }

  setSweepChain(chainId) {
    clearTimeout(this.quoteExpiryTimer)
    this.sweepQuoteSequence += 1
    this.setState({
      queueError: '',
      sweepChainId: Number(chainId),
      sweepIncludeNative: false,
      sweepQuote: null,
      sweepReview: false,
      sweepSelected: [],
      sweepStatus: 'idle'
    })
  }

  toggleSweepAsset(asset) {
    this.sweepQuoteSequence += 1
    const key = assetKey(asset)
    this.setState((state) => {
      const selected = state.sweepSelected.includes(key)
        ? state.sweepSelected.filter((entry) => entry !== key)
        : [...state.sweepSelected, key]
      if (selected.length + (state.sweepIncludeNative ? 1 : 0) > MAX_SWEEP_ASSETS) return null
      return {
        queueError: '',
        sweepQuote: null,
        sweepReview: false,
        sweepSelected: selected,
        sweepStatus: 'idle'
      }
    })
  }

  toggleSweepNative() {
    this.sweepQuoteSequence += 1
    this.setState((state) => {
      const includeNative = !state.sweepIncludeNative
      if (state.sweepSelected.length + (includeNative ? 1 : 0) > MAX_SWEEP_ASSETS) return null
      return {
        queueError: '',
        sweepIncludeNative: includeNative,
        sweepQuote: null,
        sweepReview: false,
        sweepStatus: 'idle'
      }
    })
  }

  selectSweepAssets(tokens, native) {
    this.sweepQuoteSequence += 1
    this.setState((state) => {
      const selectedCount = state.sweepSelected.length + (state.sweepIncludeNative ? 1 : 0)
      const availableCount = tokens.length + (native ? 1 : 0)
      const targetCount = Math.min(availableCount, MAX_SWEEP_ASSETS)
      const clear = selectedCount === targetCount
      const selectedTokens = clear ? [] : tokens.slice(0, MAX_SWEEP_ASSETS).map(assetKey)
      const includeNative = !clear && Boolean(native) && selectedTokens.length < MAX_SWEEP_ASSETS
      return {
        queueError: '',
        sweepIncludeNative: includeNative,
        sweepQuote: null,
        sweepReview: false,
        sweepSelected: selectedTokens,
        sweepStatus: 'idle'
      }
    })
  }

  async reviewSweep(event, context) {
    event.preventDefault()
    const { account, assets } = context
    if (!account || !this.state.recipientResolved || this.state.sweepStatus === 'loading') return
    const chainId = this.state.sweepChainId
    const selected = assets.filter(
      (asset) =>
        !asset.native && asset.chainId === chainId && this.state.sweepSelected.includes(assetKey(asset))
    )
    const count = selected.length + (this.state.sweepIncludeNative ? 1 : 0)
    if (!count || count > MAX_SWEEP_ASSETS) return

    const sequence = ++this.sweepQuoteSequence
    const recipient = this.state.recipientResolved
    const selectionFingerprint = selected
      .map((asset) => assetKey(asset))
      .sort()
      .join('|')
    const includeNative = this.state.sweepIncludeNative
    const accountId = account.id
    this.setState({ queueError: '', sweepQuote: null, sweepReview: false, sweepStatus: 'loading' })
    const result = await quoteSweep({
      account: account.id,
      chainId,
      recipient,
      tokens: selected.map((asset) => asset.address),
      includeNative
    })
    const currentSelection = [...this.state.sweepSelected].sort().join('|')
    if (
      !this.mounted ||
      sequence !== this.sweepQuoteSequence ||
      accountId !== (this.store('selected.current') || '') ||
      recipient !== this.state.recipientResolved ||
      chainId !== this.state.sweepChainId ||
      selectionFingerprint !== currentSelection ||
      includeNative !== this.state.sweepIncludeNative
    )
      return
    const quote = result.quote || result
    if (!result.success || !quote.quoteId || !Array.isArray(quote.calls) || quoteExpired(quote)) {
      this.setState({
        queueError:
          errorCopy[result.error] || 'Could not scan fresh balances. Check the network and try again.',
        sweepQuote: null,
        sweepReview: false,
        sweepStatus: 'error'
      })
      return
    }
    this.setState({ queueError: '', sweepQuote: quote, sweepReview: true, sweepStatus: 'ready' })
    this.scheduleQuoteExpiry('sweep', quote)
  }

  async submitSweep(context) {
    const { account } = context
    const quote = this.state.sweepQuote
    if (!account || !quote || this.state.queueing) return
    if (quoteExpired(quote)) {
      this.clearDerivedReview({ message: 'Sweep quote expired. Scan again before queueing.' })
      return
    }
    const sequence = ++this.queueSequence
    clearTimeout(this.quoteExpiryTimer)
    const requestRecipient = this.state.recipientResolved
    this.setState({ queueError: '', queueing: true })
    const result = await queueSweep({
      quoteId: quote.quoteId,
      account: account.id,
      chainId: this.state.sweepChainId,
      recipient: requestRecipient
    })
    if (!this.mounted || sequence !== this.queueSequence) return
    if (!result.success) {
      this.setState({
        queueError: errorCopy[result.error] || COPY.errorBody,
        queueing: false,
        sweepQuote: null,
        sweepReview: false,
        sweepStatus: 'error'
      })
      return
    }
    clearTimeout(this.quoteExpiryTimer)
    this.lastRequest = null
    this.setState({
      queueing: false,
      requestAccount: account.id,
      requestRecipient,
      requestId: result.handlerId || result.requestId || '',
      sweepStatus: result.handlerId || result.requestId ? 'queued' : 'queued-local'
    })
  }

  resetRequest(clearDraft = false) {
    const clearMaxAmount = Boolean(this.state.maxQuote)
    clearTimeout(this.quoteExpiryTimer)
    this.maxSequence += 1
    this.queueSequence += 1
    this.sweepQuoteSequence += 1
    this.lastRequest = null
    this.setState({
      ...(clearDraft
        ? { amount: '', recipient: '', recipientName: '', recipientResolved: '', recipientSource: '' }
        : clearMaxAmount
          ? { amount: '' }
          : {}),
      queueError: '',
      queueing: false,
      copyStatus: '',
      maxQuote: null,
      maxQuoteStatus: 'idle',
      maxReview: false,
      requestAccount: '',
      requestRecipient: '',
      requestId: '',
      sweepQuote: null,
      sweepReview: false,
      sweepStatus: 'idle'
    })
  }

  closeRetainedRequest(kind, request, failureMessage) {
    if (this.state.queueing) return
    this.setState({ queueError: '', queueing: true })
    const callback = (error) => {
      if (!this.mounted) return
      if (error) {
        this.setState({
          queueError: failureMessage,
          queueing: false
        })
        return
      }
      this.resetRequest(false)
    }
    if (kind === 'walletCalls') link.rpc('closeFailedWalletCallsRequest', request, callback)
    else link.rpc('closeFailedTransactionRequest', request, callback)
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
        <div className='sendPickerSearch wrenInputGroup'>
          <Icon name='search' size={15} />
          <input
            autoFocus
            aria-label='Search assets'
            className='wrenInput'
            onChange={(event) => this.setState({ assetFilter: event.target.value })}
            placeholder={COPY.searchAssets}
            value={this.state.assetFilter}
          />
        </div>
        <div className='sendAssetList'>
          {assets.length ? (
            assets.map((asset) => {
              const selected = context.selected && assetKey(asset) === assetKey(context.selected)
              const chainLabel =
                asset.chainName ||
                (Number.isSafeInteger(Number(asset.chainId))
                  ? `Chain ${Number(asset.chainId)}`
                  : 'Unknown network')
              return (
                <button
                  aria-label={`Select ${asset.symbol} on ${chainLabel}`}
                  aria-pressed={selected}
                  className={`sendAssetOption ${selected ? 'sendAssetOptionSelected' : ''}`}
                  key={assetKey(asset)}
                  onClick={() => {
                    this.setState(() => {
                      this.maxSequence += 1
                      return {
                        amount: '',
                        assetFilter: '',
                        maxQuote: null,
                        maxQuoteStatus: 'idle',
                        maxReview: false,
                        queueError: '',
                        selectedAsset: assetKey(asset)
                      }
                    })
                    this.closePicker()
                  }}
                  type='button'
                >
                  <AssetMark appearance='plain' asset={asset} />
                  <span className='sendAssetIdentity'>
                    <strong>{asset.symbol}</strong>
                    <span>{chainLabel}</span>
                  </span>
                  <span className='sendAssetBalance'>
                    <strong>{this.store('selected.hideBalances') ? '••••' : asset.displayBalance}</strong>
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
    const allAccounts = Object.values(this.store('main.accounts') || {}).filter(
      ({ status = 'ok' }) => status === 'ok'
    )
    const accounts = allAccounts
      .filter(({ address = '', ensName = '', id = '', name = '' }) => {
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
    const hiddenRecentAddresses = new Set([
      ...allAccounts.flatMap(({ address, id }) =>
        [address, id].filter((value) => typeof value === 'string').map((value) => value.toLowerCase())
      ),
      ...Object.values(this.store('main.addressBook') || {}).map(({ address }) => address.toLowerCase())
    ])
    const recentRecipients = this.store('main.rememberRecentRecipients')
      ? projectRecentRecipients(this.store('main.recentRecipientUses') || [])
          .filter(({ address }) => !hiddenRecentAddresses.has(address))
          .filter(({ address }) => !filter || address.includes(filter))
          .slice(0, 10)
      : []
    const noMatches = !accounts.length && !contacts.length && !recentRecipients.length

    return (
      <section className='sendPicker sendContactPicker cardShow' aria-label={COPY.chooseAContact}>
        <div className='sendPickerSearch wrenInputGroup'>
          <Icon name='search' size={15} />
          <input
            autoFocus
            aria-label='Search recipients'
            className='wrenInput'
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
          {contacts.length ? (
            <div className='sendPickerSection'>
              <h3 className='sendPickerSectionTitle'>{COPY.savedContacts}</h3>
              {contacts.map((contact) => (
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
                  <span className='sendContactContext'>
                    {contact.provenance.status === 'verified-out-of-band' ? 'Checked outside Wren' : 'Saved'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {recentRecipients.length ? (
            <div className='sendPickerSection sendRecentRecipients' aria-labelledby='send-recent-title'>
              <h3 id='send-recent-title'>{COPY.recentRecipients}</h3>
              {recentRecipients.map(({ address }) => (
                <button
                  className='sendContactOption sendRecentRecipientOption'
                  key={`recent:${address}`}
                  onClick={() => {
                    this.updateRecipient(address, COPY.recentRecipientSource)
                    this.setState({ contactFilter: '' })
                    this.closePicker()
                  }}
                  type='button'
                >
                  <span className='sendContactIcon' aria-hidden='true'>
                    <Icon name='send' size={17} />
                  </span>
                  <span className='sendContactIdentity'>
                    <strong>Recent recipient</strong>
                    <code>{address}</code>
                  </span>
                  <span className='sendContactContext'>{COPY.recentRecipientContext}</span>
                </button>
              ))}
            </div>
          ) : null}
          {noMatches ? (
            <div className='sendPickerEmpty'>
              {this.store('main.rememberRecentRecipients') ? COPY.noRecipients : COPY.noContacts}
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  renderMaxQuote(selected) {
    const { maxQuote, maxQuoteStatus, maxReview } = this.state
    if (maxQuoteStatus === 'loading') {
      return (
        <section aria-busy='true' aria-live='polite' className='sendQuotePanel' role='status'>
          <strong>{COPY.quotingMax}</strong>
          <span>The previous amount was cleared while Wren refreshed fee evidence.</span>
        </section>
      )
    }
    if (!maxQuote) return null
    const reserve = maxQuote.reserve || {}
    const rows = [
      ['Fee model', exactValue(reserve.feeModel)],
      ['Gas limit', exactValue(reserve.gasLimit)],
      ['Gas price', exactValue(reserve.gasPrice, ' wei')],
      ['Max fee per gas', exactValue(reserve.maxFeePerGas, ' wei')],
      ['Max priority fee per gas', exactValue(reserve.maxPriorityFeePerGas, ' wei')],
      ['Execution fee', exactValue(reserve.executionFee, ' wei')],
      ['L1 data fee', exactValue(reserve.l1Fee, ' wei')],
      ['Total reserved', exactValue(reserve.total, ' wei')],
      ['Quote expires', expiryLabel(maxQuote.expiresAt)]
    ].filter(
      ([label, value]) =>
        !['Gas price', 'Max fee per gas', 'Max priority fee per gas'].includes(label) ||
        value !== 'Not provided'
    )
    return (
      <section
        className={`sendQuotePanel ${maxReview ? 'sendQuotePanelReview' : ''}`}
        aria-label='Maximum-send quote'
      >
        <div className='sendQuoteHeading'>
          <div>
            <span>{maxReview ? 'Review maximum send' : 'Maximum sendable'}</span>
            <strong>
              {this.store('selected.hideBalances') ? '••••' : `${this.state.amount} ${selected.symbol}`}
            </strong>
          </div>
          <span className='sendQuoteBadge'>Fresh RPC quote</span>
        </div>
        <button
          className='wrenControl wrenControlGhost wrenControlCompact sendQuoteEdit'
          onClick={() => {
            this.clearDerivedReview({ clearAmount: true })
            setTimeout(() => this.amountRef.current?.focus(), 0)
          }}
          type='button'
        >
          Edit amount
        </button>
        <dl className='sendQuoteFacts'>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{this.store('selected.hideBalances') && /fee|reserved/i.test(label) ? '••••' : value}</dd>
            </div>
          ))}
        </dl>
        <p>
          {maxReview
            ? 'Verify the recipient, exact reserve, and expiry. Worst-case reserve may leave dust; queueing opens Wren’s normal signing review.'
            : 'This amount reserves the worst-case fee shown and may leave dust when the actual fee is lower. It is bound to this recipient and expiry; review is required.'}
        </p>
      </section>
    )
  }

  copySweepValue(label, value) {
    link.send('tray:clipboardData', String(value))
    clearTimeout(this.copyStatusTimer)
    this.setState({ copyStatus: `${label} copied` })
    this.copyStatusTimer = setTimeout(() => {
      if (this.mounted) this.setState({ copyStatus: '' })
    }, 4_000)
  }

  renderSweep(context, watchOnly) {
    const { account, assets } = context
    const hideBalances = this.store('selected.hideBalances')
    const chainIds = [...new Set(assets.map((asset) => asset.chainId))]
    const chainId = this.state.sweepChainId || chainIds[0]
    const chainAssets = assets.filter((asset) => asset.chainId === chainId)
    const native = chainAssets.find((asset) => asset.native)
    const tokens = chainAssets.filter((asset) => !asset.native)
    const selectedTokens = tokens.filter((asset) => this.state.sweepSelected.includes(assetKey(asset)))
    const selectedCount = selectedTokens.length + (this.state.sweepIncludeNative ? 1 : 0)
    const busy = this.state.sweepStatus === 'loading' || this.state.queueing
    const canReview =
      Boolean(
        account && this.state.recipientResolved && selectedCount && selectedCount <= MAX_SWEEP_ASSETS
      ) &&
      !watchOnly &&
      !busy
    const quote = this.state.sweepQuote

    if (quote && this.state.sweepReview) {
      const quotedAssets = Array.isArray(quote.assets) ? quote.assets : []
      const calls = Array.isArray(quote.calls) ? quote.calls : []
      return (
        <section className='sendSweepReview' aria-label='Review sweep'>
          <div className='sendSweepWarning' role='alert'>
            <strong>Sequential execution — not atomic</strong>
            <span>
              These transfers are submitted one-by-one. If one fails, earlier transfers stay on-chain and
              later transfers may not run. No bridge or batch contract is used. Wren does not retry
              automatically; start a fresh Sweep for any remainder.
            </span>
          </div>
          <div className='sendSweepTruth'>
            <div>
              <span>Recipient</span>
              <code>{quote.recipient || this.state.recipientResolved}</code>
              <button
                aria-label='Copy full sweep recipient address'
                className='wrenControl wrenControlGhost wrenControlCompact'
                onClick={() =>
                  this.copySweepValue('Recipient address', quote.recipient || this.state.recipientResolved)
                }
                type='button'
              >
                Copy
              </button>
            </div>
            {quotedAssets.map((asset, index) => (
              <div key={`${asset.address}:${index}`}>
                <span>Token {index + 1} · submitted before native</span>
                <code>{asset.address}</code>
                <code>{hideBalances ? '••••' : exactValue(asset.balance)}</code>
                <span className='sendSweepCopies'>
                  <button
                    aria-label={`Copy full token ${index + 1} address`}
                    className='wrenControl wrenControlGhost wrenControlCompact'
                    onClick={() => this.copySweepValue(`Token ${index + 1} address`, asset.address)}
                    type='button'
                  >
                    Copy address
                  </button>
                  <button
                    aria-label={`Copy full token ${index + 1} amount`}
                    aria-describedby={hideBalances ? 'sendSweepPrivacyCopy' : undefined}
                    className='wrenControl wrenControlGhost wrenControlCompact'
                    disabled={hideBalances}
                    onClick={() => this.copySweepValue(`Token ${index + 1} amount`, asset.balance)}
                    type='button'
                  >
                    Copy amount
                  </button>
                </span>
              </div>
            ))}
            {quote.native?.selected ? (
              <div>
                <span>Native asset · submitted last</span>
                <code>Native currency</code>
                <code>{hideBalances ? '••••' : exactValue(quote.native.value)}</code>
                <button
                  aria-label='Copy full native amount'
                  aria-describedby={hideBalances ? 'sendSweepPrivacyCopy' : undefined}
                  className='wrenControl wrenControlGhost wrenControlCompact'
                  disabled={hideBalances}
                  onClick={() => this.copySweepValue('Native amount', quote.native.value)}
                  type='button'
                >
                  Copy amount
                </button>
              </div>
            ) : null}
          </div>
          {hideBalances ? (
            <p className='sendSweepPrivacyCopy' id='sendSweepPrivacyCopy'>
              Amount copy and calldata are hidden while balance privacy is on.
            </p>
          ) : null}
          <details className='sendSweepCalls'>
            <summary>Exact ordered calls ({calls.length})</summary>
            {calls.map((call, index) => (
              <div key={`${call.to}:${index}`}>
                <strong>
                  {index + 1}.{' '}
                  {index === calls.length - 1 && quote.native?.selected ? 'Native last' : 'Token call'}
                </strong>
                <code>to: {call.to}</code>
                <code>value: {hideBalances ? '••••' : exactValue(call.value)}</code>
                <code>data: {hideBalances ? '••••' : exactValue(call.data)}</code>
              </div>
            ))}
          </details>
          <dl className='sendQuoteFacts'>
            <div>
              <dt>Maximum total fee</dt>
              <dd>{hideBalances ? '••••' : `${exactValue(quote.maximumFee)} wei`}</dd>
            </div>
            <div>
              <dt>Quote expires</dt>
              <dd>{expiryLabel(quote.expiresAt)}</dd>
            </div>
          </dl>
          {this.state.copyStatus ? (
            <span className='sendCopyStatus' aria-live='polite' role='status'>
              {this.state.copyStatus}
            </span>
          ) : null}
          <div className='sendSweepReviewActions'>
            <button
              className='wrenControl wrenControlGhost wrenControlLarge'
              disabled={this.state.queueing}
              onClick={() => this.clearDerivedReview()}
              type='button'
            >
              Back to selection
            </button>
            <button
              className='wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
              disabled={this.state.queueing}
              onClick={() => this.submitSweep(context)}
              type='button'
            >
              {this.state.queueing
                ? 'Queueing…'
                : `Queue ${calls.length} transfer${calls.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className='sendSweepSelect' aria-busy={busy ? 'true' : undefined}>
        <div className='sendSweepChain'>
          <label className='sendSweepChainLabel' htmlFor='send-sweep-chain'>
            Network
          </label>
          <div className='dropdownWrap'>
            <select
              className='dropdown wrenInput'
              disabled={busy}
              id='send-sweep-chain'
              onChange={(event) => this.setSweepChain(event.target.value)}
              value={chainId}
            >
              {chainIds.map((id) => (
                <option key={id} value={id}>
                  {assets.find((asset) => asset.chainId === id)?.chainName || id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className='sendSweepHeader'>
          <div>
            <strong>Select positive balances</strong>
            <span>
              {selectedCount} selected · {MAX_SWEEP_ASSETS} per sweep · one network
            </span>
          </div>
          <div className='sendSweepHeaderActions'>
            {this.state.sweepStatus === 'loading' ? (
              <span aria-live='polite'>Scanning fresh balances…</span>
            ) : null}
            <button
              className='sendSweepSelectAll wrenControl wrenControlGhost wrenControlCompact'
              disabled={busy || (tokens.length === 0 && !native)}
              onClick={() => this.selectSweepAssets(tokens, native)}
              type='button'
            >
              {selectedCount === Math.min(tokens.length + (native ? 1 : 0), MAX_SWEEP_ASSETS)
                ? 'Clear selection'
                : tokens.length + (native ? 1 : 0) > MAX_SWEEP_ASSETS
                  ? `Select first ${MAX_SWEEP_ASSETS}`
                  : 'Select all'}
            </button>
          </div>
        </div>
        <div aria-label='Select sweep assets' className='sendSweepAssets' role='group'>
          {tokens.map((asset) => {
            const checked = this.state.sweepSelected.includes(assetKey(asset))
            return (
              <label className={checked ? 'sendSweepAssetSelected' : ''} key={assetKey(asset)}>
                <input
                  checked={checked}
                  disabled={busy || (!checked && selectedCount >= MAX_SWEEP_ASSETS)}
                  onChange={() => this.toggleSweepAsset(asset)}
                  type='checkbox'
                />
                <span className='sendSweepCheckbox' aria-hidden='true'>
                  {checked ? <Icon name='check' size={14} /> : null}
                </span>
                <AssetMark appearance='plain' asset={asset} />
                <span>
                  <strong>{asset.symbol}</strong>
                  <code>{asset.address}</code>
                </span>
                <span>{this.store('selected.hideBalances') ? '••••' : asset.displayBalance}</span>
              </label>
            )
          })}
          {native ? (
            <label className={this.state.sweepIncludeNative ? 'sendSweepAssetSelected' : ''}>
              <input
                checked={this.state.sweepIncludeNative}
                disabled={busy || (!this.state.sweepIncludeNative && selectedCount >= MAX_SWEEP_ASSETS)}
                onChange={() => this.toggleSweepNative()}
                type='checkbox'
              />
              <span className='sendSweepCheckbox' aria-hidden='true'>
                {this.state.sweepIncludeNative ? <Icon name='check' size={14} /> : null}
              </span>
              <AssetMark appearance='plain' asset={native} />
              <span>
                <strong>Include {native.symbol}</strong>
                <code>Native currency · sent last</code>
              </span>
              <span>{this.store('selected.hideBalances') ? '••••' : native.displayBalance}</span>
            </label>
          ) : null}
          {!tokens.length && !native ? <p>No positive balances on this network.</p> : null}
        </div>
        <p className='sendSweepWarning sendSweepWarningCompact'>
          Sweep is sequential and non-atomic. Earlier completed transfers remain if a later one fails. No
          bridge, batch contract, or automatic retry is used. Native reserve may leave dust when actual fees
          are lower.
        </p>
        <div className='sendActionShelf sendSweepShelf'>
          <button
            className='wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
            disabled={!canReview}
            type='submit'
          >
            {this.state.sweepStatus === 'loading'
              ? 'Scanning balances…'
              : canReview
                ? `Review ${selectedCount} transfer${selectedCount === 1 ? '' : 's'}`
                : 'Select assets to sweep'}
          </button>
        </div>
      </section>
    )
  }

  renderRequestState(request) {
    const {
      body,
      changedMax,
      changedSweep,
      confirmed,
      declined,
      failed,
      heading,
      retainedFailure,
      retainedTransactionFailure
    } = this.requestStatePresentation(request)
    const savedContact = confirmed ? this.confirmedContact() : undefined
    const assertive = failed

    return (
      <section className={`sendRequestState ${confirmed ? 'sendRequestStateSuccess' : ''}`}>
        <div className='sendRequestGlyph'>
          <Icon name={confirmed ? 'check' : failed ? 'alert' : declined ? 'close' : 'pending'} size={28} />
        </div>
        <div
          aria-atomic='true'
          aria-live={assertive ? 'assertive' : 'polite'}
          role={assertive ? 'alert' : 'status'}
        >
          <h2 ref={this.requestHeadingRef} tabIndex={-1}>
            {heading}
          </h2>
          <p>{body}</p>
          {this.state.queueError ? <div className='sendComposerError'>{this.state.queueError}</div> : null}
        </div>
        {confirmed && this.state.requestRecipient ? (
          <div className='sendConfirmedDestination'>
            <span>{COPY.destination}</span>
            {savedContact ? <strong>{savedContact.name}</strong> : null}
            <code>{this.state.requestRecipient}</code>
            <button
              className='wrenControl wrenControlGhost wrenControlCompact'
              onClick={() => this.copyAddress(this.state.requestRecipient)}
              type='button'
            >
              Copy address
            </button>
            {this.state.copyStatus ? (
              <span aria-atomic='true' aria-live='polite' className='sendCopyStatus' role='status'>
                {this.state.copyStatus}
              </span>
            ) : null}
          </div>
        ) : null}
        {declined || failed ? (
          <button
            className='wrenControl wrenControlPrimary wrenControlLarge'
            disabled={retainedFailure && this.state.queueing}
            onClick={() => {
              if (changedSweep) {
                this.closeRetainedRequest(
                  'walletCalls',
                  request,
                  'Could not close the stale Sweep request. Open Wren and try again.'
                )
              } else if (retainedTransactionFailure) {
                this.closeRetainedRequest(
                  'transaction',
                  request,
                  changedMax
                    ? 'Could not close the stale Max request. Open Wren and try again.'
                    : 'Could not close the failed transaction request. Open Wren and try again.'
                )
              } else {
                this.resetRequest(false)
              }
            }}
            type='button'
          >
            {retainedFailure ? (this.state.queueing ? 'Closing…' : 'Close request') : COPY.tryAgain}
          </button>
        ) : confirmed ? (
          <div className='sendConfirmedActions'>
            <button
              className='wrenControl wrenControlGhost wrenControlLarge'
              onClick={() => this.openConfirmedContact()}
              type='button'
            >
              {savedContact ? COPY.viewContact : COPY.saveContact}
            </button>
            <button
              className='wrenControl wrenControlSecondary wrenControlLarge'
              onClick={() => this.closeRequestPanel()}
              type='button'
            >
              {COPY.close}
            </button>
          </div>
        ) : (
          <button
            className='wrenControl wrenControlGhost wrenControlLarge'
            onClick={() => this.closeRequestPanel()}
            type='button'
          >
            {COPY.close}
          </button>
        )}
      </section>
    )
  }

  render() {
    const context = this.getContext()
    const { account, assets, balanceError, scanning, selected, unavailableAssets } = context
    const { data = {} } = this.store('windows.dash.nav')[0] || {}
    if (data.step === 'assetPicker') return this.renderAssetPicker(context)
    if (data.step === 'contactPicker') return this.renderContactPicker()

    if (this.state.requestId) {
      return this.renderRequestState(this.requestForState())
    }

    if (!account || !assets.length) {
      const unavailableTitle = !account
        ? COPY.noAccount
        : balanceError
          ? 'Could not load balances'
          : scanning
            ? COPY.assetsChecking
            : unavailableAssets
              ? COPY.assetsDisconnected
              : COPY.noAssets
      const unavailableCopy = !account
        ? undefined
        : balanceError
          ? 'The configured RPC did not return balances. Check the network and try again.'
          : scanning
            ? COPY.assetsCheckingCopy
            : unavailableAssets
              ? COPY.assetsDisconnectedCopy
              : COPY.noAssetsCopy
      return (
        <div className='sendUnavailable'>
          <WrenEmptyState
            copy={unavailableCopy}
            expanded={true}
            image={emptyBalances}
            title={unavailableTitle}
            transparentImage={true}
          />
        </div>
      )
    }
    if (!selected && this.state.mode === 'send') {
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
    const derivationBusy = this.state.maxQuoteStatus === 'loading' || this.state.sweepStatus === 'loading'
    const canSubmit =
      !watchOnly &&
      !amountError &&
      Boolean(this.state.amount && this.state.recipientResolved) &&
      !derivationBusy &&
      !this.state.queueing
    const recipientHint =
      this.state.recipientStatus === 'resolving'
        ? COPY.recipientResolving
        : this.state.recipientStatus === 'resolved'
          ? this.state.recipientName
            ? `${this.state.recipientName}${this.state.recipientSource ? ` · ${this.state.recipientSource}` : ''}`
            : this.state.recipientSource || COPY.recipientResolved
          : ''

    return (
      <form
        aria-busy={derivationBusy || this.state.queueing ? 'true' : undefined}
        className={`sendComposer cardShow ${this.state.mode === 'sweep' ? 'sendComposerSweep' : ''}`}
        onSubmit={(event) =>
          this.state.mode === 'sweep' ? this.reviewSweep(event, context) : this.submit(event, context)
        }
      >
        <div aria-label='Send mode' className='sendModeSwitch' role='group'>
          <button
            aria-pressed={this.state.mode === 'send'}
            disabled={derivationBusy || this.state.queueing}
            onClick={() => this.setMode('send', context)}
            type='button'
          >
            Send one
          </button>
          <button
            aria-pressed={this.state.mode === 'sweep'}
            disabled={derivationBusy || this.state.queueing}
            onClick={() => this.setMode('sweep', context)}
            type='button'
          >
            Sweep assets
          </button>
        </div>
        <div className='sendLedger'>
          {this.state.mode === 'send' ? (
            <div className='sendLedgerRow sendAssetRow'>
              <span className='sendRowLabel'>{COPY.asset}</span>
              <button
                aria-label={COPY.chooseAsset}
                className='sendRowValue sendAssetValue'
                disabled={derivationBusy || this.state.queueing}
                ref={this.assetTriggerRef}
                onClick={() => this.openPicker('assetPicker', COPY.chooseAsset)}
                type='button'
              >
                <span className='sendAssetIdentityCluster'>
                  <AssetMark appearance='plain' asset={selected} />
                  <span>
                    <strong>{account.ensName || account.name || COPY.currentAccount}</strong>
                    <small>
                      {selected.symbol} ·{' '}
                      {this.store('selected.hideBalances')
                        ? 'Balance hidden'
                        : `${selected.displayBalance} ${selected.symbol}`}{' '}
                      · {selected.chainName}
                    </small>
                  </span>
                </span>
                <Icon name='next' size={17} />
              </button>
            </div>
          ) : null}

          <div className={`sendLedgerRow sendInputRow ${this.state.recipientError ? 'sendRowError' : ''}`}>
            <label className='sendRowLabel' htmlFor='send-recipient'>
              {COPY.recipient}
            </label>
            <span
              className={`sendInputWrap wrenInputGroup ${this.state.recipientError ? 'wrenInputGroupError' : ''}`}
            >
              <input
                autoComplete='off'
                aria-label='Recipient'
                aria-describedby='sendRecipientFeedback'
                aria-invalid={this.state.recipientError ? 'true' : undefined}
                className='sendRecipientInput wrenInput'
                disabled={derivationBusy || this.state.queueing || this.state.sweepReview}
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
                disabled={derivationBusy || this.state.queueing || this.state.sweepReview}
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
                  disabled={derivationBusy || this.state.queueing || this.state.sweepReview}
                  onClick={() => this.updateRecipient('')}
                  type='button'
                >
                  <Icon name='close' size={14} />
                </button>
              ) : null}
            </span>
            <span
              className='sendRowHint sendRecipientFeedback'
              id='sendRecipientFeedback'
              role={
                this.state.recipientError
                  ? 'alert'
                  : this.state.recipientStatus && !this.state.copyStatus
                    ? 'status'
                    : undefined
              }
            >
              {this.state.recipientError ||
                (this.state.recipientResolved ? (
                  <span className='sendRecipientResolved'>
                    {recipientHint ? <span>{recipientHint}</span> : null}
                    <code>{this.state.recipientResolved}</code>
                    <button
                      aria-label='Copy recipient address'
                      className='sendRecipientCopy'
                      disabled={derivationBusy || this.state.queueing || this.state.sweepReview}
                      onClick={() => this.copyAddress(this.state.recipientResolved)}
                      type='button'
                    >
                      Copy
                    </button>
                    {this.state.copyStatus ? (
                      <span aria-atomic='true' aria-live='polite' className='sendCopyStatus' role='status'>
                        {this.state.copyStatus}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  recipientHint
                ))}
            </span>
          </div>

          {this.state.mode === 'send' ? (
            <div className={`sendLedgerRow sendInputRow sendAmountRow ${amountError ? 'sendRowError' : ''}`}>
              <label className='sendRowLabel' htmlFor='send-amount'>
                {COPY.amount}
              </label>
              <span className={`sendInputWrap wrenInputGroup ${amountError ? 'wrenInputGroupError' : ''}`}>
                <input
                  autoComplete='off'
                  aria-describedby={[
                    amountError ? 'sendAmountError' : '',
                    'sendAvailableBalance',
                    maxNeedsRecipient && !amountError ? 'sendMaxReason' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-invalid={amountError ? 'true' : undefined}
                  className='sendAmountInput wrenInput'
                  disabled={derivationBusy || this.state.queueing || Boolean(this.state.maxQuote)}
                  id='send-amount'
                  inputMode='decimal'
                  ref={this.amountRef}
                  onChange={(event) => {
                    clearTimeout(this.quoteExpiryTimer)
                    this.maxSequence += 1
                    this.setState({
                      amount: event.target.value,
                      maxQuote: null,
                      maxQuoteStatus: 'idle',
                      maxReview: false,
                      queueError: ''
                    })
                  }}
                  placeholder='0.00'
                  spellCheck={false}
                  value={this.state.amount}
                />
                <span className='sendAmountSymbol'>{selected.symbol}</span>
                <button
                  aria-describedby={maxNeedsRecipient && !amountError ? 'sendMaxReason' : undefined}
                  className='sendMaxAction wrenControl wrenControlGhost wrenControlCompact'
                  disabled={
                    maxNeedsRecipient || derivationBusy || this.state.queueing || Boolean(this.state.maxQuote)
                  }
                  onClick={() => {
                    this.setMax(selected)
                  }}
                  type='button'
                >
                  {COPY.quoteMax}
                </button>
              </span>
              <span className='sendRowHint sendAmountHints'>
                {amountError ? (
                  <span className='sendAmountError' id='sendAmountError' role='alert'>
                    {amountError}
                  </span>
                ) : null}
                <span className='sendAvailableHint' id='sendAvailableBalance'>
                  {this.store('selected.hideBalances')
                    ? 'Available balance hidden'
                    : `Available: ${selected.displayBalance} ${selected.symbol}`}
                </span>
                {maxNeedsRecipient ? (
                  <span className='sendMaxReason' id='sendMaxReason'>
                    {COPY.maxNeedsRecipient}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}

          {this.state.mode === 'send' ? this.renderMaxQuote(selected) : null}

          {this.state.mode === 'send' && !this.state.maxQuote ? (
            <div className='sendLedgerRow sendFeeRow'>
              <span className='sendRowLabel'>{COPY.fee}</span>
              <span className='sendFeeValue'>{COPY.feeReview}</span>
              <span className='sendRowHint'>{COPY.reviewFee}</span>
            </div>
          ) : null}
        </div>

        {this.state.mode === 'sweep' ? this.renderSweep(context, watchOnly) : null}

        {watchOnly || this.state.queueError ? (
          <div
            className={watchOnly ? 'sendComposerError sendComposerNotice' : 'sendComposerError'}
            role='alert'
          >
            {watchOnly ? COPY.watchOnly : this.state.queueError}
          </div>
        ) : null}

        {this.state.mode === 'send' ? (
          <div className='sendActionShelf'>
            <button
              className='wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
              disabled={!canSubmit}
              type='submit'
            >
              {this.state.queueing
                ? COPY.primarySubmitting
                : this.state.maxReview
                  ? 'Queue transfer'
                  : this.state.maxQuote
                    ? 'Review maximum send'
                    : canSubmit
                      ? COPY.primaryReady
                      : COPY.primaryDisabled}
            </button>
          </div>
        ) : null}
      </form>
    )
  }
}

export default Restore.connect(Send)
