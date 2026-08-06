import React from 'react'
import Restore from 'react-restore'
import { okPort, okProtocol } from '../../../resources/connections'
import link from '../../../resources/link'
import svg from '../../../resources/svg'
import { WREN_COMPANION_RELEASES_URL, WREN_LICENSE_URL, WREN_SUPPORT_URL } from '../../../resources/constants'

const dashboardSections = [
  {
    label: 'Wallet',
    items: [
      {
        view: 'accounts',
        title: 'Accounts',
        description: 'Manage signing and watch-only accounts',
        icon: svg.accounts
      },
      {
        view: 'addressBook',
        title: 'Contacts',
        description: 'Name and verify frequently used addresses',
        icon: svg.people
      },
      {
        view: 'earn',
        title: 'Earn',
        description: 'Review selected Yearn vault opportunities',
        icon: svg.bars
      }
    ]
  },
  {
    label: 'Configuration',
    items: [
      {
        view: 'chains',
        title: 'Networks',
        description: 'Configure chains and RPC connections',
        icon: svg.chain
      },
      {
        view: 'tokens',
        title: 'Tokens',
        description: 'Control recognized and custom assets',
        icon: svg.tokens
      },
      {
        view: 'dapps',
        title: 'Connected apps',
        description: 'Review dapp access and permissions',
        icon: svg.window
      },
      {
        view: 'settings',
        title: 'Settings',
        description: 'Desktop behavior, shortcuts, and privacy',
        icon: svg.settings
      }
    ]
  }
]

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

  componentDidMount() {
    const scroll = document.querySelector('.dashMainScroll')
    if (scroll) scroll.scrollTop = 0
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
    return (
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <header className='dashHomeHeader'>
            <div className='dashHomeEyebrow'>Desktop EVM wallet</div>
            <h1>Control center</h1>
            <p>Manage accounts, networks, permissions, and wallet behavior.</p>
          </header>
          <nav className='dashModules' aria-label='Wallet management'>
            {dashboardSections.map((section) => (
              <section className='dashModuleSection' key={section.label}>
                <h2>{section.label}</h2>
                <div className='dashModuleList'>
                  {section.items.map((item) => (
                    <button
                      type='button'
                      className='dashModule'
                      aria-label={item.title}
                      key={item.view}
                      onClick={() => link.send('tray:action', 'navDash', { view: item.view, data: {} })}
                    >
                      <span className='dashModuleIcon'>{item.icon(20)}</span>
                      <span className='dashModuleCopy'>
                        <strong className='dashModuleTitle'>{item.title}</strong>
                        <span className='dashModuleDescription'>{item.description}</span>
                      </span>
                      <span className='dashModuleArrow'>{svg.arrowRight(14)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <section className='dashCompanion' aria-labelledby='dash-companion-title'>
            <div className='dashCompanionCopy'>
              <h2 id='dash-companion-title'>Browser companion</h2>
              <p>Connect browser dapps to this Wren desktop instance.</p>
            </div>
            <div className='snipItBrowserExtensionIcons'>
              <button
                type='button'
                aria-label='Download Chrome companion'
                className='snipItBrowserExtensionIcon snipItBrowserExtensionIconChrome'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.chrome(22)}
              </button>
              <button
                type='button'
                aria-label='Download Firefox companion'
                className='snipItBrowserExtensionIcon snipItBrowserExtensionIconFirefox'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.firefox(22)}
              </button>
            </div>
          </section>
          <div className='dashSupportActions'>
            <button
              type='button'
              className='requestFeatureButton'
              onClick={() => {
                link.send('tray:openExternal', WREN_SUPPORT_URL)
              }}
            >
              Support &amp; feedback
            </button>
            <button
              type='button'
              className='requestFeatureButton'
              onClick={() => {
                link.send('tray:action', 'setOnboard', { showing: true })
              }}
            >
              Tutorial
            </button>
            <button
              type='button'
              className='requestFeatureButton requestFeatureButtonDanger'
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
