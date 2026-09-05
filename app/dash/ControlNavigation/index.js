import React from 'react'

import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'

export const primaryDashboardItems = [
  {
    title: 'Home',
    description: 'Control center home.',
    icon: 'overview'
  },
  {
    view: 'accounts',
    title: 'Accounts',
    description: 'Manage signing and watch-only accounts.',
    icon: 'accounts',
    count: 'accounts'
  },
  {
    view: 'chains',
    title: 'Networks',
    description: 'Configure networks and RPC connections.',
    icon: 'network',
    count: 'networks'
  },
  {
    view: 'dapps',
    title: 'Connected apps',
    description: 'Review active and recent apps, account access, and default networks.',
    icon: 'sync',
    count: 'dapps'
  },
  {
    view: 'settings',
    title: 'Settings',
    description: 'Adjust desktop behavior, shortcuts, and privacy.',
    icon: 'settings'
  }
]

export class ControlNavigation extends React.Component {
  openDestination = (view) => {
    if (view === this.props.current) return
    if (this.props.replace) {
      const crumbs = view ? [{ view, data: {} }] : []
      link.send('tray:action', 'navReplace', 'dash', crumbs)
    } else if (view) {
      link.send('tray:action', 'navDash', { view, data: {} })
    }
  }

  render() {
    const { counts } = this.props
    return (
      <nav className='dashModules' aria-label='Control destinations'>
        {primaryDashboardItems.map((item) => {
          const current = (item.view || 'overview') === this.props.current
          const meta = item.count ? counts[item.count] : undefined
          return (
            <button
              type='button'
              aria-current={current ? 'page' : undefined}
              aria-label={item.title}
              className={`dashModule wrenControl ${current ? 'dashModuleCurrent' : 'wrenControlGhost'}`}
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
              ) : null}
            </button>
          )
        })}
      </nav>
    )
  }
}

ControlNavigation.defaultProps = {
  counts: {},
  current: 'overview',
  replace: false
}

export default ControlNavigation
