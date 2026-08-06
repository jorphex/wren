import { useState } from 'react'

function findOption(options, value) {
  return options.find((option) => option.value === value) || options[0]
}

const Dropdown = ({
  options,
  syncValue,
  initialValue,
  style,
  className = '',
  label = 'Choose an option',
  disabled = false,
  onChange
}) => {
  const [localValue, setLocalValue] = useState(() => findOption(options, initialValue)?.value)
  const selected = findOption(options, syncValue === undefined ? localValue : syncValue)

  const handleChange = (event) => {
    const option = options.find((candidate) => String(candidate.value) === event.target.value)
    if (!option || option.value === selected?.value) return

    if (syncValue === undefined) setLocalValue(option.value)
    onChange(option.value)
  }

  return (
    <div className='dropdownWrap'>
      <select
        aria-label={label}
        className={`dropdown ${className}`}
        disabled={disabled}
        style={style}
        value={selected ? String(selected.value) : ''}
        onChange={handleChange}
      >
        {options.map((option, index) => (
          <option key={`${option.text}-${index}`} value={String(option.value)}>
            {option.text}
          </option>
        ))}
      </select>
    </div>
  )
}

export default Dropdown
