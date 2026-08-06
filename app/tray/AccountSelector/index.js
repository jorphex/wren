import React from 'react'
import Restore from 'react-restore'

import AccountController from './AccountController'

import emptyAccounts from 'url:../../../asset/ui/empty-accounts.png'
import Icon from '../../../resources/Components/Icon'
import { accountSort as byCreation } from '../../../resources/domain/account'
import { matchFilter } from '../../../resources/utils'

import link from '../../../resources/link'

let firstScroll = true

class AccountSelector extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      accountFilter: context.store('panel.accountFilter') || ''
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

  renderAccountFilter() {
    const accounts = this.store('main.accounts')
    const open = this.store('selected.open')
    if (Object.keys(accounts).length === 0 || open) return null

    return (
      <div className='panelFilterMain'>
        <div className='panelFilterIcon'>
          <Icon name='search' size={12} />
        </div>
        <div className='panelFilterInput'>
          <input
            aria-label='Filter accounts'
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
            className='panelFilterClear'
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

  renderAccountList() {
    const accounts = this.store('main.accounts')
    const sortedAccounts = Object.values(accounts).sort(byCreation)
    const filter = this.store('panel.accountFilter')

    const displayAccounts = sortedAccounts.filter(({ address, name, ensName, lastSignerType }) => {
      return matchFilter(filter, [address, name, ensName, lastSignerType])
    })

    return (
      <div
        className='accountSelectorScroll'
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
                reportScroll={() => this.reportScroll()}
                resetScroll={() => this.resetScroll()}
              />
            ))
          ) : Object.keys(accounts).length === 0 ? (
            <div className='accountSelectorEmpty'>
              <img alt='' aria-hidden='true' className='accountSelectorEmptyArtwork' src={emptyAccounts} />
              <div className='accountSelectorEmptyTitle'>No accounts yet</div>
              <div className='accountSelectorEmptyCopy'>Add an account to connect, review, and sign.</div>
              <button
                type='button'
                className='newAccountButton'
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
            <div className='noSigners'>{'No Matching Accounts'}</div>
          )}
        </div>
      </div>
    )
  }

  render() {
    const open = this.store('selected.open')

    return (
      <div className={open ? 'accountSelector accountSelectorOpen' : 'accountSelector'}>
        {this.renderAccountFilter()}
        {this.renderAccountList()}
      </div>
    )
  }
}

export default Restore.connect(AccountSelector)
