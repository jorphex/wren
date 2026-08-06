import { useEffect, useRef, useState } from 'react'
import link from '../../../../resources/link'

const reloadInProgress = (status = '') =>
  ['loading', 'connecting', 'addresses', 'pairing'].includes(status.toLowerCase())

const ReloadSignerButton = ({ id, status }) => {
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (reloadInProgress(status)) return
    pendingRef.current = false
    setPending(false)
  }, [status])

  const reload = () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    link.send('dash:reloadSigner', id)
  }

  return (
    <button type='button' className='signerControlOption' disabled={pending} onClick={reload}>
      {pending ? 'Reloading Signer...' : 'Reload Signer'}
    </button>
  )
}

export default ReloadSignerButton
