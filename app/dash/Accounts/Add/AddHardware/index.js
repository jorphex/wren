import React from 'react'
import Restore from 'react-restore'

import hardwareSetup from 'url:../../../../../asset/ui/hardware-setup-v6.png'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'

import Signer from '../../../Signer'

export class AddHardware extends React.Component {
  state = { connecting: false, error: '' }
  mounted = false
  pending = false

  componentDidMount() {
    this.mounted = true
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.pending) link.rpc('cancelTrezorConnect', () => {})
  }

  connect = () => {
    if (this.pending) return
    this.pending = true
    this.setState({ connecting: true, error: '' })
    link.rpc('connectTrezor', (error) => {
      if (!this.mounted) return
      this.pending = false
      this.setState({ connecting: false, error: error ? String(error) : '' })
    })
  }

  cancel = () => {
    link.rpc('cancelTrezorConnect', () => {})
  }

  render() {
    const deviceName = `${this.props.type.charAt(0).toUpperCase()}${this.props.type.slice(1)}`
    const suite = this.props.type === 'trezor'
    const signers = this.store('main.signers')
    const isType = (id) => this.store('main.signers', id, 'type') === this.props.type
    const toDevice = (id) => this.store('main.signers', id)

    const tethered = Object.keys(signers).filter(isType.bind(this)).map(toDevice.bind(this))
    return (
      <div className='addAccountItem addAccountItemAdding'>
        <div className='addAccountItemBar addAccountItemHardware' />
        <div className='addAccountItemWrap'>
          <div className='addAccountItemTop'>
            <div className='addAccountItemTopType'>
              <div className='addAccountItemIcon'>
                <Icon name={suite ? 'trezor' : 'hardware'} size={20} />
                <div className='addAccountItemIconHex addAccountItemIconHexHardware' />
              </div>
              <div className='addAccountItemTopTitle'>{deviceName}</div>
            </div>
            {/* <div className='addAccountItemClose' onMouseDown={() => this.props.close()}>{'DONE'}</div> */}
          </div>
          <div className='addAccountItemDevices'>
            {tethered.length ? (
              tethered.map((signer) => {
                return (
                  <div key={signer.id} className='addAccountItemOptionSetupFrame'>
                    <Signer {...signer} inSetup={true} />
                  </div>
                )
              })
            ) : (
              <div className='addAccountItemDevice'>
                <img alt='' aria-hidden='true' className='addAccountItemDeviceArtwork' src={hardwareSetup} />
                <div aria-live='polite' className='addAccountItemDeviceTitle' role='status'>
                  {suite
                    ? this.state.connecting
                      ? 'Continue in Trezor Suite…'
                      : 'Connect with Trezor Suite'
                    : `Looking for your ${deviceName}`}
                </div>
                {!suite || (!this.state.connecting && !this.state.error) ? (
                  <div className='addAccountItemDeviceStatus'>
                    {suite
                      ? 'Open Suite Desktop and connect your Trezor.'
                      : 'Connect and unlock your device.'}
                  </div>
                ) : null}
              </div>
            )}
            {suite ? (
              <div className='addAccountItemSuiteActions'>
                {this.state.connecting && tethered.length ? (
                  <div role='status'>Continue in Trezor Suite…</div>
                ) : null}
                {this.state.error ? <div role='alert'>{this.state.error}</div> : null}
                <button
                  type='button'
                  className='wrenControl wrenControlSecondary'
                  disabled={this.state.connecting}
                  onClick={this.connect}
                >
                  {this.state.connecting ? 'Connecting…' : 'Connect with Suite'}
                </button>
                {this.state.connecting ? (
                  <button
                    type='button'
                    className='wrenControl wrenControlGhost wrenCommandLabel'
                    onClick={this.cancel}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className='addAccountItemFooter' />
        </div>
      </div>
    )
  }
}

export default Restore.connect(AddHardware)
