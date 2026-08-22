import React from 'react'
import Restore from 'react-restore'

import emptyConnections from 'url:../../../../../asset/ui/wren-empty-connections-v2.png'

import link from '../../../../../resources/link'
import {
  MAX_TIMER_DELAY,
  nextActiveExternalPermissionExpiry
} from '../../../../../resources/domain/connectedApps'
import { getPermissionIds } from '../../../../../resources/domain/permissions'
import RevokeAccess, {
  REVOKE_ACCESS_SESSION_ONLY,
  REVOKE_ACCESS_UNCERTAIN,
  REVOKE_CONFIRMATION_UNAVAILABLE,
  captureRevokeFocus,
  isSessionOnlyPersistenceFailure,
  restoreRevokeFocus
} from '../RevokeAccess'
import DappGuardrailEditor, { canonicalChainId } from '../DappGuardrailEditor'

import { ClusterBox, Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'
import DialogSurface from '../../../../../resources/Components/DialogSurface'

let clearDescriptionIndex = 0

export class DappsPermissionsExpanded extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.clearButtonRef = React.createRef()
    this.cancelClearRef = React.createRef()
    this.clearConfirmRef = React.createRef()
    this.clearDescriptionId = `clear-access-description-${++clearDescriptionIndex}`
    this.clearStatusRef = React.createRef()
    this.revokeStatusRef = React.createRef()
    this.guardrailButtonRefs = new Map()
    this.state = {
      clearConfirm: false,
      clearRequested: false,
      clearAcknowledged: false,
      clearSessionOnly: false,
      clearUncertain: false,
      clearing: false,
      clearStatus: false,
      clearFailure: false,
      guardrailEditor: null
    }
  }

  componentDidUpdate() {
    this.schedulePermissionExpiry()
    const permissions = this.store('main.permissions', this.props.account) || {}
    if (this.state.clearRequested && getPermissionIds(permissions).length === 0) {
      if (this.state.clearSessionOnly) {
        this.showClearStatus(REVOKE_ACCESS_SESSION_ONLY, 'alert')
      } else if (this.state.clearUncertain) {
        this.showClearStatus(REVOKE_ACCESS_UNCERTAIN, 'alert')
      } else if (this.state.clearAcknowledged) {
        this.showClearStatus('All app access revoked.', 'status')
      }
    }
    const revoked = this.state.revokeRequested
    if (revoked && !getPermissionIds(permissions).includes(revoked.id)) {
      if (revoked.sessionOnly) {
        this.showRevokeStatus(revoked, REVOKE_ACCESS_SESSION_ONLY, 'alert')
      } else if (revoked.uncertain) {
        this.showRevokeStatus(revoked, REVOKE_ACCESS_UNCERTAIN, 'alert')
      } else if (revoked.acknowledged) {
        this.showRevokeStatus(
          revoked,
          `Access revoked for ${revoked.origin}. The app must request access again.`,
          'status'
        )
      } else {
        this.orphanedRevokeId = revoked.id
        this.setState({ revokeRequested: null })
      }
    }
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
        ;(nextAction || this.revokeStatusRef.current)?.focus()
        this.revokeStatusTimer = setTimeout(() => this.dismissRevokeStatus(), 4000)
      }
    )
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.permissionExpiryTimer)
    clearTimeout(this.clearStatusTimer)
    clearTimeout(this.clearFailureTimer)
    clearTimeout(this.revokeStatusTimer)
    this.permissionExpiryDeadline = undefined
    this.orphanedRevokeId = undefined
  }

  componentDidMount() {
    this.mounted = true
    this.schedulePermissionExpiry()
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
            () =>
              restoreRevokeFocus(
                this.moduleRef.current,
                expiryFocus,
                document.querySelector('.accountViewBack') || this.moduleRef.current
              )
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
      if (restoreFocus) {
        ;(document.querySelector('.accountViewBack') || this.moduleRef.current)?.focus()
      }
    })
  }

  beginClear() {
    if (this.state.clearConfirm || this.state.clearing) return
    clearTimeout(this.clearStatusTimer)
    clearTimeout(this.clearFailureTimer)
    this.setState({ clearConfirm: true, clearStatus: false, clearFailure: false }, () => {
      this.cancelClearRef.current?.focus()
    })
  }

  cancelClear() {
    if (this.state.clearing) return
    clearTimeout(this.clearFailureTimer)
    this.setState(
      {
        clearConfirm: false,
        clearRequested: false,
        clearAcknowledged: false,
        clearSessionOnly: false,
        clearUncertain: false,
        clearFailure: false
      },
      () => this.clearButtonRef.current?.focus()
    )
  }

  async confirmClear() {
    if (!this.state.clearConfirm || this.state.clearing) return

    clearTimeout(this.clearFailureTimer)
    this.setState({
      clearRequested: true,
      clearAcknowledged: false,
      clearSessionOnly: false,
      clearUncertain: false,
      clearing: true,
      clearFailure: false
    })
    let result
    try {
      result = await link.invoke('tray:revokeAccess', this.props.account)
    } catch {
      result = { success: false, uncertain: true, error: 'Revocation confirmation is unavailable' }
    }
    if (!this.mounted) return
    if (result?.success) return this.setState({ clearAcknowledged: true })

    const permissions = this.store('main.permissions', this.props.account) || {}
    if (result?.sessionOnly) {
      if (getPermissionIds(permissions).length === 0) {
        this.showClearStatus(REVOKE_ACCESS_SESSION_ONLY, 'alert')
      } else {
        this.setState(
          {
            clearRequested: true,
            clearAcknowledged: false,
            clearSessionOnly: true,
            clearUncertain: false,
            clearing: false,
            clearFailure: REVOKE_ACCESS_SESSION_ONLY
          },
          () => {
            this.clearConfirmRef.current?.focus()
            this.clearFailureTimer = setTimeout(() => this.setState({ clearFailure: false }), 4000)
          }
        )
      }
      return
    }
    if (result?.uncertain) {
      if (getPermissionIds(permissions).length === 0) {
        this.showClearStatus(REVOKE_ACCESS_UNCERTAIN, 'alert')
      } else {
        this.setState(
          {
            clearRequested: true,
            clearAcknowledged: false,
            clearSessionOnly: false,
            clearUncertain: true,
            clearing: false,
            clearFailure: REVOKE_CONFIRMATION_UNAVAILABLE
          },
          () => {
            this.clearConfirmRef.current?.focus()
            this.clearFailureTimer = setTimeout(() => this.setState({ clearFailure: false }), 4000)
          }
        )
      }
      return
    }
    if (getPermissionIds(permissions).length > 0) {
      this.setState(
        {
          clearRequested: false,
          clearAcknowledged: false,
          clearSessionOnly: false,
          clearUncertain: false,
          clearing: false,
          clearFailure: 'App access was not revoked. Try again.'
        },
        () => {
          this.clearConfirmRef.current?.focus()
          this.clearFailureTimer = setTimeout(() => this.setState({ clearFailure: false }), 4000)
        }
      )
      return
    }
    this.showClearStatus(result?.error || 'App access was not revoked. Try again.', 'alert')
  }

  showClearStatus(message, role) {
    clearTimeout(this.clearFailureTimer)
    this.setState(
      {
        clearConfirm: false,
        clearRequested: false,
        clearAcknowledged: false,
        clearSessionOnly: false,
        clearUncertain: false,
        clearing: false,
        clearFailure: false,
        clearStatus: message,
        clearStatusRole: role
      },
      () => {
        this.clearStatusRef.current?.focus()
        this.scheduleClearStatusDismissal()
      }
    )
  }

  scheduleClearStatusDismissal() {
    clearTimeout(this.clearStatusTimer)
    this.clearStatusTimer = setTimeout(() => this.dismissClearStatus(), 4000)
  }

  dismissClearStatus() {
    const restoreFocus = document.activeElement === this.clearStatusRef.current
    this.setState({ clearStatus: false }, () => {
      if (restoreFocus) {
        ;(document.querySelector('.accountViewBack') || this.moduleRef.current)?.focus()
      }
    })
  }

  guardrailKey(originId, chainId) {
    return `${originId}\u0000${chainId}`
  }

  guardrailButtonRef(originId, chainId) {
    const key = this.guardrailKey(originId, chainId)
    if (!this.guardrailButtonRefs.has(key)) this.guardrailButtonRefs.set(key, React.createRef())
    return this.guardrailButtonRefs.get(key)
  }

  openGuardrail(originId, chainId) {
    if (this.state.clearing) return
    this.setState({ guardrailEditor: { originId, chainId }, clearConfirm: false })
  }

  closeGuardrail() {
    const active = this.state.guardrailEditor
    this.setState({ guardrailEditor: null }, () => {
      if (active) this.guardrailButtonRef(active.originId, active.chainId).current?.focus()
    })
  }

  chainName(chainId) {
    const numericId = Number(BigInt(chainId))
    const storedName = this.store('main.networks.ethereum', numericId, 'name')
    return typeof storedName === 'string' && storedName ? storedName : `Chain ${chainId}`
  }

  nativeDecimals(chainId) {
    const numericId = Number(BigInt(chainId))
    return this.store('main.networksMeta.ethereum', numericId, 'nativeCurrency', 'decimals')
  }

  render() {
    const permissions = this.store('main.permissions', this.props.account) || {}
    const allPermissionIds = getPermissionIds(permissions)
    let permissionList = getPermissionIds(permissions, this.props.filter)
    if (!this.props.expanded) permissionList = permissionList.slice(0, 3)

    return (
      <div
        className='accountViewScroll accountLedgerView permissionsLedgerView'
        ref={this.moduleRef}
        tabIndex={-1}
      >
        {permissionList.length === 0 ? (
          allPermissionIds.length ? (
            <div className='wrenEmptyFilter'>No matching app permissions</div>
          ) : (
            <WrenEmptyState
              image={emptyConnections}
              transparentImage={true}
              title='No app access'
              copy='Apps allowed to use this account appear here.'
              expanded
            />
          )
        ) : (
          <ClusterBox>
            <Cluster className='connectedAppsList'>
              <div className='moduleMainPermissions'>
                {permissionList.map((o) => {
                  const permission = permissions[o]
                  const originId = permission.handlerId
                  const chains = (permission.caveats?.[0]?.value?.chains || [])
                    .map(canonicalChainId)
                    .filter(Boolean)
                  return (
                    <ClusterRow key={o}>
                      <ClusterValue pointerEvents={true}>
                        <div className='signerPermission'>
                          <div className='signerPermissionControls'>
                            <div className='signerPermissionIdentity'>
                              <div className='signerPermissionOrigin'>{permission.origin}</div>
                              <div className='signerPermissionPrincipal'>App connection ID {originId}</div>
                            </div>
                            <RevokeAccess
                              account={this.props.account}
                              permissionId={o}
                              origin={permission.origin}
                              onRevokeRequested={(id, origin, focusPermissionIds) =>
                                this.requestRevoke(id, origin, focusPermissionIds)
                              }
                              onRevokeFailed={(id) => this.revokeFailed(id)}
                              onRevokeCanceled={(id) => this.cancelRevoke(id)}
                              onRevokeSettled={(id, result) => this.revokeSettled(id, result)}
                            />
                          </div>
                          <div className='dappGuardrailChainActions'>
                            {chains.length ? (
                              chains.map((chainId) => {
                                const guardrail = this.store(
                                  'main.dappGuardrails',
                                  this.props.account.toLowerCase(),
                                  originId,
                                  chainId
                                )
                                const chainName = this.chainName(chainId)
                                return (
                                  <button
                                    type='button'
                                    className='dappGuardrailManage wrenControl wrenControlSecondary'
                                    key={chainId}
                                    ref={this.guardrailButtonRef(originId, chainId)}
                                    aria-expanded={
                                      this.state.guardrailEditor?.originId === originId &&
                                      this.state.guardrailEditor?.chainId === chainId
                                    }
                                    onClick={() => this.openGuardrail(originId, chainId)}
                                  >
                                    {guardrail ? 'Edit' : 'Add'} guardrail · {chainName} ({chainId})
                                  </button>
                                )
                              })
                            ) : (
                              <span className='dappGuardrailNoChains'>No granted chains</span>
                            )}
                          </div>
                          {this.state.guardrailEditor?.originId === originId
                            ? chains
                                .filter((chainId) => this.state.guardrailEditor.chainId === chainId)
                                .map((chainId) => (
                                  <DappGuardrailEditor
                                    key={`${originId}-${chainId}`}
                                    account={this.props.account.toLowerCase()}
                                    originId={originId}
                                    origin={
                                      this.store('main.origins', originId) || {
                                        name: permission.origin,
                                        provenance: 'legacy'
                                      }
                                    }
                                    chainId={chainId}
                                    chainName={this.chainName(chainId)}
                                    nativeDecimals={this.nativeDecimals(chainId)}
                                    guardrail={this.store(
                                      'main.dappGuardrails',
                                      this.props.account.toLowerCase(),
                                      originId,
                                      chainId
                                    )}
                                    onClose={() => this.closeGuardrail()}
                                  />
                                ))
                            : null}
                        </div>
                      </ClusterValue>
                    </ClusterRow>
                  )
                })}
              </div>
            </Cluster>
          </ClusterBox>
        )}
        {permissionList.length === 0 && this.state.clearStatus ? (
          <div
            className='clearPermissionsStatus'
            role={this.state.clearStatusRole || 'status'}
            aria-live={this.state.clearStatusRole === 'alert' ? 'assertive' : 'polite'}
            aria-atomic='true'
            tabIndex={-1}
            ref={this.clearStatusRef}
          >
            {this.state.clearStatus}
          </div>
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
        {(permissionList.length > 0 || this.state.clearConfirm) && (
          <div className='clearPermissionsButton'>
            {this.state.clearConfirm ? (
              <DialogSurface
                className='clearPermissionsConfirm'
                role='alertdialog'
                modal
                ariaLabel='Revoke all app access?'
                describedBy={this.clearDescriptionId}
                busy={this.state.clearing}
                initialFocusRef={this.cancelClearRef}
                returnFocusRef={this.clearButtonRef}
                onCancel={() => this.cancelClear()}
              >
                <div className='clearPermissionsCopy'>
                  <strong>Revoke all app access?</strong>
                  <p id={this.clearDescriptionId}>
                    External apps will lose access to this account. Their guardrails will be removed, and they
                    must request access again.
                  </p>
                </div>
                {this.state.clearFailure ? (
                  <div className='revokeAccessFailure' role='alert'>
                    {this.state.clearFailure}
                  </div>
                ) : null}
                <div className='clearPermissionsActions'>
                  <button
                    type='button'
                    className='clearPermissionsAction wrenControl wrenControlSecondary'
                    disabled={this.state.clearing}
                    onClick={() => this.cancelClear()}
                    ref={this.cancelClearRef}
                  >
                    Cancel
                  </button>
                  <button
                    ref={this.clearConfirmRef}
                    type='button'
                    className='clearPermissionsAction wrenControl wrenControlDanger'
                    disabled={this.state.clearing}
                    onClick={() => this.confirmClear()}
                  >
                    {this.state.clearing ? 'Revoking…' : 'Confirm revoke'}
                  </button>
                </div>
              </DialogSurface>
            ) : (
              <button
                type='button'
                className='clearPermissionsAction wrenControl wrenControlSecondary'
                onClick={() => this.beginClear()}
                ref={this.clearButtonRef}
              >
                Revoke all app access
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
}

export default Restore.connect(DappsPermissionsExpanded)
