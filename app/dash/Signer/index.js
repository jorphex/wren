import React from 'react'
import Restore from 'react-restore'

import link from '../../../resources/link'
import DialogSurface from '../../../resources/Components/DialogSurface'
import Icon from '../../../resources/Components/Icon'
import AccountTypeMark from '../../../resources/Components/AccountTypeMark'
import { capitalize, getAddress } from '../../../resources/utils'
import { getSignerDisplayType, getSignerStatusMeta, isHardwareSigner } from '../../../resources/domain/signer'

import SignerStatus from './SignerStatus'
import ReloadSignerButton from './ReloadSignerButton'
import { compactAccountAddress } from '../Accounts/address'

// Command chrome, account heading, pager, and control shelf remain outside the ledger row budget.
const signerListReservedHeight = 392
const signerAddressRowHeight = 44
const minimumAddressLimit = 8
const maximumAddressLimit = 10
export function getAddressLimit(viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight) {
  const height = Number.isFinite(viewportHeight) ? viewportHeight : 900
  const usableListHeight = Math.max(0, height - signerListReservedHeight)
  const availableRows = Math.floor(usableListHeight / signerAddressRowHeight)

  return Math.max(minimumAddressLimit, Math.min(maximumAddressLimit, availableRows))
}

export class Signer extends React.Component {
  constructor(...args) {
    super(...args)

    this.state = {
      page: 0,
      addressLimit: getAddressLimit(),
      latticePairCode: '',
      latticePairError: '',
      latticePairPending: false,
      promptDismissalPending: false,
      removalArmed: false,
      removalPending: false,
      removalError: '',
      removalStatus: '',
      accountRemovalPending: '',
      accountRemovalError: '',
      accountRemovalStatus: ''
    }
    this.pending = { latticePair: false, pin: false, phrase: false, pairing: false }
    this.removePending = false
    this.mounted = true
    this.updateAddressLimit = this.updateAddressLimit.bind(this)
    this.signerRemovalTrigger = React.createRef()
    this.signerRemovalCancel = React.createRef()
  }

  componentDidMount() {
    window.addEventListener('resize', this.updateAddressLimit)
  }

  componentWillUnmount() {
    this.mounted = false
    window.removeEventListener('resize', this.updateAddressLimit)
  }

  armRemoval() {
    if (this.state.removalPending || this.state.removalArmed) return
    this.setState({ removalArmed: true, removalError: '', removalStatus: '' })
  }

  cancelRemoval() {
    if (!this.state.removalArmed || this.state.removalPending) return
    this.setState({ removalArmed: false, removalError: '', removalStatus: '' })
  }

  confirmRemoval() {
    if (this.removePending) return
    this.removePending = true
    this.setState({ removalPending: true, removalError: '', removalStatus: '' }, () => {
      link.rpc('removeSigner', this.props.id, (error, result) => {
        if (!error) {
          if (result?.status === 'deferred') {
            if (this.mounted) {
              this.setState({
                removalStatus: 'Removal is in progress. Wren will finish automatically.'
              })
            }
            return
          }
          link.send('tray:action', 'backDash')
          return
        }

        this.removePending = false
        if (this.mounted) {
          this.setState({
            removalPending: false,
            removalError: 'Couldn\u2019t remove signer. Try again.'
          })
        }
      })
    })
  }

  removeAccount(address) {
    if (this.state.accountRemovalPending) return
    this.setState({ accountRemovalPending: address, accountRemovalError: '', accountRemovalStatus: '' })
    link.rpc('removeAccount', address, {}, (error, result) => {
      if (!this.mounted) return
      this.setState({
        accountRemovalPending: result?.status === 'deferred' ? address : '',
        accountRemovalError: error ? 'Couldn\u2019t remove account. Try again.' : '',
        accountRemovalStatus:
          !error && result?.status === 'deferred'
            ? 'Account removal is in progress. Wren will finish automatically.'
            : ''
      })
    })
  }

  updateAddressLimit() {
    const addressLimit = getAddressLimit()
    if (addressLimit === this.state.addressLimit) return

    const signer = this.store('main.signers', this.props.id) || {}
    const addressCount = (signer.addresses || []).length
    const maxPage = Math.max(0, Math.ceil(addressCount / addressLimit) - 1)

    this.setState((state) => ({ addressLimit, page: Math.min(state.page, maxPage) }))
  }

