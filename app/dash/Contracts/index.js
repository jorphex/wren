import React from 'react'

import Deployment from '../Deployment'
import ContractVerification from '../ContractVerification'

const DEPLOY_MODE = 'deploy'
const VERIFY_MODE = 'verify'

const initialMode = (props) =>
  props.initialMode === VERIFY_MODE || props.data?.mode === VERIFY_MODE ? VERIFY_MODE : DEPLOY_MODE

const verificationContextKey = (props) => {
  const data = props.data || {}
  return (
    [data.operationId, data.verificationId, data.chainId, data.address].filter(Boolean).join(':') || 'manual'
  )
}

export class Contracts extends React.Component {
  constructor(props) {
    super(props)
    const mode = initialMode(props)
    this.state = {
      mode,
      deployVisited: mode === DEPLOY_MODE,
      verifyVisited: mode === VERIFY_MODE
    }
  }

  componentDidUpdate(previousProps) {
    const previousRoute = `${initialMode(previousProps)}:${verificationContextKey(previousProps)}`
    const nextMode = initialMode(this.props)
    const nextRoute = `${nextMode}:${verificationContextKey(this.props)}`
    if (previousRoute === nextRoute || this.state.mode === nextMode) return

    this.setState({
      mode: nextMode,
      ...(nextMode === DEPLOY_MODE ? { deployVisited: true } : { verifyVisited: true })
    })
  }

  setMode(mode) {
    if (mode === this.state.mode) return
    this.setState({
      mode,
      ...(mode === DEPLOY_MODE ? { deployVisited: true } : { verifyVisited: true })
    })
  }

  render() {
    const verify = this.state.mode === VERIFY_MODE
    const description = verify
      ? 'Match source to deployed bytecode and publish a public record.'
      : 'Check prepared creation data, then queue it for native review.'

    return (
      <main className='contracts cardShow'>
        <header className='contractsHeader'>
          <span>CONTRACT TOOLS</span>
          <h1>Contracts</h1>
          <p>{description}</p>
        </header>

        <div aria-label='Contract tool' className='sendModeSwitch contractsModeSwitch' role='group'>
          <button aria-pressed={!verify} onClick={() => this.setMode(DEPLOY_MODE)} type='button'>
            Deploy contract
          </button>
          <button aria-pressed={verify} onClick={() => this.setMode(VERIFY_MODE)} type='button'>
            Verify source
          </button>
        </div>

        {this.state.deployVisited ? (
          <section aria-label='Deploy contract' className='contractsPanel' hidden={verify}>
            <Deployment
              embedded
              accounts={this.props.accounts}
              signers={this.props.signers}
              currentAccount={this.props.currentAccount}
              networks={this.props.networks}
              networksMeta={this.props.networksMeta}
            />
          </section>
        ) : null}
        {this.state.verifyVisited ? (
          <section aria-label='Verify source' className='contractsPanel' hidden={!verify}>
            <ContractVerification
              key={verificationContextKey(this.props)}
              embedded
              data={this.props.data}
              networks={this.props.networks}
            />
          </section>
        ) : null}
      </main>
    )
  }
}

export default Contracts
