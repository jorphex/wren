import React from 'react'

import DialogSurface from '../../../../../resources/Components/DialogSurface'
import Toggle from '../../../../../resources/Components/Toggle'
import link from '../../../../../resources/link'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u
const MAX_UINT256 = (1n << 256n) - 1n
const MAX_LIST_ENTRIES = 64

const validNativeDecimals = (value) => Number.isInteger(value) && value >= 0 && value <= 255

export const canonicalChainId = (chainId) => {
  try {
    const value = BigInt(chainId)
    return value >= 0n ? `0x${value.toString(16)}` : ''
  } catch {
    return ''
  }
}

const quantityFromInteger = (value) => {
  const quantity = BigInt(value)
  if (quantity > MAX_UINT256) throw new Error('Amount exceeds the maximum uint256 value.')
  return `0x${quantity.toString(16)}`
}

export const nativeDecimalToQuantity = (value, decimals = 18) => {
  if (!validNativeDecimals(decimals)) throw new Error('Native asset precision is unavailable.')
  const normalized = value.trim()
  const decimalPattern = new RegExp(
    decimals === 0 ? '^(?:0|[1-9][0-9]*)$' : `^(?:0|[1-9][0-9]*)(?:\\.([0-9]{1,${decimals}}))?$`,
    'u'
  )
  const match = normalized.match(decimalPattern)
  if (!match) throw new Error(`Enter a non-negative amount with no more than ${decimals} decimal places.`)
  const whole = BigInt(normalized.split('.')[0])
  const scale = 10n ** BigInt(decimals)
  const fraction = (match[1] || '').padEnd(decimals, '0')
  return quantityFromInteger(whole * scale + BigInt(fraction || '0'))
}

export const nativeQuantityToDecimal = (value, decimals = 18) => {
  try {
    if (!validNativeDecimals(decimals)) return ''
    const quantity = BigInt(value)
    const scale = 10n ** BigInt(decimals)
    const whole = quantity / scale
    const fraction = (quantity % scale).toString().padStart(decimals, '0').replace(/0+$/u, '')
    return fraction ? `${whole}.${fraction}` : whole.toString()
  } catch {
    return ''
  }
}

const integerQuantityToDecimal = (value) => {
  try {
    return BigInt(value).toString()
  } catch {
    return ''
  }
}

const lines = (value) =>
  value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)

const parseAddresses = (value, label) => {
  const entries = lines(value)
  if (entries.length > MAX_LIST_ENTRIES) throw new Error(`${label} cannot contain more than 64 addresses.`)
  const invalid = entries.find((address) => !ADDRESS_PATTERN.test(address))
  if (invalid) throw new Error(`${label} contains an invalid address: ${invalid}`)
  return [...new Set(entries.map((address) => address.toLowerCase()))].sort()
}

const parseTokenCeilings = (value) => {
  const entries = lines(value)
  if (entries.length > MAX_LIST_ENTRIES) throw new Error('Token ceilings cannot contain more than 64 tokens.')

  const ceilings = entries.map((entry) => {
    const [token, amount, ...extra] = entry.split(/\s+/u)
    if (extra.length || !ADDRESS_PATTERN.test(token || '')) {
      throw new Error(`Use one token address and raw base-unit amount per line: ${entry}`)
    }
    if (!INTEGER_PATTERN.test(amount || '')) {
      throw new Error(`Token ceiling must be a non-negative whole base-unit amount: ${entry}`)
    }
    return { token: token.toLowerCase(), amount: quantityFromInteger(amount) }
  })

  const tokens = new Set()
  ceilings.forEach(({ token }) => {
    if (tokens.has(token)) throw new Error(`Token ceiling is repeated: ${token}`)
    tokens.add(token)
  })
  return ceilings.sort((left, right) => left.token.localeCompare(right.token))
}

const localDateTime = (timestamp) => {
  if (!Number.isInteger(timestamp) || timestamp < 0) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(timestamp - offset).toISOString().slice(0, 16)
}

