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
  betaDisclosure() {
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBoxSlide'>
          <div className='notifyBox'>
            <div className='notifyWrenIcon'>
              <img alt='' aria-hidden='true' src={wrenIcon} />
            </div>
            <div className='notifyTitle'>Wren preview</div>
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
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div className='notifyTitle'>High network fee</div>
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
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
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
                link.rpc('approveRequest', req, () => {})
                link.send('tray:action', 'backDash')
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
          <div className='notifyTitle'>Signer unavailable</div>
          <div className='notifyBody'>
            <div className='notifyBodyQuestion'>Check the signer for this account, then try again.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
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
          <div className='notifyTitle'>No signer attached</div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>This account does not have a signer.</div>
            <div className='notifyBodyQuestion'>Attach a signer before submitting a signature.</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputSingleButton'
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
    return (
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBox'>
          <div className='notifyTitle'>Signer compatibility</div>
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
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
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
                  link.rpc('approveRequest', req, () => {})
                  link.send('tray:action', 'backDash')
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
          <div className='notifyTitle'>
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
          <div className='notifyTitle'>
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
          <div className='notifyTitle'>
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
          <div className='notifyTitle'>Open external link</div>
          <div className='notifyBody'>
            <div className='notifyBodyLineUrl'>{url}</div>
            <div className='notifyBodyLine'>{'Open this link in your browser?'}</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
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
          <div className='notifyTitle'>Open block explorer</div>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>Open this transaction in a block explorer?</div>
            <div className='notifyBodyHash'>{hash}</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny'
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
      return <div className='notify cardShow'>{this.betaDisclosure()}</div>
    } else if (notify === 'gasFeeWarning') {
      return <div className='notify cardShow'>{this.gasFeeWarning(notifyData)}</div>
    } else if (notify === 'noSignerWarning') {
      return <div className='notify cardShow'>{this.noSignerWarning(notifyData)}</div>
    } else if (notify === 'signerUnavailableWarning') {
      return <div className='notify cardShow'>{this.signerUnavailableWarning(notifyData)}</div>
    } else if (notify === 'signerCompatibilityWarning') {
      return <div className='notify cardShow'>{this.signerCompatibilityWarning(notifyData)}</div>
    } else if (notify === 'contractData') {
      return <div className='notify cardShow'>{this.contractData()}</div>
    } else if (notify === 'hotAccountWarning') {
      return <div className='notify cardShow'>{this.hotAccountWarning()}</div>
    } else if (notify === 'hotSignerMismatch') {
      return <div className='notify cardShow'>{this.hotSignerMismatch()}</div>
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

      return (
        <div className='notify cardShow'>
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
        </div>
      )
    } else if (notify === 'openExternal') {
      return <div className='notify cardShow'>{this.openExternal(notifyData)}</div>
    } else if (notify === 'openExplorer') {
      return <div className='notify cardShow'>{this.openExplorer(notifyData)}</div>
    } else {
      return null
    }
  }
}

export default Restore.connect(Notify)
