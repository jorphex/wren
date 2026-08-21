import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import DialogSurface from '../../../../../resources/Components/DialogSurface'
import Icon from '../../../../../resources/Components/Icon'
import { ConfirmPassword, CreatePassword } from '../../../../../resources/Components/Password'
import useCopiedMessage, { useSecretCopiedMessage } from '../../../../../resources/Hooks/useCopiedMessage'
import link from '../../../../../resources/link'
import { setDashNavigationGuard } from '../../../navigationGuard'
import { AddHotAccountWrapper } from '../Components'

const normalizePrivateKey = (value) => value.trim().replace(/^0x/iu, '').toLowerCase()
const validPrivateKey = (value) => /^[0-9a-f]{64}$/u.test(normalizePrivateKey(value))
const COMPLETION_TIMEOUT_MS = 30_000
const GENERATION_TIMEOUT_MS = 65_000

const useActivationFocus = (active, delay = 100) => {
  const ref = useRef(null)

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => ref.current?.focus(), delay)
    return () => clearTimeout(timer)
  }, [active, delay])

  return ref
}

const BlankFrame = ({ active }) => (
  <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active} />
)

const CopyControl = ({ copied, focusRef, label, onCopy }) => {
  const [copyFailed, setCopyFailed] = useState(false)

  const copy = async () => {
    setCopyFailed(false)
    if (!(await onCopy())) setCopyFailed(true)
  }

  const target = label.replace(/^Copy /u, '')
  const buttonLabel = copyFailed ? `${label} again` : copied ? `${target} copied` : label
  const status = copyFailed ? 'Copy failed. Try again.' : copied ? `${target} copied` : ''

  return (
    <span className='generatedWalletCopyGroup'>
      <button
        type='button'
        ref={focusRef}
        className='generatedWalletQuietControl wrenControl wrenControlSecondary'
        onClick={copy}
      >
        <Icon name='copy' size={16} />
        <span>{buttonLabel}</span>
      </button>
      <span className='generatedWalletCopyStatus' role='status' aria-live='polite'>
        {status}
      </span>
    </span>
  )
}

const SetupExpiry = ({ expiresAt }) => {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!Number.isFinite(expiresAt)) return
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [expiresAt])

  if (!Number.isFinite(expiresAt)) return null
  const remaining = Math.max(0, expiresAt - now)
  if (remaining <= 60_000) {
    return <p className='generatedWalletSessionNote'>Finish setup within less than a minute.</p>
  }
  const minutes = Math.ceil(remaining / 60_000)
  return (
    <p className='generatedWalletSessionNote'>
      Finish setup within about {minutes} {minutes === 1 ? 'minute' : 'minutes'}.
    </p>
  )
}

const PhrasePresentation = ({ active, onContinue, presentation }) => {
  const [copied, copyPhrase] = useSecretCopiedMessage(presentation.secret, 1800)
  const headingRef = useActivationFocus(active)

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody'>
        <div
          ref={headingRef}
          role='heading'
          aria-level='2'
          tabIndex='-1'
          className='addAccountItemOptionTitle'
        >
          Your recovery phrase
        </div>
        <p className='generatedWalletGuidance'>
          Write these 12 words down in order. Wren will not show them again.
        </p>
        <ol className='generatedWalletPhrase' aria-label='Recovery phrase'>
          {presentation.secret.split(' ').map((word, index) => (
            <li key={`${index}-${word}`}>
              <span aria-hidden='true'>{index + 1}</span>
              <strong>{word}</strong>
            </li>
          ))}
        </ol>
        <CopyControl copied={copied} label='Copy recovery phrase' onCopy={copyPhrase} />
        <p className='generatedWalletClipboardNote'>
          Wren clears an unchanged clipboard after 60 seconds. Clipboard history may retain it.
        </p>
        <SetupExpiry expiresAt={presentation.expiresAt} />
        <p className='generatedWalletConsequence'>Leaving now deletes this new wallet.</p>
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          onClick={onContinue}
        >
          {"I've written it down"}
        </button>
      </div>
    </div>
  )
}

