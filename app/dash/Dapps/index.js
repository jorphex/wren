import React from 'react'
import Restore from 'react-restore'
import emptyConnections from 'url:../../../asset/ui/empty-connections-v15.png'
import link from '../../../resources/link'
import {
  MAX_TIMER_DELAY,
  nextActiveExternalPermissionExpiry,
  nextTransientConnectedAppExpiry,
  selectConnectedAppGroups
} from '../../../resources/domain/connectedApps'
import { safeNetworkMetadata } from '../../../resources/domain/networkMetadata'

import ChainIdentityMark from '../../../resources/Components/ChainIdentityMark'

import DappDetails from './DappDetails'

export const Indicator = ({ connected }) => (
  <span
    aria-hidden='true'
    className={connected ? 'sliceOriginIndicator' : 'sliceOriginIndicator sliceOriginIndicatorOff'}
  />
)

export class OriginModuleComponent extends React.Component {
  constructor(...args) {
    super(...args)

    this.state = {
      opening: false
    }

    this.navigationPending = false
  }

  componentWillUnmount() {
    this.navigationPending = false
  }

  openDetails(originId) {
    if (this.navigationPending) return
    this.navigationPending = true
    this.setState({ opening: true })
    link.send('tray:action', 'navDash', { view: 'dapps', data: { dappDetails: originId } })
  }

  render() {
    const { origin, connected } = this.props
    const accountLabel = origin.accessCount
      ? `Access to ${origin.accessCount} ${origin.accessCount === 1 ? 'account' : 'accounts'}`
      : 'No account access'
    const activityLabel = connected ? 'Active' : origin.durable ? 'Inactive' : 'Recent'
    const connectionStatus = `${activityLabel} · ${accountLabel}`

    return (
      <button
        type='button'
        aria-label={`Open ${origin.name} app details, ${connectionStatus.toLowerCase()}`}
        className='sliceOrigin'
        disabled={this.state.opening}
        onClick={() => this.openDetails(origin.id)}
      >
        <Indicator connected={connected} />
        <span className='sliceOriginIdentity'>
          <span className='sliceOriginTitle'>{origin.name}</span>
          <span className='sliceOriginStatus'>{connectionStatus}</span>
        </span>
      </button>
    )
  }
}

const OriginModule = Restore.connect(OriginModuleComponent)

const ChainOrigins = ({ chain, connected, disconnected, primaryColor, icon }) => {
  return (
    <section className='sliceOriginGroup'>
      <div className='originTitle'>
        <div className='originTitleIcon'>
          <ChainIdentityMark
            chainId={chain.id}
            icon={icon}
            isTestnet={chain.isTestnet}
            primaryColor={primaryColor}
            small
          />
        </div>
        <div className='originTitleText'>{chain.name}</div>
      </div>
      <div className='sliceOriginList'>
        {connected.map((origin) => (
          <OriginModule key={origin.id} origin={origin} connected={true} />
        ))}
        {disconnected.map((origin) => (
          <OriginModule key={origin.id} origin={origin} connected={false} />
        ))}
      </div>
    </section>
  )
}

export class Dapps extends React.Component {
  componentDidMount() {
    this.scheduleOriginExpiry()
  }

  componentDidUpdate() {
    this.scheduleOriginExpiry()
  }

  componentWillUnmount() {
    clearTimeout(this.originExpiryTimer)
    this.originExpiryDeadline = undefined
  }

  getGroups(now = Date.now()) {
    return selectConnectedAppGroups({
      networks: this.store('main.networks.ethereum') || {},
      origins: this.store('main.origins') || {},
      permissions: this.store('main.permissions') || {},
      now
    })
  }

  scheduleOriginExpiry() {
    const now = Date.now()
    const permissions = this.store('main.permissions') || {}
    const expiries = [
      nextTransientConnectedAppExpiry(this.getGroups(now)),
      nextActiveExternalPermissionExpiry(permissions, now)
    ].filter((expiry) => expiry !== undefined)
    const nextExpiry = expiries.length ? Math.min(...expiries) : undefined

    if (nextExpiry === this.originExpiryDeadline) return

    clearTimeout(this.originExpiryTimer)
    this.originExpiryDeadline = nextExpiry
    if (nextExpiry !== undefined) {
      const delay = Math.max(1, Math.min(nextExpiry - now, MAX_TIMER_DELAY))
      this.originExpiryTimer = setTimeout(() => {
        this.originExpiryDeadline = undefined
        this.setState((state) => ({ originExpiryTick: (state?.originExpiryTick || 0) + 1 }))
      }, delay)
    }
  }

  render() {
    const chainGroups = this.getGroups().map((group) => ({
      ...group,
      meta: safeNetworkMetadata(this.store('main.networksMeta.ethereum', group.chain.id), group.chain)
    }))

    const { dappDetails } = this.props.data

    if (dappDetails) {
      return <DappDetails originId={dappDetails} />
    } else {
      return (
        <div className='connectedApps connectedAppsPerch'>
          {chainGroups.length ? (
            <>
              {chainGroups.map(({ chain, connected, disconnected, meta: { primaryColor, icon } }) => (
                <ChainOrigins
                  key={chain.id}
                  chain={chain}
                  connected={connected}
                  disconnected={disconnected}
                  primaryColor={primaryColor}
                  icon={icon}
                />
              ))}
            </>
          ) : (
            <div className='connectedAppsEmpty'>
              <img alt='' aria-hidden='true' className='connectedAppsEmptyArtwork' src={emptyConnections} />
              <strong>No app activity</strong>
              <span>Open a dapp with the Wren Companion to see it here.</span>
            </div>
          )}
        </div>
      )
    }
  }
}

export default Restore.connect(Dapps)
