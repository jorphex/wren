import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import Icon from '../../../resources/Components/Icon'
import AssetMark from '../../../resources/Components/AssetMark'
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

const COPY = Object.freeze({
  accountChanged: 'The selected account changed. Re-check the recipient and amount before trying again.',
  amount: 'Amount',
  amountExceedsBalance: 'Amount exceeds available balance',
  amountInvalid: 'Enter a valid amount',
  amountZero: 'Enter an amount',
  asset: 'Asset',
  assetUnavailable: 'This asset is no longer available to send on this network. Choose another asset.',
  backToAccount: 'Back to account',
  chooseAsset: 'Choose an asset',
  clearRecipient: 'Clear recipient',
  declinedBody: 'The request was declined before it was sent.',
  declinedHeading: 'Transaction declined',
  errorBody: 'The network did not accept this transaction.',
  errorHeading: 'Transaction failed',
  fee: 'Network fee',
  feeUnavailable: 'Fee estimate unavailable',
  maxNeedsRecipient: 'Enter a recipient to enable Max so we can estimate gas.',
  noAccount: 'Select an account to send',
  noAssets: 'No sendable assets on this network',
  noAssetsFound: 'No assets found',
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
  reviewFee: 'Estimated fee; review before signing.',
  searchAssets: 'Search assets',
  successBody: 'Your transaction was submitted successfully.',
  successHeading: 'Transaction sent',
  tryAgain: 'Try again',
  watchOnly: 'Watch-only accounts cannot sign transactions.'
})

const errorCopy = Object.freeze({
  'account-changed': COPY.accountChanged,
  'amount-exceeds-balance': COPY.amountExceedsBalance,
  'amount-invalid': COPY.amountInvalid,
  'amount-zero': COPY.amountZero,
  'asset-unavailable': COPY.assetUnavailable,
  'fee-unavailable': COPY.feeUnavailable,
  'network-unavailable': 'Network unavailable. Check your connection and try again.',
  'recipient-invalid': COPY.recipientInvalid,
  'watch-only': COPY.watchOnly
})

