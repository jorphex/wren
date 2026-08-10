import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

import BigNumber from 'bignumber.js'
import { usesBaseFee } from '../../../resources/domain/transaction'

import Confirm from '../../../resources/Components/Confirm'
import wrenIcon from '../../../asset/WrenIcon.png'
import { WREN_LICENSE_URL, WREN_SUPPORT_URL } from '../../../resources/constants'

const FEE_WARNING_THRESHOLD_USD = 50
const capitalize = (s) => s[0].toUpperCase() + s.slice(1)

export class Notify extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = { approvalPending: false, approvalError: false }
    this.dialogRef = React.createRef()
    this.activeDialog = null
    this.previousFocus = null
    this.approvalInFlight = false
  }

  componentDidMount() {
    this.syncDialogFocus()
  }

  componentDidUpdate() {
    this.syncDialogFocus()
  }

  componentWillUnmount() {
    this.previousFocus?.focus?.()
  }

  approveRequest(req, onSuccess) {
    if (this.approvalInFlight) return

    this.approvalInFlight = true
    this.setState({ approvalPending: true, approvalError: false })
    link.rpc('approveRequest', req, (error) => {
      if (error) {
        this.approvalInFlight = false
        this.setState({ approvalPending: false, approvalError: true })
        return
      }

      onSuccess()
    })
  }

  syncDialogFocus() {
    const dialog = this.dialogRef.current

    if (dialog && dialog !== this.activeDialog) {
      this.previousFocus = document.activeElement
      this.activeDialog = dialog
      const firstControl =
        dialog.querySelector('[data-dialog-initial-focus]') ||
        dialog.querySelector('button:not(:disabled), a[href], [tabindex="0"]')
      ;(firstControl || dialog).focus()
    } else if (!dialog && this.activeDialog) {
      this.activeDialog = null
      this.previousFocus?.focus?.()
      this.previousFocus = null
      this.approvalInFlight = false
      if (this.state.approvalPending || this.state.approvalError) {
        this.setState({ approvalPending: false, approvalError: false })
      }
    }
  }

  handleDialogKeyDown(event, dismissible) {
    if (event.key === 'Escape' && dismissible && !this.approvalInFlight) {
      event.preventDefault()
      link.send('tray:action', 'backDash')
      return
    }

    if (event.key !== 'Tab' || !this.dialogRef.current) return

    const focusable = Array.from(
      this.dialogRef.current.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')
    )
    if (!focusable.length) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  renderDialog(content, dismissible = true, ariaLabel) {
    return (
      <div
        ref={this.dialogRef}
        className='notify cardShow'
        role='dialog'
        aria-modal='true'
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : 'wren-dash-notify-title'}
        tabIndex={-1}
        onKeyDown={(event) => this.handleDialogKeyDown(event, dismissible)}
        onMouseDown={
          dismissible
            ? () => {
                if (!this.approvalInFlight) link.send('tray:action', 'backDash')
              }
            : undefined
        }
      >
        {content}
      </div>
    )
  }

  betaDisclosure() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBoxSlide'>
          <div className='notifyBox'>
            <div className='notifyWrenIcon'>
              <img alt='' aria-hidden='true' src={wrenIcon} />
            </div>
            <div id='wren-dash-notify-title' className='notifyTitle'>
              Wren preview
            </div>
            <div className='notifyBody'>
              <div className='notifyBodyBlock notifyBodyBlockBig'>
                Wren is independently maintained and built from the original Frame project.
              </div>
              <div className='notifyBodyBlock'>
                Back up your profile, verify release checksums, and test with accounts that hold no valuable
                assets before relying on Wren.
              </div>
              <div className='notifyBodyBlock'>
                Use hardware signers for high-value accounts. Verify every transaction and account detail on
                the signing device.
              </div>
              <div className='notifyBodyBlock'>
                <span>Read</span>
                <button
                  type='button'
                  className='notifyBodyLink'
                  onClick={() => {
                    link.send('tray:openExternal', WREN_LICENSE_URL)
                  }}
                >
                  our license
                </button>
                <span>before using Wren at your own risk.</span>
              </div>
              <div className='notifyBodyBlock notifyBodyBlockBig'>
                <div>Need help or found a problem? Open a GitHub issue.</div>
                <button
                  type='button'
                  className='notifyBodyLink'
                  style={{ marginTop: '20px' }}
                  onClick={() => {
                    link.send('tray:openExternal', WREN_SUPPORT_URL)
                  }}
                >
                  Open GitHub issue
                </button>
              </div>
            </div>
            <div className='notifyInput'>
              <button
                type='button'
                className='notifyInputOption notifyInputSingleButton'
                data-dialog-initial-focus
                onClick={() => {
                  link.send('tray:action', 'muteBetaDisclosure')
                  link.send('tray:action', 'backDash')
                }}
              >
                <div className='notifyInputOptionText notifyBetaGo'>Continue</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  gasFeeWarning({ req = {}, feeUSD = '0.00', currentSymbol = 'ETH' }) {
    const { approvalPending, approvalError } = this.state

    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            High network fee
          </div>
          <div className='notifyBody'>
            {feeUSD !== '0.00' ? (
              <>
                <div className='notifyBodyLine'>The maximum network fee is:</div>
                <div className='notifyBodyLine notifyBodyPrice'>{`≈ $${feeUSD} in ${currentSymbol}`}</div>
              </>
            ) : (
              <div className='notifyBodyLine'>
                Wren could not estimate this transaction&apos;s fee in USD.
              </div>
            )}
            <div className='notifyBodyQuestion'>Are you sure you want to proceed?</div>
            {approvalError ? (
              <div className='notifyBodyLine' role='alert'>
                Couldn’t approve this request. It’s still pending.
              </div>
            ) : null}
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
              data-dialog-initial-focus
              disabled={approvalPending}
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed'
              disabled={approvalPending}
              onClick={() => this.approveRequest(req, () => link.send('tray:action', 'backDash'))}
            >
              <div className='notifyInputOptionText'>{approvalError ? 'Retry' : 'Proceed'}</div>
            </button>
          </div>
          <button
            type='button'
            aria-pressed={this.store('main.mute.gasFeeWarning')}
            className='notifyCheck'
            disabled={approvalPending}
            onClick={() => link.send('tray:action', 'toggleGasFeeWarning')}
          >
            <div className='notifyCheckBox'>
              {this.store('main.mute.gasFeeWarning') ? <Icon name='check' size={26} /> : null}
            </div>
            <div className='notifyCheckText'>{"Don't show this warning again"}</div>
          </button>
        </div>
      </div>
    )
  }

  signerUnavailableWarning() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            Signer unavailable
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyQuestion'>Check the signer for this account, then try again.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  noSignerWarning() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            No signer attached
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>This account does not have a signer.</div>
            <div className='notifyBodyQuestion'>Attach a signer before submitting a signature.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  toDisplayUSD(bn) {
    return bn.toFixed(2, BigNumber.ROUND_UP).toString()
  }

  signerCompatibilityWarning({ req = {}, compatibility = {}, chain = {} }) {
    const { signer, tx } = compatibility
    const { approvalPending, approvalError } = this.state
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            Signer compatibility
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              {`Your ${capitalize(signer)} cannot sign ${capitalize(tx)} ${
                tx === 'london' ? '(EIP-1559) ' : ''
              }transactions. Wren will convert this request to a legacy transaction before signing.`}
            </div>
            {['lattice', 'ledger'].includes(signer) ? (
              <div className='notifyBodyUpdate'>
                {`Check for a ${capitalize(signer)} update that supports this transaction type.`}
              </div>
            ) : null}
            <div className='notifyBodyQuestion'>Do you want to proceed?</div>
            {approvalError ? (
              <div className='notifyBodyLine' role='alert'>
                Couldn’t approve this request. It’s still pending.
              </div>
            ) : null}
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
              data-dialog-initial-focus
              disabled={approvalPending}
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed'
              disabled={approvalPending}
              onClick={() => {
                // TODO: Transacionns need a better flow to respond to mutiple notifications after hitting sign
                const isTestnet = this.store('main.networks', chain.type, chain.id, 'isTestnet')
                const {
                  nativeCurrency,
                  nativeCurrency: { symbol: currentSymbol = '?' }
                } = this.store('main.networksMeta', chain.type, chain.id)
                const nativeUSD =
                  nativeCurrency && nativeCurrency.usd && !isTestnet ? nativeCurrency.usd.price : 0

                let maxFeePerGas, maxFee, maxFeeUSD

                if (usesBaseFee(req.data)) {
                  const gasLimit = BigNumber(req.data.gasLimit, 16)
                  maxFeePerGas = BigNumber(req.data.maxFeePerGas, 16)
                  maxFee = maxFeePerGas.multipliedBy(gasLimit)
                  maxFeeUSD = maxFee.shiftedBy(-18).multipliedBy(nativeUSD)
                } else {
                  const gasLimit = BigNumber(req.data.gasLimit, 16)
                  maxFeePerGas = BigNumber(req.data.gasPrice, 16)
                  maxFee = maxFeePerGas.multipliedBy(gasLimit)
                  maxFeeUSD = maxFee.shiftedBy(-18).multipliedBy(nativeUSD)
                }

                if (
                  (maxFeeUSD.toNumber() > FEE_WARNING_THRESHOLD_USD ||
                    this.toDisplayUSD(maxFeeUSD) === '0.00') &&
                  !this.store('main.mute.gasFeeWarning')
                ) {
                  link.send('tray:action', 'navDash', {
                    view: 'notify',
                    data: {
                      notify: 'gasFeeWarning',
                      notifyData: { req, feeUSD: this.toDisplayUSD(maxFeeUSD), currentSymbol }
                    }
                  })
                } else {
                  this.approveRequest(req, () => link.send('tray:action', 'backDash'))
                }
              }}
            >
              <div className='notifyInputOptionText'>{approvalError ? 'Retry' : 'Proceed'}</div>
            </button>
          </div>
          <button
            type='button'
            aria-pressed={this.store('main.mute.signerCompatibilityWarning')}
            className='notifyCheck'
            disabled={approvalPending}
            onClick={() => link.send('tray:action', 'toggleSignerCompatibilityWarning')}
          >
            <div className='notifyCheckBox'>
              {this.store('main.mute.signerCompatibilityWarning') ? <Icon name='check' size={26} /> : null}
            </div>
            <div className='notifyCheckText'>{"Don't show this warning again"}</div>
          </button>
        </div>
      </div>
    )
  }

  contractData() {
    return (
      <div
        className='notifyBoxWrap'
        onMouseDown={(e) => e.stopPropagation()}
        style={
          this.store('view.notify') === 'contractData' ? { transform: 'translateX(calc(-100% - 100px))' } : {}
        }
      >
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            <div>Blind signing</div>
            <div>disabled</div>
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Your Ledger rejected data it could not fully verify on-device.
            </div>
            <div className='notifyBodyLine'>
              <span>If you understand and trust this request, open the Ethereum app and go to</span>
              <br />
              <span style={{ fontWeight: 'bold' }}>{'Settings > Blind signing'}</span>
              <br />
              <span>Only enable it when you understand and trust the request.</span>
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  hotAccountWarning() {
    return (
      <div
        className='notifyBoxWrap'
        onMouseDown={(e) => e.stopPropagation()}
        style={
          this.store('view.notify') === 'hotAccountWarning'
            ? { transform: 'translateX(calc(-100% - 100px))' }
            : {}
        }
      >
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            <div>Experimental hot signer</div>
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Wren hot signers are experimental. Do not use them for high-value accounts. Confirm that your
              backups work before relying on them.
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  hotSignerMismatch() {
    return (
      <div
        className='notifyBoxWrap'
        onMouseDown={(e) => e.stopPropagation()}
        style={
          this.store('view.notify') === 'hotSignerMismatch'
            ? { transform: 'translateX(calc(-100% - 100px))' }
            : {}
        }
      >
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            <div>Hot signer address mismatch</div>
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              The unlocked hot signer did not match the address shown in Wren and has been relocked.
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  openExternal({ url }) {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            Open external link
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLineUrl'>{url}</div>
            <div className='notifyBodyLine'>{'Open this link in your browser?'}</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed'
              onClick={() => {
                link.send('tray:openExternal', url)
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>Open link</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  openExplorer({ hash, chain }) {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div id='wren-dash-notify-title' className='notifyTitle'>
            Open block explorer
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>Open this transaction in a block explorer?</div>
            <div className='notifyBodyHash'>{hash}</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
              data-dialog-initial-focus
              onClick={() => {
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed'
              onClick={() => {
                link.send('tray:openExplorer', chain, hash)
                link.send('tray:action', 'backDash')
              }}
            >
              <div className='notifyInputOptionText'>Open explorer</div>
            </button>
          </div>
          <button
            type='button'
            aria-pressed={this.store('main.mute.explorerWarning')}
            className='notifyCheck'
            onClick={() => {
              link.send('tray:action', 'toggleExplorerWarning')
            }}
          >
            <div className='notifyCheckBox'>
              {this.store('main.mute.explorerWarning') ? <Icon name='check' size={26} /> : null}
            </div>
            <div className='notifyCheckText'>{"Don't show this warning again"}</div>
          </button>
        </div>
      </div>
    )
  }

  render() {
    const { notify, notifyData } = this.props.data
    if (notify === 'betaDisclosure') {
      return this.renderDialog(this.betaDisclosure(), false)
    } else if (notify === 'gasFeeWarning') {
      return this.renderDialog(this.gasFeeWarning(notifyData))
    } else if (notify === 'noSignerWarning') {
      return this.renderDialog(this.noSignerWarning(notifyData))
    } else if (notify === 'signerUnavailableWarning') {
      return this.renderDialog(this.signerUnavailableWarning(notifyData))
    } else if (notify === 'signerCompatibilityWarning') {
      return this.renderDialog(this.signerCompatibilityWarning(notifyData))
    } else if (notify === 'contractData') {
      return this.renderDialog(this.contractData())
    } else if (notify === 'hotAccountWarning') {
      return this.renderDialog(this.hotAccountWarning())
    } else if (notify === 'hotSignerMismatch') {
      return this.renderDialog(this.hotSignerMismatch())
    } else if (notify === 'confirmRemoveChain') {
      const { chain } = notifyData

      const onAccept = () => {
        link.send('tray:action', 'removeNetwork', chain)

        // if accepted, go back twice to get back to the main chains panel
        link.send('tray:action', 'backDash', 2)
      }

      const onDecline = () => {
        link.send('tray:action', 'backDash')
      }

      return this.renderDialog(
        <>
          <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
            <div className='notifyBoxSlide'>
              <Confirm
                prompt={`Remove ${chain.name}?`}
                description='This removes the network from Wren. Your assets are not affected.'
                acceptText='Remove network'
                declineText='Cancel'
                onAccept={onAccept}
                onDecline={onDecline}
              />
            </div>
          </div>
        </>,
        true,
        `Remove ${chain.name}?`
      )
    } else if (notify === 'openExternal') {
      return this.renderDialog(this.openExternal(notifyData))
    } else if (notify === 'openExplorer') {
      return this.renderDialog(this.openExplorer(notifyData))
    } else {
      return null
    }
  }
}

export default Restore.connect(Notify)
