import React from 'react'
import Restore from 'react-restore'
import link from '../../../../../resources/link'

export class SettingsExpanded extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.clientHeight
          })
        }
      })
    }
    this.state = {
      expand: false,
      name: ''
    }
  }

  componentDidMount() {
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
    this.nameObs = this.store.observer(() => {
      const name = this.store('main.accounts', this.props.account, 'name')
      if (name !== this.state.name) this.setState({ name })
    })
  }

  componentWillUnmount() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
    this.nameObs.remove()
  }

  saveName() {
    const currentName = this.store('main.accounts', this.props.account, 'name') || ''
    const name = this.state.name.trim()

    if (name && name !== currentName) link.send('tray:renameAccount', this.props.account, name)
    this.setState({ name: name || currentName })
  }

  render() {
    return (
      <div className='accountViewScroll'>
        <div className='expandedModule'>
          <div className='panelBlock'>
            <div className='panelBlockTitle'>Name</div>
            <div className='panelBlockValues panelBlockItem'>
              <input
                className='wrenInput'
                type='text'
                aria-label='Account name'
                value={this.state.name}
                onChange={(e) => {
                  this.setState({ name: e.target.value })
                }}
                onBlur={() => this.saveName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    const name = this.store('main.accounts', this.props.account, 'name') || ''
                    this.setState({ name })
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(SettingsExpanded)
