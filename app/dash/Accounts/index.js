import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../resources/Components/Icon'
import WrenEmptyState from '../../../resources/Components/WrenEmptyState'
import link from '../../../resources/link'
import svg from '../../../resources/svg'
import { getAddress } from '../../../resources/utils'
import { isWatchOnlyAccountType } from '../../../resources/domain/signer'
import emptyAccounts from 'url:../../../asset/ui/empty-accounts-v2.png'

import Signer from '../Signer'

import AddHardware from './Add/AddHardware'
import AddHardwareLattice from './Add/AddHardwareLattice'
import AddPhrase from './Add/AddPhrase'
import AddRing from './Add/AddRing'
import AddKeystore from './Add/AddKeystore'
import AddAddress from './Add/AddAddress'
import { compactAccountAddress } from './address'
import { DelegationRevocation } from './DelegationRevocation'

export class AddAccounts extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      view: 'default'
    }
  }
  renderAddNonsigning() {
    return (
      <div className='addAccounts cardShow'>
        <AddAddress close={this.props.close} />
      </div>
    )
  }
  renderAddKeyring({ accountSetupStep, error }) {
    return (
      <div className='addAccounts cardShow'>
        <AddRing close={this.props.close} accountSetupStep={accountSetupStep} error={error} />
      </div>
    )
  }
  renderAddKeystore({ accountSetupStep, error }) {
    return (
      <div className='addAccounts cardShow'>
        <AddKeystore close={this.props.close} accountSetupStep={accountSetupStep} error={error} />
      </div>
    )
  }
  renderAddSeed({ accountSetupStep, error }) {
    return (
      <div className='addAccounts cardShow'>
        <AddPhrase close={this.props.close} accountSetupStep={accountSetupStep} error={error} />
      </div>
    )
  }
  renderAddTrezor() {
    return (
      <div className='addAccounts cardShow'>
        <AddHardware type={'trezor'} close={this.props.close} />
      </div>
    )
  }
  renderAddLedger() {
    return (
      <div className='addAccounts cardShow'>
        <AddHardware type={'ledger'} close={this.props.close} />
      </div>
    )
  }
  renderAddLattice() {
    return (
      <div className='addAccounts cardShow'>
        <AddHardwareLattice type={'lattice'} close={this.props.close} />
      </div>
    )
  }
  renderAddGnosis() {
    return <div className='addAccounts cardShow'>{'Add Gnosis'}</div>
  }
  createNewAccount(type) {
    link.send('tray:action', 'navDash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: type }
    })
  }
  renderDefault() {
    return (
      <div className='addAccounts addAccountsChooser cardShow'>
        <div className='addAccountsHeader'>
          <div className='addAccountsHeaderTitle'>Choose an account type</div>
        </div>
        <section className='accountTypeGroup' aria-labelledby='account-type-hardware'>
          <h2 id='account-type-hardware' className='accountTypeGroupTitle'>
            Hardware devices
          </h2>
          <div className='accountTypeList'>
            <button
              type='button'
              className='accountTypeSelect'
              onClick={() => this.createNewAccount('lattice')}
            >
              <div className='accountTypeSelectIcon'>{svg.lattice(20)}</div>
              <div>{'GridPlus Lattice1'}</div>
            </button>
            <button
              type='button'
              className='accountTypeSelect'
              onClick={() => this.createNewAccount('ledger')}
            >
              <div className='accountTypeSelectIcon'>{svg.ledger(20)}</div>
              <div>{'Ledger device'}</div>
            </button>
            <button
              type='button'
              className='accountTypeSelect'
              onClick={() => this.createNewAccount('trezor')}
            >
              <div className='accountTypeSelectIcon'>{svg.trezor(18)}</div>
              <div>{'Trezor device'}</div>
            </button>
          </div>
        </section>
        <section className='accountTypeGroup' aria-labelledby='account-type-local'>
          <h2 id='account-type-local' className='accountTypeGroupTitle'>
            Local accounts
          </h2>
          <div className='accountTypeList'>
            <button type='button' className='accountTypeSelect' onClick={() => this.createNewAccount('seed')}>
              <div className='accountTypeSelectIcon'>
                <Icon name='key' size={20} />
              </div>
              <div>{'Seed phrase'}</div>
            </button>
            <button
              type='button'
              className='accountTypeSelect'
              onClick={() => this.createNewAccount('keyring')}
            >
              <div className='accountTypeSelectIcon'>
                <Icon name='key' size={20} />
              </div>
              <div>{'Private key'}</div>
            </button>
            <button
              type='button'
              className='accountTypeSelect'
              onClick={() => this.createNewAccount('keystore')}
            >
              <div className='accountTypeSelectIcon'>
                <Icon name='file' size={20} />
              </div>
              <div>{'Keystore file (JSON)'}</div>
            </button>
          </div>
        </section>
        <section className='accountTypeGroup' aria-labelledby='account-type-watch'>
          <h2 id='account-type-watch' className='accountTypeGroupTitle'>
            Watch-only
          </h2>
          <div className='accountTypeList'>
            <button
              type='button'
              className='accountTypeSelect'
              onClick={() => this.createNewAccount('nonsigning')}
            >
              <div className='accountTypeSelectIcon'>
                <Icon name='watch' size={20} />
              </div>
              <div>{'Watch account'}</div>
            </button>
          </div>
        </section>
      </div>
    )
  }
  render() {
    const { newAccountType, accountSetupStep, error } = this.props.data

    if (newAccountType === 'ledger') {
      return this.renderAddLedger()
    } else if (newAccountType === 'trezor') {
      return this.renderAddTrezor()
    } else if (newAccountType === 'lattice') {
      return this.renderAddLattice()
    } else if (newAccountType === 'seed') {
      return this.renderAddSeed({ accountSetupStep, error })
    } else if (newAccountType === 'keyring') {
      return this.renderAddKeyring({ accountSetupStep, error })
    } else if (newAccountType === 'keystore') {
      return this.renderAddKeystore({ accountSetupStep, error })
    } else if (newAccountType === 'nonsigning') {
      return this.renderAddNonsigning()
    } else {
      return this.renderDefault()
    }
  }
}

