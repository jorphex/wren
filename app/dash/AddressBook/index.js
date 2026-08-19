import React from 'react'
import Restore from 'react-restore'

import emptyContacts from 'url:../../../asset/ui/empty-contacts-v5.png'
import DialogSurface from '../../../resources/Components/DialogSurface'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { exportAddressBook, importAddressBook, removeAddressBookEntry, saveAddressBookEntry } from './api'

const completeEnsName = (value) => /\.[a-z]{2,}$/i.test(value.trim())
const completeAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim())
const provenanceStatus = (entry) => entry?.provenance?.status || 'saved'
const verifiedDate = (entry) => {
  if (entry?.provenance?.status !== 'verified-out-of-band') return ''
  const date = new Date(entry.provenance.verifiedAt)
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toISOString().slice(0, 10)
}

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
      provenanceStatus: provenanceStatus(entry),
      verificationNote: entry.provenance?.status === 'verified-out-of-band' ? entry.provenance.note : '',
      error: '',
      resolving: false,
      saving: false
    }
  }

  componentDidMount() {
    if (!this.props.entry && completeEnsName(this.state.address))
      this.scheduleEnsResolution(this.state.address)
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

      const currentProvenance = this.props.entry?.provenance || { status: 'saved' }
      const provenanceChanged =
        this.state.provenanceStatus !== currentProvenance.status ||
        (this.state.provenanceStatus === 'verified-out-of-band' &&
          this.state.verificationNote.trim() !== (currentProvenance.note || ''))
      const request = {
        mode: this.props.entry ? 'edit' : 'add',
        address,
        name: this.state.name,
        note: this.state.note,
        ...(provenanceChanged
          ? {
              provenance:
                this.state.provenanceStatus === 'verified-out-of-band'
                  ? { status: 'verified-out-of-band', note: this.state.verificationNote }
                  : { status: 'saved' }
            }
          : {})
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
    const clearsVerification =
      this.props.entry?.provenance?.status === 'verified-out-of-band' &&
      this.state.provenanceStatus === 'saved'

    return (
      <form className='addressBookEditor cardShow' onSubmit={(event) => this.submit(event)}>
        <div className='addressBookEditorScroll'>
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
              aria-readonly={editing ? 'true' : undefined}
              className='wrenInput'
              autoComplete='off'
              autoFocus={!editing}
              disabled={this.state.saving}
              maxLength={255}
              onChange={(event) => this.updateAddress(event.target.value)}
              placeholder='0x... or name.eth'
              spellCheck={false}
              readOnly={editing}
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
                    : 'Couldn’t resolve ENS name. Check the name and try again.'}
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

          <fieldset className='addressBookProvenanceField'>
            <legend>Address check</legend>
            <div className='addressBookProvenanceOptions'>
              <label>
                <input
                  checked={this.state.provenanceStatus === 'saved'}
                  disabled={this.state.saving}
                  name='contact-provenance'
                  onChange={() => this.setState({ provenanceStatus: 'saved', error: '' })}
                  type='radio'
                  value='saved'
                />
                <span>Saved only</span>
              </label>
              <label>
                <input
                  checked={this.state.provenanceStatus === 'verified-out-of-band'}
                  disabled={this.state.saving}
                  name='contact-provenance'
                  onChange={() => this.setState({ provenanceStatus: 'verified-out-of-band', error: '' })}
                  type='radio'
                  value='verified-out-of-band'
                />
                <span>Checked outside Wren</span>
              </label>
            </div>
            <small>
              {clearsVerification
                ? 'Saving as Saved only clears the check date and note.'
                : this.state.provenanceStatus === 'verified-out-of-band'
                  ? 'You checked this address outside Wren. Wren does not verify it. Compare the full address before signing.'
                  : 'Wren stores your label. Wren does not verify this address.'}
            </small>
            {this.state.provenanceStatus === 'verified-out-of-band' ? (
              <label className='addressBookField addressBookVerificationNote'>
                <span>
                  Check note <small>optional</small>
                </span>
                <textarea
                  aria-describedby='addressBookVerificationCount'
                  className='wrenInput'
                  disabled={this.state.saving}
                  maxLength={280}
                  onChange={(event) => this.setState({ verificationNote: event.target.value, error: '' })}
                  placeholder='Where or how you checked this address'
                  rows={2}
                  value={this.state.verificationNote}
                />
                <small id='addressBookVerificationCount'>{this.state.verificationNote.length}/280</small>
              </label>
            ) : null}
            {this.props.entry?.provenance?.status === 'verified-out-of-band' ? (
              <small>{`Checked ${verifiedDate(this.props.entry)}`}</small>
            ) : null}
          </fieldset>

          <label className='addressBookField'>
            <span>
              Note <small>optional</small>
            </span>
            <textarea
              aria-describedby='addressBookNoteCount'
              className='wrenInput'
              disabled={this.state.saving}
              maxLength={280}
              onChange={(event) => this.setState({ note: event.target.value, error: '' })}
              placeholder='How you use this address'
              rows={3}
              value={this.state.note}
            />
            <small id='addressBookNoteCount'>{this.state.note.length}/280</small>
          </label>

          {this.state.error ? (
            <div className='addressBookError' role='alert'>
              {this.state.error}
            </div>
          ) : null}
        </div>
        <div className='addressBookActionShelf'>
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
        </div>
      </form>
    )
  }
}

