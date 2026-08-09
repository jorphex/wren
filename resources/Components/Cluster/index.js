export const ClusterValue = ({
  children,
  style = {},
  onClick,
  grow = 1,
  pointerEvents = false,
  transparent = false,
  role,
  ariaLabel,
  ariaExpanded,
  actionRef,
  disabled = false
}) => {
  const actionable = typeof onClick === 'function'
  let valueClass = 'clusterValue'
  if (actionable) valueClass += ' clusterValueClickable clusterValueButton'
  if (pointerEvents) valueClass += ' clusterValueInteractable'
  if (transparent) valueClass += ' clusterValueTransparent'
  const valueStyle = { ...style, flexGrow: grow }

  if (actionable) {
    return (
      <div className={`${valueClass}${disabled ? ' clusterValueDisabled' : ''}`} style={valueStyle}>
        <button
          type='button'
          aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
          aria-expanded={ariaExpanded}
          className='clusterValueAction'
          disabled={disabled}
          onClick={onClick}
          ref={actionRef}
        />
        <div className='clusterValueContent'>{children}</div>
      </div>
    )
  }

  return (
    <div className={valueClass} style={valueStyle} role={role}>
      {children}
    </div>
  )
}

export const ClusterRow = ({ children, style = {}, className = '' }) => {
  return (
    <div className={`clusterRow${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  )
}

export const ClusterStatus = ({ children }) => (
  <span className='clusterStatus' role='status' aria-live='polite'>
    {children}
  </span>
)

export const ClusterColumn = ({ children, style = {}, grow = 1, width }) => {
  const columnStyle = {
    ...style,
    flexGrow: grow,
    ...(width ? { width, minWidth: width, maxWidth: width } : {})
  }
  return (
    <div className='clusterColumn' style={columnStyle}>
      {children}
    </div>
  )
}

export const Cluster = ({ children, style = {}, className = '' }) => {
  return (
    <div className={`cluster${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  )
}

export const ClusterBox = ({ title, subtitle, children, className = '', style = {}, animationSlot = 0 }) => {
  const boxStyle = { ...style, animationDelay: 0.1 * animationSlot + 's' }
  return (
    <div className={`_txMain${className ? ` ${className}` : ''}`} style={boxStyle}>
      <div className='_txMainInner'>
        {title ? (
          <div className='_txLabel'>
            <div>{title}</div>
            {subtitle && <span className='clusterBoxSubtitle'>{`(${subtitle})`}</span>}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}
