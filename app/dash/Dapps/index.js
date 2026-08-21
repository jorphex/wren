import React from 'react'
import Restore from 'react-restore'
import emptyConnections from 'url:../../../asset/ui/empty-connections-v15.png'
import link from '../../../resources/link'
import {
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
    clearTimeout(this.originExpiryTimer)

    const nextExpiry = nextTransientConnectedAppExpiry(this.getGroups())
    if (nextExpiry !== undefined) {
      const delay = Math.max(1, nextExpiry - Date.now() + 1)
      this.originExpiryTimer = setTimeout(() => {
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
        <div className='connectedApps cardShow'>
          {chainGroups.length ? (
            <>
              <p className='connectedAppsScope'>
                Recent activity, account access, and default networks across all accounts.
              </p>
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
