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
    this.nameDirty = false
    this.pendingName = ''
  }

  componentDidMount() {
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
    this.nameObs = this.store.observer(() => {
      const name = this.store('main.accounts', this.props.account, 'name') || ''
      if (this.nameDirty) return
      if (this.pendingName) {
        if (name !== this.pendingName) return
        this.pendingName = ''
      }
      if (name !== this.state.name) this.setState({ name })
    })
  }

  componentWillUnmount() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
    this.nameObs.remove()
  }

  saveName() {
    const currentName = this.store('main.accounts', this.props.account, 'name') || ''
    const name = String(this.state.name || '').trim()

    if (name && name !== currentName) {
      this.pendingName = name
      link.send('tray:renameAccount', this.props.account, name)
    }
    this.nameDirty = false
    this.setState({ name: name || currentName })
  }

  render() {
    return (
      <div className='accountViewScroll accountSettingsExpandedView'>
        <div className='expandedModule'>
          <header className='accountSettingsIntro'>
            <h2>Account</h2>
          </header>
          <section className='panelBlock accountSettingsEditor'>
            <div className='accountSettingsAddress'>
              <span>Address</span>
              <code>{this.props.account}</code>
            </div>
            <label className='panelBlockTitle' htmlFor='wren-account-name'>
              Account name
            </label>
            <input
              id='wren-account-name'
              className='wrenInput panelBlockItem'
              type='text'
              aria-label='Account name'
              autoFocus
              maxLength={128}
              value={this.state.name}
              onChange={(e) => {
                this.nameDirty = true
                this.setState({ name: e.target.value })
              }}
              onBlur={() => this.saveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  e.preventDefault()
                  const name = this.store('main.accounts', this.props.account, 'name') || ''
                  this.nameDirty = false
                  this.pendingName = ''
                  this.setState({ name })
                }
              }}
            />
          </section>
        </div>
      </div>
    )
  }
}

export default Restore.connect(SettingsExpanded)
