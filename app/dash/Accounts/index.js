import React from 'react'
import Restore from 'react-restore'

import AccountTypeMark from '../../../resources/Components/AccountTypeMark'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { getAddress } from '../../../resources/utils'
import { accountSort as byCreation } from '../../../resources/domain/account'
import {
  getSignerStatusMeta,
  isHardwareSigner,
  isWatchOnlyAccountType
} from '../../../resources/domain/signer'
import { signerPanelCrumb } from '../../../resources/domain/nav'

import AddHardware from './Add/AddHardware'
import AddHardwareLattice from './Add/AddHardwareLattice'
import AddPhrase from './Add/AddPhrase'
import AddRing from './Add/AddRing'
import CreatePhrase from './Add/CreatePhrase'
import CreatePrivateKey from './Add/CreatePrivateKey'
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
  renderCreateSeed() {
    return (
      <div className='addAccounts cardShow'>
        <CreatePhrase />
      </div>
    )
  }
  renderCreateKeyring() {
    return (
      <div className='addAccounts cardShow'>
        <CreatePrivateKey />
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
    const { accountChooserMode } = this.props.data
    const showHardware = !accountChooserMode
    const showCreate = !accountChooserMode || accountChooserMode === 'create'
    const showImport = !accountChooserMode || accountChooserMode === 'import'
    const showWatch = !accountChooserMode
    const title =
      accountChooserMode === 'create'
        ? 'Create an account'
        : accountChooserMode === 'import'
          ? 'Import an account'
          : 'Choose an account type'

    return (
      <div className='addAccounts addAccountsChooser cardShow'>
        <div className='addAccountsHeader'>
          <div className='addAccountsHeaderTitle'>{title}</div>
        </div>
        {showHardware ? (
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
                <div className='accountTypeSelectIcon'>
                  <AccountTypeMark type='lattice' size={20} />
                </div>
                <div>{'GridPlus Lattice1'}</div>
              </button>
              <button
                type='button'
                className='accountTypeSelect'
                onClick={() => this.createNewAccount('ledger')}
              >
                <div className='accountTypeSelectIcon'>
                  <AccountTypeMark type='ledger' size={20} />
                </div>
                <div>{'Ledger device'}</div>
              </button>
              <button
                type='button'
                className='accountTypeSelect'
                onClick={() => this.createNewAccount('trezor')}
              >
                <div className='accountTypeSelectIcon'>
                  <AccountTypeMark type='trezor' size={20} />
                </div>
                <div>{'Trezor device'}</div>
              </button>
            </div>
          </section>
        ) : null}
        {showCreate ? (
          <section className='accountTypeGroup' aria-labelledby='account-type-create'>
            <h2 id='account-type-create' className='accountTypeGroupTitle'>
              Create new
            </h2>
            <div className='accountTypeList'>
              <button
                type='button'
                aria-label='Create recovery phrase'
                className='accountTypeSelect'
                onClick={() => this.createNewAccount('create-seed')}
              >
                <div className='accountTypeSelectIcon'>
                  <AccountTypeMark type='seed' size={20} />
                </div>
                <div>{'Recovery phrase'}</div>
              </button>
              <button
                type='button'
                aria-label='Create private key'
                className='accountTypeSelect'
                onClick={() => this.createNewAccount('create-keyring')}
              >
                <div className='accountTypeSelectIcon'>
                  <Icon name='key' size={20} />
                </div>
                <div>{'Private key'}</div>
              </button>
            </div>
          </section>
        ) : null}
        {showImport ? (
          <section className='accountTypeGroup' aria-labelledby='account-type-import'>
            <h2 id='account-type-import' className='accountTypeGroupTitle'>
              Import existing
            </h2>
            <div className='accountTypeList'>
              <button
                type='button'
                aria-label='Import recovery phrase'
                className='accountTypeSelect'
                onClick={() => this.createNewAccount('seed')}
              >
                <div className='accountTypeSelectIcon'>
                  <AccountTypeMark type='seed' size={20} />
                </div>
                <div>{'Recovery phrase'}</div>
              </button>
              <button
                type='button'
                aria-label='Import private key'
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
        ) : null}
        {showWatch ? (
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
        ) : null}
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
    } else if (newAccountType === 'create-seed') {
      return this.renderCreateSeed()
    } else if (newAccountType === 'create-keyring') {
      return this.renderCreateKeyring()
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
  openAccountChooser = (accountChooserMode) => {
    link.send('tray:action', 'navDash', {
      view: 'accounts',
      data: { showAddAccounts: true, accountChooserMode }
    })
  }

  watchAccount = () => {
    link.send('tray:action', 'navDash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'nonsigning' }
    })
  }

  signerForAccount = (account, signers) => {
    if (account.signer && signers[account.signer]) return signers[account.signer]

    const address = getAddress(account.address || account.id).toLowerCase()
    const matches = Object.values(signers).filter((signer) =>
      (signer.addresses || []).some((candidate) => candidate.toLowerCase() === address)
    )
    const sameType = matches.filter((signer) => signer.type === account.lastSignerType)
    if (sameType.length === 1) return sameType[0]
    if (matches.length === 1) return matches[0]
  }

  selectSigningAccount = (account, signer) => {
    const hardware = isHardwareSigner(account.lastSignerType)
    if (hardware) {
      link.send(
        'tray:action',
        'navDash',
        signer
          ? signerPanelCrumb(signer)
          : {
              view: 'accounts',
              data: { showAddAccounts: true, newAccountType: account.lastSignerType }
            }
      )
    }

    link.rpc('setSigner', account.id, (error) => {
      if (error) return
      if (!signer) return
      const status = getSignerStatusMeta(signer)
      if (hardware) {
        if (status.reloadable && !status.busy && !status.input) {
          link.send('dash:reloadSigner', signer.id)
        }
        return
      }
      if (status.ready) return

      link.send('tray:action', 'navDash', signerPanelCrumb(signer))
    })
  }

  renderAccountRow = (account, signers) => {
    const address = getAddress(account.address || account.id)
    const name = account.ensName || account.name || address
    const type = account.lastSignerType || 'address'
    const hardware = ['ledger', 'trezor', 'lattice'].includes(type)
    const signer = this.signerForAccount(account, signers)
    const signerStatus = signer ? getSignerStatusMeta(signer) : undefined
    const needsUnlock = hardware || Boolean(signerStatus && !signerStatus.ready)
    const detail = `${compactAccountAddress(address)}${
      signerStatus ? ` · ${signerStatus.label.toLowerCase()}` : hardware ? ' · connect device' : ''
    }`
    return (
      <button
        type='button'
        className='dashAccountSigner'
        key={account.id}
        aria-label={`${needsUnlock ? 'Select and unlock' : 'Select'} ${name} ${address}`}
        title={address}
        onClick={() => this.selectSigningAccount(account, signer)}
      >
        <span className='dashAccountSignerIcon'>
          <AccountTypeMark type={type} size={20} />
        </span>
        <span className='dashAccountSignerIdentity'>
          <strong>{name}</strong>
          <span>{detail}</span>
        </span>
        <span className='dashAccountSignerRole'>{hardware ? type : 'local'}</span>
        <Icon name='next' size={14} />
      </button>
    )
  }

  render() {
    const signers = this.store('main.signers') || {}
    const accounts = this.store('main.accounts') || {}
    const allAccounts = Object.keys(accounts)
      .map((id) => ({ id, ...accounts[id] }))
      .sort(byCreation)
    const signingAccounts = allAccounts.filter((account) => !isWatchOnlyAccountType(account.lastSignerType))
    const watchAccounts = allAccounts.filter((account) => isWatchOnlyAccountType(account.lastSignerType))
    const accountCount = Object.keys(accounts).length
    const { showAddAccounts } = this.props.data
    return showAddAccounts ? (
      <AddAccounts
        close={() =>
          link.send('tray:action', 'navDash', { view: 'accounts', data: { showAddAccounts: false } })
        }
        {...this.props}
      />
    ) : (
      <div className='localSettings dashAccountsPerch'>
        <div className='localSettingsWrap'>
          <section className='dashHomeCard dashAccountsSignerCard' aria-labelledby='dash-signers-title'>
            <div className='dashAccountsCardHeader'>
              <h2 id='dash-signers-title'>Signing accounts</h2>
            </div>
            {signingAccounts.length ? (
              <div className='dashAccountSignerLedger'>
                {signingAccounts.map((account) => this.renderAccountRow(account, signers))}
              </div>
            ) : (
              <p className='dashAccountsEmptyCopy'>No signing accounts yet.</p>
            )}
          </section>
          <section className='dashHomeCard dashAccountsWatchCard' aria-labelledby='dash-watch-accounts-title'>
            <div className='dashAccountsCardHeader'>
              <h2 id='dash-watch-accounts-title'>Watch accounts</h2>
            </div>
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
                        <AccountTypeMark type='address' size={20} />
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
            ) : (
              <p className='dashAccountsEmptyCopy'>
                Track addresses without holding keys. No signing capability.
              </p>
            )}
          </section>
          <section className='dashHomeCard dashAccountsAddCard' aria-labelledby='dash-add-account-title'>
            <div className='dashAccountsCardHeader'>
              <h2 id='dash-add-account-title'>Add account</h2>
            </div>
            <div className='dashAccountsActions'>
              <button type='button' onClick={() => this.openAccountChooser('create')}>
                <Icon name='lock' size={19} />
                <span>Derive new</span>
              </button>
              <button type='button' onClick={this.watchAccount}>
                <Icon name='eye' size={19} />
                <span>Watch</span>
              </button>
              <button type='button' onClick={() => this.openAccountChooser('import')}>
                <Icon name='file' size={19} />
                <span>Import</span>
              </button>
            </div>
          </section>
          {accountCount ? (
            <DelegationRevocation
              accounts={accounts}
              currentAccount={this.store('selected.current')}
              networks={this.store('main.networks.ethereum') || {}}
              signers={signers}
            />
          ) : null}
        </div>
      </div>
    )
  }
}

export default Restore.connect(Dash)