  dismissHardwarePrompt() {
    if (!this.props.promptDismissible || this.state.promptDismissalPending) return
    this.setState({ promptDismissalPending: true })
    link.send('dash:dismissHardwarePrompt', this.props.id)
  }

  getStatusMeta() {
    return getSignerStatusMeta({ type: this.props.type, status: this.props.status })
  }

  statusText(Element = 'div') {
    const signerStatus = this.getStatusMeta()
    const classes = [
      'signerStatusText',
      signerStatus.tone === 'positive' ? 'signerStatusReady' : '',
      signerStatus.tone === 'warning' ? 'signerStatusWarning' : '',
      signerStatus.tone === 'danger' ? 'signerStatusDanger' : ''
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <Element className={classes} role='status'>
        {signerStatus.label}
      </Element>
    )
  }

  nextPage(backwards) {
    let page = backwards ? this.state.page - 1 : this.state.page + 1
    const signer = this.store('main.signers', this.props.id)
    const maxPage = Math.max(0, Math.ceil((signer.addresses || []).length / this.state.addressLimit) - 1)
    if (page > maxPage) page = maxPage
    if (page < 0) page = 0
    this.setState({ page })
  }

  pairToLattice() {
    if (!this.state.latticePairCode || this.pending.latticePair) return
    const code = this.state.latticePairCode
    this.pending.latticePair = true
    this.setState({ latticePairError: '', latticePairPending: true })
    link.rpc('latticePair', this.props.id, code, (err) => {
      this.pending.latticePair = false
      if (!this.mounted) return
      if (err) {
        this.setState({ latticePairError: err.message || String(err), latticePairPending: false })
      } else {
        this.setState({ latticePairCode: '', latticePairError: '', latticePairPending: false })
      }
    })
  }

  expand(id) {
    const crumb = {
      view: 'expandedSigner',
      data: { signer: id }
    }
    link.send('tray:action', 'navDash', crumb)
  }

  renderPreview() {
    const signer = this.store('main.signers', this.props.id)
    const signerStatus = this.getStatusMeta()

    const hwSigner = isHardwareSigner(this.props.type)

    // UI changes for this status only apply to hot signers
    const isLocked = !hwSigner && signerStatus.phase === 'locked'

    let signerClass = 'signer'
    if (signerStatus.ready) signerClass += ' signerOk'
    if (isLocked) signerClass += ' signerLocked'

    const addedAccounts = signer.addresses.filter((address) => {
      return Boolean(this.store('main.accounts', address.toLowerCase()))
    })
    const accountSummary = `${addedAccounts.length} active ${addedAccounts.length === 1 ? 'account' : 'accounts'}`

    const zIndex = 1000 - (this.props.index || 0)

    return (
      <button
        type='button'
        className={signerClass + ' cardShow'}
        style={{ zIndex }}
        aria-label={`Manage accounts for ${this.props.name || 'signer'}. ${signerStatus.label}. ${accountSummary}.`}
        onClick={() => this.expand(signer.id)}
      >
        <span className='signerDetails'>
          <span className='signerIcon'>
            {((_) => {
              const type = this.props.type
              if (type === 'ledger' || type === 'trezor' || type === 'lattice')
                return (
                  <span className='signerIconWrap signerIconHardware'>
                    <AccountTypeMark type={type} size={20} />
                  </span>
                )
              if (type === 'seed' || type === 'ring')
                return (
                  <span className='signerIconWrap signerIconHot'>
                    <AccountTypeMark type={type} size={20} />
                  </span>
                )
              return (
                <span className='signerIconWrap'>
                  <Icon name='hardware' size={20} />
                </span>
              )
            })()}
          </span>
          <span className='signerIdentity'>
            <span className='signerName'>{this.props.name}</span>
            <span className='signerPreviewMeta'>
              {this.statusText('span')}
              <span className='signerPreviewMetaSeparator' aria-hidden='true'>
                ·
              </span>
              <span className='signerPreviewAccountCount'>{accountSummary}</span>
            </span>
          </span>
        </span>
        <Icon name='next' size={14} />
      </button>
    )
  }

  renderSignerStatus() {
    const signer = this.store('main.signers', this.props.id)

    return <SignerStatus signer={signer} />
  }

