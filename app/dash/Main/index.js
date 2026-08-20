import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import QrCode from '../../../resources/Components/QrCode'
import link from '../../../resources/link'
import svg from '../../../resources/svg'
import {
  WREN_COMPANION_RELEASES_URL,
  WREN_SUPPORT_ADDRESS,
  WREN_SUPPORT_URL
} from '../../../resources/constants'
import { getAddress } from '../../../resources/utils'
import controlCenterWren from 'url:../../../asset/ui/wren-control-center-v1.png'

const supportAddress = getAddress(WREN_SUPPORT_ADDRESS)

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
        view: 'earn',
        title: 'Earn',
        description: 'Review selected Yearn vaults by network.',
        icon: 'earn'
      },
      {
        view: 'addressBook',
        title: 'Contacts',
        description: 'Save labels for addresses. Compare the full address before signing.',
        icon: 'contacts'
      },
      {
        view: 'dapps',
        title: 'Connected apps',
        description: 'Review active connections, access, and default networks.',
        icon: 'apps'
      }
    ]
  },
  {
    label: 'Tools',
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
        view: 'inspector',
        title: 'Read-only inspector',
        description: 'Inspect requests without signing.',
        icon: 'search'
      },
      {
        view: 'contracts',
        title: 'Contracts',
        description: 'Deploy prepared bytecode or publish verified source.',
        icon: 'file'
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
  constructor(props) {
    super(props)
    this.state = {
      supportCopied: false,
      supportPreviewFocused: false,
      supportPreviewHovered: false
    }
    this.supportCopyTimer = undefined
  }

  componentDidMount() {
    const scroll = document.querySelector('.dashMainScroll')
    if (scroll) scroll.scrollTop = 0
  }

  componentWillUnmount() {
    clearTimeout(this.supportCopyTimer)
  }

  copySupportAddress = () => {
    link.send('tray:clipboardData', supportAddress)
    clearTimeout(this.supportCopyTimer)
    this.setState({ supportCopied: true })
    this.supportCopyTimer = setTimeout(() => this.setState({ supportCopied: false }), 1800)
  }

  render() {
    const supportPreviewOpen = this.state.supportPreviewFocused || this.state.supportPreviewHovered

    return (
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <header className='dashHomeHeader'>
            <div className='dashHomeIntro'>
              <h1>Control center</h1>
              <p>Manage accounts, networks, permissions, and desktop behavior.</p>
            </div>
            <img
              className='dashHomeWren'
              src={controlCenterWren}
              alt=''
              aria-hidden='true'
              data-testid='control-center-wren'
            />
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
            <div
              className='dashSupportWrenDisclosure'
              onMouseEnter={() => this.setState({ supportPreviewHovered: true })}
              onMouseLeave={() => this.setState({ supportPreviewHovered: false })}
            >
              <button
                type='button'
                className='dashSupportWrenButton requestFeatureButton wrenControl wrenControlGhost'
                aria-controls='dash-support-wren-preview'
                aria-describedby='dash-support-wren-description dash-support-wren-status'
                aria-expanded={supportPreviewOpen}
                onBlur={() => this.setState({ supportPreviewFocused: false })}
                onClick={this.copySupportAddress}
                onFocus={() => this.setState({ supportPreviewFocused: true })}
                title='Copy support address. Hover or focus to view its QR code.'
              >
                <Icon name={this.state.supportCopied ? 'check' : 'copy'} size={15} />
                Support Wren
              </button>
              {supportPreviewOpen ? (
                <div id='dash-support-wren-preview' className='dashSupportWrenPreview'>
                  <QrCode
                    className='dashSupportWrenQrCode'
                    label='QR code for the support address'
                    value={supportAddress}
                  />
                  <div className='dashSupportWrenAddress'>{supportAddress}</div>
                  <p id='dash-support-wren-description' className='dashSupportWrenPreviewNote'>
                    Support is optional.
                  </p>
                </div>
              ) : null}
              <span
                id='dash-support-wren-status'
                className='dashSupportWrenStatus'
                role='status'
                aria-live='polite'
              >
                {this.state.supportCopied ? 'Address copied' : ''}
              </span>
            </div>
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
        </div>
      </div>
    )
  }
}

export default Restore.connect(Main)
