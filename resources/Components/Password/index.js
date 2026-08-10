import { useEffect, useRef, useState } from 'react'
import zxcvbn from 'zxcvbn'
import useFocusableRef from '../../Hooks/useFocusableRef'

import { debounce } from '../../utils'

const NO_PASSWORD_ENTERED = 'Enter password'

export const PasswordInput = ({
  getError: getInputError,
  next,
  title,
  buttonText,
  autofocus,
  active = true,
  lastStep = false
}) => {
  const [error, setError] = useState(NO_PASSWORD_ENTERED)
  const inputRef = useFocusableRef(autofocus)
  const [disabled, setDisabled] = useState(false)
  const [processing, setProcessing] = useState(false)
  const submitting = useRef(false)
  const resetTimer = useRef()
  const wasActive = useRef(active)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const resetError = () => setError(NO_PASSWORD_ENTERED)

  const clear = () => {
    inputRef.current && (inputRef.current.value = '')
  }

  useEffect(() => {
    if (active && !wasActive.current) {
      clearTimeout(resetTimer.current)
      submitting.current = false
      setDisabled(false)
      setProcessing(false)
      resetError()
      clear()
    }
    wasActive.current = active
  }, [active])

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
    return value ? getInputError(value) || '' : NO_PASSWORD_ENTERED
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
          error && error !== NO_PASSWORD_ENTERED
            ? 'addAccountItemOptionInput addAccountItemOptionInputPassword wrenInputGroup wrenInputGroupError'
            : 'addAccountItemOptionInput addAccountItemOptionInputPassword wrenInputGroup'
        }
      >
        <input
          className={error && error !== NO_PASSWORD_ENTERED ? 'wrenInput wrenInputError' : 'wrenInput'}
          role='textbox'
          type='password'
          aria-label={title}
          autoCapitalize='none'
          autoComplete='off'
          spellCheck={false}
          ref={inputRef}
          onChange={validateInput}
          onKeyDown={(e) => {
            if (!error && e.key === 'Enter' && !disabled && !submitting.current) handleSubmit()
          }}
        />
      </div>

      {error ? (
        <div role='alert' className='addAccountItemOptionError'>
          {error}
        </div>
      ) : processing ? (
        <div role='status' className='addAccountItemOptionProcessing'>
          Processing...
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
    if (password.length < 12) return 'PASSWORD MUST BE AT LEAST 12 CHARACTERS'
    const {
      feedback: { warning },
      score
    } = zxcvbn(password)
    if (score > 2) return

    return (warning || 'PLEASE CHOOSE A STRONGER PASSWORD').toUpperCase()
  }

  return (
    <PasswordInput
      getError={getError}
      next={onCreate}
      title='Create Password'
      buttonText='Continue'
      autofocus={autofocus}
      active={active}
    />
  )
}

export const ConfirmPassword = ({ password, onConfirm, autofocus, active, lastStep }) => {
  const getError = (confirmedPassword) => {
    if (password !== confirmedPassword) return 'PASSWORDS DO NOT MATCH'
  }

  return (
    <PasswordInput
      getError={getError}
      next={onConfirm}
      title='Confirm Password'
      buttonText='Create'
      autofocus={autofocus}
      active={active}
      lastStep={lastStep}
    />
  )
}
