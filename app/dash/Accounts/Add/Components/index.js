import { cloneElement, useCallback, useEffect, useRef, useState } from 'react'

import useFocusableRef from '../../../../../resources/Hooks/useFocusableRef'
import Icon from '../../../../../resources/Components/Icon'
import { ConfirmPassword, CreatePassword } from '../../../../../resources/Components/Password'
import link from '../../../../../resources/link'
import { debounce } from '../../../../../resources/utils'

const navForward = (newAccountType, accountSetupStep, error) =>
  link.send('nav:forward', 'dash', {
    view: 'accounts',
    data: {
      showAddAccounts: true,
      newAccountType,
      accountSetupStep,
      ...(error ? { error } : {})
    }
  })

const normalizeSecret = (secret, accountType) =>
  accountType === 'seed' ? secret.replace(/\s+/g, ' ') : secret.replace(/\s+/g, '')

export const AddHotAccountWrapper = ({ children, title, svgName, summary, index, setupClass = '' }) => {
  return (
    <div className={`addAccountItem addAccountItemSmart addAccountItemAdding ${setupClass}`}>
      <div className='addAccountItemBar addAccountItemHot' />
      <div className='addAccountItemWrap'>
        <div className='addAccountItemTop'>
          <div className='addAccountItemTopType'>
            <div className='addAccountItemIcon'>
              <div className='addAccountItemIconType addAccountItemIconHot'>
                <Icon
                  name={
                    svgName === 'key'
                      ? 'key'
                      : svgName === 'file'
                        ? 'file'
                        : svgName === 'seedling'
                          ? 'seedling'
                          : 'hot'
                  }
                  size={svgName === 'seedling' ? 20 : 24}
                />
              </div>
              <div className='addAccountItemIconHex addAccountItemIconHexHot' />
            </div>
            <div className='addAccountItemTopTitle'>{title}</div>
          </div>
          <div className='addAccountItemSummary'>{summary}</div>
        </div>
        <div className='addAccountItemOption'>
          <div className='addAccountItemOptionSetup' style={{ transform: `translateX(-${100 * index}%)` }}>
            <div className='addAccountItemOptionSetupFrames'>{children}</div>
          </div>
        </div>
        <div className='addAccountItemFooter' />
      </div>
    </div>
  )
}

const EnterSecret = ({ newAccountType, validateSecret, title, autofocus, active, onContinue }) => {
  const EMPTY_STATE = `Enter ${title.charAt(0).toLowerCase()}${title.slice(1)}`
  const inputRef = useFocusableRef(autofocus, 100)
  const [error, setError] = useState(EMPTY_STATE)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const wasActive = useRef(active)

  const resetError = useCallback(() => setError(EMPTY_STATE), [EMPTY_STATE])

  const clear = useCallback(() => {
    resetError()
    inputRef.current && (inputRef.current.value = '')
  }, [inputRef, resetError])

  useEffect(() => {
    if (active && !wasActive.current) {
      submittingRef.current = false
      setSubmitting(false)
      clear()
    }
    wasActive.current = active
  }, [active, clear])

  const validateInput = debounce((e) => {
    const value = normalizeSecret(e.target.value, newAccountType).trim()
    if (!value) return resetError()
    const validationErr = validateSecret(value)
    setError(validationErr || '')
  }, 300)

  const handleSubmit = () => {
    if (error || submittingRef.current) return
    const secret = normalizeSecret(inputRef.current.value, newAccountType).trim()
    submittingRef.current = true
    setSubmitting(true)
    clear()
    return onContinue(secret)
  }

  return (
    <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
      <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
        {title}
      </div>
      <div
        className={
          newAccountType === 'keyring'
            ? 'addAccountItemOptionInput phrase addAccountItemOptionInputSingleLine wrenInputGroup'
            : 'addAccountItemOptionInput phrase wrenInputGroup'
        }
      >
        <textarea
          className='wrenInput'
          ref={inputRef}
          aria-label={title}
          autoCapitalize='none'
          autoComplete='off'
          spellCheck={false}
          onChange={(e) => {
            inputRef.current.value = normalizeSecret(e.target.value, newAccountType)
            validateInput(e)
          }}
          onKeyDown={(e) => {
            if (!error && !submitting && e.key === 'Enter') handleSubmit()
          }}
        />
      </div>
      <div role={error ? 'alert' : undefined} className='addAccountItemOptionError'>
        {error}
      </div>
      <button
        type='button'
        className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
        disabled={Boolean(error) || submitting}
        onClick={() => handleSubmit()}
      >
        {'Next'}
      </button>
    </div>
  )
}

const Error = ({ error, active }) => {
  return (
    <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
      <>
        <div role='alert' className='addAccountItemOptionTitle'>
          {error}
        </div>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          onClick={() => link.send('nav:back', 'dash', 3)}
        >
          Try again
        </button>
      </>
    </div>
  )
}

export function AddHotAccount({
  title,
  summary,
  svgName,
  intro,
  accountSetupStep,
  error,
  createSignerMethod,
  newAccountType,
  validateSecret,
  firstStep,
  firstStepSteps = [],
  backSteps = 4
}) {
  const [draft, setDraft] = useState({})
  const previousStep = useRef(accountSetupStep)
  const { secret, password } = draft
  const viewIndex =
    error || firstStepSteps.includes(accountSetupStep)
      ? error
        ? 3
        : 0
      : !secret
        ? 0
        : accountSetupStep === 'confirm' && password
          ? 2
          : 1

  const clearDraft = () => {
    setDraft({})
  }

  useEffect(() => {
    if (!accountSetupStep && previousStep.current) clearDraft()
    previousStep.current = accountSetupStep
  }, [accountSetupStep])

  const advance = (step, update) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...update }))
    navForward(newAccountType, step)
  }

  const onCreate = (password) => {
    advance('confirm', { password })
  }

  const onConfirm = () => {
    const { secret, password, creationArgs = [] } = draft
    link.rpc(createSignerMethod, secret, password, ...creationArgs, (err, signer) => {
      if (err) {
        clearDraft()
        return navForward(newAccountType, 'error', err)
      }

      clearDraft()
      link.send('nav:back', 'dash', backSteps)
      link.send(`nav:forward`, 'dash', {
        view: 'expandedSigner',
        data: { signer: signer.id }
      })
    })
  }

  const firstFlowStep = firstStep ? (
    cloneElement(firstStep, {
      onContinue: (secret, creationArgs = []) => advance('password', { secret, creationArgs }),
      secret
    })
  ) : (
    <EnterSecret
      key={0}
      {...{
        validateSecret,
        title,
        newAccountType,
        autofocus: viewIndex === 0,
        onContinue: (secret) => advance('password', { secret })
      }}
    />
  )

  const steps = [
    firstFlowStep,
    <CreatePassword key={1} onCreate={onCreate} autofocus={viewIndex === 1} />,
    <ConfirmPassword
      key={2}
      password={password}
      onConfirm={onConfirm}
      autofocus={viewIndex === 2}
      lastStep={true}
    />,
    <Error key={3} error={error} />
  ]

  return (
    <AddHotAccountWrapper
      {...{
        title,
        intro,
        summary,
        svgName,
        index: viewIndex
      }}
    >
      {steps.map((step, stepIndex) => cloneElement(step, { active: stepIndex === viewIndex }))}
    </AddHotAccountWrapper>
  )
}
