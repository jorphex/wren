import React from 'react'
import Restore from 'react-restore'

import link from '../../resources/link'
import Native from '../../resources/Native'

export const FailedToLoad = ({ dappId }) => {
  const retry = () => {
    if (!dappId) return
    link.send('tray:action', 'retryDapp', dappId)
    link.send('frame:close')
  }

  return (
    <div className='mainDappState' role='alert'>
      <div className='mainDappLoadingText'>
        <strong>Couldn’t load app</strong>
        <span>Wren couldn’t load this app.</span>
      </div>
      <div className='mainDappStateActions'>
        <button
          type='button'
          className='mainDappStateAction wrenControl wrenControlPrimary'
          disabled={!dappId}
          onClick={retry}
        >
          Try again
        </button>
        <button
          type='button'
          className='mainDappStateAction wrenControl wrenControlSecondary'
          onClick={() => link.send('frame:close')}
        >
          Close
        </button>
      </div>
    </div>
  )
}

export const LoadingDapp = () => {
  return (
    <div className='mainDappState' role='status'>
      <div className='mainDappLoadingText'>
        <strong>Loading app</strong>
        <span>Wren is loading this app.</span>
      </div>
      <div className='loader' aria-hidden='true' />
      <button
        type='button'
        className='mainDappStateAction wrenControl wrenControlSecondary'
        onClick={() => link.send('frame:close')}
      >
        Cancel
      </button>
    </div>
  )
}

class App extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = { ready: false }
  }

  render() {
    const frame = this.store('main.frames', window.frameId) || {}
    const view = frame.views?.[frame.currentView]
    const dapp = view?.dappId ? this.store('main.dapps', view.dappId) || {} : {}
    const failed = dapp.status === 'failed'

    return (
      <div className='splash'>
        <Native />
        <div className='main'>
          <div className='mainTop' />
          <div className='mainDappLoading'>
            {failed ? <FailedToLoad dappId={view?.dappId} /> : !view?.ready ? <LoadingDapp /> : null}
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(App)
