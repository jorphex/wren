import { useState } from 'react'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import RingIcon from '../../../../../resources/Components/RingIcon'
import chainDefault from '../chainDefault'
import { getChainIdentity } from '../../../../../resources/utils/chainIdentity'

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

  return (
    <label className={error ? 'networkEditorField networkEditorFieldError' : 'networkEditorField'}>
      <span className='networkEditorFieldLabel'>
        <span>{label}</span>
        {status && (
          <span
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
    <button
      type='button'
      aria-label={label}
      aria-pressed={checked}
      className={checked ? 'networkEditorToggle networkEditorToggleOn' : 'networkEditorToggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
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
  if (endpoint.status === 'connected') {
    return endpoint.latencyMs === undefined ? 'Connected' : `Connected · ${Math.round(endpoint.latencyMs)} ms`
  }
  if (endpoint.status === 'standby') {
    return endpoint.latencyMs === undefined ? 'Not checked' : `Standby · ${Math.round(endpoint.latencyMs)} ms`
  }
  if (['loading', 'pending', 'syncing'].includes(endpoint.status)) return 'Checking connection…'
  if (['disconnected', 'error', 'chain mismatch'].includes(endpoint.status)) return 'Can’t connect'
  return 'Not checked'
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
  onRemove
}) => (
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
        const error = status === 'Can’t connect' || status === 'Use an HTTPS RPC URL'
        return (
          <div
            className={endpoint.on ? 'rpcEndpointRow' : 'rpcEndpointRow rpcEndpointRowOff'}
            key={endpoint.id}
          >
            <span className='rpcEndpointOrder'>{index + 1}</span>
            <span className={`rpcEndpointDot rpcEndpointDot${endpoint.status || 'off'}`} aria-hidden='true' />
            <label className='rpcEndpointInputWrap'>
              <input
                aria-label={`RPC URL ${index + 1}`}
                aria-invalid={error || undefined}
                className='rpcEndpointInput wrenInput'
                spellCheck='false'
                value={values[endpoint.id] ?? ''}
                onBlur={() => onCommit(endpoint.id)}
                onChange={(event) => onValueChange(endpoint.id, event.target.value.replace(/\s+/g, ''))}
              />
            </label>
            <span className={error ? 'rpcEndpointStatus rpcEndpointStatusError' : 'rpcEndpointStatus'}>
              {status}
            </span>
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
            <button
              type='button'
              aria-label={`${endpoint.on ? 'Disable' : 'Enable'} RPC endpoint ${index + 1}`}
              aria-pressed={endpoint.on}
              className={endpoint.on ? 'networkEditorToggle networkEditorToggleOn' : 'networkEditorToggle'}
              onClick={() => onToggle(endpoint.id, !endpoint.on)}
            >
              <span />
            </button>
            {index > 0 ? (
              <button
                type='button'
                className='rpcEndpointRemove'
                aria-label={`Remove RPC endpoint ${index + 1}`}
                onClick={() => onRemove(endpoint.id)}
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
        <span>Add RPC</span>
      </button>
      {endpoints.length >= 5 && <span>Maximum of 5 RPC endpoints</span>}
    </div>
  </section>
)

export const ChainHeader = ({
  type,
  id,
  icon,
  name,
  isTestnet,
  on,
  primaryColor,
  showExpand,
  showToggle
}) => {
  const isMainnet = id === 1
  const chainIdentity = getChainIdentity(id, isTestnet)
  const isCustomIdentity = chainIdentity.mark === 'chain'
  const identityColor =
    isCustomIdentity && primaryColor ? `var(--${primaryColor})` : `var(${chainIdentity.colorToken})`
  const identity = (
    <>
      <div className='signerIcon'>
        <RingIcon
          block={!isCustomIdentity}
          color={identityColor}
          img={isCustomIdentity ? icon : undefined}
          noRing={!isCustomIdentity}
          svgName={chainIdentity.mark}
          svgSize={isCustomIdentity ? undefined : 20}
        />
      </div>
      <div className='networkIdentityText'>
        <div role='chainName' className='signerName'>
          {name}
        </div>
        <div className='networkChainId'>Chain ID {id}</div>
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
      <div className='chainInputLabel'>Chain Color</div>
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
