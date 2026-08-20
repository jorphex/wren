import { useState } from 'react'

import link from '../../../../../resources/link'
import { isInvalidCustomTarget } from '../../../../../resources/connections'
import { connectionTarget } from '../Connection'
import {
  NetworkEditorActions,
  NetworkEditorField,
  NetworkEditorToggle,
  RpcEndpointLedger
} from '../Components'

const emptyEndpoints = []

const ChainExpanded = ({
  id,
  name,
  type,
  explorer,
  symbol,
  isTestnet,
  on,
  connection,
  primaryColor,
  icon,
  nativeCurrencyIcon,
  nativeCurrencyName,
  nativeCurrencyDecimals = 18
}) => {
  const chain = { id, type, name, isTestnet, symbol, explorer, primaryColor }
  const [currentName, setName] = useState(name)
  const [currentSymbol, setSymbol] = useState(symbol)
  const [currentExplorer, setExplorer] = useState(explorer)
  const [currentDecimals, setDecimals] = useState(nativeCurrencyDecimals)
  const [currentOn, setOn] = useState(on)
  const runtimeEndpoints = connection?.endpoints || emptyEndpoints
  const [previousRuntimeEndpoints, setPreviousRuntimeEndpoints] = useState(runtimeEndpoints)
  const [endpoints, setEndpoints] = useState(runtimeEndpoints)
  const [endpointValues, setEndpointValues] = useState(() =>
    Object.fromEntries(
      (connection?.endpoints || []).map((endpoint) => [endpoint.id, connectionTarget(id, endpoint)])
    )
  )
  const [endpointStatuses, setEndpointStatuses] = useState({})

  if (runtimeEndpoints !== previousRuntimeEndpoints) {
    setPreviousRuntimeEndpoints(runtimeEndpoints)
    setEndpoints(runtimeEndpoints)
    setEndpointStatuses((statuses) =>
      Object.fromEntries(
        Object.entries(statuses).filter(([endpointId, status]) => {
          if (status !== 'Checking connection…') return true
          const endpoint = runtimeEndpoints.find(({ id: currentId }) => currentId === endpointId)
          return endpoint && ['loading', 'pending', 'syncing'].includes(endpoint.status)
        })
      )
    )
  }

  const endpointInvalid = Object.values(endpointStatuses).some(
    (status) => status === 'Enter a valid RPC URL.'
  )
  const decimals = Number(currentDecimals)
  const formValid =
    currentName.trim() &&
    currentSymbol.trim() &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    !endpointInvalid

  const commitRpc = (endpointId) => {
    const value = endpointValues[endpointId]
    const currentEndpoint = endpoints.find(({ id: currentId }) => currentId === endpointId)
    if (!value || isInvalidCustomTarget(value)) {
      setEndpointStatuses((statuses) => ({ ...statuses, [endpointId]: 'Enter a valid RPC URL.' }))
      return
    }

    link.send('tray:action', 'setEndpointUrl', type, id, endpointId, value)
    setEndpoints((items) =>
      items.map((endpoint) =>
        endpoint.id === endpointId ? { ...endpoint, status: endpoint.on ? 'loading' : 'off' } : endpoint
      )
    )
    setEndpointStatuses((statuses) => ({
      ...statuses,
      [endpointId]: currentEndpoint?.on ? 'Checking connection…' : ''
    }))
  }

  const moveEndpoint = (endpointId, offset) => {
    setEndpoints((items) => {
      const index = items.findIndex((endpoint) => endpoint.id === endpointId)
      const nextIndex = index + offset
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items
      const moved = [...items]
      const [endpoint] = moved.splice(index, 1)
      moved.splice(nextIndex, 0, endpoint)
      return moved
    })
    link.send('tray:action', 'moveEndpoint', type, id, endpointId, offset)
  }

  const addEndpoint = () => {
    if (endpoints.length >= 5) return
    const used = new Set(endpoints.map(({ id: endpointId }) => endpointId))
    let suffix = 1
    while (used.has(`rpc-${suffix}`)) suffix += 1
    const endpoint = {
      id: `rpc-${suffix}`,
      on: false,
      connected: false,
      current: 'custom',
      status: 'off',
      custom: ''
    }
    setEndpoints((items) => [...items, endpoint])
    setEndpointValues((values) => ({ ...values, [endpoint.id]: '' }))
    link.send('tray:action', 'addEndpoint', type, id)
  }

  const removeEndpoint = (endpointId) => {
    setEndpoints((items) => items.filter((endpoint) => endpoint.id !== endpointId))
    link.send('tray:action', 'removeEndpoint', type, id, endpointId)
  }

  const save = () => {
    if (!formValid) return

    const updatedChain = {
      id,
      type,
      primaryColor,
      isTestnet,
      explorer: currentExplorer,
      icon,
      nativeCurrencyIcon,
      name: currentName,
      symbol: currentSymbol,
      nativeCurrencyName: nativeCurrencyName || currentSymbol,
      nativeCurrencyDecimals: decimals
    }

    link.send('tray:action', 'updateNetwork', chain, updatedChain)
    if (currentOn !== on) link.send('tray:action', 'activateNetwork', type, id, currentOn)
    link.send('tray:action', 'backDash')
  }

  const isMainnet = id === 1

  return (
    <div key='editNetwork' className='networkEditor cardShow'>
      <div className='networkEditorHeader'>
        <h1>Edit {currentName}</h1>
        <p>Chain ID {id}</p>
      </div>
      <div className='networkEditorBody'>
        <div className='networkEditorGrid'>
          <NetworkEditorField label='Network name' value={currentName} onChange={setName} />
          <NetworkEditorField label='Chain ID' value={id} technical readOnly />
          <NetworkEditorField label='Native currency' value={currentSymbol} onChange={setSymbol} />
          <NetworkEditorField
            label='Decimals'
            value={currentDecimals}
            technical
            inputMode='numeric'
            onChange={setDecimals}
          />
          <div className='networkEditorWide'>
            <RpcEndpointLedger
              endpoints={endpoints}
              values={endpointValues}
              statuses={endpointStatuses}
              onValueChange={(endpointId, value) => {
                setEndpointValues((values) => ({ ...values, [endpointId]: value }))
                setEndpointStatuses((statuses) => ({ ...statuses, [endpointId]: '' }))
              }}
              onCommit={commitRpc}
              onToggle={(endpointId, endpointOn) => {
                setEndpoints((items) =>
                  items.map((endpoint) =>
                    endpoint.id === endpointId ? { ...endpoint, on: endpointOn } : endpoint
                  )
                )
                link.send('tray:action', 'toggleEndpoint', type, id, endpointId, endpointOn)
              }}
              onMove={moveEndpoint}
              onAdd={addEndpoint}
              onRemove={removeEndpoint}
            />
          </div>
          <div className='networkEditorWide'>
            <NetworkEditorField
              label='Block explorer'
              value={currentExplorer}
              technical
              onChange={setExplorer}
            />
          </div>
        </div>
        <NetworkEditorToggle
          label='Use this network'
          checked={currentOn}
          disabled={isMainnet}
          onChange={setOn}
        />
      </div>
      <NetworkEditorActions
        primaryLabel='Save changes'
        primaryEnabled={Boolean(formValid)}
        onCancel={() => link.send('tray:action', 'backDash')}
        onPrimary={save}
        onRemove={
          isMainnet
            ? undefined
            : () => {
                const confirmAction = {
                  view: 'notify',
                  data: { notify: 'confirmRemoveChain', notifyData: { chain } }
                }
                link.send('tray:action', 'navDash', confirmAction)
              }
        }
      />
    </div>
  )
}

export default ChainExpanded
