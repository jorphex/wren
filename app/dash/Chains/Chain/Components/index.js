import { useState } from 'react'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import RingIcon from '../../../../../resources/Components/RingIcon'
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

export const ChainHeader = ({ type, id, primaryColor, icon, svgName, name, on, showExpand, showToggle }) => {
  const isMainnet = id === 1
  return (
    <div className='signerTop'>
      <div className='signerDetails'>
        <div className='signerIcon'>
          <RingIcon color={`var(--${primaryColor})`} img={icon} svgName={svgName} />
        </div>
        {/* <div className='signerType' style={this.props.inSetup ? {top: '21px'} : {top: '24px'}}>{this.props.model}</div> */}
        <div role='chainName' className='signerName'>
          {name}
        </div>
      </div>
      <div className='signerMenuItems'>
        {showExpand && (
          <button
            type='button'
            aria-label={`Open ${name} network details`}
            className='signerExpand'
            onClick={() => {
              const chain = { id, type }
              link.send('tray:action', 'navDash', { view: 'chains', data: { selectedChain: chain } })
            }}
          >
            <Icon name='details' size={14} />
          </button>
        )}
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
        className={!currentValue ? 'chainInput chainInputDim' : 'chainInput'}
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
