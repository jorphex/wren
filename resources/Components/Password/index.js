import { useCallback, useEffect, useId, useRef, useState } from 'react'
import zxcvbn from 'zxcvbn'
import Icon from '../Icon'
import useFocusableRef from '../../Hooks/useFocusableRef'

import { debounce, isUnmodifiedEnter } from '../../utils'

const NO_PASSWORD_ENTERED = 'Enter password'

export { isUnmodifiedEnter }

export const PasswordInput = ({
  getError: getInputError,
  next,
  title,
  buttonText,
  autofocus,
  active = true,
  autoComplete = 'off',
  emptyError = NO_PASSWORD_ENTERED,
  lastStep = false
}) => {
  const [error, setError] = useState(emptyError)
  const messageId = useId()
  const [revealed, setRevealed] = useState(false)
  const inputRef = useFocusableRef(autofocus)
  const [disabled, setDisabled] = useState(false)
  const [processing, setProcessing] = useState(false)
  const submitting = useRef(false)
  const resetTimer = useRef()
  const wasActive = useRef(active)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const resetError = useCallback(() => setError(emptyError), [emptyError])

  const clear = useCallback(() => {
    inputRef.current && (inputRef.current.value = '')
  }, [inputRef])

  useEffect(() => {
    if (active && !wasActive.current) {
      clearTimeout(resetTimer.current)
      submitting.current = false
      setDisabled(false)
      setProcessing(false)
      setRevealed(false)
      resetError()
      clear()
    }
    wasActive.current = active
  }, [active, clear, resetError])

  const handleSubmit = () => {
    if (disabled || submitting.current) return
    submitting.current = true
    if (lastStep) setProcessing(true)
    next(inputRef.current.value)
    if (lastStep) {
      clear()
    } else {
      resetTimer.current = setTimeout(() => {
        submitting.current = false
        resetError()
        clear()
      }, 1_000)
    }
  }

  const getError = () => {
    const value = inputRef.current?.value || ''
    return value ? getInputError(value) || '' : emptyError
  }

  const validateInput = () => {
    const err = getError()
    if (err) {
      setDisabled(true)
      return debounce(() => {
        setDisabled(false)
        setError(getError())
      }, 300)()
    }
    return setError(err)
  }

  return (
    <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
      <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
        {title}
      </div>
      <div
        className={
          error && error !== emptyError
            ? 'addAccountItemOptionInput addAccountItemOptionInputPassword wrenInputGroup wrenInputGroupError'
            : 'addAccountItemOptionInput addAccountItemOptionInputPassword wrenInputGroup'
        }
      >
        <input
          className={error && error !== emptyError ? 'wrenInput wrenInputError' : 'wrenInput'}
          role='textbox'
          type={revealed ? 'text' : 'password'}
          aria-label={title}
          aria-describedby={error ? messageId : undefined}
          autoCapitalize='none'
          autoComplete={autoComplete}
          spellCheck={false}
          ref={inputRef}
          onChange={validateInput}
          onKeyDown={(e) => {
            if (!error && isUnmodifiedEnter(e) && !disabled && !submitting.current) {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <button
          type='button'
          className='addAccountItemOptionPasswordReveal wrenControl wrenControlSecondary wrenControlIcon'
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          <Icon name='eye' size={18} />
        </button>
      </div>

      {error ? (
        <div
          id={messageId}
          role={error === emptyError ? undefined : 'alert'}
          className='addAccountItemOptionError'
        >
          {error}
        </div>
      ) : processing ? (
        <div role='status' className='addAccountItemOptionProcessing'>
          Processing…
        </div>
      ) : (
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={disabled || processing}
          onClick={handleSubmit}
        >
          {buttonText}
        </button>
      )}
    </div>
  )
}

export const CreatePassword = ({ onCreate, autofocus, active }) => {
  const getError = (password) => {
    if (password.length < 12) return 'Password must be at least 12 characters'
    const {
      feedback: { warning },
      score
    } = zxcvbn(password)
    if (score > 2) return

    return warning || 'Choose a stronger password'
  }

  return (
    <PasswordInput
      getError={getError}
      next={onCreate}
      title='Create password'
      buttonText='Continue'
      autofocus={autofocus}
      active={active}
      autoComplete='new-password'
    />
  )
}

export const ConfirmPassword = ({ password, onConfirm, autofocus, active, lastStep }) => {
  const getError = (confirmedPassword) => {
    if (password !== confirmedPassword) return 'Passwords do not match'
  }

  return (
    <PasswordInput
      getError={getError}
      next={onConfirm}
      title='Confirm password'
      buttonText='Create'
      autofocus={autofocus}
      active={active}
      autoComplete='new-password'
      emptyError='Enter your password again'
      lastStep={lastStep}
    />
  )
}
