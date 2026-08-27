import { useEffect, useRef, useState } from 'react'

import Icon from '../../../../../resources/Components/Icon'
import Toggle from '../../../../../resources/Components/Toggle'
import link from '../../../../../resources/link'
import ChainIdentityMark from '../../../../../resources/Components/ChainIdentityMark'
import chainDefault from '../chainDefault'

export const SubmitChainButton = ({ text, enabled, textColor, onClick }) => {
  return (
    <button
      type='button'
      className={enabled ? 'addTokenSubmit addTokenSubmitEnabled' : 'addTokenSubmit'}
      disabled={!enabled}
      style={{ color: textColor }}
      onClick={onClick}
    >
      <span>{text}</span>
    </button>
  )
}

export const NetworkEditorField = ({
  label,
  value,
  onChange,
  onBlur,
  status,
  error,
  technical = false,
  readOnly = false,
  inputMode
}) => {
  const id = `network-${label.toLowerCase().replace(/\s+/g, '-')}`
  const statusId = `${id}-status`

  return (
    <label className={error ? 'networkEditorField networkEditorFieldError' : 'networkEditorField'}>
      <span className='networkEditorFieldLabel'>
        <span>{label}</span>
        {status && (
          <span
            id={statusId}
            role='status'
            aria-live='polite'
            className={
              error ? 'networkEditorFieldStatus networkEditorFieldStatusError' : 'networkEditorFieldStatus'
            }
          >
            {status}
          </span>
        )}
      </span>
      <input
        id={id}
        aria-describedby={status ? statusId : undefined}
        aria-label={label}
        aria-invalid={error || undefined}
        className={
          technical
            ? 'networkEditorInput networkEditorInputTechnical wrenInput'
            : 'networkEditorInput wrenInput'
        }
        inputMode={inputMode}
        readOnly={readOnly}
        spellCheck='false'
        value={value ?? ''}
        onBlur={onBlur}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  )
}

export const NetworkEditorToggle = ({ label, checked, disabled = false, onChange }) => (
  <div className='networkEditorToggleRow'>
    <span>{label}</span>
    <Toggle checked={checked} disabled={disabled} label={label} onChange={onChange} />
  </div>
)

export const NetworkEditorActions = ({ primaryLabel, primaryEnabled, onCancel, onPrimary, onRemove }) => (
  <div className='networkEditorFooter'>
    {onRemove && (
      <button type='button' className='networkEditorRemove wrenControl wrenControlDanger' onClick={onRemove}>
        Remove network
      </button>
    )}
    <div className='networkEditorFooterActions'>
      <button
        type='button'
        className='networkEditorCancel wrenControl wrenControlSecondary'
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type='button'
        className='networkEditorSubmit wrenControl wrenControlPrimary'
        disabled={!primaryEnabled}
        onClick={onPrimary}
      >
        {primaryLabel}
      </button>
    </div>
  </div>
)

const endpointStatus = (endpoint, localStatus) => {
  if (localStatus) return localStatus
  if (!endpoint.on) return ''
  if (endpoint.status === 'connected') return 'Connected'
  if (endpoint.status === 'standby') return 'Not checked'
  if (['loading', 'pending', 'syncing'].includes(endpoint.status)) return 'Checking connection…'
  if (endpoint.status === 'chain mismatch') return 'Wrong network'
  if (['disconnected', 'error'].includes(endpoint.status)) return 'Can’t connect'
  return 'Not checked'
}

