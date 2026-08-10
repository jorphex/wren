import React from 'react'
import Restore from 'react-restore'

import emptyContacts from 'url:../../../asset/ui/empty-contacts-v5.png'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { exportAddressBook, importAddressBook, removeAddressBookEntry, saveAddressBookEntry } from './api'

const shortAddress = (address) => `${address.slice(0, 8)}...${address.slice(-6)}`
const completeEnsName = (value) => /\.[a-z]{2,}$/i.test(value.trim())
const completeAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim())
const initials = (name) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

const resolveEnsName = (name) =>
  new Promise((resolve, reject) => {
    link.rpc('resolveEnsName', name, (error, address) => {
      if (error || !address) return reject(new Error('ENS name could not be resolved'))
      resolve(address)
    })
  })

export class AddressBookEditor extends React.Component {
  constructor(props) {
    super(props)
    const entry = props.entry || {}
    const seed = props.seed?.trim() || ''
    const seedAddress = completeAddress(seed) || completeEnsName(seed)
    this.ensSequence = 0
    this.state = {
      address: entry.address || (seedAddress ? seed : ''),
      ensInput: '',
      ensStatus: '',
      name: entry.name || (seed && !seedAddress ? seed : ''),
      nameDirty: Boolean(entry.name || (seed && !seedAddress)),
      note: entry.note || '',
      error: '',
      resolving: false,
      saving: false
    }
  }

  componentDidMount() {
    if (!this.props.entry && completeEnsName(this.state.address)) this.scheduleEnsResolution(this.state.address)
  }

  componentWillUnmount() {
    clearTimeout(this.ensTimer)
    this.ensSequence += 1
  }

  scheduleEnsResolution(value) {
    clearTimeout(this.ensTimer)
    const sequence = ++this.ensSequence
    this.setState({ ensStatus: 'resolving' })
    this.ensTimer = setTimeout(() => this.resolveEnsInput(value, sequence), 320)
  }

  async resolveEnsInput(value, sequence = ++this.ensSequence) {
    const ensName = value.trim()
    if (!completeEnsName(ensName)) return
    this.setState({ ensStatus: 'resolving', error: '', resolving: true })
    try {
      const address = await resolveEnsName(ensName)
      if (sequence !== this.ensSequence || this.state.address.trim() !== ensName) return
      this.setState((state) => ({
        address,
        ensInput: ensName,
        ensStatus: 'resolved',
        name: state.nameDirty ? state.name : ensName,
        resolving: false
      }))
      return address
    } catch {
      if (sequence !== this.ensSequence || this.state.address.trim() !== ensName) return
      this.setState({ ensStatus: 'failed', error: '', resolving: false })
    }
  }

  updateAddress(address) {
    clearTimeout(this.ensTimer)
    this.ensSequence += 1
    this.setState({ address, ensInput: '', ensStatus: '', error: '', resolving: false })
    if (completeEnsName(address)) this.scheduleEnsResolution(address)
  }

