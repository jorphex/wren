import React from 'react'
import Restore from 'react-restore'
import AccountTypeMark from '../../../../../resources/Components/AccountTypeMark'
import Icon from '../../../../../resources/Components/Icon'

import link from '../../../../../resources/link'
import {
  findUnavailableSigners,
  getSignerStatusMeta,
  isHardwareSigner,
  isWatchOnlyAccountType
} from '../../../../../resources/domain/signer'
import { accountPanelCrumb, signerPanelCrumb } from '../../../../../resources/domain/nav'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'

export class Signer extends React.Component {
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
      notifySuccess: false,
      notifyText: '',
      openingDetails: false,
      verifying: false
    }
    this.mounted = false
    this.navigationPending = false
    this.verifyPending = false
  }

  componentDidMount() {
    this.mounted = true
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.notificationTimer)
    clearTimeout(this.unavailableTimer)
    if (this.resizeObserver) this.resizeObserver.disconnect()
  }

  verifyAddress(hardwareSigner) {
    if (this.verifyPending) return
    this.verifyPending = true
    this.setState({ verifying: true })
    if (hardwareSigner) {
      // prompt for on-signer verification
      this.setState({ notifySuccess: false, notifyText: 'Verify address on signer' })
    }
    link.rpc('verifyAddress', (err) => {
      if (!this.mounted) return
      this.verifyPending = false
      if (err) {
        this.setState({ notifySuccess: false, notifyText: err, verifying: false })
      } else {
        this.setState({ notifySuccess: true, notifyText: 'Address matched', verifying: false })
      }
      clearTimeout(this.notificationTimer)
      this.notificationTimer = setTimeout(() => {
        this.setState({ notifySuccess: false, notifyText: '' })
      }, 5000)
    })
  }

  openSignerDetails(activeAccount, activeSigner) {
    if (this.navigationPending) return
    this.navigationPending = true
    this.setState({ openingDetails: true })

    const getUnavailableSigner = () => {
      const signers = Object.values(this.store('main.signers'))
      const unavailableSigners = findUnavailableSigners(activeAccount.lastSignerType, signers)
      return unavailableSigners.length === 1 && unavailableSigners[0]
    }
    const signer = activeSigner || getUnavailableSigner()
    if (!signer) {
      this.setState({ notifySuccess: false, notifyText: 'Signer unavailable' })
      clearTimeout(this.unavailableTimer)
      this.unavailableTimer = setTimeout(() => {
        this.setState({ notifySuccess: false, notifyText: '' })
      }, 5000)
    }
    const crumb = signer ? signerPanelCrumb(signer) : accountPanelCrumb()
    link.send('tray:action', 'navDash', crumb)
  }

  renderSignerType(type) {
    if (type === 'lattice') {
      return (
        <div className='moduleItemSignerType'>
          <div className='moduleItemIcon'>
            <AccountTypeMark type={type} size={17} />
          </div>
          <div>{'GridPlus'}</div>
        </div>
      )
    } else if (type === 'ledger') {
      return (
        <div className='moduleItemSignerType'>
          <div className='moduleItemIcon'>
            <AccountTypeMark type={type} size={17} />
          </div>
          <div>{'Ledger'}</div>
        </div>
      )
    } else if (type === 'trezor') {
      return (
        <div className='moduleItemSignerType'>
          <div className='moduleItemIcon'>
            <AccountTypeMark type={type} size={17} />
          </div>
          <div>{'Trezor'}</div>
        </div>
      )
    } else if (type === 'seed' || type === 'ring') {
      return (
        <div className='moduleItemSignerType'>
          <div className='moduleItemIcon'>
            <Icon name='hot' size={16} />
          </div>
          <div>{'Hot'}</div>
        </div>
      )
    } else {
      return (
        <div className='moduleItemSignerType'>
          <div>{'Watch-only'}</div>
        </div>
      )
    }
  }

  getCurrentStatus(activeSigner, hardwareSigner) {
    const style = {}
    let status = 'No signer'

    if (activeSigner) {
      const signerStatus = getSignerStatusMeta(activeSigner)
      status = signerStatus.label
      if (signerStatus.tone === 'positive') {
        style.color = 'var(--good)'
      } else if (signerStatus.tone === 'warning') {
        style.color = 'var(--moon)'
      } else if (signerStatus.tone === 'danger') {
        style.color = 'var(--bad)'
      }
    } else if (hardwareSigner) {
      style.color = 'var(--bad)'
      status = 'Device disconnected'
    } else {
      style.color = 'var(--wren-text-muted)'
    }

    return (
      <div className='signerPreviewStatus' style={style}>
        {status}
      </div>
    )
  }

  render() {
    const activeAccount = this.store('main.accounts', this.props.account)

    let activeSigner

    if (activeAccount.signer) {
      activeSigner = this.store('main.signers', activeAccount.signer)
    }

    const hardwareSigner = isHardwareSigner(activeAccount.lastSignerType)
    const watchOnly = isWatchOnlyAccountType(activeAccount.lastSignerType)

    return (
      <div className='balancesBlock accountLedgerModule' ref={this.moduleRef}>
        <Cluster>
          <ClusterRow className='signerPreviewRow accountLedgerRow'>
            <div className='accountLedgerLabel'>
              <span>
                <Icon name='sign' size={18} />
              </span>
              <span>{'Signer'}</span>
            </div>
            <ClusterValue
              ariaLabel='Open signer details'
              disabled={this.state.openingDetails}
              onClick={() => this.openSignerDetails(activeAccount, activeSigner)}
            >
              <div className='signerPreviewSummary'>
                {this.renderSignerType(activeAccount.lastSignerType)}
                {this.getCurrentStatus(activeSigner, hardwareSigner)}
              </div>
            </ClusterValue>
            {!watchOnly && (
              <ClusterValue
                ariaLabel='Verify account address on signer'
                disabled={this.state.verifying}
                grow={0}
                onClick={() => this.verifyAddress(hardwareSigner)}
                style={{ flexBasis: '72px' }}
              >
                <Icon name='verify' size={20} />
              </ClusterValue>
            )}
          </ClusterRow>
          {this.state.notifyText && (
            <ClusterRow>
              <ClusterValue>
                <div
                  className='clusterTag'
                  style={{
                    color: this.state.notifySuccess ? 'var(--good)' : 'var(--bad)'
                  }}
                >
                  {this.state.notifyText}
                </div>
              </ClusterValue>
            </ClusterRow>
          )}
        </Cluster>
      </div>
    )
  }
}

export default Restore.connect(Signer)
