import { cloneElement, useEffect, useRef, useState } from 'react'
import { AddHotAccount } from '../Components'
import link from '../../../../../resources/link'
import { PasswordInput } from '../../../../../resources/Components/Password'

const navForward = (accountData) =>
  link.send('nav:forward', 'dash', {
    view: 'accounts',
    data: {
      showAddAccounts: true,
      newAccountType: 'keystore',
      accountData
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
          className='addAccountItemOptionSubmit'
          disabled={selectionPending}
          style={{ marginTop: '10px' }}
          onClick={() => addKeystore()}
        >
          Locate Keystore File (json)
        </button>
      )}
    </div>
  )
}

const Locating = ({ active }) => (
  <div className='addAccountItemOptionSetupFrame' aria-hidden={!active} inert={!active}>
    <div role={'status'} className='addAccountItemOptionTitle' style={{ marginTop: '15px' }}>
      Locating Keystore file...
    </div>
  </div>
)

const EnterKeystorePassword = ({ keystore, active }) => {
  const next = (keystorePassword) => {
    navForward({
      secret: keystore,
      creationArgs: [keystorePassword]
    })
  }
  //TODO: validate keystore password here?
  const getError = () => {}
  const title = 'Enter Keystore Password'
  const buttonText = 'Continue'
  return <PasswordInput {...{ next, getError, title, buttonText, active }} />
}

const LoadKeystore = ({ accountData, active }) => {
  const { keystore, selecting, secret } = accountData

  const [error, setError] = useState('')
  const [selectionPending, setSelectionPending] = useState(false)
  const selectionTimer = useRef()
  const selectionPendingRef = useRef(false)
  const selectionRequest = useRef(0)
  const observedSelecting = useRef(Boolean(selecting))
  const mounted = useRef(true)

  useEffect(
    () => () => {
      mounted.current = false
      selectionRequest.current += 1
      clearTimeout(selectionTimer.current)
    },
    []
  )

  useEffect(() => {
    if (selecting) {
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
  }, [selecting])

  const addKeystore = () => {
    if (selectionPendingRef.current) return
    selectionPendingRef.current = true
    const request = ++selectionRequest.current
    setSelectionPending(true)
    navForward({ selecting: true })
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
          navForward({ keystore: locatedKeystore })
        }
      })
    }, 640)
  }

  const viewIndex = secret || keystore ? 2 : selecting ? 1 : 0

  const steps = [
    <LocateKeystore key={0} {...{ addKeystore, error, setError, selectionPending }} />,
    <Locating key={1} />,
    <EnterKeystorePassword key={2} keystore={accountData.keystore} />
  ]
  return cloneElement(steps[viewIndex], { active })
}

const AddKeystore = ({ accountData }) => (
  <AddHotAccount
    title='Key Store'
    summary='A keystore account lets you add accounts from your keystore.json file'
    svgName='file'
    intro='Add KeyStore Account'
    createSignerMethod='createFromKeystore'
    newAccountType='keystore'
    backSteps={6}
    accountData={accountData}
    firstStep={<LoadKeystore key={0} accountData={accountData} />}
    validateSecret={() => {}}
  />
)

export default AddKeystore
