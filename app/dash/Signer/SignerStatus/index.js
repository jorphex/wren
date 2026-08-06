import React from 'react'
import Restore from 'react-restore'
import link from '../../../../resources/link'
import { isHardwareSigner } from '../../../../resources/domain/signer'

class SignerStatus extends React.Component {
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
      shake: false
    }
    this.statusRef = React.createRef()
    this.inputRef = React.createRef()
  }

  shake() {
    this.setState({ shake: true })
    setTimeout(() => {
      this.setState({ shake: false })
    }, 1200)
  }

  unlockChange(e) {
    this.setState({ unlockInput: e.target.value })
  }

  unlockSubmit() {
    link.rpc('unlockSigner', this.props.signer.id, this.state.unlockInput, (err) => {
      if (err) this.shake()
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
    const { shake } = this.state

    const signer = this.props.signer || {}

    return !isHardwareSigner(signer) && signer.id && signer.status === 'locked' ? (
      <div className={shake ? 'signerStatus headShake' : 'signerStatus'} ref={this.statusRef}>
        <div className='signerStatusWrap'>
          <div className='signerStatusMain'>
            <div className='signerUnlockWrap'>
              <input
                autoFocus={true}
                ref={this.inputRef}
                className='signerUnlockInput'
                type='password'
                value={this.state.unlockInput}
                onChange={this.unlockChange.bind(this)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    this.unlockSubmit()
                  }
                }}
              />
              <div className='signerUnlockInputLabel'>{'Enter password to unlock'}</div>
              <div className='signerUnlockSubmit' onClick={this.unlockSubmit.bind(this)}>
                {'Unlock'}
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null
  }
}

export default Restore.connect(SignerStatus)
