import { cloneElement, useEffect, useRef, useState } from 'react'

import Icon from '../../../../../resources/Components/Icon'
import { ConfirmPassword, CreatePassword } from '../../../../../resources/Components/Password'
import useCopiedMessage from '../../../../../resources/Hooks/useCopiedMessage'
import link from '../../../../../resources/link'
import { AddHotAccountWrapper } from '../Components'

const normalizePrivateKey = (value) => value.trim().replace(/^0x/iu, '').toLowerCase()

const CopyControl = ({ copied, label, onCopy }) => (
  <span className='generatedWalletCopyGroup'>
    <button
      type='button'
      className='generatedWalletQuietControl wrenControl wrenControlSecondary'
      aria-label={label}
      onClick={onCopy}
    >
      <Icon name='copy' size={16} />
      <span>{copied ? 'Copied' : label.replace(/^Copy /u, 'Copy ')}</span>
    </button>
    <span className='generatedWalletCopyStatus' role='status' aria-live='polite'>
      {copied ? `${label.replace(/^Copy /u, '')} copied` : ''}
    </span>
  </span>
)

const PhrasePresentation = ({ active, onContinue, presentation }) => {
  const [copied, copyPhrase] = useCopiedMessage(presentation.secret, 1800)

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody'>
        <div role='heading' aria-level='2' className='addAccountItemOptionTitle'>
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
  const [addressCopied, copyAddress] = useCopiedMessage(presentation.address, 1800)
  const [keyCopied, copyPrivateKey] = useCopiedMessage(presentation.secret, 1800)

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
        <p className='generatedWalletGuidance'>Save this key somewhere safe. Wren will not show it again.</p>
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
            {revealed ? presentation.secret : `0x${'•'.repeat(32)}`}
          </code>
          <div className='generatedWalletEvidenceControls'>
            <button
              type='button'
              className='generatedWalletQuietControl wrenControl wrenControlSecondary'
              aria-pressed={revealed}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? 'Hide private key' : 'Show private key'}
            </button>
            <CopyControl copied={keyCopied} label='Copy private key' onCopy={copyPrivateKey} />
          </div>
        </div>
        <p className='generatedWalletConsequence'>Leaving now deletes this new account.</p>
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          onClick={onContinue}
        >
          {"I've saved my key"}
        </button>
      </div>
    </div>
  )
}

const PhraseVerification = ({ active, challenge, onComplete, submitting, error }) => {
  const [words, setWords] = useState(['', '', ''])
  const ready = words.every((word) => word.trim())

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
                autoFocus={index === 0}
                className={error ? 'wrenInput wrenInputError' : 'wrenInput'}
                disabled={submitting}
                spellCheck={false}
                value={words[index]}
                onChange={(event) => {
                  const next = [...words]
                  next[index] = event.target.value.replace(/\s+/gu, '').toLowerCase()
                  setWords(next)
                }}
              />
            </span>
          </label>
        ))}
        {error ? (
          <div role='alert' className='generatedWalletVerifyError'>
            {error}
          </div>
        ) : null}
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={!ready || submitting}
          onClick={() => onComplete({ words })}
        >
          {submitting ? 'Finishing…' : 'Finish backup'}
        </button>
      </div>
    </div>
  )
}

const PrivateKeyVerification = ({ active, onComplete, submitting, error }) => {
  const [privateKey, setPrivateKey] = useState('')

  return (
    <div
      className='addAccountItemOptionSetupFrame generatedWalletFrame'
      aria-hidden={!active}
      inert={!active}
    >
      <div className='generatedWalletFrameBody generatedWalletVerify'>
        <label htmlFor='generated-private-key-confirmation' className='addAccountItemOptionTitle'>
          Verify your backup
        </label>
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
            autoFocus
            className={error ? 'wrenInput wrenInputError' : 'wrenInput'}
            disabled={submitting}
            spellCheck={false}
            value={privateKey}
            onChange={(event) => setPrivateKey(event.target.value.replace(/\s+/gu, ''))}
          />
        </div>
        {error ? (
          <div role='alert' className='generatedWalletVerifyError'>
            {error}
          </div>
        ) : null}
      </div>
      <div className='generatedWalletActionShelf'>
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={normalizePrivateKey(privateKey).length !== 64 || submitting}
          onClick={() => onComplete({ privateKey })}
        >
          {submitting ? 'Finishing…' : 'Finish backup'}
        </button>
      </div>
    </div>
  )
}

