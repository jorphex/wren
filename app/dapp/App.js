import React from 'react'
import Restore from 'react-restore'

import link from '../../resources/link'
import Native from '../../resources/Native'

export const FailedToLoad = () => {
  return (
    <div className='mainDappState' role='alert'>
      <div className='mainDappLoadingText'>
        <strong>Could not load dapp</strong>
        <span>Wren could not load this embedded app.</span>
      </div>
      <button
        type='button'
        className='mainDappStateAction wrenControl wrenControlSecondary'
        onClick={() => link.send('frame:close')}
      >
        Close
      </button>
    </div>
  )
}

export const LoadingDapp = () => {
  return (
    <div className='mainDappState' role='status'>
      <div className='mainDappLoadingText'>
        <strong>Loading dapp</strong>
        <span>Wren is loading the embedded app.</span>
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
            {failed ? <FailedToLoad /> : !view?.ready ? <LoadingDapp /> : null}
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(App)
