import React from 'react'
import { createPortal } from 'react-dom'

import DialogSurface from '../../../../../resources/Components/DialogSurface'
import link from '../../../../../resources/link'

export class RevokeAccess extends React.Component {
  constructor(...args) {
    super(...args)
    this.cancelRef = React.createRef()
    this.triggerRef = React.createRef()
    this.state = { confirming: false, pending: false }
  }

  componentWillUnmount() {
    clearTimeout(this.pendingTimer)
  }

  open() {
    if (!this.state.pending) this.setState({ confirming: true })
  }

  cancel() {
    if (!this.state.pending) this.setState({ confirming: false })
  }

  revoke() {
    if (this.state.pending) return

    clearTimeout(this.pendingTimer)
    this.pendingTimer = setTimeout(() => this.setState({ pending: false }), 600)
    this.setState({ pending: true })
    this.props.onRevokeRequested?.(this.props.permissionId, this.props.origin)
    link.send('tray:action', 'toggleAccess', this.props.account, this.props.permissionId, false)
  }

  renderDialog() {
    if (!this.state.confirming) return null

    return createPortal(
      <DialogSurface
        className='revokeAccessDialog'
        role='alertdialog'
        modal
        ariaLabel={`Revoke access for ${this.props.origin}?`}
        busy={this.state.pending}
        initialFocusRef={this.cancelRef}
        returnFocusRef={this.triggerRef}
        onCancel={() => this.cancel()}
      >
        <div className='revokeAccessPanel'>
          <strong>Revoke access for {this.props.origin}?</strong>
          <p>
            This app will lose access to this account. Its guardrails will be removed, and it must request
            access again.
          </p>
          <div className='revokeAccessActions'>
            <button
              ref={this.cancelRef}
              type='button'
              className='wrenControl wrenControlSecondary'
              disabled={this.state.pending}
              onClick={() => this.cancel()}
            >
              Cancel
            </button>
            <button
              type='button'
              className='wrenControl wrenControlDanger'
              disabled={this.state.pending}
              onClick={() => this.revoke()}
            >
              {this.state.pending ? 'Revoking…' : 'Confirm revoke'}
            </button>
          </div>
        </div>
      </DialogSurface>,
      document.body
    )
  }

  render() {
    return (
      <>
        <button
          ref={this.triggerRef}
          type='button'
          className='revokeAccessButton wrenControl wrenControlDanger'
          disabled={this.state.pending}
          onClick={() => this.open()}
        >
          Revoke access
        </button>
        {this.renderDialog()}
      </>
    )
  }
}

export default RevokeAccess
