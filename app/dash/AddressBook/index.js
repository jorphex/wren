import React from 'react'
import Restore from 'react-restore'

import emptyContacts from 'url:../../../asset/ui/empty-contacts.png'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { exportAddressBook, importAddressBook, removeAddressBookEntry, saveAddressBookEntry } from './api'

const shortAddress = (address) => `${address.slice(0, 8)}...${address.slice(-6)}`
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
    this.state = {
      address: entry.address || '',
      name: entry.name || '',
      note: entry.note || '',
      error: '',
      resolving: false,
      saving: false
    }
  }

  async submit(event) {
    event.preventDefault()
    if (this.state.saving || this.state.resolving) return

    this.setState({ error: '', saving: true })
    try {
      let address = this.state.address.trim()
      if (!this.props.entry && address.includes('.')) {
        this.setState({ resolving: true, saving: false })
        address = await resolveEnsName(address)
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
            <p>{editing ? 'Update the local name or note.' : 'Save a trusted address for review.'}</p>
          </div>
        </header>

        <label className='addressBookField'>
          <span>Address or ENS name</span>
          <input
            autoComplete='off'
            autoFocus={!editing}
            disabled={editing || pending}
            maxLength={255}
            onChange={(event) => this.setState({ address: event.target.value, error: '' })}
            placeholder='0x... or name.eth'
            spellCheck={false}
            value={this.state.address}
          />
          {!editing && this.state.address.includes('.') ? (
            <small>The ENS name will be resolved once; only its address is stored.</small>
          ) : null}
        </label>

        <label className='addressBookField'>
          <span>Name</span>
          <input
            autoComplete='off'
            disabled={pending}
            maxLength={80}
            onChange={(event) => this.setState({ name: event.target.value, error: '' })}
            placeholder='Treasury, teammate, protocol...'
            value={this.state.name}
          />
        </label>

        <label className='addressBookField'>
          <span>
            Note <small>optional</small>
          </span>
          <textarea
            disabled={pending}
            maxLength={280}
            onChange={(event) => this.setState({ note: event.target.value, error: '' })}
            placeholder='Why you trust or use this address'
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

        <button className='addressBookPrimaryButton' disabled={pending} type='submit'>
          {this.state.resolving ? 'Resolving ENS...' : this.state.saving ? 'Saving...' : 'Save Contact'}
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

  openEditor(address) {
    link.send('tray:action', 'navDash', {
      view: 'addressBook',
      data: { screen: 'edit', ...(address ? { address } : {}) }
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
      this.setState({ confirmDelete: '', working: false, status: 'Contact removed.' })
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
      this.setState({
        working: false,
        status:
          operation === 'import'
            ? `Imported ${result.imported}; skipped ${result.skipped} existing or excess entr${
                result.skipped === 1 ? 'y' : 'ies'
              }.`
            : `Exported ${result.exported} contact${result.exported === 1 ? '' : 's'}.`
      })
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
        <header className='addressBookHeader'>
          <div>
            <h2>Trusted destinations</h2>
            <p>Local labels appear during transaction review. Always verify the address.</p>
          </div>
          <div className='addressBookCount'>{Object.keys(addressBook).length}</div>
        </header>

        <div className='addressBookToolbar'>
          <input
            aria-label='Search contacts'
            onChange={(event) => this.setState({ filter: event.target.value, confirmDelete: '' })}
            placeholder='Search name, note, or address'
            spellCheck={false}
            value={this.state.filter}
          />
          <button onClick={() => this.openEditor()} type='button'>
            Add
          </button>
        </div>

        {entries.length ? (
          <div className='addressBookList'>
            {entries.map((entry) => (
              <article className='addressBookCard' key={entry.address}>
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
                      ? 'addressBookRemove addressBookRemoveConfirm'
                      : 'addressBookRemove'
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
            <span>{filter ? 'Try another search.' : 'Add addresses you recognize and verify often.'}</span>
          </div>
        )}

        <div className='addressBookTransfer'>
          <button disabled={this.state.working} onClick={() => this.transfer('import')} type='button'>
            Import JSON
          </button>
          <button disabled={this.state.working} onClick={() => this.transfer('export')} type='button'>
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
    const { address, screen } = this.props.data || {}
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
            <button onClick={() => link.send('tray:action', 'backDash')} type='button'>
              Return to Contacts
            </button>
          </div>
        )
      }
      return <AddressBookEditor entry={entry} key={address || 'new'} />
    }
    return this.renderList(addressBook)
  }
}

export default Restore.connect(AddressBook)