const formFor = (guardrail, nativeDecimals) => ({
  mode: guardrail?.mode === 'warn' ? 'warn' : 'block',
  targetsEnabled: Array.isArray(guardrail?.targets),
  targets: Array.isArray(guardrail?.targets) ? guardrail.targets.join('\n') : '',
  spendersEnabled: Array.isArray(guardrail?.spenders),
  spenders: Array.isArray(guardrail?.spenders) ? guardrail.spenders.join('\n') : '',
  nativeEnabled: typeof guardrail?.nativeValueCeiling === 'string',
  nativeValueCeiling: nativeQuantityToDecimal(guardrail?.nativeValueCeiling, nativeDecimals),
  tokensEnabled: Array.isArray(guardrail?.tokenCeilings),
  tokenCeilings: Array.isArray(guardrail?.tokenCeilings)
    ? guardrail.tokenCeilings
        .map(({ token, amount }) => `${token} ${integerQuantityToDecimal(amount)}`)
        .join('\n')
    : '',
  expiresEnabled: Number.isInteger(guardrail?.expiresAt),
  expiresAt: localDateTime(guardrail?.expiresAt)
})

export const guardrailBodyFor = (form, nativeDecimals = 18) => {
  const body = { mode: form.mode }
  if (form.targetsEnabled) body.targets = parseAddresses(form.targets, 'Target allowlist')
  if (form.spendersEnabled) body.spenders = parseAddresses(form.spenders, 'Spender allowlist')
  if (form.nativeEnabled) {
    body.nativeValueCeiling = nativeDecimalToQuantity(form.nativeValueCeiling, nativeDecimals)
  }
  if (form.tokensEnabled) body.tokenCeilings = parseTokenCeilings(form.tokenCeilings)
  if (form.expiresEnabled) {
    const expiresAt = new Date(form.expiresAt).getTime()
    if (!form.expiresAt || !Number.isInteger(expiresAt) || expiresAt < 0) {
      throw new Error('Choose a valid allowed-until date and time.')
    }
    body.expiresAt = expiresAt
  }
  if (Object.keys(body).length === 1) {
    throw new Error('Enable at least one restriction before saving this guardrail.')
  }
  return body
}

const comparableGuardrail = (guardrail) => {
  if (!guardrail) return undefined
  return {
    mode: guardrail.mode,
    ...(Array.isArray(guardrail.targets) ? { targets: guardrail.targets } : {}),
    ...(Array.isArray(guardrail.spenders) ? { spenders: guardrail.spenders } : {}),
    ...(typeof guardrail.nativeValueCeiling === 'string'
      ? { nativeValueCeiling: guardrail.nativeValueCeiling }
      : {}),
    ...(Array.isArray(guardrail.tokenCeilings) ? { tokenCeilings: guardrail.tokenCeilings } : {}),
    ...(Number.isInteger(guardrail.expiresAt) ? { expiresAt: guardrail.expiresAt } : {})
  }
}

const matchesBody = (guardrail, body) =>
  JSON.stringify(comparableGuardrail(guardrail)) === JSON.stringify(body)

const provenanceCopy = (origin) => {
  if (origin?.provenance === 'direct') {
    return 'Direct web origin · asserted by the connecting app'
  }
  if (origin?.provenance === 'companion') return 'Wren Companion · bound to the source below'
  if (origin?.provenance === 'native') return 'Native app · bound to the source below'
  if (origin?.sessionOnly) return 'Session connection · retained only for this session'
  return 'Stored connection identity'
}

export class DappGuardrailEditor extends React.Component {
  constructor(props) {
    super(props)
    this.firstFieldRef = React.createRef()
    this.cancelConfirmRef = React.createRef()
    this.removeButtonRef = React.createRef()
    this.statusRef = React.createRef()
    this.state = {
      form: formFor(props.guardrail, props.nativeDecimals),
      confirmation: '',
      pending: null,
      message: '',
      messageKind: 'status'
    }
  }

  componentDidMount() {
    this.focusFirstField()
  }

