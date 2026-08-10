import React from 'react'
import Restore from 'react-restore'
import link from '../../../../../resources/link'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'

export class SettingsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.cancelRemoveRef = React.createRef()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.clientHeight
          })
        }
      })
    }
    this.state = {
      removeConfirm: false,
      removing: false
    }
  }

  componentDidMount() {
    this.mounted = true
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.resizeObserver) this.resizeObserver.disconnect()
  }

  resetRemoveConfirmation() {
    this.setState({ removeConfirm: false })
  }

  removeAccount(event) {
    if (this.state.removing || this.removePending) return
    // A browser increments detail for clicks in one multi-click gesture.
    if (event.detail > 1) return

    this.removePending = true
    this.setState({ removing: true })
    link.rpc('removeAccount', this.props.account, {}, (err) => {
      if (err) {
        this.removePending = false
        if (this.mounted) this.setState({ removing: false })
      }
    })
  }

  armAccountRemoval() {
    if (this.state.removing || this.removePending) return
    this.setState({ removeConfirm: true }, () => this.cancelRemoveRef.current?.focus())
  }

  render() {
    return (
      <div ref={this.moduleRef}>
        <div className='balancesBlock accountLedgerModule'>
          <Cluster>
            {this.state.removeConfirm ? (
              <ClusterRow className='settingsPreviewActions settingsPreviewRemovalConfirm accountLedgerRow'>
                <ClusterValue
                  actionRef={this.cancelRemoveRef}
                  ariaLabel='Cancel account removal'
                  disabled={this.state.removing}
                  onClick={() => this.resetRemoveConfirmation()}
                >
                  <div className='moduleItem cardShow'>Cancel</div>
                </ClusterValue>
                <ClusterValue
                  ariaLabel='Confirm remove account'
                  disabled={this.state.removing}
                  onClick={(event) => this.removeAccount(event)}
                >
                  <div className='moduleItem cardShow'>Confirm removal</div>
                </ClusterValue>
              </ClusterRow>
            ) : (
              <ClusterRow className='settingsPreviewActions accountLedgerRow'>
                <ClusterValue
                  ariaLabel='Remove account'
                  disabled={this.state.removing}
                  onClick={() => this.armAccountRemoval()}
                >
                  <div className='moduleItem cardShow'>Remove account</div>
                </ClusterValue>
              </ClusterRow>
            )}
          </Cluster>
        </div>
      </div>
    )
  }
}

export default Restore.connect(SettingsPreview)
