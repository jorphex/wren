import React from 'react'
import Restore from 'react-restore'

import AccountController from './AccountController'

import emptyAccounts from 'url:../../../asset/ui/empty-accounts-v2.png'
import wrenMark from 'url:../../../asset/brand/exports/mark/wren-mark-color-32.png'
import Icon from '../../../resources/Components/Icon'
import QrCode from '../../../resources/Components/QrCode'
import DialogSurface from '../../../resources/Components/DialogSurface'
import { accountSort as byCreation } from '../../../resources/domain/account'
import { getAddress, matchFilter } from '../../../resources/utils'

import link from '../../../resources/link'

let firstScroll = true

const AccountQrAction = ({ address, name }) => {
  const [focused, setFocused] = React.useState(false)
  const [hovered, setHovered] = React.useState(false)
  const previewId = React.useId()
  const titleId = `${previewId}-title`
  const open = focused || hovered

  return (
    <div
      className='accountHomeQrDisclosure accountSwitcherQr'
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type='button'
        aria-controls={previewId}
        aria-expanded={open}
        aria-label='Account address QR code'
        className='accountHomeQrTrigger wrenControl wrenControlGhost wrenControlIcon'
        title='Hover or focus to show the account address QR code'
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
      >
        <Icon name='qr' size={16} />
      </button>
      {open ? (
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
  )
}

export class AccountSelector extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      accountFilter: context.store('panel.accountFilter') || ''
    }
    this.accountTriggerRef = React.createRef()
    this.accountDrawerRef = React.createRef()
    this.accountChooserRef = React.createRef()
  }

  reportScroll() {
    const ref = this.scroll.current
    this.store.initialScrollPos(ref?.scrollTop)
  }

  resetScroll() {
    setTimeout(() => {
      if (firstScroll) {
        firstScroll = false
      } else {
        this.scroll.scrollTo({ top: -999999999999, left: 0, behavior: 'smooth' })
      }
    }, 3000)
  }

  renderAccountFilter() {
    const accounts = this.store('main.accounts')
    if (Object.keys(accounts).length === 0) return null

    return (
      <div className='panelFilterMain accountDrawerFilter'>
        <div className='panelFilterIcon'>
          <Icon name='search' size={15} />
        </div>
        <div className='panelFilterInput'>
          <input
            aria-label='Filter accounts'
            className='wrenInput'
            data-dialog-initial-focus
            spellCheck='false'
            onChange={(e) => {
              const value = e.target.value
              this.setState({ accountFilter: value })
              link.send('tray:action', 'setAccountFilter', value)
            }}
            value={this.state.accountFilter}
          />
        </div>
        {this.store('panel.accountFilter') ? (
          <button
            type='button'
            aria-label='Clear account filter'
            className='panelFilterClear wrenControl wrenControlGhost wrenControlIcon'
            onClick={() => {
              this.setState({ accountFilter: '' })
              link.send('tray:action', 'setAccountFilter', '')
            }}
          >
            <Icon name='close' size={12} />
          </button>
        ) : null}
      </div>
    )
  }

  renderWelcome() {
    return (
      <header className='accountSelectorWelcome'>
        <h1>Choose an account</h1>
        <p>Choose an account to open your wallet.</p>
      </header>
    )
  }

  renderAccountList(closeOnSelect = false) {
    const accounts = this.store('main.accounts')
    const sortedAccounts = Object.values(accounts).sort(byCreation)
    const filter = this.store('panel.accountFilter')

    const displayAccounts = sortedAccounts.filter(({ address, name, ensName, lastSignerType }) => {
      return matchFilter(filter, [address, name, ensName, lastSignerType])
    })

    return (
      <div
        className='accountSelectorScroll accountDrawerScroll'
        ref={(ref) => {
          if (ref) this.scroll = ref
        }}
      >
        {/* <div className='accountSelectorScrollWrap' style={current && scrollTop > 0 ? { marginTop: '-' + scrollTop + 'px' } : {}}> */}
        <div className='accountSelectorScrollWrap'>
          {displayAccounts.length ? (
            <>
              {displayAccounts.map((account, i) => (
                <AccountController
                  key={account.id}
                  {...account}
                  index={i}
                  drawer={closeOnSelect}
                  reportScroll={() => this.reportScroll()}
                  resetScroll={() => this.resetScroll()}
                />
              ))}
            </>
          ) : Object.keys(accounts).length === 0 ? (
            <div className='accountSelectorEmpty'>
              <img alt='' aria-hidden='true' className='accountSelectorEmptyArtwork' src={emptyAccounts} />
              <div className='accountSelectorEmptyTitle'>No accounts yet</div>
              <div className='accountSelectorEmptyCopy'>Add an account to connect, review, or sign.</div>
              <button
                type='button'
                className='newAccountButton wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
                onClick={() => {
                  link.send('tray:action', 'navDash', {
                    view: 'accounts',
                    data: { showAddAccounts: true }
                  })
                }}
              >
                <span className='newAccountIcon'>
                  <Icon name='add' size={14} />
                </span>
                <span className='newAccountText'>Add account</span>
              </button>
            </div>
          ) : (
            <div className='noSigners'>{'No matching accounts'}</div>
          )}
        </div>
      </div>
    )
  }

  addAccount() {
    this.store.toggleShowAccounts(false)
    link.send('tray:action', 'navDash', {
      view: 'accounts',
      data: { showAddAccounts: true }
    })
  }

  renderCurrentAccount(currentAccount) {
    const hideBalances = this.store('selected.hideBalances')
    const workspaceOpen = Boolean(this.store('windows.dash.showing'))
    const address = getAddress(currentAccount.address || currentAccount.id)
    const displayName = currentAccount.ensName || currentAccount.name || 'Account'
    const shortAddress = `${address.substring(0, 6)}…${address.slice(-4)}`
    return (
      <div className='accountSwitcherBar'>
        <button
          type='button'
          ref={this.accountTriggerRef}
          className='accountSwitcherTrigger wrenControl wrenControlGhost'
          aria-expanded={this.store('selected.showAccounts')}
          aria-controls='account-switcher-panel'
          onClick={() => this.store.toggleShowAccounts()}
        >
          <img alt='' aria-hidden='true' className='accountSwitcherBrand' src={wrenMark} />
          <span className='accountSwitcherIdentity'>
            <span className='accountSwitcherName'>{displayName}</span>
            <span className='accountSwitcherAddress'>{shortAddress}</span>
          </span>
        </button>
        <div className='accountSwitcherControls'>
          <div className='accountSwitcherPrivacy'>
            <button
              type='button'
              className={
                hideBalances
                  ? 'accountPrivacyToggle accountPrivacyToggleHidden wrenControl wrenControlGhost wrenControlIcon'
                  : 'accountPrivacyToggle wrenControl wrenControlGhost wrenControlIcon'
              }
              aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
              aria-pressed={hideBalances}
              onClick={() => this.store.toggleHideBalances()}
            >
              <Icon name='eye' size={18} />
            </button>
          </div>
          <button
            type='button'
            className='accountCopyAddress wrenControl wrenControlGhost wrenControlIcon'
            aria-label='Copy account address'
            onClick={() => link.send('tray:clipboardData', address)}
          >
            <Icon name='copy' size={17} />
          </button>
          <AccountQrAction address={address} name={displayName} />
          <button
            type='button'
            className='accountWorkspaceToggle wrenControl wrenControlGhost wrenControlIcon wrenShellNav'
            aria-label={workspaceOpen ? 'Close dashboard' : 'Open dashboard'}
            aria-pressed={workspaceOpen}
            onClick={() => link.send('tray:action', 'setDash', { showing: !workspaceOpen })}
          >
            <Icon name={workspaceOpen ? 'panelSplit' : 'panelSingle'} size={19} />
          </button>
        </div>
      </div>
    )
  }

  renderAccountPanel(accounts) {
    if (!this.store('selected.showAccounts')) return null

    return (
      <section
        id='account-switcher-panel'
        ref={this.accountChooserRef}
        className='accountChooserPanel'
        aria-label='Accounts'
        tabIndex={-1}
      >
        {this.renderAccountFilter()}
        {this.renderAccountList(true)}
        {Object.keys(accounts).length ? (
          <div className='accountDrawerFooter'>
            <button
              type='button'
              className='accountDrawerAdd wrenControl wrenControlPrimary'
              onClick={() => this.addAccount()}
            >
              <Icon name='add' size={14} />
              <span>Add account</span>
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  render() {
    const accounts = this.store('main.accounts')
    const current = this.store('selected.current')
    const open = this.store('selected.open')
    const currentAccount = accounts[current]
    const accountDrawerOpen = Boolean(this.store('selected.showAccounts'))

    if (open && currentAccount) {
      const content = (
        <>
          {this.renderCurrentAccount(currentAccount)}
          {this.renderAccountPanel(accounts)}
        </>
      )

      if (accountDrawerOpen) {
        return (
          <DialogSurface
            ref={this.accountDrawerRef}
            className='accountSelector accountSelectorOpen'
            modal
            ariaLabel='Accounts'
            returnFocusRef={this.accountTriggerRef}
            onCancel={() => this.store.toggleShowAccounts(false)}
          >
            {content}
          </DialogSurface>
        )
      }

      return <div className='accountSelector accountSelectorOpen'>{content}</div>
    }

    return (
      <div className='accountSelector'>
        {Object.keys(accounts).length ? this.renderWelcome() : null}
        {this.renderAccountFilter()}
        {this.renderAccountList()}
      </div>
    )
  }
}

export default Restore.connect(AccountSelector)