const assetKey = (asset) => `${asset.chainId}:${asset.address.toLowerCase()}`
const trimNumber = (value) => value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')

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
    this.state = {
      amount: '',
      assetFilter: '',
      pickerOpen: false,
      queueError: '',
      queueing: false,
      recipient: '',
      recipientError: '',
      recipientName: '',
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
    this.lockInitialAsset()
  }

  componentDidUpdate() {
    const accountId = this.store('selected.current') || ''
    if (accountId === this.accountId) {
      this.lockInitialAsset()
      return
    }
    this.accountId = accountId
    this.lastRequest = null
    this.maxSequence += 1
    this.queueSequence += 1
    this.recipientSequence += 1
    this.setState({
      amount: '',
      pickerOpen: false,
      queueError: '',
      queueing: false,
      recipient: '',
      recipientError: '',
      recipientName: '',
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
    this.maxSequence += 1
    this.queueSequence += 1
    this.recipientSequence += 1
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

    return { account, accountId, assets, metadata, networks, selected }
  }

  amountError(asset) {
    if (!this.state.amount) return ''
    const amount = parseTokenDecimalAmount(this.state.amount, asset.decimals)
    if (amount === undefined) return COPY.amountInvalid
    if (amount === 0n) return COPY.amountZero
    const balance = parseTokenBaseUnitAmount(asset.balance)
    return balance === undefined || amount > balance ? COPY.amountExceedsBalance : ''
  }

  async resolveRecipient(value) {
    const sequence = ++this.recipientSequence
    this.setState({
      recipientError: '',
      recipientName: '',
      recipientResolved: '',
      recipientStatus: 'resolving'
    })
    const result = await resolveSendRecipient(value)
    if (sequence !== this.recipientSequence || value !== this.state.recipient.trim()) return

    if (!result.success) {
      this.setState({ recipientError: COPY.recipientInvalid, recipientStatus: 'invalid' })
      return
    }

    const identity = resolveLocalAddressIdentity(
      this.store('main.addressBook'),
      this.store('main.accounts'),
      result.address
    )
    this.setState({
      recipientError: '',
      recipientName: identity?.label || result.name || '',
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

  feeSummary(asset, metadata) {
    const gas = metadata[asset.chainId]?.gas
    const gasPrice = gas?.price?.fees?.maxFeePerGas || gas?.price?.levels?.fast
    if (!gasPrice) return COPY.feeUnavailable
    const gasLimit = asset.native ? 21_000 : 65_000
    const nativeDecimals = metadata[asset.chainId].nativeCurrency.decimals || 18
    const fee = new BigNumber(gasPrice).times(gasLimit).shiftedBy(-nativeDecimals)
    if (!fee.isFinite()) return COPY.feeUnavailable
    return `${trimNumber(fee.toFixed(6))} ${metadata[asset.chainId].nativeCurrency.symbol}`
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
    this.lastRequest = null
    this.setState({
      ...(clearDraft ? { amount: '', recipient: '', recipientName: '', recipientResolved: '' } : {}),
      queueError: '',
      requestAccount: '',
      requestId: ''
    })
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
        <header className='sendPickerHeader'>
          <h2>{COPY.chooseAsset}</h2>
        </header>
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
                  onClick={() =>
                    this.setState(() => {
                      this.maxSequence += 1
                      return {
                        amount: '',
                        assetFilter: '',
                        pickerOpen: false,
                        queueError: '',
                        selectedAsset: assetKey(asset)
                      }
                    })
                  }
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

  renderRequestState(request) {
    const status = request?.status
    const declined = status === 'declined'
    const failed = status === 'error'
    const success = ['success', 'sent', 'confirming', 'confirmed'].includes(status)
    const heading = declined
      ? COPY.declinedHeading
      : failed
        ? COPY.errorHeading
        : success
          ? COPY.successHeading
          : COPY.queuedHeading
    const body = declined
      ? COPY.declinedBody
      : failed
        ? request?.notice || COPY.errorBody
        : success
          ? COPY.successBody
          : COPY.queuedBody

    return (
      <section className={`sendRequestState cardShow ${success ? 'sendRequestStateSuccess' : ''}`}>
        <div className='sendRequestGlyph'>
          <Icon name={success ? 'check' : failed || declined ? 'alert' : 'pending'} size={28} />
        </div>
        <h2>{heading}</h2>
        <p>{body}</p>
        {declined || failed ? (
          <button
            className='wrenControl wrenControlPrimary wrenControlLarge'
            onClick={() => this.resetRequest(false)}
            type='button'
          >
            {COPY.tryAgain}
          </button>
        ) : success ? (
          <button
            className='wrenControl wrenControlSecondary wrenControlLarge'
            onClick={() => this.resetRequest(true)}
            type='button'
          >
            {COPY.backToAccount}
          </button>
        ) : null}
      </section>
    )
  }

  render() {
    const context = this.getContext()
    const { account, assets, metadata, selected } = context
    if (this.state.pickerOpen) return this.renderAssetPicker(context)

    if (this.state.requestId) {
      const request = this.store('main.accounts', this.state.requestAccount, 'requests', this.state.requestId)
      if (request) this.lastRequest = { notice: request.notice, status: request.status }
      return this.renderRequestState(request || this.lastRequest)
    }

    if (!account) return <div className='sendUnavailable'>{COPY.noAccount}</div>
    if (!assets.length) return <div className='sendUnavailable'>{COPY.noAssets}</div>
    if (!selected) {
      return (
        <div className='sendUnavailable sendUnavailableAsset'>
          <span>{COPY.assetUnavailable}</span>
          <button
            className='wrenControl wrenControlSecondary wrenControlLarge'
            onClick={() => this.setState({ pickerOpen: true })}
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
            ? `Saved address: ${this.state.recipientName}`
            : COPY.recipientResolved
          : ''

    return (
      <form className='sendComposer cardShow' onSubmit={(event) => this.submit(event, context)}>
        <div className='sendLedger'>
          <button
            aria-label={COPY.chooseAsset}
            className='sendLedgerRow sendAssetRow'
            onClick={() => this.setState({ pickerOpen: true })}
            type='button'
          >
            <span className='sendRowLabel'>{COPY.asset}</span>
            <span className='sendRowValue sendAssetValue'>
              <span className='sendAssetIdentityCluster'>
                <AssetMark asset={selected} />
                <span>
                  <strong>{selected.symbol}</strong>
                  <small>{selected.chainName}</small>
                </span>
              </span>
              <Icon name='next' size={17} />
            </span>
          </button>

          <label className={`sendLedgerRow sendInputRow ${this.state.recipientError ? 'sendRowError' : ''}`}>
            <span className='sendRowLabel'>{COPY.recipient}</span>
            <span className='sendInputWrap'>
              <input
                autoComplete='off'
                className='sendRecipientInput'
                maxLength={255}
                onChange={(event) => this.updateRecipient(event.target.value)}
                placeholder={COPY.recipientPlaceholder}
                spellCheck={false}
                value={this.state.recipient}
              />
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
          </label>

          <label className={`sendLedgerRow sendInputRow sendAmountRow ${amountError ? 'sendRowError' : ''}`}>
            <span className='sendRowLabel'>{COPY.amount}</span>
            <span className='sendInputWrap'>
              <input
                autoComplete='off'
                className='sendAmountInput'
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
                onClick={() => this.setMax(selected)}
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
          </label>

          <div className='sendLedgerRow sendFeeRow'>
            <span className='sendRowLabel'>{COPY.fee}</span>
            <span className='sendFeeValue'>{this.feeSummary(selected, metadata)}</span>
            <span className='sendRowHint'>{COPY.reviewFee}</span>
          </div>
        </div>

        {watchOnly || this.state.queueError ? (
          <div className='sendComposerError' role='alert'>
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
