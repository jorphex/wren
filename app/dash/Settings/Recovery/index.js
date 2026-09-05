import { Component, createRef } from 'react'

import DialogSurface from '../../../../resources/Components/DialogSurface'
import { MINIMUM_PASSWORD_LENGTH } from '../../../../resources/domain/password'
import { exportProfileBackup, inspectProfileBackup, stageProfileRestore } from './api'

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatBackupDate = (createdAt) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(createdAt))

export class Recovery extends Component {
  constructor(props) {
    super(props)
    this.exportTriggerRef = createRef()
    this.exportPasswordRef = createRef()
    this.exportStatusRef = createRef()
    this.restoreTriggerRef = createRef()
    this.restorePasswordRef = createRef()
    this.restoreCancelRef = createRef()
    this.restoreStatusRef = createRef()
    this.state = {
      active: '',
      exportPassword: '',
      exportConfirmation: '',
      exportPending: false,
      exportError: '',
      exportStatus: '',
      restorePassword: '',
      restorePending: false,
      restoreError: '',
      restoreStatus: '',
      inspected: undefined,
      restoreToken: ''
    }
  }

  begin(flow) {
    if (this.state.exportPending || this.state.restorePending) return
    this.setState(
      {
        active: flow,
        exportPassword: '',
        exportConfirmation: '',
        exportError: '',
        exportStatus: '',
        restorePassword: '',
        restoreError: '',
        restoreStatus: '',
        inspected: undefined,
        restoreToken: ''
      },
      () => (flow === 'export' ? this.exportPasswordRef : this.restorePasswordRef).current?.focus()
    )
  }

  cancel(flow) {
    if (this.state.exportPending || this.state.restorePending) return
    this.setState(
      {
        active: '',
        exportPassword: '',
        exportConfirmation: '',
        exportError: '',
        restorePassword: '',
        restoreError: '',
        inspected: undefined,
        restoreToken: ''
      },
      () => (flow === 'export' ? this.exportTriggerRef : this.restoreTriggerRef).current?.focus()
    )
  }

  async exportBackup(event) {
    event.preventDefault()
    if (this.state.exportPending) return
    if (this.state.exportPassword.length < MINIMUM_PASSWORD_LENGTH) {
      this.setState({ exportError: `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.` })
      return
    }
    if (this.state.exportPassword !== this.state.exportConfirmation) {
      this.setState({ exportError: 'The passwords do not match.' })
      return
    }

    this.setState({ exportPending: true, exportError: '', exportStatus: '' })
    try {
      const result = await exportProfileBackup(this.state.exportPassword)
      if (!result.success && !result.canceled) throw new Error('export failed')
      const exportStatus = result.success
        ? `Encrypted backup saved (${formatBytes(result.bytes)}).`
        : 'Export canceled. No backup was written.'
      this.setState(
        {
          active: '',
          exportPassword: '',
          exportConfirmation: '',
          exportPending: false,
          exportStatus
        },
        () => this.exportStatusRef.current?.focus()
      )
    } catch {
      this.setState({
        exportPending: false,
        exportError: 'Couldn’t export the encrypted backup. Nothing was changed. Try again.'
      })
    }
  }

  async inspectBackup(event) {
    event.preventDefault()
    if (this.state.restorePending) return
    if (this.state.restorePassword.length < MINIMUM_PASSWORD_LENGTH) {
      this.setState({
        restoreError: `Enter the backup password (at least ${MINIMUM_PASSWORD_LENGTH} characters).`
      })
      return
    }

    this.setState({ restorePending: true, restoreError: '', restoreStatus: '' })
    try {
      const result = await inspectProfileBackup(this.state.restorePassword)
      if (!result.success && !result.canceled) throw new Error('inspect failed')
      if (result.canceled) {
        this.setState(
          {
            active: '',
            restorePassword: '',
            restorePending: false,
            restoreStatus: 'Restore canceled. Your current profile is unchanged.'
          },
          () => this.restoreStatusRef.current?.focus()
        )
        return
      }
      if (!result.restoreToken) throw new Error('inspect response unavailable')
      this.setState(
        {
          restorePending: false,
          inspected: result.backup,
          restoreToken: result.restoreToken
        },
        () => this.restoreCancelRef.current?.focus()
      )
    } catch {
      this.setState({
        restorePending: false,
        restoreError: 'Couldn’t open this backup. Check the file and password, then try again.'
      })
    }
  }

