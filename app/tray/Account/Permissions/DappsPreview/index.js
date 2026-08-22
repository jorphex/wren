import React from 'react'
import Restore from 'react-restore'

import emptyConnections from 'url:../../../../../asset/ui/wren-empty-connections-v2.png'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import {
  MAX_TIMER_DELAY,
  nextActiveExternalPermissionExpiry
} from '../../../../../resources/domain/connectedApps'
import { getPermissionIds } from '../../../../../resources/domain/permissions'
import RevokeAccess, {
  REVOKE_ACCESS_SESSION_ONLY,
  REVOKE_ACCESS_UNCERTAIN,
  captureRevokeFocus,
  isSessionOnlyPersistenceFailure,
  restoreRevokeFocus
} from '../RevokeAccess'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'

export class DappsPermissionsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.moduleHeaderRef = React.createRef()
    this.revokeStatusRef = React.createRef()
    this.state = { navigating: false }
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.clientHeight
          })
        }
      })
    }
  }

  componentDidMount() {
    this.mounted = true
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
    this.schedulePermissionExpiry()
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.resizeObserver) this.resizeObserver.disconnect()
    clearTimeout(this.permissionExpiryTimer)
    clearTimeout(this.revokeStatusTimer)
    this.permissionExpiryDeadline = undefined
    this.orphanedRevokeId = undefined
  }

  componentDidUpdate() {
    this.schedulePermissionExpiry()
    const revoked = this.state.revokeRequested
    if (!revoked) return
    const permissions = this.store('main.permissions', this.props.account) || {}
    if (getPermissionIds(permissions).includes(revoked.id)) return
    if (revoked.sessionOnly) {
      return this.showRevokeStatus(revoked, REVOKE_ACCESS_SESSION_ONLY, 'alert')
    }
    if (revoked.uncertain) {
      return this.showRevokeStatus(revoked, REVOKE_ACCESS_UNCERTAIN, 'alert')
    }
    if (!revoked.acknowledged) {
      this.orphanedRevokeId = revoked.id
      return this.setState({ revokeRequested: null })
    }

    this.showRevokeStatus(
      revoked,
      `Access revoked for ${revoked.origin}. The app must request access again.`,
      'status'
    )
  }

  showRevokeStatus(revoked, message, role) {
    clearTimeout(this.revokeStatusTimer)
    this.setState(
      {
        revokeRequested: null,
        revokeStatus: message,
        revokeStatusRole: role
      },
      () => {
        const actions = Array.from(this.moduleRef.current?.querySelectorAll('.revokeAccessButton') || [])
        const nextAction = revoked.focusPermissionIds
          .map((id) => actions.find((action) => action.dataset.permissionId === id))
          .find(Boolean)
        ;(nextAction || this.revokeStatusRef.current || this.moduleHeaderRef.current)?.focus()
        this.revokeStatusTimer = setTimeout(() => this.dismissRevokeStatus(), 4000)
      }
    )
  }

  schedulePermissionExpiry() {
    const now = Date.now()
    const permissions = this.store('main.permissions', this.props.account) || {}
    const nextExpiry = nextActiveExternalPermissionExpiry({ [this.props.account]: permissions }, now)
    if (nextExpiry === this.permissionExpiryDeadline) return

    clearTimeout(this.permissionExpiryTimer)
    this.permissionExpiryDeadline = nextExpiry
    if (nextExpiry !== undefined) {
      this.permissionExpiryTimer = setTimeout(
        () => {
          const expiryFocus = captureRevokeFocus(this.moduleRef.current)
          this.permissionExpiryDeadline = undefined
          this.setState(
            (state) => ({ permissionExpiryTick: (state?.permissionExpiryTick || 0) + 1 }),
            () => restoreRevokeFocus(this.moduleRef.current, expiryFocus, this.moduleHeaderRef.current)
          )
        },
        Math.max(1, Math.min(nextExpiry - now, MAX_TIMER_DELAY))
      )
    }
  }

  requestRevoke(id, origin, focusPermissionIds = []) {
    clearTimeout(this.revokeStatusTimer)
    this.orphanedRevokeId = undefined
    this.setState({
      revokeRequested: { id, origin, focusPermissionIds, acknowledged: false },
      revokeStatus: false
    })
  }

  revokeSettled(id, result) {
    if (!this.mounted) return
    if (this.state.revokeRequested?.id !== id) {
      if (this.orphanedRevokeId !== id) return
      this.orphanedRevokeId = undefined
      if (isSessionOnlyPersistenceFailure(result)) this.showOrphanedSessionOnlyStatus()
      return
    }
    if (result?.success) {
      this.setState((state) => ({
        revokeRequested: { ...state.revokeRequested, acknowledged: true }
      }))
      return
    }

    if (result?.sessionOnly) {
      this.setState((state) => ({
        revokeRequested: { ...state.revokeRequested, sessionOnly: true }
      }))
      return
    }

    if (result?.uncertain) {
      this.setState((state) => ({
        revokeRequested: { ...state.revokeRequested, uncertain: true }
      }))
      return
    }

    const permissions = this.store('main.permissions', this.props.account) || {}
    if (getPermissionIds(permissions).includes(id)) return this.setState({ revokeRequested: null })
    clearTimeout(this.revokeStatusTimer)
    this.setState(
      {
        revokeRequested: null,
        revokeStatus: result?.error || 'Access was not revoked. Try again.',
        revokeStatusRole: 'alert'
      },
      () => {
        this.revokeStatusRef.current?.focus()
        this.revokeStatusTimer = setTimeout(() => this.dismissRevokeStatus(), 4000)
      }
    )
  }

  showOrphanedSessionOnlyStatus() {
    clearTimeout(this.revokeStatusTimer)
    this.setState(
      {
        revokeStatus: REVOKE_ACCESS_SESSION_ONLY,
        revokeStatusRole: 'alert'
      },
      () => {
        this.revokeStatusTimer = setTimeout(() => this.dismissRevokeStatus(), 4000)
      }
    )
  }

  revokeFailed(id) {
    if (this.state.revokeRequested?.id === id) this.setState({ revokeRequested: null })
  }

  cancelRevoke(id) {
    if (this.state.revokeRequested?.id === id) this.setState({ revokeRequested: null })
  }

  dismissRevokeStatus() {
    const restoreFocus = document.activeElement === this.revokeStatusRef.current
    this.setState({ revokeStatus: false }, () => {
      if (restoreFocus) this.moduleHeaderRef.current?.focus()
    })
  }

  openExpanded() {
    if (this.state.navigating) return

    const crumb = {
      view: 'expandedModule',
      data: {
        id: this.props.moduleId,
        account: this.props.account
      }
    }
    this.setState({ navigating: true })
    link.send('nav:forward', 'panel', crumb)
  }

  render() {
    const permissions = this.store('main.permissions', this.props.account) || {}
    const allPermissionIds = getPermissionIds(permissions)
    const permissionIds = getPermissionIds(permissions, this.props.filter)
    const permissionList = this.props.expanded ? permissionIds : permissionIds.slice(0, 4)

    return (
      <div className='balancesBlock' ref={this.moduleRef}>
        <div className='moduleHeader permissionsModuleHeader' ref={this.moduleHeaderRef} tabIndex={-1}>
          <span>
            <Icon name='apps' size={14} />
          </span>
          <span>Apps with access</span>
        </div>
        {permissionList.length === 0 ? (
          allPermissionIds.length ? (
            <div className='wrenEmptyFilter'>No matching app permissions</div>
          ) : (
            <WrenEmptyState
              image={emptyConnections}
              transparentImage={true}
              title='No app access'
              copy='Apps allowed to use this account appear here.'
            />
          )
        ) : (
          <Cluster className='connectedAppsList'>
            {permissionList.map((o) => {
              return (
                <ClusterRow key={o}>
                  <ClusterValue pointerEvents={true}>
                    <div className='signerPermission'>
                      <div className='signerPermissionControls'>
                        <div className='signerPermissionOrigin'>{permissions[o].origin}</div>
                        <RevokeAccess
                          account={this.props.account}
                          permissionId={o}
                          origin={permissions[o].origin}
                          onRevokeRequested={(id, origin, focusPermissionIds) =>
                            this.requestRevoke(id, origin, focusPermissionIds)
                          }
                          onRevokeFailed={(id) => this.revokeFailed(id)}
                          onRevokeCanceled={(id) => this.cancelRevoke(id)}
                          onRevokeSettled={(id, result) => this.revokeSettled(id, result)}
                        />
                      </div>
                    </div>
                  </ClusterValue>
                </ClusterRow>
              )
            })}
          </Cluster>
        )}
        {!this.props.expanded && permissionIds.length > permissionList.length ? (
          <button
            type='button'
            className='accountContinuationRow connectedAppsContinuation'
            disabled={this.state.navigating}
            onClick={() => this.openExpanded()}
          >
            <span>View all app access</span>
            <Icon name='chevron-right' size={16} />
          </button>
        ) : null}
        {this.state.revokeStatus ? (
          <div
            className='revokeAccessStatus'
            role={this.state.revokeStatusRole || 'status'}
            aria-live={this.state.revokeStatusRole === 'alert' ? 'assertive' : 'polite'}
            aria-atomic='true'
            tabIndex={-1}
            ref={this.revokeStatusRef}
          >
            {this.state.revokeStatus}
          </div>
        ) : null}
      </div>
    )
  }
}

export default Restore.connect(DappsPermissionsPreview)