  renderExpanded() {
    const { id, type, tag, index = 0 } = this.props
    const zIndex = 1000 - index

    if (this.props.authenticationOwnedByPrompt) {
      return (
        <section
          className='expandedSigner expandedSignerPromptOwned cardShow'
          style={{ zIndex }}
          aria-label={this.props.name}
        />
      )
    }

    const signer = this.store('main.signers', id)
    const { page, addressLimit } = this.state
    const startIndex = page * addressLimit

    const signerStatus = this.getStatusMeta()

    const hwSigner = isHardwareSigner(type)
    const canReload = signerStatus.reloadable

    // UI changes for this status only apply to hot signers
    const isLocked = !hwSigner && signerStatus.phase === 'locked'
    const permissionId = tag || tag === '' ? 'Frame' + (tag ? `-${tag}` : '') : undefined

    return (
      <section className={'expandedSigner cardShow'} style={{ zIndex }} aria-label={this.props.name}>
        {!signerStatus.ready ? this.statusText() : null}
        {isLocked ? (
          this.renderSignerStatus()
        ) : type === 'lattice' && signerStatus.input === 'pairingCode' ? (
          <div className='signerLatticePair'>
            <div className='signerLatticePairTitle'>Enter the pairing code shown on your Lattice.</div>
            <div className='signerLatticePairInput wrenInputGroup'>
              <input
                className='wrenInput'
                aria-label='GridPlus pairing code'
                autoFocus
                value={this.state.latticePairCode}
                disabled={this.state.latticePairPending}
                onChange={(e) =>
                  this.setState({
                    latticePairCode: (e.target.value || '').toUpperCase(),
                    latticePairError: ''
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    this.pairToLattice()
                  }
                }}
              />
            </div>
            {this.state.latticePairError ? (
              <div role='alert' className='signerLatticePairError'>
                {this.state.latticePairError}
              </div>
            ) : null}
            <button
              type='button'
              disabled={!this.state.latticePairCode || this.state.latticePairPending}
              onClick={() => this.pairToLattice()}
              className='signerLatticePairSubmit wrenControl wrenControlPrimary'
            >
              Pair
            </button>
          </div>
        ) : signerStatus.ready ? (
          <>
            {this.renderSignerStatus()}
            <div className='signerAddedAccountTitle'>{'Available accounts'}</div>
            <div className='signerAccounts'>
              {signer.addresses.slice(startIndex, startIndex + addressLimit).map((address, index) => {
                const added = this.store('main.accounts', address.toLowerCase())
                const checkSummedAddress = getAddress(address)
                return (
                  <button
                    type='button'
                    key={address}
                    aria-label={
                      added
                        ? `Remove ${checkSummedAddress} from accounts`
                        : `Add ${checkSummedAddress} as an account`
                    }
                    title={checkSummedAddress}
                    className={!added ? 'signerAccount' : 'signerAccount signerAccountAdded'}
                    disabled={Boolean(this.state.accountRemovalPending)}
                    onClick={() => {
                      if (this.store('main.accounts', address.toLowerCase())) {
                        this.removeAccount(address)
                      } else {
                        const type = getSignerDisplayType(signer)
                        link.rpc(
                          'createAccount',
                          address,
                          `${capitalize(type)} Account`,
                          { type: signer.type },
                          (e) => {
                            if (e) console.error(e)
                          }
                        )
                      }
                    }}
                  >
                    <div className='signerAccountIndex'>{index + 1 + startIndex}</div>
                    <div className='signerAccountAddress'>{compactAccountAddress(checkSummedAddress)}</div>
                    <div className='signerAccountCheck' />
                  </button>
                )
              })}
            </div>
            {this.state.accountRemovalError ? (
              <div className='signerAccountActionError' role='alert'>
                {this.state.accountRemovalError}
              </div>
            ) : null}
            {this.state.accountRemovalStatus ? (
              <div className='signerAccountActionStatus' role='status'>
                {this.state.accountRemovalStatus}
              </div>
            ) : null}
            {signer.addresses.length > addressLimit ? (
              <div className='signerBottom'>
                <button
                  type='button'
                  aria-label='Previous address page'
                  className='signerBottomPageBack wrenControl wrenControlGhost wrenControlIcon'
                  disabled={page === 0}
                  onClick={() => this.nextPage(true)}
                >
                  <Icon name='back' size={20} />
                </button>
                <div className='signerBottomPages'>
                  {page + 1 + ' / ' + Math.ceil(signer.addresses.length / addressLimit)}
                </div>
                <button
                  type='button'
                  aria-label='Next address page'
                  className='signerBottomPageNext wrenControl wrenControlGhost wrenControlIcon'
                  disabled={startIndex + addressLimit >= signer.addresses.length}
                  onClick={() => this.nextPage()}
                >
                  <Icon name='back' size={20} />
                </button>
              </div>
            ) : null}
          </>
        ) : signerStatus.busy ? (
          <div className='signerLoading'>
            <div className='signerLoadingLoader' />
          </div>
        ) : (
          <></>
        )}
        <div className='signerControls'>
          {permissionId ? (
            <div className='signerControlDetail'>
              <div className='signerControlDetailKey'>{'Lattice permission ID (legacy)'}</div>
              <div className='signerControlDetailValue'>{permissionId}</div>
            </div>
          ) : null}
          {canReload && <ReloadSignerButton id={id} status={this.props.status} type={type} />}
          {this.state.removalArmed ? (
            <DialogSurface
              className='signerRemovalConfirm'
              role='alertdialog'
              modal={false}
              labelledBy={`signer-removal-title-${id}`}
              describedBy={`signer-removal-description-${id}`}
              busy={this.state.removalPending}
              initialFocusRef={this.signerRemovalCancel}
              returnFocusRef={this.signerRemovalTrigger}
              onCancel={() => this.cancelRemoval()}
            >
              <div
                id={`signer-removal-title-${id}`}
                className='signerRemovalConfirmTitle'
                role='heading'
                aria-level='2'
              >
                Remove signer?
              </div>
              <div id={`signer-removal-description-${id}`} className='signerRemovalConfirmDescription'>
                {`This removes ${this.props.name || 'this signer'} and any accounts that no other signer can use.`}
              </div>
              {this.state.removalError ? (
                <div className='signerRemovalConfirmError' role='alert'>
                  {this.state.removalError}
                </div>
              ) : null}
              {this.state.removalStatus ? (
                <div className='signerRemovalConfirmStatus' role='status'>
                  {this.state.removalStatus}
                </div>
              ) : null}
              <div className='signerRemovalConfirmActions'>
                <button
                  ref={this.signerRemovalCancel}
                  type='button'
                  className='signerControlOption wrenControl wrenControlSecondary'
                  disabled={this.state.removalPending}
                  onClick={() => this.cancelRemoval()}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='signerControlOption signerControlOptionImportant wrenControl wrenControlDanger'
                  disabled={this.state.removalPending}
                  onClick={() => this.confirmRemoval()}
                >
                  {this.state.removalPending ? 'Removing signer\u2026' : 'Remove signer'}
                </button>
              </div>
            </DialogSurface>
          ) : (
            <button
              ref={this.signerRemovalTrigger}
              type='button'
              className='signerControlOption wrenControl wrenControlSecondary'
              disabled={this.state.removalPending}
              onClick={() => this.armRemoval()}
            >
              Remove signer
            </button>
          )}
        </div>
      </section>
    )
  }