  async stageRestore() {
    if (this.state.restorePending || !this.state.inspected || !this.state.restoreToken) return
    this.setState({ restorePending: true, restoreError: '' })
    try {
      const result = await stageProfileRestore(this.state.restoreToken, this.state.restorePassword)
      if (!result.success) throw new Error('restore failed')
      this.setState(
        {
          active: '',
          restorePassword: '',
          restorePending: false,
          restoreStatus: 'Restore staged. Wren is restarting to replace this profile atomically.',
          inspected: undefined,
          restoreToken: ''
        },
        () => this.restoreStatusRef.current?.focus()
      )
    } catch {
      this.setState(
        {
          active: '',
          restorePassword: '',
          restorePending: false,
          restoreError: '',
          restoreStatus:
            'Couldn’t stage this restore. Your current profile is unchanged. Inspect the backup again.',
          inspected: undefined,
          restoreToken: ''
        },
        () => this.restoreStatusRef.current?.focus()
      )
    }
  }

  renderExport() {
    if (this.state.active !== 'export') return null
    return (
      <DialogSurface
        as='form'
        className='recoveryPanel'
        role='dialog'
        modal={false}
        ariaLabel='Export encrypted backup'
        busy={this.state.exportPending}
        initialFocusRef={this.exportPasswordRef}
        returnFocusRef={this.exportTriggerRef}
        onCancel={() => this.cancel('export')}
        onSubmit={(event) => this.exportBackup(event)}
      >
        <p className='recoveryPanelCopy'>
          Choose a new password for this backup. Wren cannot recover it if you forget it.
        </p>
        <div className='recoveryFields'>
          <label htmlFor='recovery-export-password'>Backup password</label>
          <input
            id='recovery-export-password'
            ref={this.exportPasswordRef}
            className='wrenInput wrenInputQuiet'
            type='password'
            minLength={MINIMUM_PASSWORD_LENGTH}
            maxLength={1024}
            autoComplete='new-password'
            disabled={this.state.exportPending}
            aria-label='Backup password'
            aria-invalid={Boolean(this.state.exportError)}
            value={this.state.exportPassword}
            onChange={(event) => this.setState({ exportPassword: event.target.value, exportError: '' })}
          />
          <label htmlFor='recovery-export-confirmation'>Confirm password</label>
          <input
            id='recovery-export-confirmation'
            className='wrenInput wrenInputQuiet'
            type='password'
            minLength={MINIMUM_PASSWORD_LENGTH}
            maxLength={1024}
            autoComplete='new-password'
            disabled={this.state.exportPending}
            aria-label='Confirm password'
            aria-invalid={Boolean(this.state.exportError)}
            value={this.state.exportConfirmation}
            onChange={(event) => this.setState({ exportConfirmation: event.target.value, exportError: '' })}
          />
        </div>
        {this.state.exportError ? (
          <div className='recoveryError' role='alert'>
            {this.state.exportError}
          </div>
        ) : null}
        <div className='recoveryActions'>
          <button
            type='button'
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={this.state.exportPending}
            onClick={() => this.cancel('export')}
          >
            Cancel
          </button>
          <button
            type='submit'
            className='wrenControl wrenControlPrimary wrenControlLarge'
            disabled={this.state.exportPending}
          >
            {this.state.exportPending ? 'Saving encrypted backup…' : 'Choose save location'}
          </button>
        </div>
      </DialogSurface>
    )
  }

