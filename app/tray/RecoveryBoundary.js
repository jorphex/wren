import React from 'react'
import link from '../../resources/link'

export function RecoveryView({ onRetry, pending = false }) {
  return (
    <div className='walletRecovery' role='alert'>
      <strong>{pending ? 'Loading wallet' : 'Wallet view unavailable'}</strong>
      <div className='walletRecoveryActions'>
        <button type='button' onClick={onRetry} disabled={pending}>
          Try again
        </button>
        <button type='button' onClick={() => link.send('tray:reload')}>
          Reload wallet
        </button>
      </div>
    </div>
  )
}

export default class RecoveryBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // Renderer errors can include account data; report only the failure category.
    console.error('Wallet view failed to render')
  }

  render() {
    return this.state.failed ? (
      <RecoveryView onRetry={() => this.setState({ failed: false })} />
    ) : (
      this.props.children
    )
  }
}
