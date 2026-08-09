import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../../../resources/Components/Icon'
import { ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
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

export class ChainModule extends React.Component {
  render() {
    const { id, type } = this.props
    const connection = this.store('main.networks', type, id, 'connection')
    if (!connection) return null

    const active = getActiveConnection(connection.endpoints)
    if (!active) return null
    const blockHeight = this.store('main.networksMeta.ethereum', id, 'blockHeight')

    return (
      <ClusterRow>
        <ClusterValue>
          <div className='networkConnectionSummary'>
            <div className='networkConnectionState'>
              <ConnectionIndicator connection={active} />
              <div className='sliceTileConnectionName'>{presetLabel(active.current)}</div>
            </div>
            <div className='sliceTileBlock'>
              <div className='sliceTileBlockIcon'>
                <Icon name='globe' size={14} />
              </div>
              <div className='sliceTileChainId'>{id}</div>
              <div className='sliceTileBlockIcon'>
                <Icon name='server' size={14} />
              </div>
              <div>{blockHeight}</div>
            </div>
          </div>
        </ClusterValue>
      </ClusterRow>
    )
  }
}

export default Restore.connect(ChainModule)