const endpointStatusPresentation = (endpoint, status, index) => {
  const latency = Number(endpoint.latencyMs)
  const label = status || 'Off'
  const latencyDetail =
    Number.isFinite(latency) && ['Connected', 'Not checked'].includes(label)
      ? `, ${Math.round(latency)} milliseconds`
      : ''
  const accessibleLabel = `RPC endpoint ${index + 1}: ${label}${latencyDetail}`
  const visibleLabel = `${label}${latencyDetail ? ` · ${Math.round(latency)} ms` : ''}`

  if (label === 'Connected') {
    return { accessibleLabel, icon: 'check', tone: 'connected', visibleLabel }
  }
  if (label === 'Checking connection…') {
    return { accessibleLabel, icon: 'sync', tone: 'checking', visibleLabel }
  }
  if (['Can’t connect', 'Wrong network', 'Enter a valid RPC URL.', 'Use an HTTPS RPC URL.'].includes(label)) {
    return { accessibleLabel, icon: 'alert', tone: 'error', visibleLabel }
  }

  return { accessibleLabel, icon: 'pending', tone: endpoint.on ? 'standby' : 'off', visibleLabel }
}

export const RpcEndpointLedger = ({
  endpoints,
  values,
  statuses = {},
  onValueChange,
  onCommit,
  onToggle,
  onMove,
  onAdd,
  onRemove,
  showToggles = true
}) => {
  const endpointRows = useRef(new Map())
  const pendingFocusId = useRef()

  useEffect(() => {
    if (!pendingFocusId.current) return
    const row = endpointRows.current.get(pendingFocusId.current)
    const target = row?.querySelector('.rpcEndpointRemove') || row?.querySelector('.rpcEndpointInput')
    target?.focus()
    pendingFocusId.current = undefined
  }, [endpoints])

  const removeEndpoint = (endpointId, index) => {
    pendingFocusId.current = endpoints[index + 1]?.id || endpoints[index - 1]?.id
    onRemove(endpointId)
  }

  return (
    <section className='rpcEndpointSection' aria-labelledby='rpc-endpoints-title'>
      <div className='rpcEndpointHeading'>
        <div>
          <h2 id='rpc-endpoints-title'>RPC endpoints</h2>
          <p>Wren uses endpoints in order and tries the next one only if the current endpoint fails.</p>
        </div>
      </div>
      <div className='rpcEndpointLedger'>
        {endpoints.map((endpoint, index) => {
          const status = endpointStatus(endpoint, statuses[endpoint.id])
          const statusPresentation = endpointStatusPresentation(endpoint, status, index)
          const error = statusPresentation.tone === 'error'
          const statusId = `rpc-endpoint-status-${endpoint.id}`
          const rowClass = [
            'rpcEndpointRow',
            endpoint.on ? '' : 'rpcEndpointRowOff',
            showToggles ? '' : 'rpcEndpointRowNoToggle'
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              className={rowClass}
              key={endpoint.id}
              ref={(node) => {
                if (node) endpointRows.current.set(endpoint.id, node)
                else endpointRows.current.delete(endpoint.id)
              }}
            >
              <span className='rpcEndpointOrder'>{index + 1}</span>
              <span
                aria-hidden='true'
                className={`rpcEndpointState rpcEndpointState-${statusPresentation.tone}`}
                title={statusPresentation.accessibleLabel}
              >
                <Icon name={statusPresentation.icon} size={13} />
              </span>
              <label className='rpcEndpointInputWrap'>
                <input
                  aria-describedby={statusId}
                  aria-label={`RPC URL ${index + 1}`}
                  aria-invalid={error || undefined}
                  className='rpcEndpointInput wrenInput'
                  spellCheck='false'
                  value={values[endpoint.id] ?? ''}
                  onBlur={() => onCommit(endpoint.id)}
                  onChange={(event) => onValueChange(endpoint.id, event.target.value.replace(/\s+/g, ''))}
                />
                <span
                  className={`rpcEndpointStatus rpcEndpointStatus-${statusPresentation.tone}`}
                  id={statusId}
                  role='status'
                >
                  {statusPresentation.visibleLabel}
                </span>
              </label>
              <div className='rpcEndpointMove'>
                <button
                  type='button'
                  aria-label={`Move RPC endpoint ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onMove(endpoint.id, -1)}
                >
                  <Icon name='chevron-up' size={13} />
                </button>
                <button
                  type='button'
                  aria-label={`Move RPC endpoint ${index + 1} down`}
                  disabled={index === endpoints.length - 1}
                  onClick={() => onMove(endpoint.id, 1)}
                >
                  <Icon name='chevron-down' size={13} />
                </button>
              </div>
              {showToggles ? (
                <Toggle
                  checked={endpoint.on}
                  label={`${endpoint.on ? 'Disable' : 'Enable'} RPC endpoint ${index + 1}`}
                  onChange={(enabled) => onToggle(endpoint.id, enabled)}
                />
              ) : null}
              {index > 0 ? (
                <button
                  type='button'
                  className='rpcEndpointRemove'
                  aria-label={`Remove RPC endpoint ${index + 1}`}
                  onClick={() => removeEndpoint(endpoint.id, index)}
                >
                  <Icon name='remove' size={14} />
                </button>
              ) : (
                <span className='rpcEndpointRemoveSpacer' />
              )}
            </div>
          )
        })}
      </div>
      <div className='rpcEndpointAddRow'>
        <button type='button' disabled={endpoints.length >= 5} onClick={onAdd}>
          <Icon name='add' size={14} />
          <span>Add RPC endpoint</span>
        </button>
        <span aria-live='polite'>{endpoints.length} of 5 RPC endpoints used</span>
      </div>
    </section>
  )
}

export const ChainHeader = ({
  type,
  id,
  icon,
  name,
  isTestnet,
  on,
  primaryColor,
  showExpand,
  showToggle,
  compact,
  status
}) => {
  const isMainnet = id === 1
  const identity = (
    <>
      <div className='signerIcon'>
        <ChainIdentityMark chainId={id} icon={icon} isTestnet={isTestnet} primaryColor={primaryColor} />
      </div>
      <div className='networkIdentityText'>
        <span className='signerName'>{name}</span>
        <div className='networkChainId'>
          {compact
            ? `${isTestnet ? 'Testnet' : id === 1 ? 'Mainnet' : 'Chain'} · 0x${Number(id).toString(16)}`
            : `Chain ID ${id}`}
        </div>
      </div>
      {showExpand && (
        <span className='networkDetailsChevron' aria-hidden='true'>
          <Icon name='chevron-right' size={16} />
        </span>
      )}
    </>
  )
  const openDetails = () => {
    const chain = { id, type }
    link.send('tray:action', 'navDash', { view: 'chains', data: { selectedChain: chain } })
  }

  return (
    <div className='signerTop'>
      {showExpand ? (
        <button
          type='button'
          aria-label={`${name}, Chain ID ${id}`}
          className='signerDetails networkDetailsTrigger'
          onClick={openDetails}
        >
          {identity}
        </button>
      ) : (
        <div className='signerDetails'>{identity}</div>
      )}
      {status ? <span className={`networkRowStatus networkRowStatus${status}`}>{status}</span> : null}
      <div className='signerMenuItems'>
        {showToggle && (
          <button
            type='button'
            aria-label={isMainnet ? `${name} is always enabled` : `${on ? 'Disable' : 'Enable'} ${name}`}
            aria-pressed={on}
            className={on ? 'signerPermissionToggle signerPermissionToggleOn' : 'signerPermissionToggle'}
            disabled={isMainnet}
            onClick={!isMainnet ? () => link.send('tray:action', 'activateNetwork', type, id, !on) : null}
          >
            {isMainnet ? (
              <div className='signerPermissionToggleSwitchLocked'>
                <Icon name='lock' size={10} />
                <div className='signerPermissionToggleSwitch' />
              </div>
            ) : (
              <div className='signerPermissionToggleSwitch' />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

const accents = [
  ['accent1', 'feather gold'],
  ['accent2', 'straw gold'],
  ['accent3', 'stone gray'],
  ['accent4', 'clay red'],
  ['accent5', 'moss green'],
  ['accent6', 'heather'],
  ['accent7', 'mist blue'],
  ['accent8', 'slate gray']
]

export const EditChainColor = ({ currentColor, onChange }) => {
  return (
    <div className='chainRow'>
      <div className='chainInputLabel'>Network color</div>
      <div className='chainColorSwatches'>
        {accents.map(([color, label]) => (
          <button
            type='button'
            aria-label={`Use ${label} as the network color`}
            aria-pressed={currentColor === color}
            key={color}
            className={
              currentColor === color ? 'chainColorSwatch chainColorSwatchSelected' : 'chainColorSwatch'
            }
            style={{ background: `var(--${color})` }}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  )
}

export const EditChainField = ({ currentValue, defaultValue, label, onChange }) => {
  const [editing, setEditing] = useState(false)
  const id = label
    .split(' ')
    .map((s) => s.toLowerCase())
    .join('-')

  return (
    <div className='chainRow'>
      <label htmlFor={id} className='chainInputLabel'>
        {label}
      </label>
      <input
        id={id}
        className={!currentValue ? 'chainInput chainInputDim wrenInput' : 'chainInput wrenInput'}
        value={currentValue || (!editing && defaultValue) || ''}
        spellCheck='false'
        onChange={(e) => {
          onChange(e.target.value)
        }}
        onFocus={() => {
          setEditing(true)
        }}
        onBlur={() => {
          setEditing(false)
        }}
      />
    </div>
  )
}

export const EditChainName = ({ currentName, onChange }) => (
  <EditChainField
    currentValue={currentName}
    onChange={onChange}
    label={'Chain Name'}
    defaultValue={chainDefault.name}
  />
)

export const EditChainSymbol = ({ currentSymbol, onChange }) => (
  <EditChainField
    currentValue={currentSymbol}
    onChange={onChange}
    label={'Native Symbol'}
    defaultValue={chainDefault.symbol}
  />
)

export const EditChainId = ({ chainId, onChange }) => (
  <EditChainField
    currentValue={chainId}
    onChange={onChange}
    label={'Chain ID'}
    defaultValue={chainDefault.id}
  />
)

export const EditChainExplorer = ({ currentExplorer, onChange }) => (
  <EditChainField
    currentValue={currentExplorer}
    onChange={onChange}
    label={'Block Explorer'}
    defaultValue={chainDefault.explorer}
  />
)

export const EditChainIcon = ({ currentIcon, onChange }) => (
  <EditChainField
    currentValue={currentIcon}
    onChange={onChange}
    label={'Chain Icon'}
    defaultValue={chainDefault.icon}
  />
)

export const EditNativeCurrencyIcon = ({ currentCurrencyIcon, onChange }) => (
  <EditChainField
    currentValue={currentCurrencyIcon}
    onChange={onChange}
    label={'Native Currency Icon'}
    defaultValue={chainDefault.nativeCurrencyIcon}
  />
)

export const EditNativeCurrencyName = ({ currentNativeCurrency, onChange }) => (
  <EditChainField
    currentValue={currentNativeCurrency}
    label='Native Currency Name'
    defaultValue={chainDefault.nativeCurrencyName}
    onChange={onChange}
  />
)

export const EditPrimaryRPC = ({ currentPrimaryRPC, onChange }) => (
  <EditChainField
    currentValue={currentPrimaryRPC}
    label={'Primary RPC'}
    defaultValue={chainDefault.primaryRpc}
    onChange={onChange}
  />
)

export const EditSecondaryRPC = ({ currentSecondaryRpc, onChange }) => (
  <EditChainField
    currentValue={currentSecondaryRpc}
    label={'Secondary RPC'}
    defaultValue={chainDefault.secondaryRpc}
    onChange={onChange}
  />
)

export const EditTestnet = ({ testnet, onChange }) => {
  return (
    <div className='chainRowTestnet'>
      <label>Testnet</label>
      <button
        type='button'
        aria-label={`${testnet ? 'Disable' : 'Enable'} testnet mode`}
        aria-pressed={testnet}
        className={testnet ? 'signerPermissionToggle signerPermissionToggleOn' : 'signerPermissionToggle'}
        onClick={() => onChange(!testnet)}
      >
        <div className='signerPermissionToggleSwitch' />
      </button>
    </div>
  )
}