const PrivateKeyPresentation = ({ active, onContinue, presentation }) => {
  const [revealed, setRevealed] = useState(false)
  const [secretAccessed, setSecretAccessed] = useState(false)
  const [addressCopied, copyAddress] = useCopiedMessage(presentation.address, 1800)
  const [keyCopied, copyPrivateKey] = useSecretCopiedMessage(presentation.secret, 1800)
  const revealRef = useActivationFocus(active)

  const copyKey = async () => {
    const copied = await copyPrivateKey()
    if (copied) setSecretAccessed(true)
    return copied
  }

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody'>
        <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
          Your private key
        </div>
        <p className='generatedWalletGuidance'>
          Show or copy this key, then save it somewhere safe. Wren will not show it again.
        </p>
        <div className='generatedWalletEvidenceGroup'>
          <div className='generatedWalletEvidence'>
            <div className='generatedWalletEvidenceLabel'>Account address</div>
            <code className='generatedWalletEvidenceValue'>{presentation.address}</code>
            <CopyControl copied={addressCopied} label='Copy address' onCopy={copyAddress} />
          </div>
          <div className='generatedWalletEvidence'>
            <div className='generatedWalletEvidenceLabel'>Private key</div>
            <code
              className={revealed ? 'generatedWalletEvidenceValue' : 'generatedWalletEvidenceValue concealed'}
            >
              {revealed ? (
                presentation.secret
              ) : (
                <>
                  <span aria-hidden='true'>{`0x${'•'.repeat(32)}`}</span>
                  <span className='generatedWalletScreenReaderOnly'>Private key concealed</span>
                </>
              )}
            </code>
            <div className='generatedWalletEvidenceControls'>
              <button
                type='button'
                ref={revealRef}
                className='generatedWalletQuietControl wrenControl wrenControlSecondary'
                onClick={() => {
                  if (!revealed) setSecretAccessed(true)
                  setRevealed((value) => !value)
                }}
              >
                {revealed ? 'Hide private key' : 'Show private key'}
              </button>
              <CopyControl copied={keyCopied} label='Copy private key' onCopy={copyKey} />
            </div>
          </div>
        </div>
        <p className='generatedWalletClipboardNote'>
          Wren clears an unchanged clipboard after 60 seconds. Clipboard history may retain it.
        </p>
        <SetupExpiry expiresAt={presentation.expiresAt} />
        <p className='generatedWalletConsequence'>Leaving now deletes this new account.</p>
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={!secretAccessed}
          onClick={onContinue}
        >
          {"I've saved my key"}
        </button>
      </div>
    </div>
  )
}

const PhraseVerification = ({ active, challenge, expiresAt, onComplete, onEdit, submitting, error }) => {
  const [words, setWords] = useState(['', '', ''])
  const ready = words.every((word) => word.trim())
  const firstInputRef = useActivationFocus(active)
  const errorId = 'generated-phrase-verification-error'

  useEffect(() => {
    if (active && error) firstInputRef.current?.focus()
  }, [active, error, firstInputRef])

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody generatedWalletVerify'>
        <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
          Verify your backup
        </div>
        <p className='generatedWalletGuidance'>Enter the requested words from your saved copy.</p>
        {challenge.map((position, index) => (
          <label className='generatedWalletVerifyField' key={position}>
            <span>Word {position}</span>
            <span className={error ? 'wrenInputGroup wrenInputGroupError' : 'wrenInputGroup'}>
              <input
                autoCapitalize='none'
                autoComplete='off'
                ref={index === 0 ? firstInputRef : undefined}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className={error ? 'wrenInput wrenInputError' : 'wrenInput'}
                disabled={submitting}
                spellCheck={false}
                value={words[index]}
                onChange={(event) => {
                  const next = [...words]
                  next[index] = event.target.value.replace(/\s+/gu, '').toLowerCase()
                  setWords(next)
                  onEdit()
                }}
              />
            </span>
          </label>
        ))}
        {error ? (
          <div id={errorId} role='alert' className='generatedWalletVerifyError'>
            {error}
          </div>
        ) : null}
        <SetupExpiry expiresAt={expiresAt} />
        <p className='generatedWalletConsequence'>
          {submitting ? 'Wren is finishing this wallet setup.' : 'Leaving now deletes this new wallet.'}
        </p>
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={!ready || submitting}
          onClick={() => onComplete({ words })}
        >
          {submitting ? 'Finishing…' : 'Finish setup'}
        </button>
      </div>
    </div>
  )
}

