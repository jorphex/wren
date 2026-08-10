import { cloneElement, useEffect, useRef, useState } from 'react'
import { AddHotAccount } from '../Components'
import link from '../../../../../resources/link'
import { PasswordInput } from '../../../../../resources/Components/Password'

const navForward = (accountSetupStep) =>
  link.send('nav:forward', 'dash', {
    view: 'accounts',
    data: {
      showAddAccounts: true,
      newAccountType: 'keystore',
      accountSetupStep
    }
  })

const LocateKeystore = ({ addKeystore, error, setError, active, selectionPending }) => {
  useEffect(() => {
    if (!error) return
    const timeout = setTimeout(() => {
      setError('')
    }, 1_500)

    return () => clearTimeout(timeout)
  }, [error, setError])
  return (
    <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
      {error ? (
        <div role='alert' className='addAccountItemOptionError'>
          {error}
        </div>
      ) : (
        <button
          type='button'
          className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
          disabled={selectionPending}
          style={{ marginTop: '10px' }}
          onClick={() => addKeystore()}
        >
          Choose keystore JSON file
        </button>
      )}
    </div>
  )
}

const Locating = ({ active }) => (
  <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
    <div role={'status'} className='addAccountItemOptionTitle' style={{ marginTop: '15px' }}>
      Opening file picker...
    </div>
  </div>
)

const EnterKeystorePassword = ({ keystore, active, onContinue }) => {
  const next = (keystorePassword) => {
    onContinue(keystore, [keystorePassword])
  }
  //TODO: validate keystore password here?
  const getError = () => {}
  const title = 'Enter keystore password'
  const buttonText = 'Continue'
  return <PasswordInput {...{ next, getError, title, buttonText, active }} />
}

const LoadKeystore = ({ accountSetupStep, active, onContinue, secret }) => {
  const [error, setError] = useState('')
  const [selectionPending, setSelectionPending] = useState(false)
  const selectionTimer = useRef()
  const selectionPendingRef = useRef(false)
  const selectionRequest = useRef(0)
  const observedSelecting = useRef(accountSetupStep === 'locating')
  const mounted = useRef(true)
  const [selectedKeystore, setSelectedKeystore] = useState('')
  const selectedKeystoreRef = useRef(selectedKeystore)
  const previousStep = useRef(accountSetupStep)

  const clearKeystore = () => {
    selectedKeystoreRef.current = ''
    setSelectedKeystore('')
  }

  useEffect(
    () => () => {
      mounted.current = false
      selectionRequest.current += 1
      clearTimeout(selectionTimer.current)
      selectedKeystoreRef.current = ''
    },
    []
  )

  useEffect(() => {
    if (accountSetupStep === 'locating') {
      observedSelecting.current = true
      return
    }
    if (!observedSelecting.current) return
    observedSelecting.current = false
    if (!selectionPendingRef.current) return
    selectionRequest.current += 1
    clearTimeout(selectionTimer.current)
    selectionTimer.current = undefined
    selectionPendingRef.current = false
    setSelectionPending(false)
  }, [accountSetupStep])

  useEffect(() => {
    if (!accountSetupStep && previousStep.current) clearKeystore()
    previousStep.current = accountSetupStep
  }, [accountSetupStep])

  const addKeystore = () => {
    if (selectionPendingRef.current) return
    selectionPendingRef.current = true
    const request = ++selectionRequest.current
    setSelectionPending(true)
    navForward('locating')
    selectionTimer.current = setTimeout(() => {
      selectionTimer.current = undefined
      link.rpc('locateKeystore', (err, locatedKeystore) => {
        if (!mounted.current || request !== selectionRequest.current) return
        selectionPendingRef.current = false
        setSelectionPending(false)
        link.send('nav:back', 'dash')
        if (err) {
          setError(err)
        } else {
          selectedKeystoreRef.current = locatedKeystore
          setSelectedKeystore(locatedKeystore)
          navForward('keystorePassword')
        }
      })
    }, 640)
  }

  const keystore = secret || selectedKeystore
  const viewIndex =
    accountSetupStep === 'keystorePassword' && keystore ? 2 : accountSetupStep === 'locating' ? 1 : 0
  const continueWithKeystore = (keystore, creationArgs) => {
    onContinue(keystore, creationArgs)
    clearKeystore()
  }

  const steps = [
    <LocateKeystore key={0} {...{ addKeystore, error, setError, selectionPending }} />,
    <Locating key={1} />,
    <EnterKeystorePassword key={2} {...{ keystore, onContinue: continueWithKeystore }} />
  ]
  return cloneElement(steps[viewIndex], { active })
}

const AddKeystore = ({ accountSetupStep, error }) => (
  <AddHotAccount
    title='Keystore file'
    summary='Import an account from a keystore JSON file.'
    svgName='file'
    intro='Add keystore account'
    createSignerMethod='createFromKeystore'
    newAccountType='keystore'
    backSteps={6}
    accountSetupStep={accountSetupStep}
    error={error}
    firstStepSteps={['locating', 'keystorePassword']}
    firstStep={<LoadKeystore key={0} accountSetupStep={accountSetupStep} />}
    validateSecret={() => {}}
  />
)

export default AddKeystore
