import React from 'react'

import link from '../../../resources/link'
import { getAddress } from '../../../resources/utils'
import { isNetworkConnected } from '../../../resources/utils/chains'

const COPY = {
  available:
    'View the execution code the configured RPC reports for any account. You can revoke a delegation only from Wren’s currently selected eligible Ring or Seed account.',
  hardware:
    'Observed only. Wren can prepare revocation only for its currently selected eligible Ring or Seed account.',
  none: 'The configured RPC reports no code at this address.',
  contract:
    'The configured RPC reports contract code at this address. Wren can’t sign for this smart account.',
  empty: 'No accounts are available to observe.',
  unavailable: 'Execution state is unavailable.',
  admissionFailed: 'Couldn’t prepare the revocation request. No request was sent.'
}

const softwareSignerTypes = new Set(['ring', 'seed'])

export const isSoftwareAccount = (account, signers = {}) => {
  const signerType = account?.signer ? signers[account.signer]?.type : undefined
  return softwareSignerTypes.has(signerType || account?.lastSignerType)
}

export const connectedNetworks = (networks = {}) =>
  Object.entries(networks)
    .filter(
      ([, network]) =>
        network?.on && Array.isArray(network?.connection?.endpoints) && isNetworkConnected(network)
    )
    .map(([storedId, network]) => ({
      id: Number(network.id ?? storedId),
      name: network.name || `Chain ${network.id ?? storedId}`
    }))
    .filter((network) => Number.isSafeInteger(network.id) && network.id > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

export class DelegationRevocation extends React.Component {
  constructor(props) {
    super(props)
    const accounts = this.getAccounts(props)
    const networks = connectedNetworks(props.networks)
    const current = props.currentAccount
    const selectedAccount = accounts.some((account) => account.id === current) ? current : ''

    this.state = {
      account: selectedAccount,
      chainId: networks[0]?.id || '',
      execution: undefined,
      eligibility: undefined,
      checking: false,
      queueing: false,
      message: ''
    }
    this.checkSequence = 0
    this.mounted = false
  }

  componentDidMount() {
    this.mounted = true
    if (this.state.account) this.checkExecution(this.state.account, this.state.chainId)
  }

  componentWillUnmount() {
    this.mounted = false
    this.checkSequence += 1
  }

  componentDidUpdate(previousProps) {
    const { account, chainId } = this.state
    if (!account || !chainId || previousProps.networks === this.props.networks) return

    const wasConnected = connectedNetworks(previousProps.networks).some(
      (network) => network.id === Number(chainId)
    )
    const connected = connectedNetworks(this.props.networks).some((network) => network.id === Number(chainId))
    if (wasConnected === connected) return

    this.checkSequence += 1
    if (connected) this.checkExecution(account, chainId)
    else this.setUnavailable()
  }

  getAccounts(props = this.props) {
    return Object.entries(props.accounts || {})
      .map(([id, account]) => ({ id, ...account }))
      .map((account) => ({
        ...account,
        address: getAddress(account.address || account.id),
        name: account.ensName || account.name || 'Account'
      }))
  }

  setUnavailable() {
    if (!this.mounted) return
    this.setState({
      checking: false,
      execution: undefined,
      eligibility: undefined,
      message: COPY.unavailable
    })
  }

  checkExecution(account, chainId) {
    const parsedChainId = Number(chainId)
    if (!account || !Number.isSafeInteger(parsedChainId) || parsedChainId <= 0) {
      this.setUnavailable()
      return
    }

    const sequence = ++this.checkSequence
    this.setState({ checking: true, execution: undefined, eligibility: undefined, message: '' })
    link.rpc('getAccountExecutionState', account, parsedChainId, (error, result) => {
      if (!this.mounted || sequence !== this.checkSequence) return
      if (error || !result || result.account !== account || Number(result.chainId) !== parsedChainId) {
        this.setUnavailable()
        return
      }

      const selected = this.props.accounts?.[account]
      const checksRevocation =
        result.status === 'delegated' &&
        account === this.props.currentAccount &&
        isSoftwareAccount(selected, this.props.signers)

      this.setState({
        checking: checksRevocation,
        execution: result,
        eligibility: undefined,
        message: ''
      })
      if (checksRevocation) {
        this.checkEligibility(account, parsedChainId, sequence)
      }
    })
  }

  checkEligibility(account, chainId, sequence = this.checkSequence) {
    link.rpc('getEip7702RevocationEligibility', account, chainId, (error, result) => {
      if (!this.mounted || sequence !== this.checkSequence) return
      if (error || !result || result.account !== account || Number(result.chainId) !== chainId) {
        this.setState({ checking: false, eligibility: undefined })
        return
      }
      this.setState({ checking: false, eligibility: result })
    })
  }

  selectAccountAndCheck(account, chainId) {
    if (!account || !chainId) {
      this.setUnavailable()
      return
    }

    this.checkExecution(account, chainId)
  }

  requestRevocation() {
    const { account, chainId, eligibility, queueing } = this.state
    if (queueing || eligibility?.status !== 'eligible') return

    this.setState({ queueing: true, message: '' })
    link.rpc('requestEip7702Revocation', account, Number(chainId), (error, request) => {
      if (!this.mounted) return
      if (
        error ||
        !request ||
        request.type !== 'eip7702Revoke' ||
        request.account !== account ||
        !request.handlerId
      ) {
        this.setState({ queueing: false, eligibility: undefined, message: COPY.admissionFailed })
        return
      }

      this.setState({ queueing: false })
      link.send('tray:action', 'closeDash')
      link.send('nav:forward', 'panel', {
        view: 'requestView',
        data: {
          step: 'confirm',
          accountId: request.account,
          requestId: request.handlerId
        }
      })
    })
  }

  render() {
    const accounts = this.getAccounts()
    const networks = connectedNetworks(this.props.networks)
    const { account, chainId, execution, eligibility, checking, queueing, message } = this.state
    const selectedAccount = accounts.find((item) => item.id === account)
    const delegate = execution?.status === 'delegated' ? getAddress(execution.delegate) : ''

    return (
      <section className='delegationRevocation' aria-labelledby='delegation-revocation-title'>
        <header className='delegationRevocationHeader'>
          <div>
            <h2 id='delegation-revocation-title'>Account execution</h2>
            <p>{COPY.available}</p>
          </div>
        </header>
        {!accounts.length ? (
          <p className='delegationRevocationMessage' role='status'>
            {COPY.empty}
          </p>
        ) : (
          <>
            <div className='delegationRevocationSelectors'>
              <label>
                <span>Account</span>
                <select
                  aria-label='Account to observe'
                  className='wrenInput'
                  value={account}
                  disabled={checking || queueing}
                  onChange={(event) => {
                    const nextAccount = event.target.value
                    this.setState({ account: nextAccount })
                    this.selectAccountAndCheck(nextAccount, chainId)
                  }}
                >
                  {!account ? <option value=''>Choose an account to observe</option> : null}
                  {accounts.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >{`${item.name} · ${item.address.slice(0, 8)}…${item.address.slice(-6)}`}</option>
                  ))}
                </select>
                <small>Viewing another account here does not change Wren’s currently selected account.</small>
              </label>
              <label>
                <span>Network</span>
                <select
                  aria-label='Network to query'
                  className='wrenInput'
                  value={chainId}
                  disabled={checking || queueing || !networks.length}
                  onChange={(event) => {
                    const nextChainId = Number(event.target.value)
                    this.setState({ chainId: nextChainId })
                    this.checkExecution(account, nextChainId)
                  }}
                >
                  {!networks.length ? <option value=''>No connected networks</option> : null}
                  {networks.map((network) => (
                    <option key={network.id} value={network.id}>
                      {network.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {checking && !execution ? (
              <p className='delegationRevocationMessage' role='status'>
                Checking execution code…
              </p>
            ) : message ? (
              <p className='delegationRevocationMessage' role='status'>
                {message}
              </p>
            ) : execution?.status === 'delegated' ? (
              <div className='delegationRevocationEligible'>
                <div className='delegationRevocationIdentity'>
                  <span>RPC-reported delegation target</span>
                  <strong title={delegate}>{delegate}</strong>
                  <small>Reported by configured RPC · eth_getCode</small>
                  {eligibility?.status !== 'eligible' ? <small>{COPY.hardware}</small> : null}
                </div>
                {eligibility?.status === 'eligible' ? (
                  <button
                    type='button'
                    className='wrenControl wrenControlPrimary'
                    disabled={queueing || !selectedAccount}
                    onClick={() => this.requestRevocation()}
                  >
                    {queueing ? 'Preparing revocation…' : 'Revoke delegation'}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className='delegationRevocationMessage' role='status'>
                {execution?.status === 'no-code'
                  ? COPY.none
                  : execution?.status === 'contract'
                    ? COPY.contract
                    : COPY.unavailable}
              </p>
            )}
          </>
        )}
      </section>
    )
  }
}

export { COPY as delegationRevocationCopy }