const PrivateKeyVerification = ({ active, expiresAt, onComplete, onEdit, submitting, error }) => {
  const [privateKey, setPrivateKey] = useState('')
  const inputRef = useActivationFocus(active)
  const errorId = 'generated-private-key-verification-error'

  useEffect(() => {
    if (active && error) inputRef.current?.focus()
  }, [active, error, inputRef])

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody generatedWalletVerify'>
        <div role='heading' aria-level='2'>
          <label htmlFor='generated-private-key-confirmation' className='addAccountItemOptionTitle'>
            Verify your backup
          </label>
        </div>
        <p className='generatedWalletGuidance'>Enter the private key from your saved copy.</p>
        <div
          className={
            error
              ? 'generatedWalletKeyInput wrenInputGroup wrenInputGroupError'
              : 'generatedWalletKeyInput wrenInputGroup'
          }
        >
          <textarea
            id='generated-private-key-confirmation'
            autoCapitalize='none'
            autoComplete='off'
            ref={inputRef}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={error ? 'wrenInput wrenInputError' : 'wrenInput'}
            disabled={submitting}
            spellCheck={false}
            value={privateKey}
            onChange={(event) => {
              setPrivateKey(event.target.value.replace(/\s+/gu, ''))
              onEdit()
            }}
          />
        </div>
        {error ? (
          <div id={errorId} role='alert' className='generatedWalletVerifyError'>
            {error}
          </div>
        ) : null}
        <SetupExpiry expiresAt={expiresAt} />
        <p className='generatedWalletConsequence'>
          {submitting ? 'Wren is finishing this account setup.' : 'Leaving now deletes this new account.'}
        </p>
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={!validPrivateKey(privateKey) || submitting}
          onClick={() => onComplete({ privateKey })}
        >
          {submitting ? 'Finishing…' : 'Finish setup'}
        </button>
      </div>
    </div>
  )
}

