import React from 'react'
import { createPortal } from 'react-dom'

import DialogSurface from '../../../../../resources/Components/DialogSurface'
import link from '../../../../../resources/link'

let revokeDescriptionIndex = 0

export const REVOKE_CONFIRMATION_UNAVAILABLE =
  'Revocation confirmation is unavailable. Wren will keep checking for the access change.'
export const REVOKE_ACCESS_UNCERTAIN =
  'Access is blocked for this session, but Wren could not confirm the saved change. Restarting may restore access.'
export const REVOKE_ACCESS_SESSION_ONLY =
  'Access is blocked for this session, but Wren could not save the change. Restarting may restore access.'
export const isSessionOnlyPersistenceFailure = (result) =>
  result?.success === false &&
  result?.uncertain === true &&
  result?.sessionOnly === true &&
  result?.error === 'persistence-failed'

export const captureRevokeFocus = (root) => {
  const dialog = document.querySelector('.revokeAccessDialog[data-permission-id]')
  if (!dialog?.contains(document.activeElement)) return null
  const permissionId = dialog.dataset.permissionId
  const actions = Array.from(root?.querySelectorAll('.revokeAccessButton') || [])
  const index = actions.findIndex((action) => action.dataset.permissionId === permissionId)
  if (index < 0) return null
  return {
    permissionId,
    adjacentIds: [actions[index + 1], actions[index - 1]]
      .filter(Boolean)
      .map((action) => action.dataset.permissionId)
  }
}

export const restoreRevokeFocus = (root, captured, fallback) => {
  if (!captured) return
  const actions = Array.from(root?.querySelectorAll('.revokeAccessButton') || [])
  if (actions.some((action) => action.dataset.permissionId === captured.permissionId)) return
  const adjacent = captured.adjacentIds
    .map((id) => actions.find((action) => action.dataset.permissionId === id))
    .find(Boolean)
  ;(adjacent || fallback)?.focus()
}

export class RevokeAccess extends React.Component {
  constructor(...args) {
    super(...args)
    this.cancelRef = React.createRef()
    this.confirmRef = React.createRef()
    this.triggerRef = React.createRef()
    this.descriptionId = `revoke-access-description-${++revokeDescriptionIndex}`
    this.state = { confirming: false, pending: false, failure: false }
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.failureTimer)
  }

  componentDidMount() {
    this.mounted = true
  }

  open() {
    if (!this.state.pending) {
      clearTimeout(this.failureTimer)
      this.setState({ confirming: true, failure: false })
    }
  }

  cancel() {
    if (!this.state.pending) {
      clearTimeout(this.failureTimer)
      this.setState({ confirming: false, failure: false })
      this.props.onRevokeCanceled?.(this.props.permissionId)
    }
  }

  adjacentPermissionIds() {
    const actions = Array.from(
      this.triggerRef.current?.closest('.connectedAppsList')?.querySelectorAll('.revokeAccessButton') || []
    )
    const index = actions.indexOf(this.triggerRef.current)
    if (index === -1) return []
    return [actions[index + 1], actions[index - 1]]
      .filter(Boolean)
      .map((action) => action.dataset.permissionId)
  }

  showFailure(message = 'Access was not revoked. Try again.', reconcile = false) {
    clearTimeout(this.failureTimer)
    this.setState({ pending: false, failure: message }, () => {
      this.confirmRef.current?.focus()
    })
    if (!reconcile) this.props.onRevokeFailed?.(this.props.permissionId)
    this.failureTimer = setTimeout(() => this.setState({ failure: false }), 4000)
  }

  async revoke() {
    if (this.state.pending) return

    clearTimeout(this.failureTimer)
    this.setState({ pending: true, failure: false })
    try {
      this.props.onRevokeRequested?.(this.props.permissionId, this.props.origin, this.adjacentPermissionIds())
      const result = await link.invoke('tray:revokeAccess', this.props.account, this.props.permissionId)
      this.props.onRevokeSettled?.(this.props.permissionId, result)
      if (this.mounted && !result?.success) {
        this.showFailure(
          result?.sessionOnly
            ? REVOKE_ACCESS_SESSION_ONLY
            : result?.uncertain
              ? REVOKE_CONFIRMATION_UNAVAILABLE
              : undefined,
          result?.uncertain || result?.sessionOnly
        )
      }
    } catch {
      this.props.onRevokeSettled?.(this.props.permissionId, {
        success: false,
        uncertain: true,
        error: 'Revocation confirmation is unavailable'
      })
      if (this.mounted) this.showFailure(REVOKE_CONFIRMATION_UNAVAILABLE, true)
    }
  }

  renderDialog() {
    if (!this.state.confirming) return null
    const host = this.triggerRef.current?.closest('#panel') || document.body

    return createPortal(
      <DialogSurface
        className='revokeAccessDialog'
        role='alertdialog'
        modal
        ariaLabel={`Revoke access for ${this.props.origin}?`}
        describedBy={this.descriptionId}
        busy={this.state.pending}
        initialFocusRef={this.cancelRef}
        returnFocusRef={this.triggerRef}
        data-permission-id={this.props.permissionId}
        onCancel={() => this.cancel()}
      >
        <div className='revokeAccessPanel'>
          <strong>Revoke access for {this.props.origin}?</strong>
          <p id={this.descriptionId}>
            This app will lose access to this account. Its guardrails will be removed, and it must request
            access again.
          </p>
          {this.state.failure ? (
            <div className='revokeAccessFailure' role='alert'>
              {this.state.failure}
            </div>
          ) : null}
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
              ref={this.confirmRef}
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
      host
    )
  }

  render() {
    return (
      <>
        <button
          ref={this.triggerRef}
          type='button'
          data-permission-id={this.props.permissionId}
          className='revokeAccessButton wrenControl wrenControlGhost'
          aria-label='Revoke access'
          disabled={this.state.pending}
          onClick={() => this.open()}
        >
          Revoke
        </button>
        {this.renderDialog()}
      </>
    )
  }
}

export default RevokeAccess