  renderRestore() {
    if (this.state.active !== 'restore') return null
    if (this.state.inspected) {
      const { createdAt, formatVersion, signerCount } = this.state.inspected
      return (
        <DialogSurface
          className='recoveryPanel recoveryReplacePanel'
          role='alertdialog'
          modal={false}
          labelledBy='recovery-replace-title'
          describedBy='recovery-replace-description'
          busy={this.state.restorePending}
          initialFocusRef={this.restoreCancelRef}
          returnFocusRef={this.restoreTriggerRef}
          onCancel={() => this.cancel('restore')}
        >
          <strong id='recovery-replace-title'>Replace this Wren profile?</strong>
          <dl className='recoveryMetadata'>
            <div>
              <dt>Backup format</dt>
              <dd>{`Version ${formatVersion}`}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatBackupDate(createdAt)}</dd>
            </div>
            <div>
              <dt>Wallet sources</dt>
              <dd>{signerCount}</dd>
            </div>
          </dl>
          <p id='recovery-replace-description' className='recoveryPanelCopy'>
            Restart Wren and replace this device’s current profile with the backup. If restoration fails, the
            current profile stays in place.
          </p>
          <div className='recoveryActions'>
            <button
              ref={this.restoreCancelRef}
              type='button'
              className='wrenControl wrenControlSecondary wrenControlLarge'
              disabled={this.state.restorePending}
              onClick={() => this.cancel('restore')}
            >
              Cancel
            </button>
            <button
              type='button'
              className='wrenControl wrenControlDanger wrenControlLarge'
              disabled={this.state.restorePending}
              onClick={() => this.stageRestore()}
            >
              {this.state.restorePending ? 'Staging restore…' : 'Replace this Wren profile'}
            </button>
          </div>
        </DialogSurface>
      )
    }

    return (
      <DialogSurface
        as='form'
        className='recoveryPanel'
        role='dialog'
        modal={false}
        ariaLabel='Inspect encrypted backup'
        busy={this.state.restorePending}
        initialFocusRef={this.restorePasswordRef}
        returnFocusRef={this.restoreTriggerRef}
        onCancel={() => this.cancel('restore')}
        onSubmit={(event) => this.inspectBackup(event)}
      >
        <p className='recoveryPanelCopy'>Choose a backup to preview before restoring.</p>
        <div className='recoveryFields'>
          <label htmlFor='recovery-restore-password'>Backup password</label>
          <input
            id='recovery-restore-password'
            ref={this.restorePasswordRef}
            className='wrenInput wrenInputQuiet'
            type='password'
            minLength={MINIMUM_PASSWORD_LENGTH}
            maxLength={1024}
            autoComplete='off'
            disabled={this.state.restorePending}
            aria-label='Backup password'
            aria-invalid={Boolean(this.state.restoreError)}
            value={this.state.restorePassword}
            onChange={(event) => this.setState({ restorePassword: event.target.value, restoreError: '' })}
          />
        </div>
        {this.state.restoreError ? (
          <div className='recoveryError' role='alert'>
            {this.state.restoreError}
          </div>
        ) : null}
        <div className='recoveryActions'>
          <button
            type='button'
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={this.state.restorePending}
            onClick={() => this.cancel('restore')}
          >
            Cancel
          </button>
          <button
            type='submit'
            className='wrenControl wrenControlPrimary wrenControlLarge'
            disabled={this.state.restorePending}
          >
            {this.state.restorePending ? 'Inspecting backup…' : 'Choose backup to inspect'}
          </button>
        </div>
      </DialogSurface>
    )
  }

  render() {
    return (
      <div className='recoverySettings'>
        <div className='recoveryOption'>
          <div className='recoveryOptionCopy'>
            <strong>Export encrypted backup</strong>
            <span>
              Includes accounts, names, networks, contacts, permissions, settings, and wallet sources. Live
              balances, rates, and pending requests are left out.
            </span>
          </div>
          <button
            ref={this.exportTriggerRef}
            type='button'
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={Boolean(this.state.active)}
            onClick={() => this.begin('export')}
          >
            Export backup
          </button>
        </div>
        {this.renderExport()}
        {this.state.exportStatus ? (
          <div className='recoveryStatus' role='status' tabIndex={-1} ref={this.exportStatusRef}>
            {this.state.exportStatus}
          </div>
        ) : null}

        <div className='recoveryOption'>
          <div className='recoveryOptionCopy'>
            <strong>Restore encrypted backup</strong>
            <span>Inspect a backup before replacing this device’s current Wren profile.</span>
          </div>
          <button
            ref={this.restoreTriggerRef}
            type='button'
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={Boolean(this.state.active)}
            onClick={() => this.begin('restore')}
          >
            Restore backup
          </button>
        </div>
        {this.renderRestore()}
        {this.state.restoreStatus ? (
          <div className='recoveryStatus' role='status' tabIndex={-1} ref={this.restoreStatusRef}>
            {this.state.restoreStatus}
          </div>
        ) : null}
      </div>
    )
  }
}

export default Recovery
