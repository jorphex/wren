import React from 'react'
import Restore from 'react-restore'
import { ensNormalize, isAddress } from 'ethers'

import link from '../../../../../resources/link'
import RingIcon from '../../../../../resources/Components/RingIcon'

const normalizeInput = (input) => input.trim()

const isEnsName = (input) => {
  if (isAddress(input) || /^0x/i.test(input)) return false
  try {
    return ensNormalize(input).includes('.')
  } catch {
    return false
  }
}

class AddAddress extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      index: 0,
      adding: false,
      address: '',
      status: '',
      error: false,
      resolvingEnsName: false,
      creating: false
    }

    this.forms = [React.createRef(), React.createRef()]
    this.cancelEnsResolution = () => {}
    this.operationPending = false
    this.mounted = true
  }

  componentWillUnmount() {
    this.mounted = false
    this.cancelEnsResolution()
    clearTimeout(this.focusTimer)
  }

  onChange(key, e) {
    e.preventDefault()
    const update = {}
    const value = e.target.value || ''
    update[key] = value
    this.setState(update)
  }

  onBlur(key, e) {
    e.preventDefault()
    const update = {}
    update[key] = this.state[key] || ''
    this.setState(update)
  }

  onFocus(key, e) {
    e.preventDefault()
    if (this.state[key] === '') {
      const update = {}
      update[key] = ''
      this.setState(update)
    }
  }

  nextForm() {
    this.setState({ index: this.state.index + 1 })
  }

  next() {
    this.nextForm()
    this.focusActive()
  }

  async resolveEnsName(name) {
    return new Promise((resolve, reject) => {
      this.cancelEnsResolution = () => reject({ canceled: true })

      link.rpc('resolveEnsName', name, (err, resolvedAddress) => {
        if (err) return reject({ canceled: false, message: `Unable to resolve Ethereum address for ${name}` })

        resolve(resolvedAddress)
      })
    })
  }

  setResolving() {
    this.setState({ resolvingEnsName: true })
  }

  setError(status) {
    this.setState({ status, error: true })
  }

  createFromAddress(address) {
    this.setState({ creating: true, resolvingEnsName: false })
    this.nextForm()
    link.rpc('createFromAddress', address, 'Watch Account', (err) => {
      this.operationPending = false
      if (!this.mounted) return
      if (err) {
        this.setState({ creating: false })
        this.setError(err)
      } else {
        this.setState({ status: 'Successful', error: false, creating: false })
      }
    })
  }

  async create() {
    if (this.operationPending) return
    const input = normalizeInput(this.state.address)

    if (!isAddress(input) && !isEnsName(input)) {
      this.setError('Enter a valid address or ENS name')
      return this.nextForm()
    }

    if (!isEnsName(input)) {
      this.operationPending = true
      return this.createFromAddress(input)
    }

    try {
      this.operationPending = true
      this.setResolving()

      const address = await this.resolveEnsName(input)
      this.createFromAddress(address)
    } catch (e) {
      this.operationPending = false
      if (!e.canceled) {
        this.setError(e.message)
        this.nextForm()
      }
    }
  }

  restart() {
    this.cancelEnsResolution()
    this.operationPending = false
    this.setState({
      index: 0,
      adding: false,
      address: '',
      status: '',
      error: false,
      resolvingEnsName: false,
      creating: false
    })

    this.focusActive()
  }

  keyPress(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const formInput = this.forms[this.state.index]
      if (formInput) formInput.current.blur()
      if (this.state.index === 0) return this.create()
    }
  }

  focusActive() {
    clearTimeout(this.focusTimer)
    this.focusTimer = setTimeout(() => {
      const formInput = this.forms[this.state.index]
      if (formInput?.current) formInput.current.focus()
    }, 500)
  }

  render() {
    const { status, error, address, index: formIndex, resolvingEnsName, creating } = this.state

    let itemClass = 'addAccountItem addAccountItemSmart addAccountItemAdding'

    return (
      <div className={itemClass} style={{ transitionDelay: (0.64 * this.props.index) / 4 + 's' }}>
        <div className='addAccountItemBar addAccountItemMock' />
        <div className='addAccountItemWrap'>
          <div className='addAccountItemTop'>
            <div className='addAccountItemTopType'>
              <div className='addAccountItemIcon'>
                <RingIcon svgName={'mask'} svgSize={24} />
              </div>
              <div className='addAccountItemTopTitle'>Watch Account</div>
            </div>
            {/* <div className='addAccountItemClose' onClick={() => this.props.close()}>{'Done'}</div> */}
            <div className='addAccountItemSummary'>
              Watch accounts work like normal accounts but cannot sign
            </div>
          </div>
          <div className='addAccountItemOption'>
            <div
              className='addAccountItemOptionSetup'
              style={{ transform: `translateX(-${100 * formIndex}%)` }}
            >
              <div className='addAccountItemOptionSetupFrames'>
                <div
                  className='addAccountItemOptionSetupFrame'
                  aria-hidden={formIndex !== 0}
                  inert={formIndex !== 0}
                >
                  {!resolvingEnsName ? (
                    <>
                      <label htmlFor='addressInput' className='addAccountItemOptionTitle'>
                        input address or ENS name
                      </label>
                      <div className='addAccountItemOptionInput address'>
                        <input
                          autoFocus
                          id='addressInput'
                          value={address}
                          ref={this.forms[0]}
                          onChange={(e) => this.onChange('address', e)}
                          onFocus={(e) => this.onFocus('address', e)}
                          onBlur={(e) => this.onBlur('address', e)}
                          onKeyDown={(e) => this.keyPress(e)}
                        />
                      </div>
                      <button
                        type='button'
                        className='addAccountItemOptionSubmit'
                        onClick={() => this.create()}
                      >
                        Create
                      </button>
                    </>
                  ) : (
                    <div className='addAccountResolvingEns'>
                      <div className='addAccountItemOptionTitle'>Resolving ENS Name</div>
                      <div className='signerLoading'>
                        <div className='signerLoadingLoader' />
                      </div>
                      <button
                        type='button'
                        className='addAccountItemOptionSubmit'
                        onClick={() => this.restart()}
                      >
                        cancel
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className='addAccountItemOptionSetupFrame'
                  aria-hidden={formIndex !== 1}
                  inert={formIndex !== 1}
                >
                  {error ? (
                    <>
                      <div role='alert' className='addAccountItemOptionTitle'>
                        {status}
                      </div>
                      <button
                        type='button'
                        className='addAccountItemOptionSubmit'
                        onClick={() => this.restart()}
                      >
                        try again
                      </button>
                    </>
                  ) : creating ? (
                    <>
                      <div role='status' className='addAccountItemOptionTitle'>
                        Adding watch account...
                      </div>
                    </>
                  ) : status === 'Successful' ? (
                    <>
                      <div className='addAccountItemOptionTitle'>{'account added successfully'}</div>
                      <button
                        type='button'
                        className='addAccountItemOptionSubmit'
                        onClick={() => link.send('nav:back', 'dash', 2)}
                      >
                        back
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className='addAccountItemFooter' />
        </div>
      </div>
    )
  }
}

export default Restore.connect(AddAddress)
