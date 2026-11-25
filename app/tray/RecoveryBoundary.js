import React, { useEffect, useRef } from 'react'
import link from '../../resources/link'

const reloadWallet = () => link.send('tray:reload')

export function RecoveryView({ onRetry, onReload = reloadWallet, pending = false, view = 'Wallet' }) {
  const retry = useRef(null)
  useEffect(() => {
    if (!pending) retry.current?.focus()
  }, [pending])
  return (
    <div className='walletRecovery' role='alert'>
      <strong>{pending ? `Loading ${view.toLowerCase()}` : `${view} view unavailable`}</strong>
      <div className='walletRecoveryActions'>
        <button ref={retry} type='button' onClick={onRetry} disabled={pending}>
          Try again
        </button>
        <button type='button' onClick={onReload}>
          {`Reload ${view.toLowerCase()}`}
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
    console.error(`${this.props.view || 'Wallet'} view failed to render`)
  }

  render() {
    return this.state.failed ? (
      <RecoveryView
        onRetry={() => this.setState({ failed: false })}
        onReload={this.props.onReload}
        view={this.props.view}
      />
    ) : (
      this.props.children
    )
  }
}
