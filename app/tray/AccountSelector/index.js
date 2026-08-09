import React from 'react'
import Restore from 'react-restore'

import AccountController from './AccountController'

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
    this.drawerRef = React.createRef()
    this.drawerCloseRef = React.createRef()
    this.drawerWasOpen = Boolean(context.store('selected.showAccounts'))
    this.handleDrawerKeyDown = this.handleDrawerKeyDown.bind(this)
  }

  componentDidMount() {
    document.addEventListener('keydown', this.handleDrawerKeyDown)
  }

  componentDidUpdate() {
    const drawerOpen = Boolean(this.store('selected.showAccounts'))

    if (drawerOpen && !this.drawerWasOpen) this.drawerCloseRef.current?.focus()
    if (!drawerOpen && this.drawerWasOpen) this.accountTriggerRef.current?.focus()

    this.drawerWasOpen = drawerOpen
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

    if (event.key !== 'Tab' || !this.drawerRef.current) return

    const focusable = Array.from(
      this.drawerRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hidden)

    if (!focusable.length) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
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

  renderAccountFilter(drawer = false) {
    const accounts = this.store('main.accounts')
    const open = this.store('selected.open')
    if (Object.keys(accounts).length === 0 || (open && !drawer)) return null

    return (
      <div className={drawer ? 'panelFilterMain accountDrawerFilter' : 'panelFilterMain'}>
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

  renderAccountList(drawer = false) {
    const accounts = this.store('main.accounts')
    const sortedAccounts = Object.values(accounts).sort(byCreation)
    const filter = this.store('panel.accountFilter')

    const displayAccounts = sortedAccounts.filter(({ address, name, ensName, lastSignerType }) => {
      return matchFilter(filter, [address, name, ensName, lastSignerType])
    })

    return (
      <div
        className={drawer ? 'accountSelectorScroll accountDrawerScroll' : 'accountSelectorScroll'}
        ref={(ref) => {
          if (ref) this.scroll = ref
        }}
      >
        {/* <div className='accountSelectorScrollWrap' style={current && scrollTop > 0 ? { marginTop: '-' + scrollTop + 'px' } : {}}> */}
        <div className='accountSelectorScrollWrap'>
          {displayAccounts.length ? (
            displayAccounts.map((account, i) => (
              <AccountController
                key={account.id}
                {...account}
                index={i}
                drawer={drawer}
                reportScroll={() => this.reportScroll()}
                resetScroll={() => this.resetScroll()}
              />
            ))
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
    const address = getAddress(currentAccount.address || currentAccount.id)
    const displayName = currentAccount.ensName || currentAccount.name || 'Account'
    const shortAddress = `${address.substring(0, 6)}…${address.slice(-4)}`

    return (
      <div className='accountSwitcherBar'>
        <button
          type='button'
          ref={this.accountTriggerRef}
          className='accountSwitcherTrigger wrenControl wrenControlSecondary'
          aria-expanded={this.store('selected.showAccounts')}
          aria-controls='account-switcher-drawer'
          onClick={() => this.store.toggleShowAccounts()}
        >
          <span className='accountSwitcherIcon'>
            <Icon name='accounts' size={18} />
          </span>
          <span className='accountSwitcherIdentity'>
            <span className='accountSwitcherName'>{displayName}</span>
            <span className='accountSwitcherAddress'>{shortAddress}</span>
          </span>
          <span className='accountSwitcherChevron'>
            <Icon name={this.store('selected.showAccounts') ? 'chevron-up' : 'chevron-down'} size={14} />
          </span>
        </button>
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
      </div>
    )
  }

  renderDrawer(accounts) {
    if (!this.store('selected.showAccounts')) return null

    return (
      <>
        <button
          type='button'
          className='accountDrawerScrim'
          aria-hidden='true'
          tabIndex={-1}
          onClick={() => this.store.toggleShowAccounts(false)}
        />
        <aside
          id='account-switcher-drawer'
          ref={this.drawerRef}
          className='accountDrawer'
          role='dialog'
          aria-modal='true'
          aria-labelledby='account-drawer-title'
        >
          <div className='accountDrawerHeader'>
            <div>
              <span id='account-drawer-title' className='accountDrawerTitle'>
                Accounts
              </span>
              <span className='accountDrawerCount'>{Object.keys(accounts).length}</span>
            </div>
            <button
              type='button'
              ref={this.drawerCloseRef}
              className='accountDrawerClose wrenControl wrenControlGhost wrenControlIcon'
              aria-label='Close account drawer'
              onClick={() => this.store.toggleShowAccounts(false)}
            >
              <Icon name='close' size={14} />
            </button>
          </div>
          {this.renderAccountFilter(true)}
          {this.renderAccountList(true)}
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
        </aside>
      </>
    )
  }

  render() {
    const accounts = this.store('main.accounts')
    const current = this.store('selected.current')
    const open = this.store('selected.open')
    const currentAccount = accounts[current]

    if (open && currentAccount) {
      return (
        <div className='accountSelector accountSelectorOpen'>
          {this.renderCurrentAccount(currentAccount)}
          {this.renderDrawer(accounts)}
        </div>
      )
    }

    return (
      <div className='accountSelector'>
        {this.renderAccountFilter()}
        {this.renderAccountList()}
      </div>
    )
  }
}

export default Restore.connect(AccountSelector)
