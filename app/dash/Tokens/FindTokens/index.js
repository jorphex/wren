import { Component, useEffect, useRef, useState } from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import link from '../../../../resources/link'

const secondary = 'wrenControl wrenControlSecondary wrenControlCompact'

function TokenResults({ scope, hideBalances }) {
  const activeRequest = useRef(null)
  const [pending, setPending] = useState('')
  const [page, setPage] = useState(null)
  const [message, setMessage] = useState('')
  const [added, setAdded] = useState([])
  useEffect(
    () => () => {
      activeRequest.current = null
    },
    []
  )

  async function find(offset) {
    if (activeRequest.current) return
    const request = { canceled: false }
    activeRequest.current = request
    setPending('lookup')
    setMessage('')
    try {
      const result = await link.invoke('tokens:find', scope, offset)
      if (activeRequest.current !== request || request.canceled) return
      if (!result?.success) throw new Error('lookup failed')
      setPage(result)
    } catch {
      if (activeRequest.current === request && !request.canceled)
        setMessage('Couldn’t check this page. Try again.')
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setPending('')
      }
    }
  }

  async function track(token) {
    if (activeRequest.current) return
    const request = { canceled: false }
    activeRequest.current = request
    setPending(token.address)
    setMessage('')
    try {
      const result = await link.invoke('tokens:trackDiscovered', scope, token.address)
      if (activeRequest.current !== request || request.canceled) return
      if (!result?.success) throw new Error('token could not be added')
      setAdded((addresses) => [...addresses, token.address])
      setMessage(`${token.symbol} added to balances.`)
    } catch {
      if (activeRequest.current === request && !request.canceled)
        setMessage('Couldn’t add this token. Check again.')
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setPending('')
      }
    }
  }

  const cancel = () => {
    if (!activeRequest.current) return
    activeRequest.current.canceled = true
    setPending('canceled')
    setMessage('Lookup canceled.')
  }
  return (
    <>
      {page?.matches.map((token) => (
        <article className='tokenDiscoveryMatch' key={token.address}>
          <div>
            <strong>{token.symbol}</strong>
            <span>{token.name}</span>
            <span className='tokenDiscoveryAddress' title={token.address}>
              {token.address}
            </span>
            {hideBalances ? (
              <span aria-label='Balance hidden'>••••</span>
            ) : (
              <span className='tokenDiscoveryAmount'>
                {new BigNumber(token.balance).shiftedBy(-token.decimals).toFixed()}
              </span>
            )}
          </div>
          <button
            className={secondary}
            type='button'
            disabled={Boolean(pending) || added.includes(token.address)}
            aria-label={added.includes(token.address) ? undefined : `Add ${token.symbol} at ${token.address}`}
            onClick={() => track(token)}
          >
            {added.includes(token.address) ? 'Added' : pending === token.address ? 'Adding…' : 'Add'}
          </button>
        </article>
      ))}
      {pending === 'lookup' && <p role='status'>Checking balances…</p>}
      {!pending && page && !page.matches.length && <p>No new tokens on this page.</p>}
      {page?.partial && <p>Some tokens could not be checked.</p>}
      {message && <p role='status'>{message}</p>}
      <div className='tokenDiscoveryActions'>
        {pending === 'lookup' ? (
          <button type='button' className={secondary} onClick={cancel}>
            Cancel
          </button>
        ) : (
          <>
            <button type='button' className={secondary} onClick={() => find(0)} disabled={Boolean(pending)}>
              {page ? 'Check again' : 'Find tokens'}
            </button>
            {page?.next != null && (
              <button
                type='button'
                className={secondary}
                onClick={() => find(page.next)}
                disabled={Boolean(pending)}
              >
                Check next page
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

class FindTokens extends Component {
  state = { account: '', chainId: '', source: 'activity' }

  render() {
    const saved = this.store('main.accounts') || {}
    const accounts = Object.keys(saved).filter((address) => /^0x[0-9a-f]{40}$/i.test(address))
    const networks = Object.values(this.store('main.networks.ethereum') || {}).filter(
      ({ on, connection }) => on && connection.endpoints.some((endpoint) => endpoint.on && endpoint.connected)
    )
    const selected = this.store('selected.current')
    const account = this.state.account || (accounts.includes(selected) ? selected : accounts[0]) || ''
    const chainId = this.state.chainId || networks[0]?.id || ''
    const source = this.state.source
    const networkAvailable = networks.some(({ id }) => id === Number(chainId))
    const scope =
      accounts.includes(account) && networkAvailable ? { account, chainId: Number(chainId), source } : null
    return (
      <div className='customTokensPage tokenDiscovery'>
        <h1>Find tokens</h1>
        <div className='tokenDiscoveryFields'>
          <label>
            Account
            <select
              className='wrenInput'
              value={accounts.includes(account) ? account : ''}
              onChange={({ target }) => this.setState({ account: target.value })}
            >
              <option value='' disabled>
                Select account
              </option>
              {accounts.map((address) => (
                <option key={address} value={address}>
                  {saved[address].name || address}
                </option>
              ))}
            </select>
          </label>
          <label>
            Network
            <select
              className='wrenInput'
              value={networkAvailable ? chainId : ''}
              onChange={({ target }) => this.setState({ chainId: target.value })}
            >
              <option value='' disabled>
                Select network
              </option>
              {networks.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Look in
            <select
              className='wrenInput'
              value={source}
              onChange={({ target }) => this.setState({ source: target.value })}
            >
              <option value='activity'>Recent activity</option>
              <option value='catalog'>Token catalog</option>
            </select>
          </label>
        </div>
        <p>
          {source === 'activity'
            ? 'Incoming transfers seen by Wren in the past 7 days.'
            : 'Checks tokens in Wren’s catalog through your RPC.'}
        </p>
        {scope && (
          <TokenResults
            key={`${account}:${chainId}:${source}`}
            scope={scope}
            hideBalances={this.store('selected.hideBalances')}
          />
        )}
        {!scope && <p>Choose a saved account and a connected network.</p>}
      </div>
    )
  }
}

export default Restore.connect(FindTokens)
