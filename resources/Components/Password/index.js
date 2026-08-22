import { useCallback, useEffect, useId, useRef, useState } from 'react'
import zxcvbn from 'zxcvbn'
import Icon from '../Icon'
import useFocusableRef from '../../Hooks/useFocusableRef'
import { MINIMUM_NEW_PASSWORD_SCORE, MINIMUM_PASSWORD_LENGTH } from '../../domain/password'

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
  lastStep = false,
  overrideError
}) => {
  const [error, setError] = useState(emptyError)
  const [overrideAccepted, setOverrideAccepted] = useState(false)
  const [overrideAvailable, setOverrideAvailable] = useState(false)
  const messageId = useId()
  const [revealed, setRevealed] = useState(false)
  const inputRef = useFocusableRef(autofocus)
  const [disabled, setDisabled] = useState(false)
  const [processing, setProcessing] = useState(false)
  const submitting = useRef(false)
  const resetTimer = useRef()
  const wasActive = useRef(active)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const resetError = useCallback(() => {
    setError(emptyError)
    setOverrideAccepted(false)
    setOverrideAvailable(false)
  }, [emptyError])

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
    const validation = getValidation()
    const accepted = validation.overrideAvailable && overrideAccepted
    if (validation.error && !accepted) {
      setError(validation.error)
      setOverrideAvailable(validation.overrideAvailable)
      return
    }
    submitting.current = true
    if (lastStep) setProcessing(true)
    if (overrideError) {
      next(inputRef.current.value, { allowWeakPassword: accepted })
    } else {
      next(inputRef.current.value)
    }
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

  const getValidation = () => {
    const value = inputRef.current?.value || ''
    const validationError = value ? getInputError(value) || '' : emptyError
    return {
      error: validationError,
      overrideAvailable: Boolean(
        validationError && validationError !== emptyError && overrideError?.(value, validationError)
      )
    }
  }

  const validateInput = () => {
    setOverrideAccepted(false)
    setOverrideAvailable(false)
    const validation = getValidation()
    if (validation.error) {
      setDisabled(true)
      return debounce(() => {
        setDisabled(false)
        const nextValidation = getValidation()
        setError(nextValidation.error)
        setOverrideAvailable(nextValidation.overrideAvailable)
      }, 300)()
    }
    setError('')
  }

  const canSubmit = !error || (overrideAvailable && overrideAccepted)
  const hasBlockingError = Boolean(error && error !== emptyError && !overrideAvailable)

  return (
    <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
      <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
        {title}
      </div>
      <div
        className={
          hasBlockingError
            ? 'addAccountItemOptionInput addAccountItemOptionInputPassword wrenInputGroup wrenInputGroupError'
            : 'addAccountItemOptionInput addAccountItemOptionInputPassword wrenInputGroup'
        }
      >
        <input
          className={hasBlockingError ? 'wrenInput wrenInputError' : 'wrenInput'}
          role='textbox'
          type={revealed ? 'text' : 'password'}
          aria-label={title}
          aria-invalid={hasBlockingError ? 'true' : 'false'}
          aria-describedby={error ? messageId : undefined}
          autoCapitalize='none'
          autoComplete={autoComplete}
          spellCheck={false}
          ref={inputRef}
          onChange={validateInput}
          onKeyDown={(e) => {
            if (canSubmit && isUnmodifiedEnter(e) && !disabled && !submitting.current) {
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
      ) : null}
      {overrideAvailable ? (
        <label className='addAccountItemOptionPasswordConsent'>
          <input
            type='checkbox'
            checked={overrideAccepted}
            aria-describedby={messageId}
            onChange={(event) => setOverrideAccepted(event.target.checked)}
          />
          <span>I understand this password may be easy to guess.</span>
        </label>
      ) : null}
      {processing ? (
        <div role='status' className='addAccountItemOptionProcessing'>
          Processing…
        </div>
      ) : !error || overrideAvailable ? (
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={disabled || processing || !canSubmit}
          onClick={handleSubmit}
        >
          {buttonText}
        </button>
      ) : null}
    </div>
  )
}

export const CreatePassword = ({ onCreate, autofocus, active }) => {
  const getError = (password) => {
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      return `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`
    }
    const {
      feedback: { warning },
      score
    } = zxcvbn(password)
    if (score >= MINIMUM_NEW_PASSWORD_SCORE) return

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
      overrideError={(password) => password.length >= MINIMUM_PASSWORD_LENGTH}
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
