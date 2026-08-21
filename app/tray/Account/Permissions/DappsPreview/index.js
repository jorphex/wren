import React from 'react'
import Restore from 'react-restore'

import emptyConnections from 'url:../../../../../asset/ui/wren-empty-connections-v2.png'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import { getPermissionIds } from '../../../../../resources/domain/permissions'
import RevokeAccess from '../RevokeAccess'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'

export class DappsPermissionsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
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
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
  }

  componentWillUnmount() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
  }

  componentDidUpdate() {
    const revoked = this.state.revokeRequested
    if (!revoked) return
    const permissions = this.store('main.permissions', this.props.account) || {}
    if (getPermissionIds(permissions).includes(revoked.id)) return

    this.setState(
      {
        revokeRequested: null,
        revokeStatus: `Access revoked for ${revoked.origin}. The app must request access again.`
      },
      () => this.revokeStatusRef.current?.focus()
    )
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
        <div className='moduleHeader'>
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
                          onRevokeRequested={(id, origin) =>
                            this.setState({ revokeRequested: { id, origin }, revokeStatus: false })
                          }
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
          <div className='revokeAccessStatus' role='status' tabIndex={-1} ref={this.revokeStatusRef}>
            {this.state.revokeStatus}
          </div>
        ) : null}
      </div>
    )
  }
}

export default Restore.connect(DappsPermissionsPreview)
