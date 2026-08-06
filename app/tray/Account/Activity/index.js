import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../resources/Components/Icon'
import link from '../../../../resources/link'

class Activity extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.resizeObserver = new ResizeObserver(() => {
      if (this.moduleRef && this.moduleRef.current) {
        link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
          height: this.moduleRef.current.clientHeight
        })
      }
    })
    this.state = {
      expand: false
    }
  }
  componentDidMount() {
    this.resizeObserver.observe(this.moduleRef.current)
  }
  render() {
    return (
      <div ref={this.moduleRef} className='balancesBlock'>
        <div className='moduleHeader'>
          <span>
            <Icon name='activity' size={13} />
          </span>
          <span>{'Activity'}</span>
        </div>
        <div className='moduleComingSoon'>{'Coming Soon'}</div>
      </div>
    )
  }
}

export default Restore.connect(Activity)
