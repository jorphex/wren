import { cloneElement, useEffect, useRef, useState } from 'react'

import useFocusableRef from '../../../../../resources/Hooks/useFocusableRef'
import RingIcon from '../../../../../resources/Components/RingIcon'
import { ConfirmPassword, CreatePassword } from '../../../../../resources/Components/Password'
import link from '../../../../../resources/link'
import { debounce } from '../../../../../resources/utils'

const navForward = async (newAccountType, accountData) =>
  link.send('nav:forward', 'dash', {
    view: 'accounts',
    data: {
      showAddAccounts: true,
      newAccountType,
      accountData
    }
  })

const normalizeSecret = (secret, accountType) =>
  accountType === 'seed' ? secret.replace(/\s+/g, ' ') : secret.replace(/\s+/g, '')

const AddHotAccountWrapper = ({ children, title, svgName, summary, index }) => {
  return (
    <div className={'addAccountItem addAccountItemSmart addAccountItemAdding'}>
      <div className='addAccountItemBar addAccountItemHot' />
      <div className='addAccountItemWrap'>
        <div className='addAccountItemTop'>
          <div className='addAccountItemTopType'>
            <div className='addAccountItemIcon'>
              <div className='addAccountItemIconType addAccountItemIconHot'>
                <RingIcon {...{ svgName }} />
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

const EnterSecret = ({ newAccountType, validateSecret, title, autofocus, active }) => {
  const EMPTY_STATE = `Enter ${title}`
  const inputRef = useFocusableRef(autofocus, 100)
  const [error, setError] = useState(EMPTY_STATE)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const wasActive = useRef(active)

  const resetError = () => setError(EMPTY_STATE)

  const clear = () => {
    resetError()
    inputRef.current && (inputRef.current.value = '')
  }

  useEffect(() => {
    if (active && !wasActive.current) {
      submittingRef.current = false
      setSubmitting(false)
      clear()
    }
    wasActive.current = active
  }, [active])

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
    return navForward(newAccountType, { secret })
  }

  return (
    <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
      <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
        {title}
      </div>
      <div className='addAccountItemOptionInput phrase'>
        <textarea
          ref={inputRef}
          aria-label={title}
          onChange={(e) => {
            inputRef.current.value = normalizeSecret(e.target.value, newAccountType)
            validateInput(e)
          }}
          onKeyDown={(e) => {
            if (!error && !submitting && e.key === 'Enter') handleSubmit()
          }}
        />
      </div>
      {error ? (
        <div role='alert' className='addAccountItemOptionError'>
          {error}
        </div>
      ) : (
        <button
          type='button'
          className='addAccountItemOptionSubmit'
          disabled={submitting}
          onClick={() => handleSubmit()}
        >
          {'Next'}
        </button>
      )}
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
          className='addAccountItemOptionSubmit'
          onClick={() => link.send('nav:back', 'dash', 3)}
        >
          try again
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
  accountData,
  createSignerMethod,
  newAccountType,
  validateSecret,
  firstStep,
  backSteps = 4
}) {
  const { secret, password, error, creationArgs = [] } = accountData
  const viewIndex = error ? 3 : !secret ? 0 : !password ? 1 : 2

  const onCreate = (password) => {
    navForward(newAccountType, {
      secret,
      password,
      creationArgs
    })
  }

  const onConfirm = () =>
    link.rpc(createSignerMethod, secret, password, ...creationArgs, (err, signer) => {
      if (err) {
        return navForward(newAccountType, {
          error: err
        })
      }

      link.send('nav:back', 'dash', backSteps)
      link.send(`nav:forward`, 'dash', {
        view: 'expandedSigner',
        data: { signer: signer.id }
      })
    })

  const firstFlowStep = firstStep || (
    <EnterSecret key={0} {...{ validateSecret, title, newAccountType, autofocus: viewIndex === 0 }} />
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