  componentDidUpdate(previousProps) {
    const identityChanged =
      previousProps.originId !== this.props.originId ||
      previousProps.chainId !== this.props.chainId ||
      previousProps.nativeDecimals !== this.props.nativeDecimals
    if (identityChanged) {
      clearTimeout(this.pendingTimer)
      this.setState({
        form: formFor(this.props.guardrail, this.props.nativeDecimals),
        confirmation: '',
        pending: null,
        message: '',
        messageKind: 'status'
      })
      return
    }

    if (!this.state.pending) return
    const storeChanged = previousProps.guardrail !== this.props.guardrail
    const settled =
      this.state.pending.kind === 'save'
        ? storeChanged && matchesBody(this.props.guardrail, this.state.pending.body)
        : storeChanged && !this.props.guardrail
    if (!settled) return

    clearTimeout(this.pendingTimer)
    this.setState(
      {
        form: formFor(this.props.guardrail, this.props.nativeDecimals),
        confirmation: '',
        pending: null,
        message: this.state.pending.kind === 'save' ? 'Guardrail saved.' : 'Guardrail removed.',
        messageKind: 'status'
      },
      () => this.statusRef.current?.focus()
    )
  }

  componentWillUnmount() {
    clearTimeout(this.pendingTimer)
  }

  updateForm(change) {
    if (this.state.pending) return
    this.setState(({ form }) => ({
      form: { ...form, ...change },
      confirmation: '',
      message: '',
      messageKind: 'status'
    }))
  }

  focusFirstField() {
    this.firstFieldRef.current?.focus({ preventScroll: true })
  }

  requestSave(event) {
    event.preventDefault()
    try {
      guardrailBodyFor(this.state.form, this.props.nativeDecimals)
      this.setState({ confirmation: 'save', message: '', messageKind: 'status' }, () => {
        this.cancelConfirmRef.current?.focus()
      })
    } catch (error) {
      this.setState({ message: error.message, messageKind: 'alert' }, () => this.statusRef.current?.focus())
    }
  }

  beginRemove() {
    this.setState({ confirmation: 'remove', message: '', messageKind: 'status' }, () => {
      this.cancelConfirmRef.current?.focus()
    })
  }

  cancelConfirmation() {
    const returnToRemove = this.state.confirmation === 'remove'
    this.setState({ confirmation: '' }, () => {
      if (returnToRemove) this.removeButtonRef.current?.focus()
      else this.focusFirstField()
    })
  }

  submit(kind) {
    if (this.state.pending) return
    let body
    try {
      if (kind === 'save') body = guardrailBodyFor(this.state.form, this.props.nativeDecimals)
      const payload = {
        account: this.props.account,
        originId: this.props.originId,
        chainId: this.props.chainId,
        ...(kind === 'save' ? { body } : {})
      }
      this.setState({ pending: { kind, body }, message: '', messageKind: 'status' })
      if (kind === 'save') link.send('tray:action', 'saveDappGuardrail', payload)
      else link.send('tray:action', 'removeDappGuardrail', payload)
      clearTimeout(this.pendingTimer)
      this.pendingTimer = setTimeout(() => {
        this.setState(
          {
            confirmation: '',
            pending: null,
            message: `Wren could not ${kind} this guardrail. Nothing changed. Try again.`,
            messageKind: 'alert'
          },
          () => this.statusRef.current?.focus()
        )
      }, 1200)
    } catch {
      clearTimeout(this.pendingTimer)
      this.setState(
        {
          confirmation: '',
          pending: null,
          message: `Wren could not ${kind} this guardrail. Nothing changed. Try again.`,
          messageKind: 'alert'
        },
        () => this.statusRef.current?.focus()
      )
    }
  }

