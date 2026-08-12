import React from 'react'
import Restore from 'react-restore'
import Account from './Account'
import Notify from './Notify'
import Menu from './Menu'
import Badge from './Badge'

import Backdrop from './Backdrop'
import AccountSelector from './AccountSelector'
import Footer from './Footer'

// import DevTools from 'restore-devtools'
// <DevTools />

class Panel extends React.Component {
  indicator(connection) {
    const status = connection.endpoints.map((endpoint) => endpoint.status)
    if (status.indexOf('connected') > -1) {
      if (this.store('selected.current')) {
        return <div className='panelDetailIndicatorInner panelDetailIndicatorGood' />
      } else {
        return <div className='panelDetailIndicatorInner panelDetailIndicatorWaiting' />
      }
    } else {
      return <div className='panelDetailIndicatorInner panelDetailIndicatorBad' />
    }
  }

  hexToDisplayGwei(weiHex) {
    return parseInt(weiHex, 'hex') / 1e9 < 1 ? '‹1' : Math.round(parseInt(weiHex, 'hex') / 1e9)
  }

  render() {
    const opacity = this.store('tray.initial') ? 0 : 1

    const networks = this.store('main.networks')
    const networkOptions = []
    Object.keys(networks).forEach((type) => {
      Object.keys(networks[type]).forEach((id) => {
        const net = networks[type][id]
        const status = net.connection.endpoints.map((endpoint) => endpoint.status)
        if (net.on) {
          networkOptions.push({
            text: net.name,
            value: type + ':' + id,
            indicator: net.on && status.indexOf('connected') > -1 ? 'good' : 'bad'
          })
        }
      })
    })
    return (
      <div id='panel' style={{ opacity }}>
        <Badge />
        <Notify />
        <Menu />
        <AccountSelector />
        <Account />
        <Backdrop />
        <Footer />
      </div>
    )
  }
}

export default Restore.connect(Panel)