  async submit(event) {
    event.preventDefault()
    if (this.state.saving || this.state.resolving) return

    this.setState({ error: '', saving: true })
    try {
      let address = this.state.address.trim()
      if (!this.props.entry && address.includes('.')) {
        clearTimeout(this.ensTimer)
        this.ensSequence += 1
        this.setState({ saving: false })
        address = await this.resolveEnsInput(address)
        if (!address) return
        this.setState({ address, resolving: false, saving: true })
      }

      const request = {
        mode: this.props.entry ? 'edit' : 'add',
        address,
        name: this.state.name,
        note: this.state.note
      }
      await saveAddressBookEntry(request)
      link.send('tray:action', 'backDash')
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Contact could not be saved',
        resolving: false,
        saving: false
      })
    }
  }

  render() {
    const editing = Boolean(this.props.entry)
    const pending = this.state.resolving || this.state.saving

    return (
      <form className='addressBookEditor cardShow' onSubmit={(event) => this.submit(event)}>
        <header className='addressBookEditorHeader'>
          <div className='addressBookEditorIcon'>
            <Icon name='contacts' size={24} />
          </div>
          <div>
            <h2>{editing ? 'Edit contact' : 'New contact'}</h2>
            <p>
              {editing
                ? 'Update this local label or note.'
                : 'Save an address you can recognize during review.'}
            </p>
          </div>
        </header>

        <label
          className={`addressBookField ${this.state.ensStatus === 'failed' ? 'addressBookFieldError' : ''}`}
        >
          <span>Address or ENS name</span>
          <input
            className='wrenInput'
            autoComplete='off'
            autoFocus={!editing}
            disabled={editing || this.state.saving}
            maxLength={255}
            onChange={(event) => this.updateAddress(event.target.value)}
            placeholder='0x... or name.eth'
            spellCheck={false}
            value={this.state.address}
          />
          {!editing && this.state.ensStatus ? (
            <small
              className={`addressBookEnsStatus addressBookEnsStatus${this.state.ensStatus}`}
              role={this.state.ensStatus === 'failed' ? 'alert' : 'status'}
            >
              {this.state.ensStatus === 'resolving'
                ? 'Resolving ENS name…'
                : this.state.ensStatus === 'resolved'
                  ? 'ENS name resolved'
                  : "Couldn’t resolve ENS name. Check the name and try again."}
            </small>
          ) : null}
        </label>

        <label className='addressBookField'>
          <span>Name</span>
          <input
            className='wrenInput'
            autoComplete='off'
            disabled={this.state.saving}
            maxLength={80}
            onChange={(event) => this.setState({ name: event.target.value, nameDirty: true, error: '' })}
            placeholder='Treasury, teammate, protocol'
            value={this.state.name}
          />
        </label>

        <label className='addressBookField'>
          <span>
            Note <small>optional</small>
          </span>
          <textarea
            className='wrenInput'
            disabled={this.state.saving}
            maxLength={280}
            onChange={(event) => this.setState({ note: event.target.value, error: '' })}
            placeholder='How you use this address'
            rows={3}
            value={this.state.note}
          />
          <small>{this.state.note.length}/280</small>
        </label>

        {this.state.error ? (
          <div className='addressBookError' role='alert'>
            {this.state.error}
          </div>
        ) : null}

        <button
          className='addressBookPrimaryButton wrenControl wrenControlPrimary wrenControlLarge wrenHeroPrimary'
          disabled={
            pending ||
            (!completeAddress(this.state.address) && !completeEnsName(this.state.address)) ||
            !this.state.name.trim()
          }
          type='submit'
        >
          {this.state.resolving ? 'Resolving ENS…' : this.state.saving ? 'Saving…' : 'Save Contact'}
        </button>
      </form>
    )
  }
}

