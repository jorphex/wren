import { useState } from 'react'
import link from '../../../../resources/link'
import { getSignerStatusMeta } from '../../../../resources/domain/signer'

const ReloadSignerButton = ({ id, status, type }) => {
  const [reloadState, setReloadState] = useState({ busy: false, pending: false })
  const statusMeta = getSignerStatusMeta({ type, status })

  if (reloadState.busy !== statusMeta.busy) {
    const pending = statusMeta.busy ? reloadState.pending : false
    setReloadState({ busy: statusMeta.busy, pending })
  }

  const reload = () => {
    if (reloadState.pending) return
    setReloadState({ busy: statusMeta.busy, pending: true })
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
      {pending ? 'Reloading signer…' : 'Reload signer'}
    </button>
  )
}

export default ReloadSignerButton
