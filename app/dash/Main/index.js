import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
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
        description: 'Manage signing and watch-only accounts.',
        icon: 'accounts'
      },
      {
        view: 'addressBook',
        title: 'Contacts',
        description: 'Label addresses you know and verify often.',
        icon: 'contacts'
      },
      {
        view: 'earn',
        title: 'Earn',
        description: 'Review selected Yearn vaults by network.',
        icon: 'earn'
      }
    ]
  },
  {
    label: 'Configuration',
    items: [
      {
        view: 'chains',
        title: 'Networks',
        description: 'Configure networks and RPC connections.',
        icon: 'network'
      },
      {
        view: 'tokens',
        title: 'Tokens',
        description: 'Manage recognized and custom assets.',
        icon: 'tokens'
      },
      {
        view: 'settings',
        title: 'Settings',
        description: 'Adjust desktop behavior, shortcuts, and privacy.',
        icon: 'settings'
      }
    ]
  }
]

export class Main extends React.Component {
  constructor(props, context) {
    super(props, context)
    const latticeEndpoint = context.store('main.latticeSettings.endpointCustom')
    const latticeEndpointMode = context.store('main.latticeSettings.endpointMode')
    this.state = {
      latticeEndpoint,
      latticeEndpointMode,
      resetConfirm: false,
      instanceIdCopied: false
    }
  }

  componentWillUnmount() {
    clearTimeout(this.instanceIdCopiedTimeout)
    clearTimeout(this.inputLatticeTimeout)
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

  render() {
    return (
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <header className='dashHomeHeader'>
            <div className='dashHomeEyebrow'>Desktop EVM wallet</div>
            <h1>Control center</h1>
            <p>Manage accounts, networks, permissions, and desktop behavior.</p>
          </header>
          <nav className='dashModules' aria-label='Wallet management'>
            {dashboardSections.map((section) => (
              <section className='dashModuleSection' key={section.label}>
                <h2>{section.label}</h2>
                <div className='dashModuleList'>
                  {section.items.map((item) => (
                    <button
                      type='button'
                      className='dashModule wrenControl wrenControlGhost'
                      key={item.view}
                      onClick={() => link.send('tray:action', 'navDash', { view: item.view, data: {} })}
                    >
                      <span className='dashModuleIcon'>
                        <Icon name={item.icon} size={20} />
                      </span>
                      <span className='dashModuleCopy'>
                        <strong className='dashModuleTitle'>{item.title}</strong>
                        <span className='dashModuleDescription'>{item.description}</span>
                      </span>
                      <span className='dashModuleArrow'>
                        <Icon name='next' size={15} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <section className='dashCompanion' aria-labelledby='dash-companion-title'>
            <div className='dashCompanionCopy'>
              <h2 id='dash-companion-title'>Browser companion</h2>
              <p>Connect browser dapps to this Wren desktop wallet.</p>
            </div>
            <div className='dashCompanionBrowserActions'>
              <button
                type='button'
                aria-label='Download Chrome companion'
                className='wrenControl wrenControlGhost wrenControlIcon'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.chrome(22)}
              </button>
              <button
                type='button'
                aria-label='Download Firefox companion'
                className='wrenControl wrenControlGhost wrenControlIcon'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.firefox(22)}
              </button>
            </div>
          </section>
          <div className='dashSupportActions'>
            <button
              type='button'
              className='requestFeatureButton wrenControl wrenControlGhost'
              onClick={() => {
                link.send('tray:openExternal', WREN_SUPPORT_URL)
              }}
            >
              <Icon name='support' size={15} />
              Report an issue
            </button>
            <button
              type='button'
              className='requestFeatureButton wrenControl wrenControlGhost'
              onClick={() => {
                link.send('tray:action', 'setOnboard', { showing: true })
              }}
            >
              <Icon name='tutorial' size={15} />
              Tutorial
            </button>
            <button
              type='button'
              className='requestFeatureButton wrenControl wrenControlGhost'
              onClick={() => {
                link.send('tray:quit')
              }}
            >
              <Icon name='quit' size={15} />
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
