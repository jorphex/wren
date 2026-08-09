import React from 'react'
import Restore from 'react-restore'
import Icon from '../Icon'

class Filter extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      expand: false
    }
    // this.e = { p: ['QXJyb3dVcA==', 'QXJyb3dVcA==', 'QXJyb3dEb3du', 'QXJyb3dEb3du', 'QXJyb3dMZWZ0', 'QXJyb3dSaWdodA==', 'QXJyb3dMZWZ0', 'QXJyb3dSaWdodA==', 'Yg==', 'YQ=='], i: 0 }
  }
  // h (e) {
  //   if (this.e.p.indexOf(btoa(e.key)) < 0 || btoa(e.key) !== this.e.p[this.e.i]) {
  //     this.e.i = 0
  //   } else {
  //     e.preventDefault()
  //     this.e.i++
  //     if (this.e.p.length === this.e.i) {
  //       this.e.i = 0
  //       if (this.state.l === true) {
  //         this.setState({l: false})
  //       } else {
  //         this.setState({l: true})
  //       }
  //     }
  //   }
  // }
  // componentDidMount () {
  //   document.addEventListener('keydown', this.h.bind(this))
  // }
  // componentWillUnmount () {
  //   document.removeEventListener('keydown', this.h.bind(this))
  // }
  render() {
    const { buttonActionName, buttonAction } = this.props
    return (
      <div className='filter'>
        <div className='filterWrap wrenInputGroup wrenInputGroupQuiet'>
          <div className='filterIcon'>
            <Icon name='search' size={18} />
          </div>
          <input
            aria-label={this.props.inputLabel || 'Filter'}
            className='filterInput wrenInput'
            spellCheck={false}
            onChange={(e) => this.props.onInput(e.target.value)}
          />
        </div>
        {buttonActionName ? (
          <button
            type='button'
            aria-label={buttonActionName}
            className='filterButton wrenControl wrenControlSecondary wrenControlCompact'
            onClick={() => {
              if (buttonAction) buttonAction()
            }}
          >
            <Icon name='add' size={14} />
            <Icon name='network' size={16} />
          </button>
        ) : null}
      </div>
    )
  }
}

export default Restore.connect(Filter)
