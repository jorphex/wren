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
  mainnet() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div className='notifyWrenIcon'>
            <img src={wrenIcon} />
          </div>
          <div className='notifyTitle'>Welcome to Wren!</div>
          <div className='notifySubtitle'>System-wide web3</div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Please read{' '}
              <span
                onMouseDown={() => {
                  link.send('tray:openExternal', WREN_LICENSE_URL)
                }}
              >
                our license
              </span>
              , use at your own risk and verify transactions and account details on a signing device whenever
              possible.
            </div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputSingleButton'
              onMouseDown={() => {
                link.send('tray:action', 'muteWelcomeWarning')
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Let&apos;s go!</div>
            </div>
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
              <img src={wrenIcon} />
            </div>
            <div className='notifyTitle'>Wren Preview</div>
            <div className='notifyBody'>
              <div className='notifyBodyBlock'>
                <div className='notifySection'>Use hardware signers for high value accounts</div>
                <div className='notifySection'>
                  <span>Read</span>
                  <span
                    className='notifyBodyLink'
                    onMouseDown={() => {
                      link.send('tray:openExternal', WREN_LICENSE_URL)
                    }}
                  >
                    our license
                  </span>
                  <span>and use Wren at your own risk</span>
                </div>
                <div className='notifySection'>
                  <span>Report problems through </span>
                  <span
                    className='notifyBodyLink'
                    onMouseDown={() => {
                      link.send('tray:openExternal', WREN_SUPPORT_URL)
                    }}
                  >
                    community support
                  </span>
                </div>
              </div>
            </div>
            <div className='notifyInput'>
              <div
                className='notifyInputOption notifyInputSingleButton'
                onMouseDown={() => {
                  link.send('tray:action', 'muteBetaDisclosure')
                  this.store.notify()
                }}
              >
                <div className='notifyInputOptionText notifyBetaGo'>Let&apos;s go!</div>
              </div>
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
          <div className='notifyTitle'>Gas Fee Warning</div>
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
            <div className='notifyBodyQuestion'>Are you sure you want to proceed?</div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputDeny'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </div>
            <div
              className='notifyInputOption notifyInputProceed'
              onMouseDown={() => {
                link.rpc('approveRequest', req, () => {})
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Proceed</div>
            </div>
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
          <div className='notifyTitle'>Signer unavailable for signing!</div>
          <div className='notifyBody'>
            <div className='notifyBodyQuestion'>Please check the signer for this account and try again</div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputSingleButton'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  noSignerWarning() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div className='notifyTitle'>No Signer Attached!</div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>No signer attached for this account</div>
            <div className='notifyBodyQuestion'>Please attach a signer that can sign for this account</div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputSingleButton'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </div>
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
          <div className='notifyTitle'>Signer Compatibility</div>
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
            <div
              className='notifyInputOption notifyInputDeny'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </div>
            <div
              className='notifyInputOption notifyInputProceed'
              onMouseDown={() => {
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
            </div>
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
          <div className='notifyTitle'>
            <div>Blind Signing</div>
            <div>Disabled</div>
          </div>
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
            <div
              className='notifyInputOption notifyInputSingleButton'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </div>
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
          <div className='notifyTitle'>
            <div>Hot Signer Alpha</div>
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Wren hot signers are in alpha! Do not use them with high value accounts and verify your backups
              are valid. Only proceed if you understand and accept these risks.
            </div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputSingleButton'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </div>
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
          <div className='notifyTitle'>
            <div>Hot Signer Address Mismatch</div>
          </div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              The unlocked hot signer did not match the address shown in Wren and has been relocked.
            </div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputSingleButton'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>OK</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  openExternal({ url }) {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div className='notifyTitle'>Open External Link</div>
          <div className='notifyBody'>
            <div className='notifyBodyLineUrl'>{url}</div>
            <div className='notifyBodyLine'>{'Open Link in Browser?'}</div>
          </div>
          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputDeny'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </div>
            <div
              className='notifyInputOption notifyInputProceed'
              onMouseDown={() => {
                link.send('tray:openExternal', url)
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Proceed</div>
            </div>
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
          <div className='notifyTitle'>Open Block Explorer</div>
          {hash ? (
            <div className='notifyBody'>
              <div className='notifyBodyLine'>
                {'Wren will open a block explorer in your browser for transaction:'}
              </div>
              <div className='notifyBodyHash'>{hash}</div>
            </div>
          ) : (
            <div className='notifyBody'>
              <div className='notifyBodyLine'>{`Wren will open the ${chainName}`}</div>
              <div className='notifyBodyLine'>{`block explorer in your browser:`}</div>
              <div className='notifyBodyHash'>{explorerUrl}</div>
            </div>
          )}

          <div className='notifyInput'>
            <div
              className='notifyInputOption notifyInputDeny'
              onMouseDown={() => {
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Cancel</div>
            </div>
            <div
              className='notifyInputOption notifyInputProceed'
              onMouseDown={() => {
                link.send('tray:openExplorer', chain, hash)
                this.store.notify()
              }}
            >
              <div className='notifyInputOptionText'>Proceed</div>
            </div>
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
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.mainnet()}
        </div>
      )
    } else if (notify === 'betaDisclosure') {
      return <div className='notify cardShow'>{this.betaDisclosure()}</div>
    } else if (notify === 'gasFeeWarning') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.gasFeeWarning(this.store('view.notifyData'))}
        </div>
      )
    } else if (notify === 'noSignerWarning') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.noSignerWarning(this.store('view.notifyData'))}
        </div>
      )
    } else if (notify === 'signerUnavailableWarning') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.signerUnavailableWarning(this.store('view.notifyData'))}
        </div>
      )
    } else if (notify === 'signerCompatibilityWarning') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.signerCompatibilityWarning(this.store('view.notifyData'))}
        </div>
      )
    } else if (notify === 'contractData') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.contractData()}
        </div>
      )
    } else if (notify === 'hotAccountWarning') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.hotAccountWarning()}
        </div>
      )
    } else if (notify === 'hotSignerMismatch') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.hotSignerMismatch()}
        </div>
      )
    } else if (notify === 'openExternal') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.openExternal(this.store('view.notifyData'))}
        </div>
      )
    } else if (notify === 'openExplorer') {
      return (
        <div className='notify cardShow' onMouseDown={() => this.store.notify()}>
          {/* <div className='notifyCloseButton' onMouseDown={() => this.store.notify()}>
            {'close'}
          </div> */}
          {this.openExplorer(this.store('view.notifyData'))}
        </div>
      )
    } else if (notify === 'extensionConnect') {
      const { browser, extensionId, pairingCode, requestId } = this.store('view.notifyData')

      return (
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
        />
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
