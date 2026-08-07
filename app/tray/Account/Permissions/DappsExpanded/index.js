import React from 'react'
import Restore from 'react-restore'
import link from '../../../../../resources/link'
import { getPermissionIds } from '../../../../../resources/domain/permissions'
import PermissionToggle from '../PermissionToggle'

import { ClusterBox, Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'

export class DappsPermissionsExpanded extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.clearButtonRef = React.createRef()
    this.cancelClearRef = React.createRef()
    this.clearStatusRef = React.createRef()
    this.state = { clearConfirm: false, clearRequested: false, clearing: false, clearStatus: false }
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
  }

  componentWillUnmount() {
    clearTimeout(this.clearTimer)
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

  render() {
    const permissions = this.store('main.permissions', this.props.account) || {}
    let permissionList = getPermissionIds(permissions, this.props.filter)
    if (!this.props.expanded) permissionList = permissionList.slice(0, 3)

    return (
      <div className='accountViewScroll'>
        <ClusterBox style={{ marginTop: '20px' }}>
          <Cluster>
            <div className='moduleMainPermissions'>
              {permissionList.length === 0 ? (
                <ClusterRow>
                  <ClusterValue>
                    <div className='signerPermission'>
                      <div className='signerPermissionControls'>
                        <div className='signerPermissionNoPermissions'>No Permissions Set</div>
                      </div>
                    </div>
                  </ClusterValue>
                </ClusterRow>
              ) : (
                permissionList.map((o) => {
                  return (
                    <ClusterRow key={o}>
                      <ClusterValue pointerEvents={true}>
                        <div className='signerPermission'>
                          <div className='signerPermissionControls'>
                            <div className='signerPermissionOrigin'>{permissions[o].origin}</div>
                            <PermissionToggle
                              account={this.props.account}
                              permissionId={o}
                              origin={permissions[o].origin}
                              checked={permissions[o].provider}
                            />
                          </div>
                        </div>
                      </ClusterValue>
                    </ClusterRow>
                  )
                })
              )}
            </div>
          </Cluster>
        </ClusterBox>
        {permissionList.length === 0 && this.state.clearStatus ? (
          <div className='clearPermissionsStatus' role='status' tabIndex={-1} ref={this.clearStatusRef}>
            All external permissions cleared.
          </div>
        ) : null}
        {permissionList.length > 0 && (
          <div className='clearPermissionsButton'>
            {this.state.clearConfirm ? (
              <div
                className='clearPermissionsConfirm'
                role='group'
                aria-label='Confirm clearing all permissions'
              >
                <button
                  type='button'
                  className='moduleButton clearPermissionsAction'
                  disabled={this.state.clearing}
                  onClick={() => this.cancelClear()}
                  ref={this.cancelClearRef}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='moduleButton moduleButtonBad clearPermissionsAction'
                  disabled={this.state.clearing}
                  onClick={() => this.confirmClear()}
                >
                  {this.state.clearing ? 'Clearing...' : 'Confirm Clear'}
                </button>
              </div>
            ) : (
              <button
                type='button'
                className='moduleButton moduleButtonBad clearPermissionsAction'
                onClick={() => this.beginClear()}
                ref={this.clearButtonRef}
              >
                Clear All Permissions
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
}

export default Restore.connect(DappsPermissionsExpanded)