  renderConfirmation() {
    const { confirmation, pending } = this.state
    const { account, chainId, chainName, origin, originId } = this.props
    if (!confirmation) return null
    const saving = confirmation === 'save'
    const busy = Boolean(pending)
    return (
      <DialogSurface
        className='dappGuardrailConfirm'
        role='alertdialog'
        modal
        ariaLabel={saving ? 'Save guardrail changes?' : 'Remove this guardrail?'}
        busy={busy}
        initialFocusRef={this.cancelConfirmRef}
        onCancel={() => this.cancelConfirmation()}
      >
        <strong>{saving ? 'Save guardrail changes?' : 'Remove this guardrail?'}</strong>
        <span>
          {saving
            ? `Apply these local restrictions to ${origin?.name || originId} on ${chainName} (${chainId}) for account ${account}.`
            : `Remove local restrictions for ${origin?.name || originId} on ${chainName} (${chainId}) for account ${account}.`}
        </span>
        <div className='dappGuardrailConfirmActions'>
          <button
            type='button'
            className='wrenControl wrenControlSecondary'
            disabled={busy}
            ref={this.cancelConfirmRef}
            onClick={() => this.cancelConfirmation()}
          >
            Cancel
          </button>
          <button
            type='button'
            className={`wrenControl ${saving ? 'wrenControlPrimary' : 'wrenControlDanger'}`}
            disabled={busy}
            onClick={() => this.submit(confirmation)}
          >
            {busy ? (saving ? 'Saving…' : 'Removing…') : saving ? 'Confirm save' : 'Confirm remove'}
          </button>
        </div>
      </DialogSurface>
    )
  }

