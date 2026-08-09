import React from 'react'
import Restore from 'react-restore'

import link from '../../../../../resources/link'
import RingIcon from '../../../../../resources/Components/RingIcon'

function parseDeviceName(name) {
  return name.replace(/\s+/g, '-').substring(0, 14)
}

export class AddHardwareLattice extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      index: 0,
      status: '',
      error: false,
      creating: false,
      deviceId: '',
      deviceName: 'GridPlus'
    }
    this.forms = [React.createRef(), React.createRef()]
    this.createPending = false
    this.createRequest = 0
    this.mounted = true
  }

  componentWillUnmount() {
    this.mounted = false
    this.createRequest += 1
    clearTimeout(this.focusTimer)
  }

  onChange(key, e) {
    e.preventDefault()

    const value = key === 'deviceName' ? parseDeviceName(e.target.value) : e.target.value

    this.setState({ [key]: value || '' })
  }

  onBlur(key, e) {
    e.preventDefault()
    const update = {}
    update[key] = this.state[key] || ''
    this.setState(update)
  }

  onFocus(key, e) {
    e.preventDefault()
    if (this.state[key] === '') {
      const update = {}
      update[key] = ''
      this.setState(update)
    }
  }

  currentForm() {
    return this.forms[this.state.index]
  }

  blurActive() {
    const formInput = this.currentForm()
    if (formInput && formInput.current) formInput.current.blur()
  }

  focusActive(index = this.state.index) {
    clearTimeout(this.focusTimer)
    this.focusTimer = setTimeout(() => {
      const formInput = this.forms[index]
      if (formInput && formInput.current) formInput.current.focus()
    }, 500)
  }

  next() {
    if (this.state.index !== 0) return
    this.blurActive()
    this.setState({ index: 1 }, () => this.focusActive(1))
  }

  createLattice() {
    if (this.createPending || this.state.index !== 1 || !this.state.deviceId.trim()) return
    this.createPending = true
    const request = ++this.createRequest
    this.blurActive()
    if (document.activeElement?.blur) document.activeElement.blur()
    clearTimeout(this.focusTimer)
    this.setState({ index: 2, status: 'Creating GridPlus signer...', error: false, creating: true })
    link.rpc('createLattice', this.state.deviceId, this.state.deviceName, (err, signer) => {
      if (!this.mounted || request !== this.createRequest) return
      if (err) {
        this.createPending = false
        this.setState({ status: err.message || String(err), error: true, creating: false })
      } else {
        // reset nav state to before the start of the flow and open the new signer
        link.send('tray:action', 'backDash', 2)
        const crumb = {
          view: 'expandedSigner',
          data: { signer: signer.id }
        }
        link.send('tray:action', 'navDash', crumb)
      }
    })
  }

  restart() {
    this.createPending = false
    this.createRequest += 1
    this.setState({ index: 0, status: '', error: false, creating: false }, () => this.focusActive(0))
  }

  render() {
    let itemClass = 'addAccountItem addAccountItemSmart addAccountItemAdding'

    const { index, status, error, creating, deviceId, deviceName } = this.state

    return (
      <div className={itemClass} style={{ transitionDelay: (0.64 * this.props.index) / 4 + 's' }}>
        <div className='addAccountItemBar' />
        <div className='addAccountItemWrap'>
          <div className='addAccountItemTop'>
            <div className='addAccountItemTopType'>
              <div className='addAccountItemIcon'>
                <div className='addAccountItemIconType addAccountItemIconHardware'>
                  <RingIcon svgName={'lattice'} svgSize={20} />
                </div>
              </div>
              <div className='addAccountItemTopTitle'>GridPlus</div>
            </div>
            {/* <div className='addAccountItemClose' onMouseDown={() => this.props.close()}>{'Done'}</div> */}
            <div className='addAccountItemSummary'>GridPlus Lattice1</div>
          </div>
          <div className='addAccountItemOption'>
            <div className='addAccountItemOptionSetup' style={{ transform: `translateX(-${100 * index}%)` }}>
              <div className='addAccountItemOptionSetupFrames'>
                <div className='addAccountItemOptionSetupFrame' aria-hidden={index !== 0} inert={index !== 0}>
                  <label htmlFor='gridPlusDeviceName' className='addAccountItemOptionTitle'>
                    Device name
                  </label>
                  <div className='addAccountItemOptionInput wrenInputGroup'>
                    <input
                      className='wrenInput'
                      id='gridPlusDeviceName'
                      ref={this.forms[0]}
                      value={deviceName}
                      onChange={(e) => this.onChange('deviceName', e)}
                      onFocus={(e) => this.onFocus('deviceName', e)}
                      onBlur={(e) => this.onBlur('deviceName', e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          this.next()
                        }
                      }}
                    />
                  </div>
                  <button
                    type='button'
                    className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
                    onClick={() => this.next()}
                  >
                    Next
                  </button>
                </div>
                <div className='addAccountItemOptionSetupFrame' aria-hidden={index !== 1} inert={index !== 1}>
                  <label htmlFor='gridPlusDeviceId' className='addAccountItemOptionTitle'>
                    Enter device ID
                  </label>
                  <div className='addAccountItemOptionInput wrenInputGroup'>
                    <input
                      className='wrenInput'
                      id='gridPlusDeviceId'
                      ref={this.forms[1]}
                      value={deviceId}
                      onChange={(e) => this.onChange('deviceId', e)}
                      onFocus={(e) => this.onFocus('deviceId', e)}
                      onBlur={(e) => this.onBlur('deviceId', e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          this.createLattice()
                        }
                      }}
                    />
                  </div>
                  <button
                    type='button'
                    className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
                    disabled={!deviceId.trim() || creating}
                    onClick={() => this.createLattice()}
                  >
                    Create
                  </button>
                </div>
                <div className='addAccountItemOptionSetupFrame' aria-hidden={index !== 2} inert={index !== 2}>
                  <div role={error ? 'alert' : 'status'} className='addAccountItemOptionTitle'>
                    {status}
                  </div>
                  {error ? (
                    <button
                      type='button'
                      className='addAccountItemOptionSubmit wrenControl wrenControlPrimary'
                      onClick={() => this.restart()}
                    >
                      Try again
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className='addAccountItemFooter' />
        </div>
      </div>
    )
  }
}

export default Restore.connect(AddHardwareLattice)
