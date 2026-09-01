import React from 'react'
import Restore from 'react-restore'
import styled from 'styled-components'
import link from '../../../../../resources/link'
import DialogSurface from '../../../../../resources/Components/DialogSurface'
import { accountDisplayIdentity } from '../../../../../resources/domain/account'

import { Cluster } from '../../../../../resources/Components/Cluster'

const AccountActions = styled.div`
  display: grid;
  min-height: 104px;
  padding: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: var(--wren-space-2);
  box-sizing: border-box;

  button {
    width: 100%;
    min-width: 0;
    min-height: 44px;
  }
`

const RemovalDialog = styled(DialogSurface)`
  padding: 14px 16px 16px;
  color: var(--wren-text-primary);
`

const RemovalTitle = styled.h3`
  margin: 0;
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-body);
  font-weight: 600;
  line-height: 20px;
`

const RemovalBody = styled.p`
  margin: 6px 0 0;
  color: var(--wren-text-secondary);
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-small);
  line-height: 18px;
`

const RemovalError = styled.div`
  margin-top: 8px;
  color: var(--wren-danger);
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-small);
  line-height: 18px;
`

const RemovalStatus = styled.div`
  margin-top: 8px;
  color: var(--wren-text-secondary);
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-small);
  line-height: 18px;
`

const RemovalActions = styled.div`
  display: flex;
  gap: var(--wren-space-2);
  margin-top: 12px;

  button {
    flex: 1 1 0;
    min-height: 44px;
  }
`

export class SettingsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.removeTriggerRef = React.createRef()
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
      removing: false,
      removeError: '',
      removeStatus: ''
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

  resetRemoveConfirmation(restoreFocus = true) {
    if (this.state.removing || this.removePending) return
    if (!restoreFocus) this.removeTriggerRef.current = null
    this.setState({ removeConfirm: false, removeError: '', removeStatus: '' }, () => {
      if (restoreFocus) this.removeTriggerRef.current?.focus()
    })
  }

  removeAccount(event) {
    if (this.state.removing || this.removePending) return
    // A browser increments detail for clicks in one multi-click gesture.
    if (event?.detail > 1) return

    this.removePending = true
    this.setState({ removing: true, removeError: '', removeStatus: '' })
    link.rpc('removeAccount', this.props.account, {}, (err, result) => {
      if (err) {
        this.removePending = false
        if (this.mounted) {
          this.setState({
            removing: false,
            removeError: 'Couldn\u2019t remove account. Try again.',
            removeStatus: ''
          })
        }
      } else if (result?.status === 'deferred' && this.mounted) {
        this.setState({
          removeStatus: 'Removal is in progress. Wren will finish automatically.'
        })
      }
    })
  }

  armAccountRemoval() {
    if (this.state.removing || this.removePending) return
    this.setState({ removeConfirm: true, removeError: '', removeStatus: '' })
  }

  openNameEditor() {
    link.send('nav:forward', 'panel', {
      view: 'expandedModule',
      data: {
        id: this.props.moduleId,
        account: this.props.account,
        title: 'Account settings'
      }
    })
  }

  render() {
    const account = this.store('main.accounts', this.props.account) || {}
    const accountDisplayName = accountDisplayIdentity(
      account,
      Boolean(this.store('main.showLocalNameWithENS'))
    ).primary
    const accountAddress = account.address || this.props.account
    const dialogSuffix = String(accountAddress).replace(/[^a-zA-Z0-9_-]/g, '')
    const titleId = `remove-account-title-${dialogSuffix}`
    const bodyId = `remove-account-body-${dialogSuffix}`

    return (
      <div ref={this.moduleRef}>
        <div className='balancesBlock accountLedgerModule'>
          <Cluster>
            {this.state.removeConfirm ? (
              <RemovalDialog
                role='alertdialog'
                labelledBy={titleId}
                describedBy={bodyId}
                busy={this.state.removing}
                initialFocusRef={this.cancelRemoveRef}
                returnFocusRef={this.removeTriggerRef}
                onCancel={() => this.resetRemoveConfirmation()}
              >
                <RemovalTitle id={titleId}>{`Remove ${accountDisplayName}?`}</RemovalTitle>
                <RemovalBody id={bodyId}>
                  {`This removes ${accountDisplayName} (${accountAddress}) from Wren. Funds remain onchain, but this account and its signer connection will no longer be available here.`}
                </RemovalBody>
                {this.state.removeError ? (
                  <RemovalError role='alert'>{this.state.removeError}</RemovalError>
                ) : null}
                {this.state.removeStatus ? (
                  <RemovalStatus role='status'>{this.state.removeStatus}</RemovalStatus>
                ) : null}
                <RemovalActions>
                  <button
                    type='button'
                    ref={this.cancelRemoveRef}
                    className='wrenControl wrenControlGhost'
                    disabled={this.state.removing}
                    onClick={() => this.resetRemoveConfirmation()}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    className='wrenControl wrenControlDanger'
                    disabled={this.state.removing}
                    onClick={(event) => this.removeAccount(event)}
                  >
                    {this.state.removing ? 'Removing account\u2026' : 'Confirm removal'}
                  </button>
                </RemovalActions>
              </RemovalDialog>
            ) : (
              <AccountActions className='settingsPreviewActions'>
                <button
                  type='button'
                  className='settingsPreviewRename wrenControl wrenControlSecondary wrenControlLarge'
                  onClick={() => this.openNameEditor()}
                >
                  Rename account
                </button>
                <button
                  type='button'
                  ref={this.removeTriggerRef}
                  className='settingsPreviewRemove wrenControl wrenControlDanger wrenControlLarge'
                  disabled={this.state.removing}
                  onClick={() => this.armAccountRemoval()}
                >
                  Remove account
                </button>
              </AccountActions>
            )}
          </Cluster>
        </div>
      </div>
    )
  }
}

export default Restore.connect(SettingsPreview)
