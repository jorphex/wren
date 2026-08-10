import React from 'react'
import Restore from 'react-restore'

import { ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import Gas from '../../../../../resources/Components/Monitor'
import { NETWORK_PRESETS } from '../../../../../resources/constants'

export function presetLabel(key) {
  return key === 'publicnode' ? 'PublicNode' : key
}

export function connectionTarget(chainId, connection) {
  if (!connection) return ''
  if (connection.current === 'custom') return connection.custom || ''

  const networkTarget = NETWORK_PRESETS.ethereum[chainId]?.[connection.current]
  const defaultTarget = NETWORK_PRESETS.ethereum.default[connection.current]
  return networkTarget || defaultTarget || ''
}

const ConnectionIndicator = ({ connection }) => {
  const pending = ['loading', 'pending', 'syncing', 'standby'].includes(connection.status)
  const state =
    connection.status === 'connected'
      ? 'Good'
      : connection.status === 'degraded'
        ? 'Warning'
        : pending
          ? 'Pending'
          : 'Bad'

  return <div className={`sliceTileIndicatorLarge sliceTileIndicator${state}`} />
}

export function getActiveConnection(endpoints) {
  return (
    endpoints.find((endpoint) => endpoint.on && endpoint.connected) ||
    endpoints.find((endpoint) => endpoint.on) ||
    endpoints[0]
  )
}

function blockDisplay(blockHeight) {
  const value = Number(blockHeight)
  return Number.isFinite(value) ? value.toLocaleString('en-US') : blockHeight
}

export class ChainModule extends React.Component {
  render() {
    const { id, type } = this.props
    const connection = this.store('main.networks', type, id, 'connection')
    if (!connection) return null

    const active = getActiveConnection(connection.endpoints)
    if (!active) return null
    const blockHeight = this.store('main.networksMeta.ethereum', id, 'blockHeight')
    const provider = presetLabel(active.current)

    return (
      <ClusterRow>
        <ClusterValue>
          <div className='networkConnectionSummary'>
            <div className='networkConnectionState'>
              <ConnectionIndicator connection={active} />
              <div className='sliceTileConnectionName'>{provider}</div>
              <div className='networkConnectionActive'>Active</div>
            </div>
            <div className='networkConnectionStats'>
              <div className='networkConnectionStat'>
                <span className='networkConnectionStatLabel'>Block</span>
                <span className='networkConnectionStatValue'>{blockDisplay(blockHeight)}</span>
              </div>
              <div className='networkConnectionStat networkConnectionGas'>
                <span className='networkConnectionStatLabel'>Gas</span>
                <Gas chainId={id} inline={true} />
              </div>
            </div>
          </div>
        </ClusterValue>
      </ClusterRow>
    )
  }
}

export default Restore.connect(ChainModule)