  render() {
    const { account, chainId, chainName, guardrail, nativeDecimals, origin, originId, onClose } = this.props
    const { form, message, messageKind, pending } = this.state
    const fieldDisabled = Boolean(pending)
    const descriptionId = `guardrail-disclosure-${originId}-${chainId}`.replace(/[^a-zA-Z0-9_-]/gu, '-')
    const sourceId = origin?.sourceId

    return (
      <section className='dappGuardrailEditor' aria-label={`Guardrail for ${origin?.name || originId}`}>
        <div className='dappGuardrailEditorHeader'>
          <div>
            <strong>Local request guardrail</strong>
            <span>
              {chainName} · {chainId}
            </span>
          </div>
          <button
            type='button'
            className='wrenControl wrenControlCompact'
            disabled={fieldDisabled}
            onClick={onClose}
          >
            Close editor
          </button>
        </div>

        <dl className='dappGuardrailEvidence'>
          <div>
            <dt>Account</dt>
            <dd>{account}</dd>
          </div>
          <div>
            <dt>Asserted origin</dt>
            <dd>{origin?.name || 'Unknown origin'}</dd>
          </div>
          <div>
            <dt>App connection ID</dt>
            <dd>{originId}</dd>
          </div>
          <div>
            <dt>Provenance</dt>
            <dd>{provenanceCopy(origin)}</dd>
          </div>
          {sourceId ? (
            <div>
              <dt>Bound source</dt>
              <dd>{sourceId}</dd>
            </div>
          ) : null}
        </dl>

        <p className='dappGuardrailDisclosure' id={descriptionId}>
          Direct web origins are asserted by the connecting app. Wren Companion and native app identities are
          bound to their authenticated source. These restrictions are local guardrails. They never sign
          automatically and never replace normal transaction review. If a configured target, spender, or
          amount cannot be verified locally, the request exceeds that restriction.
        </p>

        {this.renderConfirmation()}

        <form aria-describedby={descriptionId} onSubmit={(event) => this.requestSave(event)}>
          <label className='dappGuardrailField'>
            <span>When a request exceeds a restriction</span>
            <select
              aria-label='When a request exceeds a restriction'
              className='wrenInput wrenInputQuiet'
              disabled={fieldDisabled}
              ref={this.firstFieldRef}
              value={form.mode}
              onChange={(event) => this.updateForm({ mode: event.target.value })}
            >
              <option value='block'>Block the request</option>
              <option value='warn'>Warn during normal review</option>
            </select>
          </label>

          <GuardrailToggleField
            checked={form.targetsEnabled}
            disabled={fieldDisabled}
            label='Restrict request targets'
            detail='Covers transaction destinations and typed-data verifying contracts. Enabled with no addresses denies every target. Disabled allows any target.'
            onChange={(checked) => this.updateForm({ targetsEnabled: checked })}
          >
            <textarea
              aria-label='Allowed target addresses'
              className='wrenInput wrenInputQuiet'
              disabled={fieldDisabled}
              placeholder='One full 0x address per line'
              rows={3}
              value={form.targets}
              onChange={(event) => this.updateForm({ targets: event.target.value })}
            />
          </GuardrailToggleField>

          <GuardrailToggleField
            checked={form.spendersEnabled}
            disabled={fieldDisabled}
            label='Restrict approval spenders'
            detail='Enabled with no addresses denies every spender. Disabled allows any spender.'
            onChange={(checked) => this.updateForm({ spendersEnabled: checked })}
          >
            <textarea
              aria-label='Allowed spender addresses'
              className='wrenInput wrenInputQuiet'
              disabled={fieldDisabled}
              placeholder='One full 0x address per line'
              rows={3}
              value={form.spenders}
              onChange={(event) => this.updateForm({ spenders: event.target.value })}
            />
          </GuardrailToggleField>

          <GuardrailToggleField
            checked={form.nativeEnabled}
            disabled={fieldDisabled || !validNativeDecimals(nativeDecimals)}
            label='Set native-value ceiling'
            detail={
              validNativeDecimals(nativeDecimals)
                ? `Amount uses the chain native asset with ${nativeDecimals} decimal places.`
                : 'Native asset precision is unavailable, so this restriction cannot be edited.'
            }
            onChange={(checked) => this.updateForm({ nativeEnabled: checked })}
          >
            <input
              aria-label='Native-value ceiling'
              className='wrenInput wrenInputQuiet'
              disabled={fieldDisabled || !validNativeDecimals(nativeDecimals)}
              inputMode='decimal'
              placeholder='0.0'
              value={form.nativeValueCeiling}
              onChange={(event) => this.updateForm({ nativeValueCeiling: event.target.value })}
            />
          </GuardrailToggleField>

          <GuardrailToggleField
            checked={form.tokensEnabled}
            disabled={fieldDisabled}
            label='Set token ceilings'
            detail='Enabled with no entries denies every token. Amounts are raw whole base units; Wren does not guess token decimals.'
            onChange={(checked) => this.updateForm({ tokensEnabled: checked })}
          >
            <textarea
              aria-label='Token ceilings'
              className='wrenInput wrenInputQuiet'
              disabled={fieldDisabled}
              placeholder='0x token address  raw base-unit amount'
              rows={3}
              value={form.tokenCeilings}
              onChange={(event) => this.updateForm({ tokenCeilings: event.target.value })}
            />
          </GuardrailToggleField>

          <GuardrailToggleField
            checked={form.expiresEnabled}
            disabled={fieldDisabled}
            label='Set allowed-until time'
            detail='After this local time, requests exceed the guardrail.'
            onChange={(checked) => this.updateForm({ expiresEnabled: checked })}
          >
            <input
              aria-label='Allowed until'
              className='wrenInput wrenInputQuiet'
              disabled={fieldDisabled}
              type='datetime-local'
              value={form.expiresAt}
              onChange={(event) => this.updateForm({ expiresAt: event.target.value })}
            />
          </GuardrailToggleField>

          {message ? (
            <div
              className={`dappGuardrailMessage dappGuardrailMessage-${messageKind}`}
              role={messageKind}
              tabIndex={-1}
              ref={this.statusRef}
            >
              {message}
            </div>
          ) : null}

          {!this.state.confirmation ? (
            <div className='dappGuardrailActions'>
              {guardrail ? (
                <button
                  type='button'
                  className='wrenControl wrenControlDanger'
                  disabled={fieldDisabled}
                  ref={this.removeButtonRef}
                  onClick={() => this.beginRemove()}
                >
                  Remove guardrail
                </button>
              ) : null}
              <button type='submit' className='wrenControl wrenControlPrimary' disabled={fieldDisabled}>
                Save changes
              </button>
            </div>
          ) : null}
        </form>
      </section>
    )
  }
}

const GuardrailToggleField = ({ checked, children, detail, disabled, label, onChange }) => (
  <fieldset className='dappGuardrailToggleField' disabled={disabled}>
    <legend>
      <span>{label}</span>
      <Toggle checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </legend>
    <span className='dappGuardrailFieldDetail'>{detail}</span>
    {checked ? children : null}
  </fieldset>
)

export default DappGuardrailEditor
