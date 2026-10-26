import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../../resources/Components/Icon'
import useCopiedMessage from '../../../../resources/Hooks/useCopiedMessage'
import { formatTokenBaseUnitAmount } from '../../../../resources/domain/token/amount'
import { MAX_TOKEN_APPROVAL_REFRESH } from '../../../../resources/domain/tokenApprovalsLimits'
import link from '../../../../resources/link'

const rpc = (send) =>
  new Promise((resolve, reject) => {
    send((error, result) => (error ? reject(new Error(error)) : resolve(result)))
  })

const CopyAddress = ({ address, label }) => {
  const [copied, copy] = useCopiedMessage(address)
  return (
    <button
      type='button'
      className='tokenApprovalAddress'
      aria-label={`Copy ${label.toLowerCase()} address`}
      onClick={copy}
    >
      <span>{address}</span>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

const metadataFor = (tokens, entry) => {
  const matches = tokens.filter(
    (token) => token.chainId === entry.chainId && token.address?.toLowerCase() === entry.token
  )
  const token = matches[0]
  if (
    !token ||
    matches.some((match) => match.decimals !== token.decimals) ||
    typeof token.symbol !== 'string' ||
    !token.symbol.trim() ||
    token.symbol.length > 24 ||
    /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(token.symbol) ||
    formatTokenBaseUnitAmount('0', token.decimals) === undefined
  )
    return undefined
  return token
}

const amountLabel = (entry, token) => {
  if (entry.status !== 'current')
    return { unchecked: 'Not checked', unavailable: 'Unavailable', 'network-off': 'Network off' }[
      entry.status
    ]
  if (entry.amount === '0') return 'None'
  if (entry.amount === ((1n << 256n) - 1n).toString()) return 'Unlimited'
  return token
    ? `${formatTokenBaseUnitAmount(entry.amount, token.decimals)} ${token.symbol}`
    : `${entry.amount} base units`
}

export class Approvals extends React.Component {
  refreshRef = React.createRef()
  state = { entries: [], page: 0, busy: false, opening: '', error: '', loaded: false }
  operation = 0

  componentDidMount() {
    this.mounted = true
    void this.load(true)
    this.timer = setInterval(() => {
      if (!this.pending) void this.load(false)
    }, 15_000)
  }

  componentDidUpdate(previous) {
    if (previous.account !== this.props.account) {
      this.operation += 1
      this.pending = false
      this.setState({ entries: [], page: 0, opening: '', loaded: false }, () => void this.load(true))
    }
  }

  componentWillUnmount() {
    this.mounted = false
    this.operation += 1
    clearInterval(this.timer)
  }

  async load(refresh) {
    if (this.pending) return
    const operation = ++this.operation
    const account = this.props.account
    this.pending = true
    if (refresh) this.setState({ busy: true, error: '' })
    try {
      let entries = await rpc((done) => link.rpc('getTokenApprovals', account, done))
      if (!this.mounted || operation !== this.operation) return
      const page = Math.min(
        this.state.page,
        Math.max(0, Math.ceil(entries.length / MAX_TOKEN_APPROVAL_REFRESH) - 1)
      )
      if (refresh && entries.length) {
        const selected = entries.slice(
          page * MAX_TOKEN_APPROVAL_REFRESH,
          (page + 1) * MAX_TOKEN_APPROVAL_REFRESH
        )
        const checked = await rpc((done) =>
          link.rpc(
            'refreshTokenApprovals',
            account,
            selected.map(({ id }) => id),
            done
          )
        )
        entries = entries.map((entry) => checked.find(({ id }) => id === entry.id) || entry)
      }
      if (this.mounted && operation === this.operation) this.setState({ entries, page, loaded: true })
    } catch {
      if (this.mounted && operation === this.operation)
        this.setState({ error: 'Could not check approvals. Try again.', loaded: true })
    } finally {
      if (this.mounted && operation === this.operation) {
        this.pending = false
        this.setState({ busy: false })
      }
    }
  }

  async revoke(entry) {
    if (this.pending) return
    this.pending = true
    const operation = ++this.operation
    this.setState({ opening: entry.id, error: '' })
    try {
      const reference = await rpc((done) =>
        link.rpc('revokeTokenApproval', this.props.account, entry.id, done)
      )
      if (!this.mounted || operation !== this.operation) return
      link.send('nav:forward', 'panel', {
        view: 'requestView',
        data: { accountId: reference.account, requestId: reference.handlerId, step: 'confirm' }
      })
    } catch {
      if (this.mounted && operation === this.operation)
        this.setState({ error: 'Could not open revocation review. Refresh and try again.' })
    } finally {
      if (this.mounted && operation === this.operation) {
        this.pending = false
        this.setState({ opening: '' })
      }
    }
  }

  async forget() {
    if (this.pending) return
    this.pending = true
    const operation = ++this.operation
    this.setState({ busy: true, error: '' })
    let cleared = false
    try {
      await rpc((done) => link.rpc('clearTokenApprovals', this.props.account, done))
      if (this.mounted && operation === this.operation) {
        cleared = true
        this.setState({ entries: [], page: 0 })
      }
    } catch {
      if (this.mounted && operation === this.operation)
        this.setState({ error: 'Could not save the history change. Try again.' })
    } finally {
      if (this.mounted && operation === this.operation) {
        this.pending = false
        this.setState({ busy: false }, () => {
          if (cleared) this.refreshRef.current?.focus()
        })
      }
    }
  }

  render() {
    const { entries, page, busy, opening, error, loaded } = this.state
    const tokens = [
      this.store('main.balances', this.props.account),
      this.store('main.tokens.known', this.props.account),
      this.store('main.tokens.custom')
    ].flatMap((value) => (Array.isArray(value) ? value : []))
    const hidden = this.store('selected.hideBalances')
    const account = this.store('main.accounts', this.props.account) || {}
    const canRevoke =
      Boolean(account.signer) && this.store('main.signers', account.signer, 'type') !== 'watch'
    const pages = Math.ceil(entries.length / MAX_TOKEN_APPROVAL_REFRESH)
    return (
      <section className='accountViewScroll tokenApprovalsView' aria-label='Token approvals'>
        <div className='tokenApprovalsBody'>
          <header className='tokenApprovalsToolbar'>
            <span>Observed token approvals</span>
            <button
              type='button'
              ref={this.refreshRef}
              className='wrenControl wrenControlSecondary wrenControlLarge'
              disabled={busy || Boolean(opening)}
              onClick={() => void this.load(true)}
            >
              {busy ? 'Checking…' : 'Refresh'}
            </button>
          </header>
          {error ? (
            <p className='tokenApprovalsError' role='alert'>
              {error}
            </p>
          ) : null}
          {entries.length ? (
            <ol className='tokenApprovalsList'>
              {entries
                .slice(page * MAX_TOKEN_APPROVAL_REFRESH, (page + 1) * MAX_TOKEN_APPROVAL_REFRESH)
                .map((entry) => {
                  const token = metadataFor(tokens, entry)
                  const networkName =
                    this.store('main.networks.ethereum', entry.chainId, 'name') || `Chain ${entry.chainId}`
                  return (
                    <li key={entry.id} className='tokenApprovalRow'>
                      <header>
                        <strong>{token?.symbol || 'Token'}</strong>
                        <span>{networkName}</span>
                      </header>
                      <div className='tokenApprovalField'>
                        <span>Token</span>
                        <CopyAddress address={entry.token} label='Token' />
                      </div>
                      <div className='tokenApprovalField'>
                        <span>Spender</span>
                        <CopyAddress address={entry.spender} label='Spender' />
                      </div>
                      <div className='tokenApprovalActions'>
                        <div className='tokenApprovalLimit'>
                          <span>Current allowance</span>
                          <strong className={hidden ? '' : 'tokenApprovalAmount'}>
                            {hidden ? 'Amount hidden' : amountLabel(entry, token)}
                          </strong>
                        </div>
                        <button
                          type='button'
                          className='wrenControl wrenControlDanger wrenControlLarge'
                          aria-label={`Revoke ${token?.symbol || 'token'} approval`}
                          disabled={
                            busy ||
                            Boolean(opening) ||
                            !canRevoke ||
                            entry.status !== 'current' ||
                            entry.amount === '0'
                          }
                          onClick={() => void this.revoke(entry)}
                        >
                          {opening === entry.id ? 'Opening…' : 'Revoke'}
                        </button>
                      </div>
                    </li>
                  )
                })}
            </ol>
          ) : error ? null : (
            <p className='tokenApprovalsEmpty' role='status'>
              {!loaded ? 'Loading approvals…' : 'No observed token approvals'}
            </p>
          )}
          {pages > 1 ? (
            <nav className='tokenApprovalsPagination' aria-label='Approval pages'>
              <button
                type='button'
                className='wrenControl wrenControlSecondary wrenControlLarge'
                disabled={busy || Boolean(opening) || !page}
                onClick={() => this.setState({ page: page - 1 }, () => void this.load(true))}
              >
                Previous
              </button>
              <span>
                {page + 1} / {pages}
              </span>
              <button
                type='button'
                className='wrenControl wrenControlSecondary wrenControlLarge'
                disabled={busy || Boolean(opening) || page + 1 === pages}
                onClick={() => this.setState({ page: page + 1 }, () => void this.load(true))}
              >
                Next
              </button>
            </nav>
          ) : null}
          <details className='tokenApprovalsAbout'>
            <summary>About this list</summary>
            <p>
              Token approvals submitted through Wren appear here. Refresh checks current allowances through
              your configured RPC. Earlier approvals, NFT approvals, and signed permits are not included.
            </p>
            <p>
              Records stay on this device for up to a year, with a limit of 500. Forgetting them does not
              change onchain allowances.
            </p>
            {entries.length ? (
              <button
                type='button'
                className='wrenControl wrenControlSecondary wrenControlLarge'
                disabled={busy || Boolean(opening)}
                onClick={() => void this.forget()}
              >
                Forget observed approvals
              </button>
            ) : null}
          </details>
        </div>
      </section>
    )
  }
}

export default Restore.connect(Approvals)
