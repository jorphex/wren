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
const maximumAddressLimit = 11
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
      tPin: '',
      tPinPending: false,
      tPhrase: '',
      tPhrasePending: false,
      tPairing: '',
      tPairingPending: false,
      removalArmed: false,
      removalPending: false
    }
    this.pending = { latticePair: false, pin: false, phrase: false, pairing: false }
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
    this.setState({ removalArmed: true })
  }

  cancelRemoval() {
    if (!this.state.removalArmed || this.state.removalPending) return
    this.setState({ removalArmed: false })
  }

  confirmRemoval() {
    if (this.state.removalPending) return
    this.setState({ removalPending: true }, () => {
      link.send('dash:removeSigner', this.props.id)
      link.send('tray:action', 'backDash')
    })
  }

  componentDidUpdate(previousProps) {
    if (previousProps.status !== this.props.status) {
      this.pending.pin = false
      this.pending.phrase = false
      this.pending.pairing = false
      if (this.state.tPinPending || this.state.tPhrasePending || this.state.tPairingPending) {
        this.setState({ tPinPending: false, tPhrasePending: false, tPairingPending: false })
      }
    } else if (previousProps.pinError !== this.props.pinError && this.state.tPinPending) {
      this.pending.pin = false
      this.setState({ tPinPending: false })
    }
  }

  updateAddressLimit() {
    const addressLimit = getAddressLimit()
    if (addressLimit === this.state.addressLimit) return

    const signer = this.store('main.signers', this.props.id) || {}
    const addressCount = (signer.addresses || []).length
    const maxPage = Math.max(0, Math.ceil(addressCount / addressLimit) - 1)

    this.setState((state) => ({ addressLimit, page: Math.min(state.page, maxPage) }))
  }

  backspacePin(e) {
    e.stopPropagation()
    this.setState({ tPin: this.state.tPin ? this.state.tPin.slice(0, -1) : '' })
  }

  trezorPin(num) {
    this.setState({ tPin: this.state.tPin + num.toString() })
  }

  submitPin() {
    if (!this.state.tPin || this.pending.pin) return
    const pin = this.state.tPin
    this.pending.pin = true
    this.setState({ tPin: '', tPinPending: true })
    link.rpc('trezorPin', this.props.id, pin, () => {})
  }

  submitPhrase() {
    if (this.pending.phrase) return
    const phrase = this.state.tPhrase || ''
    this.pending.phrase = true
    this.setState({ tPhrase: '', tPhrasePending: true })
    link.rpc('trezorPhrase', this.props.id, phrase, () => {})
  }

  submitPhraseOnDevice() {
    if (this.pending.phrase) return
    this.pending.phrase = true
    this.setState({ tPhrase: '', tPhrasePending: true })
    link.rpc('trezorEnterPhrase', this.props.id, () => {})
  }

  submitPairing() {
    if (!this.state.tPairing || this.pending.pairing) return
    const pairing = this.state.tPairing
    this.pending.pairing = true
    this.setState({ tPairing: '', tPairingPending: true })
    link.rpc('trezorPairing', this.props.id, { tag: pairing }, () => {})
  }

  renderTrezorPin(active) {
    return (
      <div className='trezorPinWrap' style={active ? {} : { height: '0px', padding: '0px 0px 0px 0px' }}>
        {active ? (
          <>
            <div className='trezorPinHeading'>
              <h3>Enter PIN</h3>
              <p>
                On your Trezor, find each PIN digit in the scrambled matrix, then select its matching position
                here.
              </p>
            </div>
            {this.props.pinError ? (
              <div role='alert' className='trezorPinError'>
                {this.props.pinError}
              </div>
            ) : null}
            <div
              className='trezorPinEntryStatus'
              role='status'
              aria-label={`${this.state.tPin.length} PIN positions entered`}
            >
              <span>{`${this.state.tPin.length} ${this.state.tPin.length === 1 ? 'position' : 'positions'} selected`}</span>
              <span className='trezorPinEntryDots' aria-hidden='true'>
                {this.state.tPin.split('').map((n, i) => (
                  <span key={i} className='signerPinDot' />
                ))}
              </span>
            </div>
            <div className='trezorPinInputWrap'>
              <div className='trezorPinInput'>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                  <button
                    type='button'
                    aria-label={`PIN position ${i}`}
                    key={i}
                    className='trezorPinInputButton'
                    disabled={this.state.tPinPending}
                    onClick={this.trezorPin.bind(this, i)}
                  >
                    <span className='signerPinDot' />
                  </button>
                ))}
              </div>
            </div>
            <div className='signerPinActions'>
              {this.state.tPin ? (
                <button
                  type='button'
                  aria-label='Delete last PIN position'
                  className='signerPinDelete wrenControl wrenControlSecondary wrenControlIcon'
                  onClick={this.backspacePin.bind(this)}
                >
                  <Icon name='back' size={18} />
                </button>
              ) : null}
              <button
                type='button'
                className='signerPinMessage signerPinSubmit wrenControl wrenControlPrimary'
                disabled={!this.state.tPin || this.state.tPinPending}
                onClick={() => this.submitPin()}
              >
                Submit PIN
              </button>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  phraseKeyPress(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.submitPhrase()
    }
  }

  renderTrezorPhrase(active) {
    const allowsDeviceEntry = (this.props.capabilities || []).includes('Capability_PassphraseEntry')

    return (
      <div className='trezorPinWrap' style={active ? {} : { height: '0px', padding: '0px 0px 0px 0px' }}>
        {active ? (
          <>
            <div className='trezorPhraseInput wrenInputGroup'>
              <input
                className='wrenInput'
                aria-label='Trezor passphrase'
                type='password'
                value={this.state.tPhrase}
                disabled={this.state.tPhrasePending}
                onChange={(e) => this.setState({ tPhrase: e.target.value })}
                onKeyDown={(e) => this.phraseKeyPress(e)}
                autoFocus
              />
            </div>
            <button
              type='button'
              className='signerPinMessage signerPinSubmit wrenControl wrenControlPrimary'
              disabled={this.state.tPhrasePending}
              onClick={() => this.submitPhrase()}
            >
              Submit passphrase
            </button>
            {allowsDeviceEntry ? (
              <>
                <div className='signerPinMessageOr'>{'or'}</div>
                <button
                  type='button'
                  className='signerPinMessage signerPinSubmit wrenControl wrenControlSecondary'
                  disabled={this.state.tPhrasePending}
                  onClick={() => this.submitPhraseOnDevice()}
                >
                  Enter passphrase on device
                </button>
              </>
            ) : (
              <></>
            )}
          </>
        ) : null}
      </div>
    )
  }

  renderTrezorPairing(active) {
    const pairing = this.props.pairing || {}
    const isCodeEntry = pairing.selectedMethod === 'CodeEntry' || pairing.selectedMethod === 2
    const title = isCodeEntry
      ? 'Enter the 6-character pairing code shown on your Trezor.'
      : 'Enter the pairing tag shown on your Trezor.'

    return (
      <div className='trezorPinWrap' style={active ? {} : { height: '0px', padding: '0px 0px 0px 0px' }}>
        {active ? (
          <>
            <div className='signerLatticePairTitle'>{title}</div>
            <div className='trezorPhraseInput wrenInputGroup'>
              <input
                className='wrenInput'
                aria-label='Trezor pairing code'
                type='text'
                autoFocus
                maxLength={isCodeEntry ? 6 : undefined}
                value={this.state.tPairing}
                disabled={this.state.tPairingPending}
                onChange={(e) => this.setState({ tPairing: (e.target.value || '').trim().toUpperCase() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    this.submitPairing()
                  }
                }}
              />
            </div>
            <button
              type='button'
              className='signerPinMessage signerPinSubmit wrenControl wrenControlPrimary'
              disabled={!this.state.tPairing || this.state.tPairingPending}
              onClick={() => this.submitPairing()}
            >
              Submit pairing code
            </button>
          </>
        ) : null}
      </div>
    )
  }

  getStatusMeta() {
    return getSignerStatusMeta({ type: this.props.type, status: this.props.status })
  }

  statusText() {
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
      <div className={classes} role='status'>
        {signerStatus.label}
      </div>
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

    const zIndex = 1000 - (this.props.index || 0)

    return (
      <section className={signerClass + ' cardShow'} style={{ zIndex }} aria-label={this.props.name}>
        <div className='signerTop'>
          <div className='signerDetails'>
            <div className='signerIcon'>
              {((_) => {
                const type = this.props.type
                if (type === 'ledger' || type === 'trezor' || type === 'lattice')
                  return (
                    <div className='signerIconWrap signerIconHardware'>
                      <AccountTypeMark type={type} size={20} />
                    </div>
                  )
                if (type === 'seed' || type === 'ring')
                  return (
                    <div className='signerIconWrap signerIconHot'>
                      <AccountTypeMark type={type} size={20} />
                    </div>
                  )
                return (
                  <div className='signerIconWrap'>
                    <Icon name='hardware' size={20} />
                  </div>
                )
              })()}
            </div>
            {/* <div className='signerType' style={this.props.inSetup ? {top: '21px'} : {top: '24px'}}>{this.props.model}</div> */}
            <div className='signerIdentity'>
              <h2 className='signerName'>{this.props.name}</h2>
              {this.statusText()}
            </div>
          </div>
          <button
            type='button'
            aria-label={`Open ${this.props.name || 'signer'} details`}
            className='signerExpand wrenControl wrenControlGhost wrenControlIcon'
            onClick={() => this.expand(signer.id)}
          >
            <Icon name='details' size={14} />
          </button>
        </div>
        {signerStatus.ready || isLocked ? (
          <div className='signerPreviewSummary'>
            <div className='signerPreviewAccountCount'>
              {`${addedAccounts.length} active ${addedAccounts.length === 1 ? 'account' : 'accounts'}`}
            </div>
            <button
              type='button'
              className='signerPreviewManage wrenControl wrenControlGhost'
              onClick={() => this.expand(signer.id)}
            >
              Manage accounts
            </button>
          </div>
        ) : signerStatus.busy ? (
          <div className='signerLoading'>
            <div className='signerLoadingLoader' />
          </div>
        ) : (
          <></>
        )}
      </section>
    )
  }

  renderSignerStatus() {
    const signer = this.store('main.signers', this.props.id)

    return <SignerStatus signer={signer} />
  }

  renderExpanded() {
    const { id, type, tag, index = 0 } = this.props
    const signer = this.store('main.signers', id)
    const { page, addressLimit } = this.state
    const startIndex = page * addressLimit

    const signerStatus = this.getStatusMeta()

    const hwSigner = isHardwareSigner(type)
    const canReload = signerStatus.reloadable

    // UI changes for this status only apply to hot signers
    const isLocked = !hwSigner && signerStatus.phase === 'locked'
    const permissionId = tag || tag === '' ? 'Frame' + (tag ? `-${tag}` : '') : undefined

    const zIndex = 1000 - index

    return (
      <section className={'expandedSigner cardShow'} style={{ zIndex }} aria-label={this.props.name}>
        {!signerStatus.ready ? this.statusText() : null}
        {type === 'lattice' && signerStatus.input === 'pairingCode' ? (
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
        ) : signerStatus.ready || isLocked ? (
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
                    onClick={() => {
                      if (this.store('main.accounts', address.toLowerCase())) {
                        link.rpc('removeAccount', address, {}, () => {})
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
        ) : type === 'trezor' && signerStatus.input ? (
          <div className='signerInterface'>
            {this.renderTrezorPin(signerStatus.input === 'pin')}
            {this.renderTrezorPhrase(signerStatus.input === 'passphrase')}
            {this.renderTrezorPairing(signerStatus.input === 'pairingCode')}
          </div>
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
                {`This removes ${this.props.name || 'this signer'} from Wren. Accounts using it become watch-only.`}
              </div>
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
                  Remove signer
                </button>
              </div>
            </DialogSurface>
          ) : (
            <button
              ref={this.signerRemovalTrigger}
              type='button'
              className='signerControlOption wrenControl wrenControlGhost'
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

    return (
      <div className='hardwareSignerPromptOverlay'>
        <DialogSurface
          className='hardwareSignerPromptSurface expandedSigner'
          ariaLabel={`${this.props.name || 'Hardware wallet'} authentication`}
          busy={signerStatus.busy}
          modal
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
          {signerStatus.input ? (
            <div className='signerInterface'>
              {this.renderTrezorPin(signerStatus.input === 'pin')}
              {this.renderTrezorPhrase(signerStatus.input === 'passphrase')}
              {this.renderTrezorPairing(signerStatus.input === 'pairingCode')}
            </div>
          ) : (
            <div className='hardwareSignerPromptBusy'>
              <div className='signerLoadingLoader' />
            </div>
          )}
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
