import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../../resources/Components/Icon'
import svg from '../../../../resources/svg'
import link from '../../../../resources/link'
import { getAddress } from '../../../../resources/utils'

export const accountTypeIcon = (type = '') => {
  if (type === 'address') return 'watch'
  if (type === 'seed') return 'seedling'
  if (type === 'ring') return 'key'
  if (['ledger', 'trezor', 'lattice'].includes(type)) return 'hardware'
  return 'accounts'
}

export const AccountTypeMark = ({ size = 17, type = '' }) => {
  if (type === 'ledger') return svg.ledger(size)
  if (type === 'trezor') return svg.trezor(size)
  if (type === 'lattice') return svg.lattice(size + 1)
  return <Icon name={accountTypeIcon(type)} size={size} />
}

export class Account extends React.Component {
  selectFromDrawer() {
    if (this.props.status !== 'ok') return

    if (this.store('selected.current') === this.props.id) {
      this.store.toggleShowAccounts(false)
      return
    }

    this.store.toggleShowAccounts(false)
    link.rpc('setSigner', this.props.id, (err) => {
      if (err) console.log(err)
    })
  }

  selectFromChooser() {
    if (this.props.status !== 'ok') return
    link.rpc('setSigner', this.props.id, (err) => {
      if (err) console.log(err)
    })
  }

  renderLedgerItem(drawer = false) {
    const { id, name, status, lastSignerType } = this.props
    const account = this.store('main.accounts', id) || this.props
    const address = getAddress(account.address || id)
    const displayName = account.ensName || name || 'Account'
    const current = this.store('selected.current') === id
    let requests = account.requests || {}
    requests = Object.keys(requests).filter((requestId) => requests[requestId].mode === 'normal')

    return (
      <button
        type='button'
        className={current ? 'accountDrawerItem accountDrawerItemSelected' : 'accountDrawerItem'}
        disabled={status !== 'ok'}
        aria-current={current ? 'true' : undefined}
        onClick={() => (drawer ? this.selectFromDrawer() : this.selectFromChooser())}
      >
        <span className='accountDrawerItemIcon'>
          <AccountTypeMark type={lastSignerType} />
        </span>
        <span className='accountDrawerItemIdentity'>
          <span className='accountDrawerItemName'>{displayName}</span>
          <span className='accountDrawerItemAddress'>
            {address.substring(0, 8)}…{address.slice(-6)}
          </span>
        </span>
        <span className='accountDrawerItemEnd'>
          {current ? <Icon name='check' size={15} /> : null}
          {!current && requests.length ? (
            <span
              className='accountDrawerRequestCount'
              role='status'
              aria-label={`${requests.length} pending account ${requests.length === 1 ? 'request' : 'requests'}`}
            >
              {requests.length}
            </span>
          ) : null}
        </span>
      </button>
    )
  }

  render() {
    return this.renderLedgerItem(Boolean(this.props.drawer))
  }
}

export default Restore.connect(Account)