const ErrorFrame = ({ active, actionLabel, detail, error, onAction }) => {
  const retryRef = useActivationFocus(active)

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody generatedWalletError'>
        <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
          <span role='alert'>{error}</span>
        </div>
        <p className='generatedWalletGuidance'>{detail}</p>
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          ref={retryRef}
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          onClick={onAction}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

const messageFor = (error) => (typeof error === 'string' ? error : error?.message || '')

const terminalMessageFor = (error, noun) => {
  const message = messageFor(error)
  if (/no longer available|expired/iu.test(message)) return `This ${noun} setup expired.`
  if (/already exists/iu.test(message)) return 'This account already exists in Wren.'
  return `Wren could not finish creating this ${noun} safely.`
}

const terminalRecoveryFor = (error) =>
  messageFor(error) ===
  'Wallet creation could not be rolled back completely. Check Accounts before trying again.'
    ? { action: 'accounts', detail: 'Check Accounts before starting again.' }
    : { action: 'restart', detail: 'No account was added.' }

export default function CreateGenerated({ kind }) {
  const isPhrase = kind === 'phrase'
  const createdNoun = isPhrase ? 'wallet' : 'account'
  const [step, setStep] = useState(0)
  const [password, setPassword] = useState('')
  const [presentation, setPresentation] = useState(null)
  const [verification, setVerification] = useState(null)
  const [error, setError] = useState('')
  const [errorAction, setErrorAction] = useState('restart')
  const [errorDetail, setErrorDetail] = useState('No account was added.')
  const [submitting, setSubmitting] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState(null)
  const pendingNavigationRef = useRef(null)
  const sessionId = useRef(null)
  const abandonCancelRef = useRef(null)
  const mounted = useRef(true)
  const beginning = useRef(false)
  const beginRequest = useRef(0)
  const completionRequest = useRef(0)
  const generationTimer = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      completionRequest.current += 1
      clearTimeout(generationTimer.current)
      if (sessionId.current) link.rpc('discardGeneratedWallet', sessionId.current, () => {})
      sessionId.current = null
    }
  }, [])

  useLayoutEffect(
    () =>
      setDashNavigationGuard(({ type, navigate }) => {
        if (type === 'back' && step === 1) {
          beginRequest.current += 1
          beginning.current = false
          clearTimeout(generationTimer.current)
          generationTimer.current = null
          const id = sessionId.current
          sessionId.current = null
          if (id) link.rpc('discardGeneratedWallet', id, () => {})
          setPassword('')
          setStep(0)
          return true
        }
        if (sessionId.current && (step === 2 || step === 3)) {
          pendingNavigationRef.current = navigate
          setPendingNavigation(() => navigate)
          return true
        }
        return false
      }),
    [step]
  )

  const discard = () => {
    const id = sessionId.current
    sessionId.current = null
    if (id) link.rpc('discardGeneratedWallet', id, () => {})
    setPresentation(null)
    setVerification(null)
    pendingNavigationRef.current = null
    setPendingNavigation(null)
  }

  const failTerminally = (message, options = {}) => {
    discard()
    setSubmitting(false)
    setError(message)
    setErrorAction(options.action || 'restart')
    setErrorDetail(options.detail || `The unfinished ${createdNoun} was deleted.`)
    setStep(4)
  }

  const expiresAt = presentation?.expiresAt || verification?.expiresAt
  useEffect(() => {
    if (submitting || !sessionId.current || !Number.isFinite(expiresAt)) return

    const remaining = Math.max(0, expiresAt - Date.now())
    const timer = setTimeout(() => {
      if (!mounted.current || !sessionId.current) return
      const id = sessionId.current
      sessionId.current = null
      link.rpc('discardGeneratedWallet', id, () => {})
      setPresentation(null)
      setVerification(null)
      pendingNavigationRef.current = null
      setPendingNavigation(null)
      setSubmitting(false)
      setError(`This ${createdNoun} setup expired.`)
      setErrorAction('restart')
      setErrorDetail(`The unfinished ${createdNoun} was deleted.`)
      setStep(4)
    }, remaining)
    return () => clearTimeout(timer)
  }, [createdNoun, expiresAt, submitting])

  useEffect(() => {
    if (!submitting) return
    const request = completionRequest.current
    const timer = setTimeout(() => {
      if (!mounted.current || !sessionId.current || request !== completionRequest.current) return
      completionRequest.current += 1
      const id = sessionId.current
      sessionId.current = null
      link.rpc('discardGeneratedWallet', id, () => {})
      setPresentation(null)
      setVerification(null)
      pendingNavigationRef.current = null
      setPendingNavigation(null)
      setSubmitting(false)
      setError(`${isPhrase ? 'Wallet' : 'Account'} setup is taking longer than expected.`)
      setErrorAction('accounts')
      setErrorDetail('Check Accounts before starting again.')
      setStep(4)
    }, COMPLETION_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isPhrase, submitting])

  const begin = () => {
    if (beginning.current) return
    beginning.current = true
    const request = ++beginRequest.current
    const creationPassword = password
    setPassword('')
    clearTimeout(generationTimer.current)
    generationTimer.current = setTimeout(() => {
      if (!mounted.current || request !== beginRequest.current) return
      beginRequest.current += 1
      beginning.current = false
      const id = sessionId.current
      sessionId.current = null
      if (id) link.rpc('discardGeneratedWallet', id, () => {})
      setError(`Wren could not create this ${createdNoun} safely.`)
      setErrorAction('restart')
      setErrorDetail('No account was added.')
      setStep(4)
    }, GENERATION_TIMEOUT_MS)
    link.rpc('reserveGeneratedWallet', (reservationError, reservation) => {
      const reservedId = reservation?.sessionId
      if (request !== beginRequest.current || !mounted.current) {
        if (reservedId) link.rpc('discardGeneratedWallet', reservedId, () => {})
        return
      }
      if (reservationError || !reservedId) {
        clearTimeout(generationTimer.current)
        generationTimer.current = null
        beginning.current = false
        setError(`Wren could not create this ${createdNoun} safely.`)
        setErrorAction('restart')
        setErrorDetail('No account was added.')
        setStep(4)
        return
      }

      sessionId.current = reservedId
      link.rpc('beginGeneratedWallet', reservedId, kind, creationPassword, (creationError, result) => {
        if (request !== beginRequest.current || !mounted.current) {
          if (sessionId.current === reservedId) sessionId.current = null
          link.rpc('discardGeneratedWallet', reservedId, () => {})
          return
        }
        clearTimeout(generationTimer.current)
        generationTimer.current = null
        beginning.current = false
        if (creationError || result?.sessionId !== reservedId) {
          sessionId.current = null
          link.rpc('discardGeneratedWallet', reservedId, () => {})
          setError(`Wren could not create this ${createdNoun} safely.`)
          setErrorAction('restart')
          setErrorDetail('No account was added.')
          setStep(4)
          return
        }
        if (Number.isFinite(result.expiresAt) && result.expiresAt <= Date.now()) {
          failTerminally(`This ${createdNoun} setup expired.`)
          return
        }
        setPresentation(result)
        setVerification({
          challenge: result.challenge,
          expiresAt: result.expiresAt,
          kind: result.kind
        })
        setStep(2)
      })
    })
  }

  const complete = (proof) => {
    if (!sessionId.current || submitting) return
    const request = ++completionRequest.current
    setSubmitting(true)
    setError('')
    link.rpc('completeGeneratedWallet', sessionId.current, proof, (completionError) => {
      if (!mounted.current || request !== completionRequest.current) return
      setSubmitting(false)
      if (completionError) {
        if (messageFor(completionError) === 'Backup confirmation does not match') {
          setError(
            isPhrase
              ? 'Those words do not match. Check your saved copy.'
              : 'This key does not match. Check your saved copy.'
          )
        } else {
          failTerminally(
            terminalMessageFor(completionError, createdNoun),
            terminalRecoveryFor(completionError)
          )
        }
        return
      }
      sessionId.current = null
      setPresentation(null)
      setVerification(null)
      const pending = pendingNavigationRef.current
      pendingNavigationRef.current = null
      setPendingNavigation(null)
      if (pending) {
        pending()
      } else {
        link.send('nav:back', 'dash', 2)
        link.send('nav:forward', 'dash', { view: 'accounts', data: {} })
      }
    })
  }

  const continueToVerification = () => {
    setPresentation(null)
    setError('')
    setStep(3)
  }

  const retry = () => {
    if (errorAction === 'accounts') {
      link.send('nav:back', 'dash', 2)
      link.send('nav:forward', 'dash', { view: 'accounts', data: {} })
      return
    }
    setError('')
    setErrorAction('restart')
    setErrorDetail('No account was added.')
    setPassword('')
    setPresentation(null)
    setVerification(null)
    setSubmitting(false)
    setStep(0)
  }

  const confirmAbandon = () => {
    const navigate = pendingNavigationRef.current
    pendingNavigationRef.current = null
    setPendingNavigation(null)
    discard()
    navigate?.()
  }

  const title = isPhrase ? 'Create recovery phrase' : 'Create private key'
  const summary = isPhrase
    ? 'Create a new 12-word wallet on this device.'
    : 'Create one standalone account on this device.'
  const frames = [
    <CreatePassword
      key='password'
      onCreate={(value) => {
        setPassword(value)
        setStep(1)
      }}
      autofocus={step === 0}
    />,
    <ConfirmPassword key='confirm' password={password} onConfirm={begin} autofocus={step === 1} lastStep />,
    presentation ? (
      isPhrase ? (
        <PhrasePresentation key='present' presentation={presentation} onContinue={continueToVerification} />
      ) : (
        <PrivateKeyPresentation
          key='present'
          presentation={presentation}
          onContinue={continueToVerification}
        />
      )
    ) : (
      <BlankFrame key='present' />
    ),
    verification ? (
      isPhrase ? (
        <PhraseVerification
          key='verify'
          challenge={verification.challenge}
          expiresAt={verification.expiresAt}
          onComplete={complete}
          onEdit={() => error && setError('')}
          submitting={submitting}
          error={error}
        />
      ) : (
        <PrivateKeyVerification
          key='verify'
          expiresAt={verification.expiresAt}
          onComplete={complete}
          onEdit={() => error && setError('')}
          submitting={submitting}
          error={error}
        />
      )
    ) : (
      <BlankFrame key='verify' />
    ),
    <ErrorFrame
      key='error'
      actionLabel={errorAction === 'accounts' ? 'Check accounts' : 'Start again'}
      detail={errorDetail}
      error={error}
      onAction={retry}
    />
  ]

  return (
    <>
      <AddHotAccountWrapper
        title={title}
        summary={summary}
        svgName={isPhrase ? 'seedling' : 'key'}
        index={step}
        setupClass='generatedWalletSetup'
      >
        {frames.map((frame, index) => cloneElement(frame, { active: index === step }))}
      </AddHotAccountWrapper>
      {pendingNavigation
        ? createPortal(
            <DialogSurface
              className='generatedWalletAbandonDialog'
              role='alertdialog'
              modal
              labelledBy='generated-wallet-abandon-title'
              describedBy='generated-wallet-abandon-description'
              initialFocusRef={abandonCancelRef}
              onCancel={() => {
                pendingNavigationRef.current = null
                setPendingNavigation(null)
              }}
            >
              <div className='generatedWalletAbandonPanel'>
                <div id='generated-wallet-abandon-title' className='generatedWalletAbandonTitle'>
                  {submitting
                    ? `${isPhrase ? 'Wallet' : 'Account'} setup is finishing`
                    : `Delete this new ${createdNoun}?`}
                </div>
                <p id='generated-wallet-abandon-description' className='generatedWalletAbandonDescription'>
                  {submitting
                    ? 'Wait for Wren to finish before leaving.'
                    : `Your backup has not been verified. Leaving now permanently deletes this ${createdNoun}.`}
                </p>
                <div className='generatedWalletAbandonActions'>
                  <button
                    ref={abandonCancelRef}
                    type='button'
                    className='wrenControl wrenControlSecondary'
                    onClick={() => {
                      pendingNavigationRef.current = null
                      setPendingNavigation(null)
                    }}
                  >
                    Keep creating
                  </button>
                  {!submitting ? (
                    <button type='button' className='wrenControl wrenControlDanger' onClick={confirmAbandon}>
                      Delete and leave
                    </button>
                  ) : null}
                </div>
              </div>
            </DialogSurface>,
            document.body
          )
        : null}
    </>
  )
}
