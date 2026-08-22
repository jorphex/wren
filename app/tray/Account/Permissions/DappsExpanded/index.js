import React from 'react'
import Restore from 'react-restore'

import emptyConnections from 'url:../../../../../asset/ui/wren-empty-connections-v2.png'

import link from '../../../../../resources/link'
import { getPermissionIds } from '../../../../../resources/domain/permissions'
import RevokeAccess from '../RevokeAccess'
import DappGuardrailEditor, { canonicalChainId } from '../DappGuardrailEditor'

import { ClusterBox, Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'
import DialogSurface from '../../../../../resources/Components/DialogSurface'

export class DappsPermissionsExpanded extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.clearButtonRef = React.createRef()
    this.cancelClearRef = React.createRef()
    this.clearStatusRef = React.createRef()
    this.guardrailButtonRefs = new Map()
    this.state = {
      clearConfirm: false,
      clearRequested: false,
      clearing: false,
      clearStatus: false,
      guardrailEditor: null
    }
  }

  componentDidUpdate() {
    const permissions = this.store('main.permissions', this.props.account) || {}
    if (this.state.clearRequested && getPermissionIds(permissions).length === 0) {
      clearTimeout(this.clearTimer)
      this.setState(
        { clearConfirm: false, clearRequested: false, clearing: false, clearStatus: true },
        () => {
          this.clearStatusRef.current?.focus()
        }
      )
    }
    const revoked = this.state.revokeRequested
    if (revoked && !getPermissionIds(permissions).includes(revoked.id)) {
      clearTimeout(this.revokeStatusTimer)
      this.setState(
        {
          revokeRequested: null,
          revokeStatus: `Access revoked for ${revoked.origin}. The app must request access again.`
        },
        () => {
          const nextAction = this.moduleRef.current?.querySelector('.revokeAccessButton')
          const fallback = document.querySelector('.accountViewBack') || this.moduleRef.current
          ;(nextAction || fallback)?.focus()
          this.revokeStatusTimer = setTimeout(() => this.setState({ revokeStatus: false }), 4000)
        }
      )
    }
  }

  componentWillUnmount() {
    clearTimeout(this.clearTimer)
    clearTimeout(this.revokeStatusTimer)
  }

  requestRevoke(id, origin) {
    clearTimeout(this.revokeStatusTimer)
    this.setState({ revokeRequested: { id, origin }, revokeStatus: false })
  }

  beginClear() {
    if (this.state.clearConfirm || this.state.clearing) return
    this.setState({ clearConfirm: true, clearStatus: false }, () => {
      this.cancelClearRef.current?.focus()
    })
  }

  cancelClear() {
    if (this.state.clearing) return
    this.setState({ clearConfirm: false }, () => this.clearButtonRef.current?.focus())
  }

  confirmClear() {
    if (!this.state.clearConfirm || this.state.clearing) return

    clearTimeout(this.clearTimer)
    this.clearTimer = setTimeout(() => {
      this.setState({ clearConfirm: false, clearing: false }, () => this.clearButtonRef.current?.focus())
    }, 600)
    this.setState({ clearRequested: true, clearing: true })
    link.send('tray:action', 'clearPermissions', this.props.account)
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
      <div className='accountViewScroll accountLedgerView' ref={this.moduleRef} tabIndex={-1}>
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
                              <div className='signerPermissionPrincipal'>Principal {originId}</div>
                            </div>
                            <RevokeAccess
                              account={this.props.account}
                              permissionId={o}
                              origin={permission.origin}
                              onRevokeRequested={(id, origin) => this.requestRevoke(id, origin)}
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
          <div className='clearPermissionsStatus' role='status' tabIndex={-1} ref={this.clearStatusRef}>
            All app permissions cleared.
          </div>
        ) : null}
        {this.state.revokeStatus ? (
          <div className='revokeAccessStatus' role='status' aria-live='polite' aria-atomic='true'>
            {this.state.revokeStatus}
          </div>
        ) : null}
        {permissionList.length > 0 && (
          <div className='clearPermissionsButton'>
            {this.state.clearConfirm ? (
              <DialogSurface
                className='clearPermissionsConfirm'
                role='alertdialog'
                modal
                ariaLabel='Clear all permissions?'
                busy={this.state.clearing}
                initialFocusRef={this.cancelClearRef}
                returnFocusRef={this.clearButtonRef}
                onCancel={() => this.cancelClear()}
              >
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
                  type='button'
                  className='clearPermissionsAction wrenControl wrenControlDanger'
                  disabled={this.state.clearing}
                  onClick={() => this.confirmClear()}
                >
                  {this.state.clearing ? 'Clearing…' : 'Confirm clear'}
                </button>
              </DialogSurface>
            ) : (
              <button
                type='button'
                className='clearPermissionsAction wrenControl wrenControlDanger'
                onClick={() => this.beginClear()}
                ref={this.clearButtonRef}
              >
                Clear all permissions
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
}

export default Restore.connect(DappsPermissionsExpanded)