  renderPrompt() {
    const signerStatus = this.getStatusMeta()
    const canDismiss = this.props.promptDismissible && !this.state.promptDismissalPending

    return (
      <div className='hardwareSignerPromptOverlay'>
        <DialogSurface
          className='hardwareSignerPromptSurface expandedSigner'
          ariaLabel={`${this.props.name || 'Hardware wallet'} authentication`}
          busy={signerStatus.busy}
          modal
          onCancel={canDismiss ? () => this.dismissHardwarePrompt() : undefined}
          cancelWhenBusy={this.props.promptDismissible}
        >
          <div className='hardwareSignerPromptHeader'>
            <div className='hardwareSignerPromptMark'>
              <AccountTypeMark type={this.props.type} size={20} />
            </div>
            <div className='hardwareSignerPromptIdentity'>
              <h2>{this.props.name || 'Hardware wallet'}</h2>
              {this.statusText()}
            </div>
          </div>
          <div className='hardwareSignerPromptBusy'>
            <div className='signerLoadingLoader' />
          </div>
          {this.props.promptDismissible ? (
            <button
              type='button'
              data-dialog-initial-focus
              className='hardwareSignerPromptDismiss wrenControl wrenControlSecondary'
              disabled={this.state.promptDismissalPending}
              onClick={() => this.dismissHardwarePrompt()}
            >
              Not now
            </button>
          ) : null}
        </DialogSurface>
      </div>
    )
  }

  render() {
    const { expanded, promptOnly } = this.props
    if (promptOnly) return this.renderPrompt()
    if (expanded) {
      return this.renderExpanded()
    } else {
      return this.renderPreview()
    }
  }
}

export default Restore.connect(Signer)