export class AddressBook extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = { filter: '', confirmDelete: '', status: '', working: false }
  }

  componentWillUnmount() {
    clearTimeout(this.statusTimer)
  }

  setTransientStatus(status) {
    clearTimeout(this.statusTimer)
    this.setState({ status })
    this.statusTimer = setTimeout(() => this.setState({ status: '' }), 4000)
  }

  openEditor(address) {
    link.send('tray:action', 'navDash', {
      view: 'addressBook',
      data: {
        screen: 'edit',
        ...(address ? { address } : {}),
        ...(!address && this.state.filter.trim() ? { seed: this.state.filter.trim() } : {})
      }
    })
  }

  async remove(address) {
    if (this.state.confirmDelete !== address) {
      this.setState({ confirmDelete: address, status: '' })
      return
    }

    this.setState({ working: true, status: '' })
    try {
      await removeAddressBookEntry(address)
      this.setState({ confirmDelete: '', working: false })
      this.setTransientStatus('Contact removed')
    } catch (error) {
      this.setState({
        working: false,
        status: error instanceof Error ? error.message : 'Contact could not be removed'
      })
    }
  }

  async transfer(operation) {
    if (this.state.working) return
    this.setState({ working: true, status: '', confirmDelete: '' })
    try {
      const result = operation === 'import' ? await importAddressBook() : await exportAddressBook()
      if (result.canceled) return this.setState({ working: false })
      this.setState({ working: false })
      this.setTransientStatus(
        operation === 'import'
          ? `Imported ${result.imported}; skipped ${result.skipped} existing or excess entr${
              result.skipped === 1 ? 'y' : 'ies'
            }.`
          : `Exported ${result.exported} contact${result.exported === 1 ? '' : 's'}.`
      )
    } catch (error) {
      this.setState({
        working: false,
        status: error instanceof Error ? error.message : 'Contact operation failed'
      })
    }
  }

  renderList(addressBook) {
    const filter = this.state.filter.trim().toLowerCase()
    const entries = Object.values(addressBook)
      .filter(({ address, name, note }) =>
        !filter ? true : [address, name, note].some((value) => value.toLowerCase().includes(filter))
      )
      .sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address))

    return (
      <div className='addressBook cardShow'>
        <div className='addressBookToolbar'>
          <label className='addressBookSearch'>
            <Icon name='search' size={15} />
            <input
              aria-label='Search contacts'
              className='wrenInput wrenInputQuiet'
              onChange={(event) => {
                clearTimeout(this.statusTimer)
                this.setState({ filter: event.target.value, confirmDelete: '', status: '' })
              }}
              placeholder='Search name, note, or address'
              spellCheck={false}
              value={this.state.filter}
            />
          </label>
          <button
            className='wrenControl wrenControlSecondary'
            onClick={() => this.openEditor()}
            type='button'
          >
            Add
          </button>
        </div>

        {entries.length ? (
          <div className='addressBookList'>
            {entries.map((entry) => (
              <article className='addressBookRow' key={entry.address}>
                <button
                  aria-label={`Edit ${entry.name}`}
                  className='addressBookCardMain'
                  onClick={() => this.openEditor(entry.address)}
                  type='button'
                >
                  <span className='addressBookAvatar'>{initials(entry.name)}</span>
                  <span className='addressBookIdentity'>
                    <strong>{entry.name}</strong>
                    <span className='addressBookAddress'>{shortAddress(entry.address)}</span>
                    {entry.note ? <span className='addressBookNote'>{entry.note}</span> : null}
                  </span>
                </button>
                <button
                  aria-label={`${this.state.confirmDelete === entry.address ? 'Confirm removing' : 'Remove'} ${entry.name}`}
                  className={
                    this.state.confirmDelete === entry.address
                      ? 'addressBookRemove addressBookRemoveConfirm wrenControl wrenControlDanger wrenControlCompact'
                      : 'addressBookRemove wrenControl wrenControlGhost wrenControlCompact'
                  }
                  disabled={this.state.working}
                  onClick={() => this.remove(entry.address)}
                  type='button'
                >
                  {this.state.confirmDelete === entry.address ? 'Confirm' : 'Remove'}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className='addressBookEmpty'>
            {filter ? (
              <div className='addressBookEmptyIcon'>
                <Icon name='contacts' size={28} />
              </div>
            ) : (
              <img alt='' aria-hidden='true' className='addressBookEmptyArtwork' src={emptyContacts} />
            )}
            <strong>{filter ? 'No contacts match' : 'No saved contacts'}</strong>
            <span>{filter ? 'Try another search.' : 'Save addresses you recognize and verify often.'}</span>
          </div>
        )}

        <div className='addressBookTransfer'>
          <button
            className='wrenControl wrenControlGhost wrenControlCompact'
            disabled={this.state.working}
            onClick={() => this.transfer('import')}
            type='button'
          >
            Import JSON
          </button>
          <button
            className='wrenControl wrenControlGhost wrenControlCompact'
            disabled={this.state.working}
            onClick={() => this.transfer('export')}
            type='button'
          >
            Export JSON
          </button>
        </div>
        {this.state.status ? (
          <div className='addressBookStatus' role='status'>
            {this.state.status}
          </div>
        ) : null}
      </div>
    )
  }

  render() {
    const addressBook = this.store('main.addressBook') || {}
    const { address, screen, seed } = this.props.data || {}
    if (screen === 'edit') {
      const entry = address ? addressBook[address.toLowerCase()] : undefined
      if (address && !entry) {
        return (
          <div className='addressBookMissing cardShow'>
            <div>
              <Icon name='contacts' size={28} />
            </div>
            <strong>Contact not found</strong>
            <span>It may have been removed or replaced by imported contacts.</span>
            <button
              className='wrenControl wrenControlSecondary'
              onClick={() => link.send('tray:action', 'backDash')}
              type='button'
            >
              Return to Contacts
            </button>
          </div>
        )
      }
      return <AddressBookEditor entry={entry} key={address || seed || 'new'} seed={seed} />
    }
    return this.renderList(addressBook)
  }
}

export default Restore.connect(AddressBook)
