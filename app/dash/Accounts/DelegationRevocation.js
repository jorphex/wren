import React from 'react'

import link from '../../../resources/link'
import { getAddress } from '../../../resources/utils'
import { isNetworkConnected } from '../../../resources/utils/chains'

const COPY = {
  available: 'Available with a Wren software signer',
  hardware: 'Revocation requires a Wren software signer.',
  none: 'No EIP-7702 delegation found. Nothing to revoke.',
  unavailable: 'Delegation status unavailable.',
  admissionFailed: 'Delegation status unavailable. Request not sent.'
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
    const accounts = this.getSoftwareAccounts(props)
    const networks = connectedNetworks(props.networks)
    const current = props.currentAccount
    const selectedAccount = accounts.some((account) => account.id === current) ? current : ''

    this.state = {
      account: selectedAccount,
      chainId: networks[0]?.id || '',
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
    if (this.state.account) this.checkEligibility(this.state.account, this.state.chainId)
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
    if (connected) this.checkEligibility(account, chainId)
    else this.setUnavailable()
  }

  getSoftwareAccounts(props = this.props) {
    return Object.entries(props.accounts || {})
      .map(([id, account]) => ({ id, ...account }))
      .filter((account) => isSoftwareAccount(account, props.signers))
      .map((account) => ({
        ...account,
        address: getAddress(account.address || account.id),
        name: account.ensName || account.name || 'Account'
      }))
  }

  setUnavailable() {
    if (!this.mounted) return
    this.setState({ checking: false, eligibility: undefined, message: COPY.unavailable })
  }

  checkEligibility(account, chainId) {
    const parsedChainId = Number(chainId)
    if (!account || !Number.isSafeInteger(parsedChainId) || parsedChainId <= 0) {
      this.setUnavailable()
      return
    }

    const sequence = ++this.checkSequence
    this.setState({ checking: true, eligibility: undefined, message: '' })
    link.rpc('getEip7702RevocationEligibility', account, parsedChainId, (error, result) => {
      if (!this.mounted || sequence !== this.checkSequence) return
      if (error || !result || result.account !== account || Number(result.chainId) !== parsedChainId) {
        this.setUnavailable()
        return
      }

      const message =
        result.status === 'not-delegated'
          ? COPY.none
          : result.status === 'unsupported-signer'
            ? COPY.hardware
            : result.status === 'eligible'
              ? ''
              : COPY.unavailable
      this.setState({ checking: false, eligibility: result, message })
    })
  }

  selectAccountAndCheck(account, chainId) {
    if (!account || !chainId) {
      this.setUnavailable()
      return
    }

    if (account === this.props.currentAccount) {
      this.checkEligibility(account, chainId)
      return
    }

    const sequence = ++this.checkSequence
    this.setState({ checking: true, eligibility: undefined, message: '' })
    link.rpc('setSigner', account, (error) => {
      if (!this.mounted || sequence !== this.checkSequence) return
      if (error) {
        this.setUnavailable()
        return
      }
      this.checkEligibility(account, chainId)
    })
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
    const accounts = this.getSoftwareAccounts()
    const networks = connectedNetworks(this.props.networks)
    const { account, chainId, eligibility, checking, queueing, message } = this.state
    const selectedAccount = accounts.find((item) => item.id === account)
    const delegate = eligibility?.status === 'eligible' ? getAddress(eligibility.delegate) : ''

    return (
      <section className='delegationRevocation' aria-labelledby='delegation-revocation-title'>
        <header className='delegationRevocationHeader'>
          <div>
            <h2 id='delegation-revocation-title'>Delegation</h2>
            <p>{COPY.available}</p>
          </div>
        </header>
        {!accounts.length ? (
          <p className='delegationRevocationMessage' role='status'>
            {COPY.hardware}
          </p>
        ) : (
          <>
            <div className='delegationRevocationSelectors'>
              <label>
                <span>Selected software account</span>
                <select
                  aria-label='Selected software account'
                  className='wrenInput'
                  value={account}
                  disabled={checking || queueing}
                  onChange={(event) => {
                    const nextAccount = event.target.value
                    this.setState({ account: nextAccount })
                    this.selectAccountAndCheck(nextAccount, chainId)
                  }}
                >
                  {!account ? <option value=''>Choose an active account</option> : null}
                  {accounts.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >{`${item.name} · ${item.address.slice(0, 8)}…${item.address.slice(-6)}`}</option>
                  ))}
                </select>
                <small>Choosing an account also makes it Wren’s selected account.</small>
              </label>
              <label>
                <span>Network</span>
                <select
                  aria-label='Network'
                  className='wrenInput'
                  value={chainId}
                  disabled={checking || queueing || !networks.length}
                  onChange={(event) => {
                    const nextChainId = Number(event.target.value)
                    this.setState({ chainId: nextChainId })
                    this.checkEligibility(account, nextChainId)
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
            {checking ? (
              <p className='delegationRevocationMessage' role='status'>
                Checking delegation…
              </p>
            ) : eligibility?.status === 'eligible' ? (
              <div className='delegationRevocationEligible'>
                <div className='delegationRevocationIdentity'>
                  <span>Delegated to</span>
                  <strong title={delegate}>{delegate}</strong>
                  <small>Configured RPC · eth_getCode</small>
                </div>
                <button
                  type='button'
                  className='wrenControl wrenControlPrimary'
                  disabled={queueing || !selectedAccount}
                  onClick={() => this.requestRevocation()}
                >
                  {queueing ? 'Preparing…' : 'Revoke delegation'}
                </button>
              </div>
            ) : (
              <p className='delegationRevocationMessage' role='status'>
                {message || COPY.unavailable}
              </p>
            )}
          </>
        )}
      </section>
    )
  }
}

export { COPY as delegationRevocationCopy }
