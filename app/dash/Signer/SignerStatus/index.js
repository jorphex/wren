import React from 'react'
import Restore from 'react-restore'
import link from '../../../../resources/link'
import { getSignerStatusMeta, isHardwareSigner } from '../../../../resources/domain/signer'

export class SignerStatus extends React.Component {
  constructor(...args) {
    super(...args)
    // this.moduleRef = React.createRef()
    // this.resizeObserver = new ResizeObserver(() => {
    //   if (this.moduleRef && this.moduleRef.current) {
    //     link.send('tray:action', 'updateAccountModule', this.props.moduleId, { height: this.moduleRef.current.clientHeight })
    //   }
    // })
    this.state = {
      expand: false,
      shake: false,
      unlockInput: '',
      unlockError: '',
      unlockPending: false
    }
    this.unlockPending = false
    this.mounted = true
    this.statusRef = React.createRef()
    this.inputRef = React.createRef()
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.shakeTimer)
  }

  shake() {
    this.setState({ shake: true })
    clearTimeout(this.shakeTimer)
    this.shakeTimer = setTimeout(() => {
      if (this.mounted) this.setState({ shake: false })
    }, 1200)
  }

  unlockChange(e) {
    this.setState({ unlockInput: e.target.value, unlockError: '' })
  }

  unlockSubmit() {
    if (!this.state.unlockInput || this.unlockPending) return
    const password = this.state.unlockInput
    this.unlockPending = true
    this.setState({ unlockInput: '', unlockError: '', unlockPending: true })
    link.rpc('unlockSigner', this.props.signer.id, password, (err) => {
      this.unlockPending = false
      if (!this.mounted) return
      this.setState({ unlockPending: false })
      if (err) {
        this.setState({ unlockError: err.message || String(err) })
        this.shake()
      }
    })
  }

  // componentDidMount () {
  //   setTimeout(() => {
  //     document.addEventListener('mousedown', (e) => {
  //       if (this.props.open && this.statusRef && this.statusRef.current && !this.statusRef.current.contains(e.target)) {
  //         this.props.setSignerStatusOpen(false)
  //       }
  //     })
  //     if (this.inputRef.current) {
  //       this.inputRef.current.focus()
  //     }
  //   }, 100)
  // }

  render() {
    const { shake, unlockInput, unlockError, unlockPending } = this.state

    const signer = this.props.signer || {}
    const signerStatus = getSignerStatusMeta(signer)

    return !isHardwareSigner(signer) && signer.id && signerStatus.phase === 'locked' ? (
      <div className={shake ? 'signerStatus headShake' : 'signerStatus'} ref={this.statusRef}>
        <div className='signerStatusWrap'>
          <div className='signerStatusMain'>
            <div className='signerUnlockWrap'>
              <input
                id={`signer-password-${signer.id}`}
                aria-label='Signer password'
                autoFocus={true}
                ref={this.inputRef}
                className='signerUnlockInput wrenInput'
                type='password'
                value={unlockInput}
                disabled={unlockPending}
                onChange={this.unlockChange.bind(this)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    this.unlockSubmit()
                  }
                }}
              />
              <label className='signerUnlockInputLabel' htmlFor={`signer-password-${signer.id}`}>
                {'Enter the signer password to unlock'}
              </label>
              {unlockError ? (
                <div role='alert' className='signerUnlockError'>
                  {unlockError}
                </div>
              ) : null}
              <button
                type='button'
                className='signerUnlockSubmit wrenControl wrenControlPrimary'
                disabled={!unlockInput || unlockPending}
                onClick={this.unlockSubmit.bind(this)}
              >
                {'Unlock'}
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null
  }
}

export default Restore.connect(SignerStatus)
