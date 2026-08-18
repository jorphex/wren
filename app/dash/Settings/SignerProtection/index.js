import { Component, createRef } from 'react'

import DialogSurface from '../../../../resources/Components/DialogSurface'
import { disableSignerProtection, enableSignerProtection, getSignerProtectionStatus } from './api'

const backendName = (backend) => {
  if (backend === 'gnome_libsecret') return 'Secret Service'
  if (backend === 'kwallet' || backend === 'kwallet5' || backend === 'kwallet6') return 'KWallet'
  return 'secure Linux keychain'
}

export class SignerProtection extends Component {
  constructor(props) {
    super(props)
    this.actionRef = createRef()
    this.cancelRef = createRef()
    this.statusRef = createRef()
    this.state = { status: undefined, pending: true, operation: '', error: '', announcement: '' }
  }

  componentDidMount() {
    this.mounted = true
    void this.refresh()
  }

  componentWillUnmount() {
    this.mounted = false
  }

  async refresh() {
    this.setState({ pending: true, error: '' })
    try {
      const result = await getSignerProtectionStatus()
      if (!result.success) throw new Error('status unavailable')
      if (this.mounted) this.setState({ status: result.status, pending: false })
    } catch {
      if (this.mounted) {
        this.setState({ pending: false, error: 'Couldn’t read software signer protection status.' })
      }
    }
  }

  arm(operation) {
    if (this.state.pending) return
    this.setState({ operation, error: '', announcement: '' }, () => this.cancelRef.current?.focus())
  }

  cancel() {
    if (this.state.pending) return
    this.setState({ operation: '', error: '' }, () => this.actionRef.current?.focus())
  }

  async apply() {
    const { operation } = this.state
    if (!operation || this.state.pending) return
    this.setState({ pending: true, error: '', announcement: '' })
    try {
      const result = await (operation === 'enable' ? enableSignerProtection() : disableSignerProtection())
      if (!result.success) throw new Error('operation failed')
      const announcement =
        operation === 'enable'
          ? 'Device protection enabled for software signers.'
          : 'Device protection disabled. Password encryption remains enabled.'
      this.setState({ status: result.status, pending: false, operation: '', announcement }, () =>
        this.statusRef.current?.focus()
      )
    } catch {
      this.setState({
        pending: false,
        error: 'Couldn’t change software signer protection. No weaker fallback was used.'
      })
    }
  }

  copy() {
    const status = this.state.status
    if (!status) return 'Checking this device’s keychain…'
    if (status.state === 'unsupported') {
      if (status.enabled) {
        return 'This profile contains Linux device-protected signers that cannot be opened here. Restore a portable encrypted backup instead.'
      }
      return 'Device protection is available on Linux in this release. Signer passwords still protect these records.'
    }
    if (status.state === 'recovery-required') {
      return 'A protection change was interrupted. Software signers stay unavailable until you finish enabling protection or restore password-only storage.'
    }
    if (status.state === 'unavailable' && status.enabled) {
      return 'Protection is enabled, but this keychain cannot open the records. Software signers remain closed; start the original Secret Service or KWallet, then retry or restore a portable backup.'
    }
    if (status.state === 'unavailable') {
      return 'Wren could not find Secret Service or KWallet. It refuses Electron’s insecure basic-text fallback.'
    }
    if (status.state === 'enabled') {
      return `${status.signerFiles} signer file${status.signerFiles === 1 ? '' : 's'} protected by ${backendName(status.backend)}. Your signer password is still required.`
    }
    return 'Add a device-bound keychain layer to every software signer file. Your signer password and portable encrypted backups continue to work independently.'
  }

  renderDialog() {
    const operation = this.state.operation
    if (!operation) return null
    const enabling = operation === 'enable'
    return (
      <DialogSurface
        className='recoveryPanel'
        role='alertdialog'
        modal={false}
        labelledBy='signer-protection-confirm-title'
        describedBy='signer-protection-confirm-copy'
        busy={this.state.pending}
        initialFocusRef={this.cancelRef}
        returnFocusRef={this.actionRef}
        onCancel={() => this.cancel()}
      >
        <strong id='signer-protection-confirm-title'>
          {enabling ? 'Protect software signers with this device?' : 'Remove device protection?'}
        </strong>
        <p id='signer-protection-confirm-copy' className='recoveryPanelCopy'>
          {enabling
            ? 'Wren will bind the existing password-encrypted signer files to this Linux keychain. Export an encrypted backup for recovery on another device.'
            : 'Wren will remove only the device-bound layer. Existing signer password encryption stays in place.'}
        </p>
        <div className='recoveryActions'>
          <button
            ref={this.cancelRef}
            type='button'
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={this.state.pending}
            onClick={() => this.cancel()}
          >
            Cancel
          </button>
          <button
            type='button'
            className='wrenControl wrenControlPrimary wrenControlLarge'
            disabled={this.state.pending}
            onClick={() => this.apply()}
          >
            {this.state.pending
              ? 'Changing protection…'
              : enabling
                ? 'Enable device protection'
                : 'Remove device protection'}
          </button>
        </div>
      </DialogSurface>
    )
  }

  renderActions() {
    const status = this.state.status
    if (!status || this.state.pending || this.state.operation) return null
    if (status.state === 'recovery-required') {
      return (
        <span className='recoveryOptionActions'>
          <button
            ref={this.actionRef}
            type='button'
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={!status.available}
            onClick={() => this.arm('disable')}
          >
            Restore password-only
          </button>
          <button
            type='button'
            className='wrenControl wrenControlPrimary wrenControlLarge'
            disabled={!status.available}
            onClick={() => this.arm('enable')}
          >
            Finish enabling
          </button>
        </span>
      )
    }
    if (status.state === 'enabled') {
      return (
        <button
          ref={this.actionRef}
          type='button'
          className='wrenControl wrenControlSecondary wrenControlLarge'
          onClick={() => this.arm('disable')}
        >
          Remove protection
        </button>
      )
    }
    if (status.state === 'disabled') {
      return (
        <button
          ref={this.actionRef}
          type='button'
          className='wrenControl wrenControlPrimary wrenControlLarge'
          onClick={() => this.arm('enable')}
        >
          Enable protection
        </button>
      )
    }
    if (status.state === 'unavailable') {
      return (
        <button
          ref={this.actionRef}
          type='button'
          className='wrenControl wrenControlSecondary wrenControlLarge'
          onClick={() => this.refresh()}
        >
          Retry
        </button>
      )
    }
    return null
  }

  render() {
    return (
      <div className='recoverySettings'>
        <div className='recoveryOption'>
          <div className='recoveryOptionCopy'>
            <strong>Device protection</strong>
            <span>{this.copy()}</span>
          </div>
          {this.renderActions()}
        </div>
        {this.renderDialog()}
        {this.state.error ? (
          <div className='recoveryError' role='alert'>
            {this.state.error}
          </div>
        ) : null}
        {this.state.announcement ? (
          <div className='recoveryStatus' role='status' tabIndex={-1} ref={this.statusRef}>
            {this.state.announcement}
          </div>
        ) : null}
      </div>
    )
  }
}

export default SignerProtection