export class Dash extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.input = React.createRef()
    this.state = {
      showAddAccounts: false
    }
  }
  render() {
    const signers = this.store('main.signers') || {}
    const accounts = this.store('main.accounts') || {}
    const hardwareSigners = Object.keys(signers)
      .map((s) => {
        const signer = signers[s]
        if (signer.type === 'ledger' || signer.type === 'trezor' || signer.type === 'lattice') {
          return signer
        } else {
          return false
        }
      })
      .filter((s) => s)
    const hotSigners = Object.keys(signers)
      .map((s) => {
        const signer = signers[s]
        if (signer.type === 'seed' || signer.type === 'ring') {
          return signer
        } else {
          return false
        }
      })
      .filter((s) => s)
    const watchAccounts = Object.keys(accounts)
      .map((id) => ({ id, ...accounts[id] }))
      .filter((account) => isWatchOnlyAccountType(account.lastSignerType))
    const accountCount = Object.keys(accounts).length
    const empty = accountCount === 0 && hardwareSigners.length === 0 && hotSigners.length === 0

    const { showAddAccounts } = this.props.data
    return showAddAccounts ? (
      <AddAccounts
        close={() =>
          link.send('tray:action', 'navDash', { view: 'accounts', data: { showAddAccounts: false } })
        }
        {...this.props}
      />
    ) : (
      <div className='cardShow'>
        <div className='signers'>
          <div className='signersMid'>
            {watchAccounts.length ? (
              <div className='watchAccounts'>
                {watchAccounts.map((account) => {
                  const address = getAddress(account.address || account.id)
                  const name = account.ensName || account.name || address
                  const compactAddress = compactAccountAddress(address)
                  return (
                    <button
                      type='button'
                      className='watchAccount'
                      key={account.id}
                      aria-label={`${name} ${address}`}
                      title={address}
                      onClick={() => link.rpc('setSigner', account.id, () => {})}
                    >
                      <span className='watchAccountIcon'>
                        <Icon name='watch' size={19} />
                      </span>
                      <span className='watchAccountIdentity'>
                        <span className='watchAccountName'>{name}</span>
                        <span className='watchAccountAddress'>{compactAddress}</span>
                      </span>
                      <Icon name='next' size={14} />
                    </button>
                  )
                })}
              </div>
            ) : null}
            {/* <div className='signersHeader'>
                Your Hardware Signers
              </div> */}
            <div className='signersList'>
              {hardwareSigners.length
                ? hardwareSigners
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                    .map((signer, index) => <Signer index={index} key={signer.id} {...signer} />)
                : null}
            </div>
            {/* <div className='signersHeader'>
                Your Hot Signers
              </div> */}
            <div className='signersList'>
              {hotSigners.length
                ? hotSigners.map((signer, index) => <Signer index={index} key={signer.id} {...signer} />)
                : null}
            </div>
            {!empty ? (
              <DelegationRevocation
                accounts={accounts}
                currentAccount={this.store('selected.current')}
                networks={this.store('main.networks.ethereum') || {}}
                signers={signers}
              />
            ) : null}
            {empty ? (
              <div className='accountsEmpty'>
                <WrenEmptyState
                  expanded
                  image={emptyAccounts}
                  title='No accounts yet'
                  copy='Add an account to connect, review, or sign.'
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(Dash)
