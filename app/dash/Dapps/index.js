import React from 'react'
import Restore from 'react-restore'
import emptyConnections from 'url:../../../asset/ui/empty-connections.png'
import link from '../../../resources/link'
import {
  nextTransientConnectedAppExpiry,
  requestsPerMinute,
  selectConnectedAppGroups
} from '../../../resources/domain/connectedApps'

import RingIcon from '../../../resources/Components/RingIcon'

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
      opening: false,
      rateNow: Date.now()
    }

    this.navigationPending = false
  }

  componentDidMount() {
    this.updateRateTimer()
  }

  componentDidUpdate(previousProps) {
    if (previousProps.connected !== this.props.connected) this.updateRateTimer()
  }

  componentWillUnmount() {
    this.navigationPending = false
    clearInterval(this.requestUpdates)
  }

  updateRateTimer() {
    clearInterval(this.requestUpdates)
    this.setState({ rateNow: Date.now() })
    if (this.props.connected) {
      this.requestUpdates = setInterval(() => this.setState({ rateNow: Date.now() }), 1000)
    }
  }

  openDetails(originId) {
    if (this.navigationPending) return
    this.navigationPending = true
    this.setState({ opening: true })
    link.send('tray:action', 'navDash', { view: 'dapps', data: { dappDetails: originId } })
  }

  render() {
    const { origin, connected } = this.props
    const rateEnd = connected ? this.state.rateNow : (origin.session.endedAt ?? origin.session.lastUpdatedAt)
    const averageRequests = requestsPerMinute(origin.session, rateEnd).toFixed(2)
    const connectionStatus = connected ? 'Connected' : origin.durable ? 'Access granted' : 'Not active'

    return (
      <button
        type='button'
        aria-label={`Open ${origin.name} connection details, ${connectionStatus.toLowerCase()}`}
        aria-describedby={`origin-rate-${origin.id}`}
        className='sliceOrigin'
        disabled={this.state.opening}
        onClick={() => this.openDetails(origin.id)}
      >
        <Indicator connected={connected} />
        <span className='sliceOriginIdentity'>
          <span className='sliceOriginTitle'>{origin.name}</span>
          <span className='sliceOriginStatus'>{connectionStatus}</span>
        </span>
        <span className='sliceOriginReqs' id={`origin-rate-${origin.id}`}>
          <span className='sliceOriginReqsNumber'>{averageRequests}</span>
          <span className='sliceOriginReqsLabel'>avg reqs/min</span>
        </span>
      </button>
    )
  }
}

const OriginModule = Restore.connect(OriginModuleComponent)

const ChainOrigins = ({ chain: { name }, connected, disconnected, primaryColor, icon }) => {
  return (
    <>
      <div className='originTitle'>
        <div className='originTitleIcon'>
          <RingIcon small={true} color={`var(--${primaryColor})`} img={icon} />
        </div>
        <div className='originTitleText'>{name}</div>
      </div>
      {connected.map((origin) => (
        <OriginModule key={origin.id} origin={origin} connected={true} />
      ))}
      {disconnected.map((origin) => (
        <OriginModule key={origin.id} origin={origin} connected={false} />
      ))}
    </>
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
      meta: this.store('main.networksMeta.ethereum', group.chain.id)
    }))

    const { dappDetails } = this.props.data

    if (dappDetails) {
      return <DappDetails originId={dappDetails} />
    } else {
      return (
        <div className='cardShow' style={{ padding: '0px 0px 64px 0px' }}>
          {chainGroups.length ? (
            chainGroups.map(({ chain, connected, disconnected, meta: { primaryColor, icon } }) => (
              <ChainOrigins
                key={chain.id}
                chain={chain}
                connected={connected}
                disconnected={disconnected}
                primaryColor={primaryColor}
                icon={icon}
              />
            ))
          ) : (
            <div className='connectedAppsEmpty'>
              <img alt='' aria-hidden='true' className='connectedAppsEmptyArtwork' src={emptyConnections} />
              <strong>No connected apps</strong>
              <span>Open a dapp with the Wren Companion to see it here.</span>
            </div>
          )}
        </div>
      )
    }
  }
}

export default Restore.connect(Dapps)
