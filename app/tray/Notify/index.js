import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { usesBaseFee } from '../../../resources/domain/transaction'
import { capitalize } from '../../../resources/utils'
import wrenIcon from '../../../asset/WrenIcon.png'
import ExtensionConnectNotification from './ExtensionConnect'
import { WREN_LICENSE_URL, WREN_SUPPORT_URL } from '../../../resources/constants'

const FEE_WARNING_THRESHOLD_USD = 50

export class Notify extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.dialogRef = React.createRef()
    this.activeDialog = null
    this.previousFocus = null
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
    }
  }

  handleDialogKeyDown(event, dismissible) {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault()
      this.store.notify()
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

  renderDialog(content, dismissible = true) {
    return (
      <div
        ref={this.dialogRef}
        className='notify cardShow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='wren-notify-title'
        tabIndex={-1}
        onKeyDown={(event) => this.handleDialogKeyDown(event, dismissible)}
        onMouseDown={dismissible ? () => this.store.notify() : undefined}
      >
        {content}
      </div>
    )
  }

  mainnet() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div className='notifyWrenIcon'>
            <img alt='' aria-hidden='true' src={wrenIcon} />
          </div>
          <h2 id='wren-notify-title' className='notifyTitle'>Welcome to Wren</h2>
          <div className='notifySubtitle'>Your desktop EVM wallet</div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Read{' '}
              <button
                type='button'
                className='notifyBodyLink'
                onClick={() => {
                  link.send('tray:openExternal', WREN_LICENSE_URL)
                }}
              >
                our license
              </button>
              . Use Wren at your own risk. When possible, verify transactions and account details on your
              signing device.
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
              onClick={() => {
                link.send('tray:action', 'muteWelcomeWarning')
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Continue</div>
            </button>
          </div>
        </div>
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
            <h2 id='wren-notify-title' className='notifyTitle'>Wren Preview</h2>
            <div className='notifyBody'>
              <div className='notifyBodyBlock'>
                <div className='notifySection'>Use hardware signers for high-value accounts.</div>
                <div className='notifySection'>
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
                  <span>. Use Wren at your own risk.</span>
                </div>
                <div className='notifySection'>
                  <span>Report a problem through </span>
                  <button
                    type='button'
                    className='notifyBodyLink'
                    onClick={() => {
                      link.send('tray:openExternal', WREN_SUPPORT_URL)
                    }}
                  >
                    community support
                  </button>
                </div>
              </div>
            </div>
            <div className='notifyInput'>
              <button
                type='button'
                className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
                onClick={() => {
                  link.send('tray:action', 'muteBetaDisclosure')
                  this.store.notify()
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
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <h2 id='wren-notify-title' className='notifyTitle'>Gas fee warning</h2>
          <div className='notifyBody'>
            {feeUSD !== '0.00' ? (
              <>
                <div className='notifyBodyLine'>The max fee for this transaction is:</div>
                <div className='notifyBodyLine notifyBodyPrice'>{`≈ $${feeUSD} in ${currentSymbol}`}</div>
              </>
            ) : (
              <div className='notifyBodyLine'>
                We were unable to determine this transaction&apos;s fee in USD.
              </div>
            )}
            <div className='notifyBodyQuestion'>Review the fee before you continue.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny wrenControl wrenControlSecondary'
              onClick={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed wrenControl wrenControlPrimary'
              onClick={() => {
                link.rpc('approveRequest', req, () => {})
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Proceed</div>
            </button>
          </div>
          <button
            type='button'
            aria-pressed={this.store('main.mute.gasFeeWarning')}
            className='notifyCheck'
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
          <h2 id='wren-notify-title' className='notifyTitle'>Signer unavailable</h2>
          <div className='notifyBody'>
            <div className='notifyBodyQuestion'>Check the signer for this account, then try again.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
              onClick={() => {
                this.store.notify()
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
          <h2 id='wren-notify-title' className='notifyTitle'>No signer attached</h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>This account does not have a signer.</div>
            <div className='notifyBodyQuestion'>Attach a signer that can sign for this account.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
              onClick={() => {
                this.store.notify()
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

    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <h2 id='wren-notify-title' className='notifyTitle'>Signer compatibility</h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              {`Your ${capitalize(signer)} is not compatible with ${capitalize(tx)} ${
                tx === 'london' ? '(EIP-1559) ' : ''
              }transactions. Your transaction will be converted to a legacy transaction before signing.`}
            </div>
            {['lattice', 'ledger'].includes(signer) ? (
              <div className='notifyBodyUpdate'>
                {`Update your ${capitalize(signer)} to enable compatibility`}
              </div>
            ) : null}
            <div className='notifyBodyQuestion'>Do you want to proceed?</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny wrenControl wrenControlSecondary'
              onClick={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed wrenControl wrenControlPrimary'
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
                  this.store.notify('gasFeeWarning', {
                    req,
                    feeUSD: this.toDisplayUSD(maxFeeUSD),
                    currentSymbol
                  })
                } else {
                  link.rpc('approveRequest', req, () => {})
                  this.store.notify()
                }
              }}
            >
              <div className='notifyInputOptionText'>Proceed</div>
            </button>
          </div>
          <button
            type='button'
            aria-pressed={this.store('main.mute.signerCompatibilityWarning')}
            className='notifyCheck'
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
          <h2 id='wren-notify-title' className='notifyTitle'>
            <div>Blind signing</div>
            <div>disabled</div>
          </h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Your Ledger rejected data that it could not fully verify on-device.
            </div>
            <div className='notifyBodyLine'>
              <span>If this request requires blind signing, open the Ethereum app and go to</span>
              <br />
              <span style={{ fontWeight: 'bold' }}>{'Settings > Blind signing'}</span>
              <br />
              <span>Only enable it when you understand and trust the request.</span>
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
              onClick={() => {
                this.store.notify()
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
          <h2 id='wren-notify-title' className='notifyTitle'>
            <div>Hot signer preview</div>
          </h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Hot signers are experimental. Do not use them with high-value accounts. Verify your backups
              before relying on this signer, and proceed only if you understand the risk.
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
              onClick={() => {
                this.store.notify()
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
          <h2 id='wren-notify-title' className='notifyTitle'>
            <div>Hot signer address mismatch</div>
          </h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              The unlocked hot signer did not match the address shown in Wren and has been relocked.
            </div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton wrenControl wrenControlPrimary'
              onClick={() => {
                this.store.notify()
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
          <h2 id='wren-notify-title' className='notifyTitle'>Open external link</h2>
          <div className='notifyBody'>
            <div className='notifyBodyLineUrl'>{url}</div>
            <div className='notifyBodyLine'>Open this link in your browser?</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny wrenControl wrenControlSecondary'
              onClick={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed wrenControl wrenControlPrimary'
              onClick={() => {
                link.send('tray:openExternal', url)
                this.store.notify()
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
    const { name: chainName, explorer: explorerUrl } = this.store('main.networks', chain.type, chain.id)
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <h2 id='wren-notify-title' className='notifyTitle'>Open block explorer</h2>
          {hash ? (
            <div className='notifyBody'>
              <div className='notifyBodyLine'>{'Wren will open this transaction in your browser:'}</div>
              <div className='notifyBodyHash'>{hash}</div>
            </div>
          ) : (
            <div className='notifyBody'>
              <div className='notifyBodyLine'>{`Wren will open the ${chainName} block explorer`}</div>
              <div className='notifyBodyLine'>in your browser:</div>
              <div className='notifyBodyHash'>{explorerUrl}</div>
            </div>
          )}

          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny wrenControl wrenControlSecondary'
              onClick={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed wrenControl wrenControlPrimary'
              onClick={() => {
                link.send('tray:openExplorer', chain, hash)
                this.store.notify()
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
    const notify = this.store('view.notify')

    if (notify === 'mainnet') {
      return this.renderDialog(this.mainnet())
    } else if (notify === 'betaDisclosure') {
      return this.renderDialog(this.betaDisclosure(), false)
    } else if (notify === 'gasFeeWarning') {
      return this.renderDialog(this.gasFeeWarning(this.store('view.notifyData')))
    } else if (notify === 'noSignerWarning') {
      return this.renderDialog(this.noSignerWarning(this.store('view.notifyData')))
    } else if (notify === 'signerUnavailableWarning') {
      return this.renderDialog(this.signerUnavailableWarning(this.store('view.notifyData')))
    } else if (notify === 'signerCompatibilityWarning') {
      return this.renderDialog(this.signerCompatibilityWarning(this.store('view.notifyData')))
    } else if (notify === 'contractData') {
      return this.renderDialog(this.contractData())
    } else if (notify === 'hotAccountWarning') {
      return this.renderDialog(this.hotAccountWarning())
    } else if (notify === 'hotSignerMismatch') {
      return this.renderDialog(this.hotSignerMismatch())
    } else if (notify === 'openExternal') {
      return this.renderDialog(this.openExternal(this.store('view.notifyData')))
    } else if (notify === 'openExplorer') {
      return this.renderDialog(this.openExplorer(this.store('view.notifyData')))
    } else if (notify === 'extensionConnect') {
      const { browser, extensionId, pairingCode, requestId } = this.store('view.notifyData')

      return this.renderDialog(
        <ExtensionConnectNotification
          browser={browser}
          extensionId={extensionId}
          pairingCode={pairingCode}
          requestId={requestId}
          onClose={() => {
            if (
              this.store('view.notify') === 'extensionConnect' &&
              this.store('view.notifyData.requestId') === requestId
            ) {
              this.store.notify()
            }
          }}
        />,
        false
      )
    } else {
      return null
    }
  }
}

// Notification Cycle for Testing

// intro
// contractData
// mainnet
// rinkeby
// ipfsAlreadyRunning
// parityAlreadyRunning
// gasFeeWarning
// contractData
// hotAccountWarning

// let notifications = [
//   {
//     name: 'intro',
//     data: {}
//   },
//   {
//     name: 'mainnet',
//     data: {}
//   },
//
//   {
//     name: 'rinkeby',
//     data: {}
//   },
//   {
//     name: 'ipfsAlreadyRunning',
//     data: {}
//   },
//   {
//     name: 'parityAlreadyRunning',
//     data: {}
//   },
//   {
//     name: 'gasFeeWarning',
//     data: {
//       req: {
//         handlerId: 'c9a46b23-dced-45a3-a961-cbc5b7873de5',
//         type: 'transaction',
//         data: {
//           value: '0x11e42f05714a67',
//           to: '0x355587247da36c3130da888d9f608ccf0d2351ce',
//           from: '0x355587247da36c3130da888d9f608ccf0d2351ce',
//           gasPrice: '0x3b9aca00',
//           gas: '0x5208',
//           chainId: '0x4'
//         },
//         payload: {
//           jsonrpc: '2.0',
//           id: 3416,
//           method: 'eth_sendTransaction',
//           params: [],
//           account: '0x355587247DA36C3130dA888d9F608ccF0D2351ce'
//         }
//       },
//       feeUSD: 200
//     }
//   },
//   {
//     name: 'contractData',
//     data: {}
//   },
//   {
//     name: 'openExplorer',
//     data: {
//       hash: '0x1234'
//     }
//   },
//   {
//     name: 'hotAccountWarning',
//     data: {}
//   }
// ]
//
//
// let i = -1
// const checkKey = (e) => {
//   if ((e || window.event).key === 'ArrowRight') {
//     i++
//     if (!notifications[i]) i = 0
//     console.log(notifications[i].name, notifications[i].data)
//     store.notify(notifications[i].name, notifications[i].data)
//   } else if ((e || window.event).key === 'ArrowLeft') {
//     i--
//     if (!notifications[i]) i = notifications.length - 1
//     console.log(notifications[i].name, notifications[i].data)
//     store.notify(notifications[i].name, notifications[i].data)
//   }
// }

// window.addEventListener('keyup', checkKey, true)

export default Restore.connect(Notify)
