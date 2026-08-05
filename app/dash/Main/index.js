import React from 'react'
import Restore from 'react-restore'
import { okPort, okProtocol } from '../../../resources/connections'
import link from '../../../resources/link'
import svg from '../../../resources/svg'
import { WREN_COMPANION_RELEASES_URL, WREN_LICENSE_URL, WREN_SUPPORT_URL } from '../../../resources/constants'

export class Main extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.customMessage = 'Custom Endpoint'
    const latticeEndpoint = context.store('main.latticeSettings.endpointCustom')
    const latticeEndpointMode = context.store('main.latticeSettings.endpointMode')
    this.state = {
      localShake: {},
      latticeEndpoint,
      latticeEndpointMode,
      resetConfirm: false,
      expandNetwork: false,
      instanceIdCopied: false
    }
  }

  componentWillUnmount() {
    clearTimeout(this.instanceIdCopiedTimeout)
    clearTimeout(this.customPrimaryInputTimeout)
    clearTimeout(this.customSecondaryInputTimeout)
    clearTimeout(this.inputLatticeTimeout)
    clearTimeout(this.localShakeTimeout)
  }

  appInfo() {
    // TODO: move this to global passed over IPC
    // eslint-disable-next-line
    const appVersion = require('../../../package.json').version
    const instanceId = this.store('main.instanceId')
    return (
      <div className='appInfo'>
        <button
          type='button'
          className='appInfoLine appInfoLineInstanceId'
          onMouseLeave={(e) => {
            e.stopPropagation()
            e.preventDefault()
            this.setState({ instanceIdCopied: false })
          }}
          onClick={() => {
            clearTimeout(this.instanceIdCopiedTimeout)
            link.send('tray:clipboardData', instanceId)
            this.setState({ instanceIdCopied: true })
            this.instanceIdCopiedTimeout = setTimeout(() => this.setState({ instanceIdCopied: false }), 1800)
          }}
        >
          {this.state.instanceIdCopied ? (
            <span className='instanceIdCopied'>{'Instance ID Copied'}</span>
          ) : (
            instanceId
          )}
        </button>
        <div className='appInfoLine appInfoLineVersion'>{`v${appVersion}`}</div>
        <button
          type='button'
          className='appInfoViewLicense'
          onClick={() => link.send('tray:openExternal', WREN_LICENSE_URL)}
        >
          View License
        </button>
        <div className='appInfoLine appInfoLineReset'>
          {this.state.resetConfirm ? (
            <>
              <span className='appInfoLineResetConfirm'>Are you sure you want to reset everything?</span>
              <span className='appInfoLineResetConfirmButtons'>
                <button
                  type='button'
                  className='appInfoLineResetConfirmButton'
                  onClick={() => link.send('tray:resetAllSettings')}
                >
                  Yes
                </button>
                <span> / </span>
                <button
                  type='button'
                  className='appInfoLineResetConfirmButton'
                  onClick={() => this.setState({ resetConfirm: false })}
                >
                  No
                </button>
              </span>
            </>
          ) : (
            <button
              type='button'
              className='appInfoLineResetButton'
              onClick={() => this.setState({ resetConfirm: true })}
            >
              Reset All Settings & Data
            </button>
          )}
        </div>
      </div>
    )
  }

  customPrimaryFocus() {
    if (this.state.primaryCustom === this.customMessage) this.setState({ primaryCustom: '' })
  }

  customPrimaryBlur() {
    if (this.state.primaryCustom === '') this.setState({ primaryCustom: this.customMessage })
  }

  inputPrimaryCustom(e) {
    e.preventDefault()
    clearTimeout(this.customPrimaryInputTimeout)
    const value = e.target.value.replace(/\s+/g, '')
    this.setState({ primaryCustom: value })
    const { type, id } = this.store('main.currentNetwork')
    this.customPrimaryInputTimeout = setTimeout(
      () => link.send('tray:action', 'setPrimaryCustom', type, id, this.state.primaryCustom),
      1000
    )
  }

  inputSecondaryCustom(e) {
    e.preventDefault()
    clearTimeout(this.customSecondaryInputTimeout)
    const value = e.target.value.replace(/\s+/g, '')
    this.setState({ secondaryCustom: value })
    const { type, id } = this.store('main.currentNetwork')
    this.customSecondaryInputTimeout = setTimeout(
      () => link.send('tray:action', 'setSecondaryCustom', type, id, this.state.secondaryCustom),
      1000
    )
  }

  inputLatticeEndpoint(e) {
    e.preventDefault()
    clearTimeout(this.inputLatticeTimeout)
    const value = e.target.value.replace(/\s+/g, '')
    this.setState({ latticeEndpoint: value })
    // TODO: Update to target specific Lattice device rather than global
    this.inputLatticeTimeout = setTimeout(
      () => link.send('tray:action', 'setLatticeEndpointCustom', this.state.latticeEndpoint),
      1000
    )
  }

  localShake(key) {
    const localShake = Object.assign({}, this.state.localShake)
    localShake[key] = true
    this.setState({ localShake })
    this.localShakeTimeout = setTimeout(() => {
      const localShake = Object.assign({}, this.state.localShake)
      localShake[key] = false
      this.setState({ localShake })
    }, 1010)
  }

  status(layer) {
    const { type, id } = this.store('main.currentNetwork')
    const connection = this.store('main.networks', type, id, 'connection', layer)
    let status = connection.status
    const current = connection.current

    if (current === 'custom') {
      if (
        layer === 'primary' &&
        this.state.primaryCustom !== '' &&
        this.state.primaryCustom !== this.customMessage
      ) {
        if (!okProtocol(this.state.primaryCustom)) status = 'invalid target'
        else if (!okPort(this.state.primaryCustom)) status = 'invalid port'
      }

      if (
        layer === 'secondary' &&
        this.state.secondaryCustom !== '' &&
        this.state.secondaryCustom !== this.customMessage
      ) {
        if (!okProtocol(this.state.secondaryCustom)) status = 'invalid target'
        else if (!okPort(this.state.secondaryCustom)) status = 'invalid port'
      }
    }
    if (status === 'connected' && !connection.network) status = 'loading'
    return (
      <div className='connectionOptionStatus'>
        {this.indicator(status)}
        <div className='connectionOptionStatusText'>{status}</div>
      </div>
    )
  }

  quit() {
    return (
      <div className='addCustomTokenButtonWrap quitFrame' style={{ zIndex: 215 }}>
        <div className='addCustomTokenButton' onClick={() => link.send('tray:quit')}>
          Quit
        </div>
      </div>
    )
  }

  indicator(status) {
    if (status === 'connected') {
      return (
        <div className='connectionOptionStatusIndicator'>
          <div className='connectionOptionStatusIndicatorGood' />
        </div>
      )
    } else if (status === 'loading' || status === 'syncing' || status === 'pending' || status === 'standby') {
      return (
        <div className='connectionOptionStatusIndicator'>
          <div className='connectionOptionStatusIndicatorPending' />
        </div>
      )
    } else {
      return (
        <div className='connectionOptionStatusIndicator'>
          <div className='connectionOptionStatusIndicatorBad' />
        </div>
      )
    }
  }

  expandNetwork(e, expand) {
    e.stopPropagation()
    this.setState({ expandNetwork: expand !== undefined ? expand : !this.state.expandNetwork })
  }

  render() {
    const networks = this.store('main.networks')
    const networkOptions = []

    Object.keys(networks).forEach((type) => {
      Object.keys(networks[type]).forEach((id) => {
        networkOptions.push({ text: networks[type][id].name, value: type + ':' + id })
      })
    })
    return (
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <div className='dashModules'>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'accounts', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.accounts(24)}</div>
              <div className='dashModuleTitle'>{'Accounts'}</div>
            </button>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'addressBook', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.people(24)}</div>
              <div className='dashModuleTitle'>{'Contacts'}</div>
            </button>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'earn', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.bars(24)}</div>
              <div className='dashModuleTitle'>{'Earn'}</div>
            </button>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'chains', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.chain(24)}</div>
              <div className='dashModuleTitle'>{'Chains'}</div>
            </button>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'tokens', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.tokens(24)}</div>
              <div className='dashModuleTitle'>{'Tokens'}</div>
            </button>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'dapps', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.window(24)}</div>
              <div className='dashModuleTitle'>{'Dapps'}</div>
            </button>
            <button
              type='button'
              className='dashModule'
              onClick={() => link.send('tray:action', 'navDash', { view: 'settings', data: {} })}
            >
              <div className='dashModuleIcon'>{svg.settings(24)}</div>
              <div className='dashModuleTitle'>{'Settings'}</div>
            </button>
          </div>
          <div className='snipIt'>
            <div>Using a dapp that doesn&apos;t support Wren natively?</div>
            <div className='snipItBrowserExtensionIcons'>
              <button
                type='button'
                aria-label='Download Chrome companion'
                className='snipItBrowserExtensionIcon snipItBrowserExtensionIconChrome'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.chrome(28)}
              </button>
              <button
                type='button'
                aria-label='Download Firefox companion'
                className='snipItBrowserExtensionIcon snipItBrowserExtensionIconFirefox'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.firefox(28)}
              </button>
              {/* <div 
                className='snipItBrowserExtensionIcon snipItBrowserExtensionIconSafari'
              >
                {svg.safari(28)}
              </div> */}
            </div>
            <div>Inject a connection with our browser extension!</div>
          </div>
          <div className='requestFeature'>
            <button
              type='button'
              className='requestFeatureButton'
              onClick={() => {
                link.send('tray:openExternal', WREN_SUPPORT_URL)
              }}
            >
              Request a Feature or Report an Issue
            </button>
          </div>
          <div className='requestFeature'>
            <button
              type='button'
              className='requestFeatureButton'
              onClick={() => {
                link.send('tray:openExternal', WREN_SUPPORT_URL)
              }}
            >
              Get Community Support
            </button>
          </div>
          <div className='requestFeature'>
            <button
              type='button'
              className='requestFeatureButton'
              onClick={() => {
                link.send('tray:action', 'setOnboard', { showing: true })
              }}
            >
              Open Wren Tutorial
            </button>
          </div>
          <div className='requestFeature'>
            <button
              type='button'
              className='requestFeatureButton'
              onClick={() => {
                link.send('tray:quit')
              }}
            >
              Quit
            </button>
          </div>
          {this.appInfo()}
        </div>
      </div>
    )
  }
}

export default Restore.connect(Main)