export class AddressBook extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = { filter: '', confirmDelete: '', status: '', working: false }
    this.removeButtons = new Map()
    this.removeCancelRef = React.createRef()
    this.removeReturnFocusRef = React.createRef()
    this.searchRef = React.createRef()
    this.removeReturnFocusAddress = ''
    this.removePending = false
  }

  componentWillUnmount() {
    clearTimeout(this.statusTimer)
    this.removeButtons.clear()
  }

  setTransientStatus(status) {
    clearTimeout(this.statusTimer)
    this.setState({ status })
    this.statusTimer = setTimeout(() => this.setState({ status: '' }), 4000)
  }

  openEditor(address) {
    clearTimeout(this.statusTimer)
    this.dismissRemoveConfirmation()
    this.setState({ confirmDelete: '', status: '' })
    link.send('tray:action', 'navDash', {
      view: 'addressBook',
      data: {
        screen: 'edit',
        ...(address ? { address } : {}),
        ...(!address && this.state.filter.trim() ? { seed: this.state.filter.trim() } : {})
      }
    })
  }

  copy(entry) {
    if (this.state.working) return
    this.dismissRemoveConfirmation()
    this.setState({ confirmDelete: '' })
    link.send('tray:clipboardData', entry.address)
    this.setTransientStatus(`${entry.name} address copied`)
  }

  setRemoveButtonRef(address, element) {
    if (element) {
      this.removeButtons.set(address, element)
      if (this.removeReturnFocusAddress === address) this.removeReturnFocusRef.current = element
    } else {
      this.removeButtons.delete(address)
    }
  }

  dismissRemoveConfirmation() {
    this.removeReturnFocusAddress = ''
    this.removeReturnFocusRef.current = null
  }

  openRemoveConfirmation(address) {
    if (this.state.working) return
    clearTimeout(this.statusTimer)
    this.removeReturnFocusAddress = address
    this.removeReturnFocusRef.current = this.removeButtons.get(address)
    this.setState({ confirmDelete: address, status: '' })
  }

  cancelRemoveConfirmation() {
    if (this.state.working || this.removePending) return
    this.setState({ confirmDelete: '', status: '' }, () => this.removeReturnFocusRef.current?.focus())
  }

  async confirmRemove(address) {
    if (this.state.working || this.removePending || this.state.confirmDelete !== address) return

    this.removePending = true
    this.setState({ working: true, status: '' })
    try {
      await removeAddressBookEntry(address)
      this.removePending = false
      this.setState({ confirmDelete: '', working: false }, () => this.searchRef.current?.focus())
      this.setTransientStatus('Contact removed')
    } catch (error) {
      this.removePending = false
      this.setState({
        working: false,
        status: error instanceof Error ? error.message : 'Contact could not be removed'
      })
    }
  }

  async transfer(operation) {
    if (this.state.working) return
    this.dismissRemoveConfirmation()
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
      .filter(({ address, name, note, provenance }) =>
        !filter
          ? true
          : [address, name, note, provenance?.note || ''].some((value) =>
              value.toLowerCase().includes(filter)
            )
      )
      .sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address))

    return (
      <div className='addressBook cardShow'>
        <div className='addressBookToolbar'>
          <label className='addressBookSearch'>
            <Icon name='search' size={15} />
            <input
              ref={this.searchRef}
              aria-label='Search contacts'
              className='wrenInput wrenInputQuiet'
              onChange={(event) => {
                clearTimeout(this.statusTimer)
                this.dismissRemoveConfirmation()
                this.setState({ filter: event.target.value, confirmDelete: '', status: '' })
              }}
              placeholder='Search name, note, or address'
              spellCheck={false}
              value={this.state.filter}
            />
          </label>
        </div>

        {entries.length ? (
          <div className='addressBookList'>
            {entries.map((entry) =>
              this.state.confirmDelete === entry.address ? (
                <DialogSurface
                  as='article'
                  className='addressBookRow addressBookRemovalDialog'
                  key={entry.address}
                  role='alertdialog'
                  ariaLabel={`Remove ${entry.name}?`}
                  busy={this.state.working || this.removePending}
                  modal
                  initialFocusRef={this.removeCancelRef}
                  returnFocusRef={this.removeReturnFocusRef}
                  onCancel={() => this.cancelRemoveConfirmation()}
                >
                  <span className='addressBookRemovalCopy'>
                    <strong>{`Remove ${entry.name}?`}</strong>
                    <span>This removes the saved contact from Wren. Funds are not affected.</span>
                  </span>
                  <button
                    ref={this.removeCancelRef}
                    className='addressBookEdit wrenControl wrenControlGhost wrenControlCompact'
                    disabled={this.state.working}
                    onClick={() => this.cancelRemoveConfirmation()}
                    type='button'
                  >
                    Cancel
                  </button>
                  <button
                    aria-label={`${this.state.working ? 'Removing' : 'Confirm removing'} ${entry.name}`}
                    className='addressBookRemove addressBookRemoveConfirm wrenControl wrenControlDanger wrenControlCompact'
                    disabled={this.state.working}
                    onClick={() => this.confirmRemove(entry.address)}
                    type='button'
                  >
                    {this.state.working ? 'Removing…' : 'Confirm'}
                  </button>
                </DialogSurface>
              ) : (
                <article className='addressBookRow' key={entry.address}>
                  <button
                    className='addressBookCardMain'
                    disabled={this.state.working}
                    onClick={() => this.copy(entry)}
                    type='button'
                  >
                    <span className='addressBookCopyPrompt'>Copy address for</span>
                    <span className='addressBookIdentity'>
                      <strong>{entry.name}</strong>
                      <span className='addressBookAddress'>{entry.address}</span>
                      {entry.note ? <span className='addressBookNote'>{entry.note}</span> : null}
                      {entry.provenance.status === 'verified-out-of-band' ? (
                        <span
                          className='addressBookVerificationSummary'
                          title={entry.provenance.note || undefined}
                        >
                          {`Checked ${verifiedDate(entry)}${
                            entry.provenance.note ? ` · ${entry.provenance.note}` : ''
                          }`}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    aria-label={`Edit ${entry.name}`}
                    className='addressBookEdit wrenControl wrenControlGhost wrenControlCompact'
                    disabled={this.state.working}
                    onClick={() => this.openEditor(entry.address)}
                    type='button'
                  >
                    Edit
                  </button>
                  <button
                    ref={(element) => this.setRemoveButtonRef(entry.address, element)}
                    aria-label={`Remove ${entry.name}`}
                    className='addressBookRemove wrenControl wrenControlGhost wrenControlCompact'
                    disabled={this.state.working}
                    onClick={() => this.openRemoveConfirmation(entry.address)}
                    type='button'
                  >
                    Remove
                  </button>
                </article>
              )
            )}
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
        <p className='addressBookExportNotice'>
          Export includes names, notes, and verification records in plaintext.
        </p>
        {this.state.status ? (
          <div aria-atomic='true' aria-live='polite' className='addressBookStatus' role='status'>
            {this.state.status}
          </div>
        ) : null}
        <div className='addressBookAddAction'>
          <button className='wrenControl wrenControlPrimary' onClick={() => this.openEditor()} type='button'>
            Add contact
          </button>
        </div>
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
