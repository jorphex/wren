import React from 'react'
import Restore from 'react-restore'

import AccountController, { AccountTypeMark } from './AccountController'

import emptyAccounts from 'url:../../../asset/ui/empty-accounts-v2.png'
import Icon from '../../../resources/Components/Icon'
import { accountSort as byCreation } from '../../../resources/domain/account'
import { getAddress, matchFilter } from '../../../resources/utils'

import link from '../../../resources/link'

let firstScroll = true

export class AccountSelector extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      accountFilter: context.store('panel.accountFilter') || ''
    }
    this.accountTriggerRef = React.createRef()
    this.accountDrawerRef = React.createRef()
    this.accountChooserRef = React.createRef()
    this.accountChooserWasOpen = Boolean(context.store('selected.showAccounts'))
    this.handleDrawerKeyDown = this.handleDrawerKeyDown.bind(this)
  }

  componentDidMount() {
    document.addEventListener('keydown', this.handleDrawerKeyDown)
    if (this.accountChooserWasOpen) this.focusAccountChooser()
  }

  componentDidUpdate() {
    const chooserOpen = Boolean(this.store('selected.showAccounts'))

    if (chooserOpen && !this.accountChooserWasOpen) this.focusAccountChooser()
    if (!chooserOpen && this.accountChooserWasOpen) this.accountTriggerRef.current?.focus()

    this.accountChooserWasOpen = chooserOpen
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleDrawerKeyDown)
  }

  handleDrawerKeyDown(event) {
    if (!this.store('selected.showAccounts')) return

    if (event.key === 'Escape') {
      event.preventDefault()
      this.store.toggleShowAccounts(false)
      return
    }

    if (event.key !== 'Tab') return

    const focusable = this.getAccountDrawerFocusable()
    if (!focusable.length) {
      event.preventDefault()
      this.accountChooserRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (!(this.accountDrawerRef.current || this.accountChooserRef.current)?.contains(active)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  getAccountChooserFocusable() {
    if (!this.accountChooserRef.current) return []

    return Array.from(
      this.accountChooserRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
  }

  getAccountDrawerFocusable() {
    const root = this.accountDrawerRef.current || this.accountChooserRef.current
    if (!root) return []

    return Array.from(
      root.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
  }

  focusAccountChooser() {
    const [first] = this.getAccountChooserFocusable()
    ;(first || this.accountChooserRef.current)?.focus()
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
          <Icon name='search' size={12} />
        </div>
        <div className='panelFilterInput'>
          <input
            aria-label='Filter accounts'
            className='wrenInput wrenInputQuiet'
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
          <span className='accountSwitcherIcon'>
            <AccountTypeMark type={currentAccount.lastSignerType} size={18} />
          </span>
          <span className='accountSwitcherIdentity'>
            <span className='accountSwitcherName'>{displayName}</span>
            <span className='accountSwitcherAddress'>{shortAddress}</span>
          </span>
          <span className='accountSwitcherChevron'>
            <Icon name={this.store('selected.showAccounts') ? 'chevron-up' : 'chevron-down'} size={14} />
          </span>
        </button>
        <div className='accountSwitcherControls'>
          <div className='accountSwitcherPrivacy'>
            <span className='accountSwitcherPrivacyLabel'>
              {hideBalances ? 'Balances hidden' : 'Balances visible'}
            </span>
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
            className='accountWorkspaceToggle wrenControl wrenControlGhost wrenControlIcon wrenShellNav'
            aria-label={workspaceOpen ? 'Close dashboard' : 'Open dashboard'}
            aria-pressed={workspaceOpen}
            onClick={() => link.send('tray:action', 'setDash', { showing: !workspaceOpen })}
          >
            <Icon name='workspace' size={19} />
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
      return (
        <div
          ref={this.accountDrawerRef}
          className='accountSelector accountSelectorOpen'
          role={accountDrawerOpen ? 'dialog' : undefined}
          aria-modal={accountDrawerOpen ? 'true' : undefined}
          aria-label={accountDrawerOpen ? 'Accounts' : undefined}
        >
          {this.renderCurrentAccount(currentAccount)}
          {this.renderAccountPanel(accounts)}
        </div>
      )
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
