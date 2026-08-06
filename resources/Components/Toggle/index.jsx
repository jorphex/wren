const Toggle = ({ checked, disabled = false, label, onChange, className = '' }) => {
  const classes = ['wrenToggle', checked ? 'wrenToggleOn' : '', className].filter(Boolean).join(' ')

  return (
    <button
      type='button'
      aria-checked={checked}
      aria-label={label}
      className={classes}
      disabled={disabled}
      role='switch'
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden='true' className='wrenToggleThumb' />
    </button>
  )
}

export default Toggle
