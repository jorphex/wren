import React from 'react'

import Toggle from '../../../../../resources/Components/Toggle'
import link from '../../../../../resources/link'

export class PermissionToggle extends React.Component {
  state = { pending: false }

  componentDidUpdate(previousProps) {
    if (this.state.pending && previousProps.checked !== this.props.checked) {
      clearTimeout(this.pendingTimer)
      this.setState({ pending: false })
    }
  }

  componentWillUnmount() {
    clearTimeout(this.pendingTimer)
  }

  toggle() {
    if (this.state.pending) return

    clearTimeout(this.pendingTimer)
    this.pendingTimer = setTimeout(() => this.setState({ pending: false }), 600)
    this.setState({ pending: true })
    link.send('tray:action', 'toggleAccess', this.props.account, this.props.permissionId, !this.props.checked)
  }

  render() {
    return (
      <Toggle
        checked={this.props.checked}
        disabled={this.state.pending}
        label={`Access for ${this.props.origin}`}
        onChange={() => this.toggle()}
      />
    )
  }
}

export default PermissionToggle