const ErrorFrame = ({ active, error, onRetry }) => (
  <div className='addAccountItemOptionSetupFrame generatedWalletFrame' aria-hidden={!active} inert={!active}>
    <div className='generatedWalletFrameBody generatedWalletError'>
      <div role='alert' className='addAccountItemOptionTitle'>
        {error}
      </div>
      <p className='generatedWalletGuidance'>Nothing was saved.</p>
    </div>
    <div className='generatedWalletActionShelf'>
      <button
        type='button'
        className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  </div>
)

export default function CreateGenerated({ kind }) {
  const isPhrase = kind === 'phrase'
  const [step, setStep] = useState(0)
  const [password, setPassword] = useState('')
  const [presentation, setPresentation] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const sessionId = useRef(null)
  const mounted = useRef(true)
  const beginning = useRef(false)

  useEffect(
    () => () => {
      mounted.current = false
      if (sessionId.current) link.rpc('discardGeneratedWallet', sessionId.current, () => {})
      sessionId.current = null
    },
    []
  )

  const begin = () => {
    if (beginning.current) return
    beginning.current = true
    const creationPassword = password
    setPassword('')
    link.rpc('beginGeneratedWallet', kind, creationPassword, (creationError, result) => {
      beginning.current = false
      if (!mounted.current) {
        if (result?.sessionId) link.rpc('discardGeneratedWallet', result.sessionId, () => {})
        return
      }
      if (creationError) {
        setError('Wren could not create this account safely.')
        setStep(4)
        return
      }
      sessionId.current = result.sessionId
      setPresentation(result)
      setStep(2)
    })
  }

  const complete = (proof) => {
    if (!sessionId.current || submitting) return
    setSubmitting(true)
    setError('')
    link.rpc('completeGeneratedWallet', sessionId.current, proof, (completionError, signer) => {
      if (!mounted.current) return
      setSubmitting(false)
      if (completionError) {
        setError(
          isPhrase
            ? 'Those words do not match. Check your saved copy.'
            : 'This key does not match. Check your saved copy.'
        )
        return
      }
      sessionId.current = null
      setPresentation(null)
      link.send('nav:back', 'dash', 2)
      link.send('nav:forward', 'dash', { view: 'expandedSigner', data: { signer: signer.id } })
    })
  }

  const retry = () => {
    setError('')
    setPassword('')
    setPresentation(null)
    setSubmitting(false)
    setStep(0)
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
        <PhrasePresentation key='present' presentation={presentation} onContinue={() => setStep(3)} />
      ) : (
        <PrivateKeyPresentation key='present' presentation={presentation} onContinue={() => setStep(3)} />
      )
    ) : (
      <div key='present' />
    ),
    presentation ? (
      isPhrase ? (
        <PhraseVerification
          key='verify'
          challenge={presentation.challenge}
          onComplete={complete}
          submitting={submitting}
          error={error}
        />
      ) : (
        <PrivateKeyVerification key='verify' onComplete={complete} submitting={submitting} error={error} />
      )
    ) : (
      <div key='verify' />
    ),
    <ErrorFrame key='error' error={error} onRetry={retry} />
  ]

  return (
    <AddHotAccountWrapper
      title={title}
      summary={summary}
      svgName={isPhrase ? 'seedling' : 'key'}
      index={step}
    >
      {frames.map((frame, index) => cloneElement(frame, { active: index === step }))}
    </AddHotAccountWrapper>
  )
}
