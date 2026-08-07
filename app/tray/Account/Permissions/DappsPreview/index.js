import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import { getPermissionIds } from '../../../../../resources/domain/permissions'
import PermissionToggle from '../PermissionToggle'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'

export class DappsPermissionsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
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
    const permissionIds = getPermissionIds(permissions, this.props.filter)
    const permissionList = this.props.expanded ? permissionIds : permissionIds.slice(0, 4)

    return (
      <div className='balancesBlock' ref={this.moduleRef}>
        <div className='moduleHeader'>
          <span>
            <Icon name='apps' size={14} />
          </span>
          <span>{'Dapps'}</span>
        </div>
        <Cluster>
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
        </Cluster>
        {permissionIds.length > 0 && (
          <div className='signerBalanceTotal'>
            <div className='signerBalanceButtons'>
              <button
                type='button'
                className='signerBalanceButton signerBalanceShowAll'
                disabled={this.state.navigating}
                onClick={() => this.openExpanded()}
              >
                More
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }
}

export default Restore.connect(DappsPermissionsPreview)
