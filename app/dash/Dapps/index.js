import React, { createRef } from 'react'
import Restore from 'react-restore'
import emptyConnections from 'url:../../../asset/ui/empty-connections.png'
import link from '../../../resources/link'
import { isNetworkConnected, isNetworkEnabled } from '../../../resources/utils/chains'
// import svg from '../../../resources/svg'

import RingIcon from '../../../resources/Components/RingIcon'

import DappDetails from './DappDetails'

function bySessionStartTime(a, b) {
  return b.session.startedAt - a.session.startedAt
}

function byLastUpdated(a, b) {
  return b.session.lastUpdatedAt - a.session.lastUpdatedAt
}

const originFilter = ['frame-internal', 'frame-extension']
const RECENT_ORIGIN_TTL = 60 * 60 * 1000

function getOriginsForChain(chain, origins) {
  const { connectedOrigins, disconnectedOrigins } = Object.entries(origins).reduce(
    (acc, [id, origin]) => {
      if (origin.chain.id === chain.id && !originFilter.includes(origin.name)) {
        const connected =
          isNetworkConnected(chain) &&
          (!origin.session.endedAt || origin.session.startedAt > origin.session.endedAt)

        acc[connected ? 'connectedOrigins' : 'disconnectedOrigins'].push({ ...origin, id })
      }

      return acc
    },
    { connectedOrigins: [], disconnectedOrigins: [] }
  )

  return {
    connected: connectedOrigins.sort(bySessionStartTime),
    disconnected: disconnectedOrigins
      .sort(byLastUpdated)
      .filter((origin) => Date.now() - origin.session.lastUpdatedAt < RECENT_ORIGIN_TTL)
  }
}

class Indicator extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      active: false
    }

    setTimeout(() => {
      this.setState({ active: true })
    }, 20)

    setTimeout(() => {
      this.setState({ active: false })
    }, 200)
  }

  render() {
    if (this.props.connected) {
      return (
        <div
          className={
            this.state.active ? 'sliceOriginIndicator sliceOriginIndicatorActive' : 'sliceOriginIndicator'
          }
        />
      )
    } else {
      return <div className='sliceOriginIndicator sliceOriginIndicatorOff' />
    }
  }
}

class _OriginModule extends React.Component {
  constructor(...args) {
    super(...args)

    this.state = {
      expanded: false,
      averageRequests: '0.0'
    }

    this.ref = createRef()
  }

  componentDidMount() {
    this.requestUpdates = setInterval(() => {
      if (this.props.connected) {
        this.updateRequestRate()
      }
    }, 1000)
  }

  componentWillUnmount() {
    clearInterval(this.requestUpdates)
  }

  updateRequestRate() {
    const { origin } = this.props
    const now = new Date().getTime()
    const sessionLength = now - origin.session.startedAt
    const sessionLengthSeconds = sessionLength / Math.min(sessionLength, 1000)
    this.setState({ averageRequests: (origin.session.requests / sessionLengthSeconds).toFixed(2) })
  }

  render() {
    const { origin, connected } = this.props

    return (
      <div>
        <div
          className='sliceOrigin'
          onClick={() => {
            link.send('tray:action', 'navDash', { view: 'dapps', data: { dappDetails: origin.id } })
          }}
        >
          <Indicator key={origin.session.lastUpdatedAt} connected={connected} />
          <div className='sliceOriginTitle'>{origin.name}</div>
          <div className='sliceOriginReqs'>
            <div className='sliceOriginReqsNumber'>{this.state.averageRequests}</div>
            <div className='sliceOriginReqsLabel'>{'reqs/min'}</div>
          </div>
        </div>
        {this.state.expanded ? <div>{'origin quick menu'}</div> : null}
      </div>
    )
  }
}

const OriginModule = Restore.connect(_OriginModule)

const ChainOrigins = ({ chain: { name }, origins, primaryColor, icon }) => {
  return (
    <>
      <div className='originTitle'>
        <div className='originTitleIcon'>
          <RingIcon small={true} color={`var(--${primaryColor})`} img={icon} />
        </div>
        <div className='originTitleText'>{name}</div>
      </div>
      {origins.connected.map((origin) => (
        <OriginModule key={origin.id} origin={origin} connected={true} />
      ))}
      {origins.disconnected.map((origin) => (
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

  getEnabledChains() {
    return Object.values(this.store('main.networks.ethereum')).filter(isNetworkEnabled)
  }

  scheduleOriginExpiry() {
    clearTimeout(this.originExpiryTimer)

    const origins = this.store('main.origins')
    const expiries = this.getEnabledChains().flatMap((chain) => {
      return getOriginsForChain(chain, origins).disconnected.map((origin) => {
        return origin.session.lastUpdatedAt + RECENT_ORIGIN_TTL
      })
    })

    if (expiries.length) {
      const nextExpiry = Math.min(...expiries)
      const delay = Math.max(1, nextExpiry - Date.now() + 1)
      this.originExpiryTimer = setTimeout(() => {
        this.setState((state) => ({ originExpiryTick: (state?.originExpiryTick || 0) + 1 }))
      }, delay)
    }
  }

  render() {
    const enabledChains = this.getEnabledChains()
    const origins = this.store('main.origins')
    const chainGroups = enabledChains
      .map((chain) => {
        const chainOrigins = getOriginsForChain(chain, origins)
        return {
          chain,
          origins: chainOrigins,
          meta: this.store('main.networksMeta.ethereum', chain.id)
        }
      })
      .filter(({ origins: chainOrigins }) => {
        return chainOrigins.connected.length > 0 || chainOrigins.disconnected.length > 0
      })

    const { dappDetails } = this.props.data

    if (dappDetails) {
      return <DappDetails originId={dappDetails} />
    } else {
      return (
        <div className='cardShow' style={{ padding: '0px 0px 64px 0px' }}>
          {chainGroups.length ? (
            chainGroups.map(({ chain, origins: chainOrigins, meta: { primaryColor, icon } }) => (
              <ChainOrigins
                key={chain.id}
                chain={chain}
                origins={chainOrigins}
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
