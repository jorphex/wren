import { useEffect, useRef, useState } from 'react'

import chainDefault from '../chainDefault'
import link from '../../../../../resources/link'
import {
  NetworkEditorActions,
  NetworkEditorField,
  NetworkEditorToggle,
  RpcEndpointLedger
} from '../Components'

const getUrl = (urlStr) => {
  try {
    return new URL(urlStr)
  } catch {
    // ignore errors
  }
}

const isValidRpc = (urlStr) => {
  const url = getUrl(urlStr)
  return ['http:', 'https:', 'ws:', 'wss:'].includes(url?.protocol)
}

const isValidIcon = (urlStr) => Boolean(getUrl(urlStr))

const displayOrigin = (origin) => {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export const Chain = ({
  id,
  name = '',
  type,
  explorer = '',
  symbol = '',
  nativeCurrencyName = '',
  nativeCurrencyIcon = '',
  icon = '',
  isTestnet = false,
  primaryColor = chainDefault.primaryColor,
  rpcUrls = [''],
  nativeCurrencyDecimals = 18,
  requestReference,
  existingChains,
  store
}) => {
  const newChain = {
    id,
    name,
    type,
    explorer,
    symbol,
    nativeCurrencyName,
    nativeCurrencyIcon,
    icon,
    isTestnet,
    primaryColor,
    rpcUrls,
    nativeCurrencyDecimals
  }

  // state
  const [currentColor] = useState(newChain.primaryColor)
  const [currentName, setName] = useState(newChain.name)
  const [currentSymbol, setSymbol] = useState(newChain.symbol)
  const [currentNativeCurrencyName] = useState(newChain.nativeCurrencyName)
  const [currentChainIcon] = useState(newChain.icon)
  const [currentCurrencyIcon] = useState(newChain.nativeCurrencyIcon)
  const [currentChainId, setChainId] = useState(newChain.id)
  const [currentExplorer, setExplorer] = useState(newChain.explorer)
  const [currentTestnet, setTestnet] = useState(newChain.isTestnet)
  const [endpoints, setEndpoints] = useState(() =>
    (newChain.rpcUrls.length ? newChain.rpcUrls : ['']).slice(0, 5).map((url, index) => ({
      id: `rpc-${index + 1}`,
      on: true,
      connected: false,
      current: 'custom',
      status: 'off',
      custom: url
    }))
  )
  const [endpointValues, setEndpointValues] = useState(() =>
    Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, endpoint.custom]))
  )
  const [currentDecimals, setDecimals] = useState(newChain.nativeCurrencyDecimals)
  const [endpointTouched, setEndpointTouched] = useState({})
  const [submissionError, setSubmissionError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submissionErrorRef = useRef(null)

  useEffect(() => {
    if (submissionError) submissionErrorRef.current?.focus()
  }, [submissionError])

  const currencyIcon = currentCurrencyIcon === chainDefault.nativeCurrencyIcon ? '' : currentCurrencyIcon
  const chainIcon = currentChainIcon === chainDefault.icon ? '' : currentChainIcon
  const updatedChain = {
    type: 'ethereum',
    id: Number(currentChainId),
    name: currentName,
    explorer: currentExplorer,
    nativeCurrencyName: currentNativeCurrencyName || currentSymbol,
    nativeCurrencyIcon: currencyIcon,
    icon: chainIcon,
    symbol: currentSymbol,
    isTestnet: currentTestnet,
    primaryColor: currentColor,
    rpcUrls: endpoints.map((endpoint) => endpointValues[endpoint.id]).filter(Boolean),
    nativeCurrencyDecimals: Number(currentDecimals)
  }

  const validateChain = (chain) => {
    if (existingChains.includes(parseInt(chain.id))) {
      return { valid: false, text: 'A network with this Chain ID already exists.' }
    }

    if (!Number.isSafeInteger(Number(chain.id)) || Number(chain.id) <= 0) {
      return { valid: false, text: 'Enter a valid Chain ID.' }
    }

    if (!chain.name || chain.name === chainDefault.name) {
      return { valid: false, text: 'Enter a network name.' }
    }

    if (!chain.symbol || chain.symbol === chainDefault.symbol) {
      return { valid: false, text: 'Enter a native currency symbol.' }
    }

    if (!chain.nativeCurrencyName || chain.nativeCurrencyName === chainDefault.nativeCurrencyName) {
      return { valid: false, text: 'Enter a native currency name.' }
    }

    if (!chain.rpcUrls[0]) {
      return { valid: false, text: 'Enter an RPC URL.' }
    }

    if (chain.icon && !isValidIcon(chain.icon)) {
      return { valid: false, text: 'Enter a valid network icon URL.' }
    }

    if (chain.nativeCurrencyIcon && !isValidIcon(chain.nativeCurrencyIcon)) {
      return { valid: false, text: 'Enter a valid currency icon URL.' }
    }

    if (chain.rpcUrls.some((url) => !isValidRpc(url))) {
      return { valid: false, text: 'Enter a valid RPC URL.' }
    }

    if (requestReference && chain.rpcUrls.some((url) => getUrl(url)?.protocol !== 'https:')) {
      return { valid: false, text: 'Use an HTTPS RPC URL.' }
    }

    if (
      !Number.isInteger(chain.nativeCurrencyDecimals) ||
      chain.nativeCurrencyDecimals < 0 ||
      chain.nativeCurrencyDecimals > 255
    ) {
      return { valid: false, text: 'Enter decimals from 0 to 255.' }
    }

    return { valid: true, text: '' }
  }

  const chainValidation = validateChain(updatedChain)
  const duplicateChain = existingChains.includes(parseInt(updatedChain.id))
  const endpointStatuses = Object.fromEntries(
    endpoints.map((endpoint, index) => {
      const value = endpointValues[endpoint.id]
      const parsedUrl = value ? getUrl(value) : undefined
      const invalid =
        (index === 0 && !value) ||
        (Boolean(value) && (requestReference ? getUrl(value)?.protocol !== 'https:' : !isValidRpc(value)))
      return [
        endpoint.id,
        endpointTouched[endpoint.id] && invalid
          ? requestReference && parsedUrl && parsedUrl.protocol !== 'https:'
            ? 'Use an HTTPS RPC URL.'
            : 'Enter a valid RPC URL.'
          : ''
      ]
    })
  )
  const decimalsInvalid =
    currentDecimals === '' ||
    !Number.isInteger(Number(currentDecimals)) ||
    Number(currentDecimals) < 0 ||
    Number(currentDecimals) > 255

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
  }

  const addEndpoint = () => {
    if (endpoints.length >= 5) return
    const used = new Set(endpoints.map(({ id: endpointId }) => endpointId))
    let suffix = 1
    while (used.has(`rpc-${suffix}`)) suffix += 1
    const endpoint = {
      id: `rpc-${suffix}`,
      on: true,
      connected: false,
      current: 'custom',
      status: 'off',
      custom: ''
    }
    setEndpoints((items) => [...items, endpoint])
    setEndpointValues((values) => ({ ...values, [endpoint.id]: '' }))
  }

  const removeEndpoint = (endpointId) => {
    setEndpoints((items) => items.filter((endpoint) => endpoint.id !== endpointId))
  }

  return (
    <div key='newNetwork' className='networkEditor cardShow'>
      <div className='networkEditorHeader'>
        <h1>{currentName ? `Add ${currentName}` : 'Add network'}</h1>
        {requestReference?.origin && <p>Requested by {displayOrigin(requestReference.origin)}</p>}
      </div>
      <div className='networkEditorBody'>
        <div className='networkEditorGrid'>
          <NetworkEditorField label='Network name' value={currentName} onChange={setName} />
          <NetworkEditorField
            label='Chain ID'
            value={currentChainId}
            technical
            inputMode='numeric'
            error={duplicateChain}
            status={duplicateChain ? 'A network with this Chain ID already exists.' : ''}
            onChange={setChainId}
          />
          <NetworkEditorField label='Native currency' value={currentSymbol} onChange={setSymbol} />
          <NetworkEditorField
            label='Decimals'
            value={currentDecimals}
            technical
            inputMode='numeric'
            error={decimalsInvalid}
            status={decimalsInvalid ? 'Enter decimals from 0 to 255.' : ''}
            onChange={setDecimals}
          />
          <div className='networkEditorWide'>
            <RpcEndpointLedger
              endpoints={endpoints}
              values={endpointValues}
              statuses={endpointStatuses}
              onValueChange={(endpointId, value) => {
                setEndpointValues((values) => ({ ...values, [endpointId]: value }))
                setEndpointTouched((touched) => ({ ...touched, [endpointId]: false }))
              }}
              onCommit={(endpointId) => setEndpointTouched((touched) => ({ ...touched, [endpointId]: true }))}
              onMove={moveEndpoint}
              onAdd={addEndpoint}
              onRemove={removeEndpoint}
              showToggles={false}
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
        <NetworkEditorToggle label='Test network' checked={currentTestnet} onChange={setTestnet} />
        {submissionError && (
          <div className='networkEditorMessage' role='alert' tabIndex={-1} ref={submissionErrorRef}>
            {submissionError}
          </div>
        )}
      </div>
      <NetworkEditorActions
        primaryLabel={submitting ? 'Verifying network…' : 'Add network'}
        primaryEnabled={chainValidation.valid && !submitting}
        onCancel={() => {
          if (requestReference) {
            link.send('tray:rejectRequest', {
              account: requestReference.account,
              handlerId: requestReference.handlerId
            })
          }
          link.send('tray:action', 'backDash')
        }}
        onPrimary={async () => {
          if (!chainValidation.valid || submitting) return
          const nav = store('windows.dash.nav')
          const reference = requestReference
            ? { account: requestReference.account, handlerId: requestReference.handlerId }
            : undefined
          const args = reference
            ? ['tray:addChain', updatedChain, reference]
            : ['tray:addChain', updatedChain]
          setSubmitting(true)
          setSubmissionError('')
          const result = await link.invoke(...args).catch(() => ({ success: false }))
          if (!result.success) {
            setSubmitting(false)
            setSubmissionError('Couldn’t add network')
            return
          }

          if (nav[1]?.view === 'chains') {
            link.send('tray:action', 'backDash')
          } else {
            link.send('nav:update', 'dash', { view: 'chains', data: {} }, false)
          }
        }}
      />
    </div>
  )
}
