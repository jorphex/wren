import React from 'react'
import Restore from 'react-restore'

import link from '../../../resources/link'
import Icon from '../../../resources/Components/Icon'
import svg from '../../../resources/svg'
import { capitalize, getAddress } from '../../../resources/utils'
import { isHardwareSigner, getSignerDisplayType } from '../../../resources/domain/signer'

import SignerStatus from './SignerStatus'
import ReloadSignerButton from './ReloadSignerButton'

function isLoading(status = '') {
  const statusToCheck = status.toLowerCase()
  return ['loading', 'connecting', 'addresses', 'input', 'pairing'].some((s) => statusToCheck.includes(s))
}

export class Signer extends React.Component {
  constructor(...args) {
    super(...args)

    this.state = {
      page: 0,
      addressLimit: 5,
      latticePairCode: '',
      tPin: '',
      tPhrase: '',
      tPairing: ''
    }
  }

  backspacePin(e) {
    e.stopPropagation()
    this.setState({ tPin: this.state.tPin ? this.state.tPin.slice(0, -1) : '' })
  }

  trezorPin(num) {
    this.setState({ tPin: this.state.tPin + num.toString() })
  }

  submitPin() {
    link.rpc('trezorPin', this.props.id, this.state.tPin, () => {})
    this.setState({ tPin: '' })
  }

  submitPhrase() {
    this.setState({ tPhrase: '' })
    link.rpc('trezorPhrase', this.props.id, this.state.tPhrase || '', () => {})
  }

  submitPairing() {
    this.setState({ tPairing: '' })
    link.rpc('trezorPairing', this.props.id, { tag: this.state.tPairing || '' }, () => {})
  }

  renderLoadingLive() {
    if (this.props.type === 'ledger' && this.getStatus() === 'deriving live addresses') {
      const liveAccountLimit = this.store('main.ledger.liveAccountLimit')
      const styleWidth = liveAccountLimit === 20 ? 120 : liveAccountLimit === 40 ? 120 : 60
      const marginTop = liveAccountLimit === 40 ? -8 : 0
      return (
        <div
          className='loadingLiveAddresses'
          style={{ top: `${marginTop}px`, padding: '20px', width: `${styleWidth}px` }}
        >
          {[...Array(liveAccountLimit).keys()]
            .map((i) => i + 1)
            .map((i) => {
              return (
                <div
                  key={'loadingLiveAddress' + i}
                  className='loadingLiveAddress'
                  style={{ opacity: i <= this.props.liveAddressesFound ? '1' : '0.3' }}
                />
              )
            })}
        </div>
      )
    } else {
      return null
    }
  }

