import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../resources/Components/Icon'
import QrCode from '../../../resources/Components/QrCode'
import link from '../../../resources/link'
import svg from '../../../resources/svg'
import {
  WREN_COMPANION_CHROME_WEB_STORE_URL,
  WREN_COMPANION_RELEASES_URL,
  WREN_SUPPORT_ADDRESS,
  WREN_SUPPORT_URL
} from '../../../resources/constants'
import { getAddress } from '../../../resources/utils'

const supportAddress = getAddress(WREN_SUPPORT_ADDRESS)

const toolDashboardItems = [
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

  openDestination = (view) => {
    if (view) link.send('tray:action', 'navDash', { view, data: {} })
  }

  renderDestination = (item, counts = {}, compact = false) => {
    const meta = item.meta ?? (item.count ? counts[item.count] : undefined)
    return (
      <button
        type='button'
        aria-current={item.current ? 'page' : undefined}
        aria-label={`${item.title} ${item.description}`}
        className={`dashModule wrenControl ${item.current ? 'dashModuleCurrent' : 'wrenControlGhost'} ${
          compact ? 'dashModuleCompact' : ''
        }`}
        key={item.view || item.title}
        onClick={() => this.openDestination(item.view)}
      >
        <span className='dashModuleIcon'>
          <Icon name={item.icon} size={18} />
        </span>
        <span className='dashModuleCopy'>
          <strong className='dashModuleTitle'>{item.title}</strong>
          <span className='dashModuleDescription'>{item.description}</span>
        </span>
        {meta !== undefined ? (
          <span className='dashModuleMeta' aria-hidden='true'>
            {meta}
          </span>
        ) : compact ? (
          <span className='dashModuleArrow' aria-hidden='true'>
            <Icon name='next' size={15} />
          </span>
        ) : null}
      </button>
    )
  }

  render() {
    const supportPreviewOpen = this.state.supportPreviewFocused || this.state.supportPreviewHovered
    return (
      <div className='localSettings dashHomePerch'>
        <div className='localSettingsWrap'>
          <section className='dashHomeCard dashToolsCard' aria-labelledby='dash-tools-title'>
            <h2 id='dash-tools-title'>More tools</h2>
            <nav className='dashToolList' aria-label='Additional tools'>
              {toolDashboardItems.map((item) => this.renderDestination(item, {}, true))}
            </nav>
          </section>
          <section className='dashHomeCard dashCompanion' aria-labelledby='dash-companion-title'>
            <div className='dashCompanionCopy'>
              <h2 id='dash-companion-title'>Browser companion</h2>
            </div>
            <div className='dashCompanionBrowserActions'>
              <button
                type='button'
                aria-label='Download Chrome companion'
                className='wrenControl wrenControlGhost wrenControlIcon'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_CHROME_WEB_STORE_URL)}
              >
                {svg.chrome(22)}
                <span>Chrome</span>
              </button>
              <button
                type='button'
                aria-label='Download Firefox companion'
                className='wrenControl wrenControlGhost wrenControlIcon'
                onClick={() => link.send('tray:openExternal', WREN_COMPANION_RELEASES_URL)}
              >
                {svg.firefox(22)}
                <span>Firefox</span>
              </button>
            </div>
          </section>
          <nav className='dashSupportActions' aria-label='Support'>
            <div
              className='dashSupportWrenDisclosure'
              onMouseEnter={() => this.setState({ supportPreviewHovered: true })}
              onMouseLeave={() => this.setState({ supportPreviewHovered: false })}
            >
              <button
                type='button'
                className='dashSupportWrenButton requestFeatureButton wrenControl wrenControlGhost'
                aria-controls='dash-support-wren-preview'
                aria-describedby='dash-support-wren-status'
                aria-expanded={supportPreviewOpen}
                onBlur={() => this.setState({ supportPreviewFocused: false })}
                onClick={this.copySupportAddress}
                onFocus={() => this.setState({ supportPreviewFocused: true })}
                title='Copy support address. Hover or focus to view its QR code.'
              >
                <span>Support Wren</span>
                <Icon name={this.state.supportCopied ? 'check' : 'copy'} size={15} />
              </button>
              {supportPreviewOpen ? (
                <div id='dash-support-wren-preview' className='dashSupportWrenPreview'>
                  <QrCode
                    className='dashSupportWrenQrCode'
                    label='QR code for the support address'
                    value={supportAddress}
                  />
                  <div className='dashSupportWrenAddress'>{supportAddress}</div>
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
              onClick={() => link.send('tray:openExternal', WREN_SUPPORT_URL)}
            >
              <span>Report an issue</span>
              <Icon name='external' size={14} />
            </button>
            <button
              type='button'
              className='requestFeatureButton wrenControl wrenControlGhost'
              onClick={() => link.send('tray:action', 'setOnboard', { showing: true })}
            >
              <span>Tutorial</span>
              <Icon name='external' size={14} />
            </button>
            <button
              type='button'
              className='requestFeatureButton requestFeatureDanger wrenControl wrenControlGhost'
              onClick={() => link.send('tray:quit')}
            >
              <span>Quit Wren</span>
              <Icon name='close' size={14} />
            </button>
          </nav>
        </div>
      </div>
    )
  }
}

export default Restore.connect(Main)
