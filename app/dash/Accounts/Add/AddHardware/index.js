import React from 'react'
import Restore from 'react-restore'

import hardwareSetup from 'url:../../../../../asset/ui/hardware-setup.png'
import link from '../../../../../resources/link'
import RingIcon from '../../../../../resources/Components/RingIcon'
import { LEDGER_SHOP_URL, TREZOR_SHOP_URL } from '../../../../../resources/constants'

import Signer from '../../../Signer'

export class AddHardware extends React.Component {
  render() {
    const deviceName = `${this.props.type.charAt(0).toUpperCase()}${this.props.type.slice(1)}`
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
                {this.props.type === 'ledger' ? (
                  <RingIcon svgName={'ledger'} svgSize={15} />
                ) : (
                  <RingIcon svgName={'trezor'} svgSize={15} />
                )}
                <div className='addAccountItemIconHex addAccountItemIconHexHardware' />
              </div>
              <div className='addAccountItemTopTitle'>{deviceName}</div>
            </div>
            {/* <div className='addAccountItemClose' onMouseDown={() => this.props.close()}>{'DONE'}</div> */}
            <div className='addAccountItemSummary'>{`Unlock your ${deviceName} to get started`}</div>
          </div>
          <div className='addAccountItemDevices'>
            {tethered.length ? (
              tethered.map((signer, i) => {
                return (
                  <div key={i + signer.id} className='addAccountItemOptionSetupFrame'>
                    {signer ? (
                      <Signer {...signer} inSetup={true} />
                    ) : (
                      <>
                        <div className='addAccountItemOptionTitle'>{this.state.status}</div>
                        {this.state.error ? (
                          <div className='addAccountItemOptionSubmit' onMouseDown={() => this.restart()}>
                            try again
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )
              })
            ) : (
              <div className='addAccountItemDevice'>
                <img alt='' aria-hidden='true' className='addAccountItemDeviceArtwork' src={hardwareSetup} />
                <div aria-live='polite' className='addAccountItemDeviceTitle' role='status'>
                  Looking for a {deviceName}
                </div>
                <div className='addAccountItemDeviceStatus'>Connect and unlock your device.</div>
              </div>
            )}
          </div>
          <div
            className='addAccountItemFooter'
            onClick={() => {
              const open = (url) => link.send('tray:openExternal', url)
              if (this.props.type === 'ledger') return open(LEDGER_SHOP_URL)
              if (this.props.type === 'trezor') return open(TREZOR_SHOP_URL)
            }}
          >
            {``}
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(AddHardware)