  renderTrezorPin(active) {
    return (
      <div className='trezorPinWrap' style={active ? {} : { height: '0px', padding: '0px 0px 0px 0px' }}>
        {active ? (
          <>
            {this.props.pinError ? <div className='trezorPinError'>{this.props.pinError}</div> : null}
            <div
              className='trezorPhraseInput'
              role='status'
              aria-label={`${this.state.tPin.length} PIN positions entered`}
            >
              {this.state.tPin.split('').map((n, i) => {
                return (
                  <span key={i} className='trezorPinInputButton' aria-hidden='true'>
                    <span className='signerPinDot' />
                  </span>
                )
              })}
            </div>
            <div className='signerPinActions'>
              <button
                type='button'
                className='signerPinMessage signerPinSubmit'
                disabled={!this.state.tPin}
                onClick={() => this.submitPin()}
              >
                Submit PIN
              </button>
              {this.state.tPin ? (
                <button
                  type='button'
                  aria-label='Delete last PIN position'
                  className='signerPinDelete'
                  onClick={this.backspacePin.bind(this)}
                >
                  <Icon name='back' size={18} />
                </button>
              ) : null}
            </div>
            <div className='trezorPinInputWrap'>
              <div className='trezorPinInput'>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                  <button
                    type='button'
                    aria-label={`PIN position ${i}`}
                    key={i}
                    className='trezorPinInputButton'
                    onClick={this.trezorPin.bind(this, i)}
                  >
                    <span className='signerPinDot' />
                  </button>
                ))}
              </div>
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
            <div className='trezorPhraseInput'>
              <input
                type='password'
                onChange={(e) => this.setState({ tPhrase: e.target.value })}
                onKeyPress={(e) => this.phraseKeyPress(e)}
                autoFocus
              />
            </div>
            <button
              type='button'
              className='signerPinMessage signerPinSubmit'
              onClick={() => this.submitPhrase()}
            >
              Submit Passphrase
            </button>
            {allowsDeviceEntry ? (
              <>
                <div className='signerPinMessageOr'>{'or'}</div>
                <button
                  type='button'
                  className='signerPinMessage signerPinSubmit'
                  onClick={() => link.rpc('trezorEnterPhrase', this.props.id, () => {})}
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
      ? 'Enter the 6-character pairing code shown on your Trezor'
      : 'Enter the pairing tag shown on your Trezor'

    return (
      <div className='trezorPinWrap' style={active ? {} : { height: '0px', padding: '0px 0px 0px 0px' }}>
        {active ? (
          <>
            <div className='signerLatticePairTitle'>{title}</div>
            <div className='trezorPhraseInput'>
              <input
                type='text'
                autoFocus
                maxLength={isCodeEntry ? 6 : undefined}
                value={this.state.tPairing}
                onChange={(e) => this.setState({ tPairing: (e.target.value || '').trim().toUpperCase() })}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    this.submitPairing()
                  }
                }}
              />
            </div>
            <button
              type='button'
              className='signerPinMessage signerPinSubmit'
              disabled={!this.state.tPairing}
              onClick={() => this.submitPairing()}
            >
              Submit Pairing Code
            </button>
          </>
        ) : null}
      </div>
    )
  }

  getStatus() {
    return (this.props.status || '').toLowerCase()
  }

  status() {
    const status = this.getStatus()

    if (status === 'ok') {
      return (
        <div className='signerStatus'>
          <div className='signerStatusIndicator signerStatusIndicatorReady'></div>
        </div>
      )
    } else if (status === 'locked') {
      return (
        <div className='signerStatus'>
          <div className='signerStatusIndicator signerStatusIndicatorLocked'></div>
        </div>
      )
    } else {
      return (
        <div className='signerStatus'>
          <div className='signerStatusIndicator'></div>
        </div>
      )
    }
  }

  statusText() {
    const status = this.getStatus()

    if (status === 'ok') {
      return <div className='signerStatusText signerStatusReady'>{'ready to sign'}</div>
    } else if (status === 'locked') {
      const hwSigner = isHardwareSigner(this.props.type)
      const lockText = hwSigner ? 'Please unlock your ' + this.props.type : 'locked'

      const classes = hwSigner ? 'signerStatusText' : 'signerStatusText signerStatusIssue'
      return <div className={classes}>{lockText}</div>
    } else if (status === 'addresses') {
      return <div className='signerStatusText'>{'deriving addresses'}</div>
    } else {
      return <div className='signerStatusText'>{this.props.status}</div>
    }
  }

  nextPage(backwards) {
    let page = backwards ? this.state.page - 1 : this.state.page + 1
    const signer = this.store('main.signers', this.props.id)
    const maxPage = Math.ceil(signer.addresses.length / this.state.addressLimit) - 1
    if (page > maxPage) page = maxPage
    if (page < 0) page = 0
    this.setState({ page })
  }

  pairToLattice() {
    link.rpc('latticePair', this.props.id, this.state.latticePairCode, () => {})

    this.setState({ latticePairCode: '' })
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
    const status = this.getStatus()

    const hwSigner = isHardwareSigner(this.props.type)
    const loading = isLoading(status)

    // TODO: create well-defined signer states that drive these UI features
    // const canReconnect =
    //   this.props.type !== 'trezor' || status === 'disconnected' || status.includes('reconnect')

    // UI changes for this status only apply to hot signers
    const isLocked = !hwSigner && status === 'locked'

    let signerClass = 'signer'
    if (status === 'ok') signerClass += ' signerOk'
    if (isLocked) signerClass += ' signerLocked'

    const addedAccounts = signer.addresses.filter((address) => {
      return Boolean(this.store('main.accounts', address.toLowerCase()))
    })

    const zIndex = 1000 - this.props.index

    return (
      <div className={signerClass + ' cardShow'} style={{ zIndex }}>
        <div className='signerTop'>
          <div className='signerDetails'>
            <div className='signerIcon'>
              {((_) => {
                const type = this.props.type
                if (type === 'ledger')
                  return <div className='signerIconWrap signerIconHardware'>{svg.ledger(20)}</div>
                if (type === 'trezor')
                  return <div className='signerIconWrap signerIconHardware'>{svg.trezor(20)}</div>
                if (type === 'seed' || type === 'ring')
                  return (
                    <div className='signerIconWrap signerIconHot'>
                      <Icon name='hot' size={23} />
                    </div>
                  )
                if (type === 'lattice')
                  return <div className='signerIconWrap signerIconSmart'>{svg.lattice(22)}</div>
                return (
                  <div className='signerIconWrap'>
                    <Icon name='hardware' size={20} />
                  </div>
                )
              })()}
            </div>
            {/* <div className='signerType' style={this.props.inSetup ? {top: '21px'} : {top: '24px'}}>{this.props.model}</div> */}
            <div className='signerName'>{this.props.name}</div>
          </div>
          <button
            type='button'
            aria-label={`Open ${this.props.name || 'signer'} details`}
            className='signerExpand'
            onClick={() => this.expand(signer.id)}
          >
            <Icon name='details' size={14} />
          </button>
          {/* {this.status()} */}
        </div>
        {this.statusText()}
        {status === 'ok' || isLocked ? (
          <>
            <div className='signerAddedAccountTitle'>
              {addedAccounts.length ? 'active accounts' : 'no active accounts'}
            </div>
            <div className='signerAccounts'>
              {addedAccounts.length ? (
                addedAccounts.map((address) => {
                  const index = signer.addresses.indexOf(address) + 1
                  const checkSummedAddress = getAddress(address)
                  return (
                    <div
                      key={address}
                      className={'signerAccount signerAccountAdded signerAccountDisabled'}
                      onClick={() => {
                        // if (this.store('main.accounts', address.toLowerCase())) {
                        //   link.rpc('removeAccount', address, {}, () => { })
                        // } else {
                        //   link.rpc('createAccount', address, { type: signer.type }, (e) => {
                        //     if (e) console.error(e)
                        //   })
                        // }
                      }}
                    >
                      <div className='signerAccountIndex'>{index}</div>
                      <div className='signerAccountAddress'>
                        {checkSummedAddress.substr(0, 11)} <Icon name='ellipsis' size={20} />{' '}
                        {checkSummedAddress.substr(address.length - 10)}
                      </div>
                      <div className='signerAccountCheck' />
                    </div>
                  )
                })
              ) : (
                <button type='button' className='signerAccountsAdd' onClick={() => this.expand(signer.id)}>
                  {'View available accounts'}
                </button>
              )}
            </div>
          </>
        ) : loading ? (
          <div className='signerLoading'>
            <div className='signerLoadingLoader' />
          </div>
        ) : (
          <></>
        )}
      </div>
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

    const status = this.getStatus()

    const hwSigner = isHardwareSigner(type)
    const loading = isLoading(status)

    // TODO: create well-defined signer states that drive these UI features
    const canReconnect =
      hwSigner && (type !== 'trezor' || status === 'disconnected' || status.includes('reconnect'))

    // UI changes for this status only apply to hot signers
    const isLocked = !hwSigner && status === 'locked'
    const permissionId = tag || tag === '' ? 'Frame' + (tag ? `-${tag}` : '') : undefined

    const zIndex = 1000 - index

    return (
      <div className={'expandedSigner cardShow'} style={{ zIndex }}>
        {<div style={{ height: '22px' }} />}
        {this.statusText()}
        {type === 'lattice' && status === 'pair' ? (
          <div className='signerLatticePair'>
            <div className='signerLatticePairTitle'>Please input your Lattice&apos;s pairing code</div>
            <div className='signerLatticePairInput'>
              <input
                autoFocus
                tabIndex='1'
                value={this.state.latticePairCode}
                onChange={(e) => this.setState({ latticePairCode: (e.target.value || '').toUpperCase() })}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') this.pairToLattice()
                }}
              />
            </div>
            <button type='button' onClick={() => this.pairToLattice()} className='signerLatticePairSubmit'>
              Pair
            </button>
          </div>
        ) : status === 'ok' || isLocked ? (
          <>
            {this.renderSignerStatus()}
            <div className='signerAddedAccountTitle'>{'available accounts'}</div>
            <div className='signerAccounts'>
              {signer.addresses.slice(startIndex, startIndex + addressLimit).map((address, index) => {
                const added = this.store('main.accounts', address.toLowerCase())
                const checkSummedAddress = getAddress(address)
                return (
                  <button
                    type='button'
                    key={address}
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
                    <div className='signerAccountAddress'>
                      {checkSummedAddress.substr(0, 11)} <Icon name='ellipsis' size={20} />{' '}
                      {checkSummedAddress.substr(address.length - 10)}
                    </div>
                    <div className='signerAccountCheck' />
                  </button>
                )
              })}
            </div>
            <div className='signerBottom'>
              <button
                type='button'
                aria-label='Previous address page'
                className='signerBottomPageBack'
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
                className='signerBottomPageNext'
                disabled={startIndex + addressLimit >= signer.addresses.length}
                onClick={() => this.nextPage()}
              >
                <Icon name='back' size={20} />
              </button>
            </div>
          </>
        ) : type === 'trezor' &&
          (status === 'need pin' || status === 'enter passphrase' || status === 'need pairing code') ? (
          <div className='signerInterface'>
            {this.renderTrezorPin(this.props.type === 'trezor' && status === 'need pin')}
            {this.renderTrezorPhrase(this.props.type === 'trezor' && status === 'enter passphrase')}
            {this.renderTrezorPairing(this.props.type === 'trezor' && status === 'need pairing code')}
          </div>
        ) : loading ? (
          <div className='signerLoading'>
            <div className='signerLoadingLoader' />
          </div>
        ) : (
          <></>
        )}
        <div className='signerControls'>
          {permissionId ? (
            <div className='signerControlDetail'>
              <div className='signerControlDetailKey'>{'LATTICE PERMISSION ID (LEGACY):'}</div>
              <div className='signerControlDetailValue'>{permissionId}</div>
            </div>
          ) : null}
          {canReconnect && <ReloadSignerButton id={id} />}
          <button
            type='button'
            className='signerControlOption signerControlOptionImportant'
            onClick={() => {
              link.send('dash:removeSigner', id)
              link.send('tray:action', 'backDash')
            }}
          >
            Remove Signer
          </button>
        </div>
      </div>
    )
  }

  render() {
    const { expanded } = this.props
    if (expanded) {
      return this.renderExpanded()
    } else {
      return this.renderPreview()
    }
  }
}

export default Restore.connect(Signer)
