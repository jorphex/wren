import { useEffect, useRef, useState } from 'react'
import link from '../../../../resources/link'
import { getSignerStatusMeta } from '../../../../resources/domain/signer'

const ReloadSignerButton = ({ id, status, type }) => {
  const [reloadState, setReloadState] = useState({ id, busy: false, pending: false })
  const pendingReload = useRef()
  const statusMeta = getSignerStatusMeta({ type, status })

  useEffect(
    () => () => {
      if (pendingReload.current?.id !== id) return
      pendingReload.current.cancel?.()
      pendingReload.current = undefined
    },
    [id]
  )

  if (reloadState.id !== id || reloadState.busy !== statusMeta.busy) {
    const pending =
      reloadState.id === id && (type === 'trezor' || statusMeta.busy) ? reloadState.pending : false
    setReloadState({ id, busy: statusMeta.busy, pending })
  }

  const reload = () => {
    if (reloadState.pending || pendingReload.current?.id === id) return
    setReloadState({ id, busy: statusMeta.busy, pending: true })
    if (type === 'trezor') {
      pendingReload.current?.cancel?.()
      const attempt = { id }
      pendingReload.current = attempt
      attempt.cancel = link.rpc('reloadSigner', id, () => {
        if (pendingReload.current !== attempt) return
        pendingReload.current = undefined
        setReloadState((current) => (current.id === id ? { ...current, pending: false } : current))
      })
      return
    }
    link.send('dash:reloadSigner', id)
  }

  const pending = reloadState.pending

  return (
    <button
      type='button'
      className='signerControlOption wrenControl wrenControlSecondary'
      disabled={pending}
      onClick={reload}
    >
      {type === 'trezor'
        ? pending
          ? 'Connecting…'
          : 'Connect with Suite'
        : pending
          ? 'Reloading signer…'
          : 'Reload signer'}
    </button>
  )
}

export default ReloadSignerButton
