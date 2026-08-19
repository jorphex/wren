import React from 'react'
import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { boundedInspectorError, inspectReadOnlyInput } from './api'

const MODES = Object.freeze([
  {
    id: 'transaction',
    label: 'Transaction',
    title: 'Decode unsigned transaction',
    description:
      'Paste one unsigned transaction object. Wren does not sign, broadcast, or queue it; complete fields may be simulated through your configured RPC.',
    inputLabel: 'Unsigned transaction JSON',
    placeholder: '{\n  "from": "0x…",\n  "to": "0x…",\n  "chainId": "0x1"\n}'
  },
  {
    id: 'calldata',
    label: 'Calldata',
    title: 'Inspect calldata with context',
    description: 'Decode calldata locally, then use only the context you explicitly provide.',
    inputLabel: 'Calldata',
    placeholder: '0x…'
  },
  {
    id: 'typed-data',
    label: 'EIP-712',
    title: 'Inspect EIP-712 typed data',
    description: 'Review the typed domain and message without creating a signature.',
    inputLabel: 'Typed data JSON',
    placeholder: '{\n  "domain": {},\n  "types": {},\n  "primaryType": "…",\n  "message": {}\n}'
  },
  {
    id: 'json-rpc',
    label: 'JSON-RPC',
    title: 'Inspect supported JSON-RPC intent',
    description:
      'Never forwards, signs, or broadcasts the pasted request. Complete transaction context may be simulated through your configured RPC.',
    inputLabel: 'JSON-RPC request',
    placeholder: '{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "eth_sendTransaction",\n  "params": []\n}'
  }
])

const EMPTY_FIELDS = Object.freeze({
  transaction: '',
  calldata: '',
  typedData: '',
  jsonRpc: '',
  chainId: '',
  from: '',
  to: '',
  value: '',
  typedVersion: 'V4'
})

const modeFor = (id) => MODES.find((mode) => mode.id === id) || MODES[0]

const textValue = (value) => {
  if (value === undefined || value === null || value === '') return 'Not established'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return 'Unavailable'
  }
}

const EvidenceRow = ({ label, value, copy, tone }) => {
  const display = textValue(value)
  const missing = display === 'Not established' || display === 'Unavailable'
  const canCopy = copy && !missing && display.length <= 4096
  const long = display.length > 1200
  return (
    <div
      className={`inspectorEvidenceRow${missing ? ' inspectorEvidenceRowMissing' : ''}${tone ? ` inspectorEvidenceRow-${tone}` : ''}`}
    >
      <dt>{label}</dt>
      <dd>
        {long ? (
          <details className='inspectorLongEvidence'>
            <summary>Show bounded evidence ({display.length.toLocaleString()} characters)</summary>
            <code>{display}</code>
          </details>
        ) : (
          <code>{display}</code>
        )}
        {canCopy ? (
          <button
            type='button'
            className='inspectorCopy wrenControl wrenControlSecondary wrenControlCompact'
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => copy(display, label)}
          >
            <Icon name='copy' size={13} />
            Copy
          </button>
        ) : copy && !missing ? (
          <span className='inspectorCopyBound'>Copy unavailable above 4,096 characters.</span>
        ) : null}
      </dd>
    </div>
  )
}

const evidenceStatusCopy = (entry) => {
  const kind = String(entry?.kind || 'evidence').replaceAll('-', ' ')
  const status = String(entry?.status || 'unavailable').replaceAll('-', ' ')
  return `${kind}: ${status}`
}

const RISK_COPY = Object.freeze({
  'legacy-v1': 'Legacy EIP-712 V1 message: reduced domain and type protections.',
  'domain-chain-missing': 'Domain chain missing: the typed-data domain does not bind this intent to a chain.',
  'domain-chain-invalid': 'Domain chain invalid: Wren could not establish a valid chain from the domain.',
  'domain-chain-mismatch': 'Chain mismatch: the requested chain differs from the typed-data domain chain.',
  'permit2-allowance': 'Permit2 allowance: this message can grant token spending authority.',
  'permit2-transfer': 'Permit2 transfer: this message can authorize a token transfer.',
  'permit2-maximum-amount': 'Permit2 maximum amount: this message grants the largest possible amount.',
  'permit2-noncanonical-contract':
    'Noncanonical Permit2 contract: verify the contract address independently.',
  'eip3009-transfer': 'EIP-3009 transfer: this message can authorize a token transfer.',
  'eip3009-maximum-amount': 'EIP-3009 maximum amount: this message authorizes the largest possible amount.'
})

const riskCopy = (risk) => RISK_COPY[risk] || `Unrecognized typed-data risk: ${textValue(risk)}`
const missingContextCopy = (item) =>
  ({ chainId: 'requested chain', from: 'sender', to: 'target', signer: 'signer' })[item] || item

const parsedTypedData = (value) => {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

export const InspectorResult = ({ inspection, onCopy, copyStatus, resultRef }) => {
  const normalized = inspection?.normalized || {}
  const decode = inspection?.decode || {}
  const evidence = Array.isArray(inspection?.evidence) ? inspection.evidence : []
  const missing = Array.isArray(inspection?.missingContext) ? inspection.missingContext : []
  const typedDomain = normalized.domain || inspection?.typedContext?.domain
  const simulation = inspection?.simulation
  const warnings = Array.isArray(inspection?.typedContext?.risks)
    ? inspection.typedContext.risks
    : Array.isArray(inspection?.warnings)
      ? inspection.warnings
      : Array.isArray(inspection?.risks)
        ? inspection.risks
        : []
  const typedData = parsedTypedData(normalized.typedData)
  const isTyped = inspection?.kind === 'typed-data'
  const isDecoded = decode.status === 'decoded'
  const isUnknownFunction = decode.status === 'unknown'

  return (
    <section className='inspectorResult' aria-labelledby='inspector-result-title'>
      <header className='inspectorResultHeader' ref={resultRef} tabIndex='-1'>
        <div>
          <span className='inspectorResultEyebrow'>Decoded from your input</span>
          <h2 id='inspector-result-title'>Inspection evidence</h2>
        </div>
        <span className='inspectorReadonlyBadge'>Read-only</span>
      </header>

      {missing.length ? (
        <div className='inspectorMissing' role='status'>
          <strong>Not established</strong>
          <span>
            {missing.map(missingContextCopy).join(', ')}. Do not infer these values from the decoded fields.
          </span>
        </div>
      ) : null}

      {warnings.length ? (
        <section className='inspectorEvidenceSection' aria-labelledby='inspector-warning-title'>
          <h3 id='inspector-warning-title'>Warnings from inspected evidence</h3>
          <ul className='inspectorWarnings'>
            {warnings.map((warning, index) => (
              <li key={`${warning?.code || warning || 'warning'}-${index}`}>{riskCopy(warning)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className='inspectorEvidenceSection' aria-labelledby='inspector-context-title'>
        <h3 id='inspector-context-title'>{isTyped ? 'Typed-data context' : 'Transaction context'}</h3>
        <dl>
          {!isTyped ? <EvidenceRow label='Sender' value={normalized.from} copy={onCopy} /> : null}
          {isTyped ? <EvidenceRow label='Signer' value={normalized.signer} copy={onCopy} /> : null}
          {!isTyped ? (
            <EvidenceRow
              label='Target'
              value={normalized.to === null ? 'Contract creation' : normalized.to}
              copy={normalized.to === null ? undefined : onCopy}
            />
          ) : null}
          <EvidenceRow
            label={isTyped ? 'Requested chain' : 'Chain'}
            value={isTyped ? inspection.typedContext?.requestChainId : normalized.chainId}
            copy={onCopy}
          />
          {!isTyped ? <EvidenceRow label='Value' value={normalized.value} copy={onCopy} /> : null}
          {!isTyped ? (
            <EvidenceRow label='Calldata' value={normalized.data ?? normalized.input} copy={onCopy} />
          ) : null}
          {isTyped ? <EvidenceRow label='Version' value={normalized.version} /> : null}
          {isTyped ? <EvidenceRow label='Domain' value={typedDomain} copy={onCopy} /> : null}
          {isTyped ? <EvidenceRow label='Primary type' value={normalized.primaryType} copy={onCopy} /> : null}
          {isTyped ? <EvidenceRow label='Types' value={typedData?.types} copy={onCopy} /> : null}
          {isTyped ? <EvidenceRow label='Message' value={typedData?.message} copy={onCopy} /> : null}
          {isTyped ? (
            <EvidenceRow label='Exact typed-data JSON' value={normalized.typedData} copy={onCopy} />
          ) : null}
        </dl>
      </section>

      {!isTyped ? (
        <section className='inspectorEvidenceSection' aria-labelledby='inspector-envelope-title'>
          <h3 id='inspector-envelope-title'>Transaction envelope</h3>
          <dl>
            <EvidenceRow label='Input source' value={inspection.source} />
            <EvidenceRow label='JSON-RPC method' value={inspection.sourceMethod} />
            <EvidenceRow label='Requested block' value={normalized.requestedBlock} />
            <EvidenceRow label='Type' value={normalized.type} />
            <EvidenceRow label='Nonce' value={normalized.nonce} />
            <EvidenceRow label='Gas limit' value={normalized.gas ?? normalized.gasLimit} />
            <EvidenceRow label='Legacy gas price' value={normalized.gasPrice} />
            <EvidenceRow label='Maximum fee per gas' value={normalized.maxFeePerGas} />
            <EvidenceRow label='Priority fee per gas' value={normalized.maxPriorityFeePerGas} />
            <EvidenceRow label='Access list counts' value={normalized.accessList} />
          </dl>
        </section>
      ) : null}

      {isTyped ? (
        <section className='inspectorEvidenceSection' aria-labelledby='inspector-typed-authority-title'>
          <h3 id='inspector-typed-authority-title'>Typed-data authority context</h3>
          <dl>
            <EvidenceRow label='Input source' value={inspection.source} />
            <EvidenceRow label='JSON-RPC method' value={inspection.sourceMethod} />
            <EvidenceRow label='Domain chain' value={inspection.typedContext?.domainChainId} />
            <EvidenceRow label='Recognized authority' value={inspection.typedContext?.authority} />
          </dl>
        </section>
      ) : null}

      {!isTyped ? (
        <section className='inspectorEvidenceSection' aria-labelledby='inspector-decode-title'>
          <h3 id='inspector-decode-title'>Calldata interpretation</h3>
          {isUnknownFunction ? (
            <div className='inspectorMissing' role='status'>
              <strong>Unknown function</strong>
              <span>
                Wren could not decode selector {decode.selector || 'Unavailable'} with its bundled local ABI
                set. Wren does not guess a function or use a remote ABI lookup.
              </span>
            </div>
          ) : null}
          <dl>
            <EvidenceRow label='Status' value={decode.status} />
            <EvidenceRow label='Selector' value={decode.selector} copy={onCopy} />
            {isDecoded ? <EvidenceRow label='Method' value={decode.method} copy={onCopy} /> : null}
            {isDecoded ? <EvidenceRow label='Arguments' value={decode.arguments} copy={onCopy} /> : null}
            <EvidenceRow label='Decode source' value={decode.source} />
          </dl>
          {!isUnknownFunction && decode.reason ? (
            <p className='inspectorEvidenceReason'>{decode.reason}</p>
          ) : null}
        </section>
      ) : null}

      {simulation ? (
        <section className='inspectorEvidenceSection' aria-labelledby='inspector-simulation-title'>
          <h3 id='inspector-simulation-title'>Configured-RPC simulation</h3>
          <dl>
            <EvidenceRow
              label='Status'
              value={simulation.status}
              tone={
                simulation.status === 'succeeded'
                  ? 'success'
                  : simulation.status === 'reverted' || simulation.status === 'failed'
                    ? 'danger'
                    : 'warning'
              }
            />
            <EvidenceRow label='Source' value={simulation.source} />
            <EvidenceRow label='Revert reason' value={simulation.reason ?? simulation.revertReason} />
            <EvidenceRow label='Gas used' value={simulation.gasUsed} />
            <EvidenceRow label='Effects' value={simulation.effects} />
            <EvidenceRow label='Allowance evidence' value={simulation.allowance} />
            <EvidenceRow label='Delegation evidence' value={simulation.delegation} />
            <EvidenceRow label='Account-code evidence' value={simulation.accountCode} />
            <EvidenceRow label='Native balance changes' value={simulation.nativeBalanceChanges} />
            <EvidenceRow label='Proxy changes' value={simulation.proxyImplementation} />
            <EvidenceRow label='Call trace' value={simulation.callTrace} />
            <EvidenceRow label='Advanced checks' value={simulation.advancedStatus} />
          </dl>
        </section>
      ) : null}

      <section className='inspectorEvidenceSection' aria-labelledby='inspector-source-title'>
        <h3 id='inspector-source-title'>Evidence sources</h3>
        {evidence.length ? (
          <ul className='inspectorSources'>
            {evidence.map((entry, index) => (
              <li key={`${entry.kind || 'evidence'}-${index}`}>
                <strong>{evidenceStatusCopy(entry)}</strong>
                <span>{entry.source || 'Source unavailable'}</span>
                {entry.reason ? <span>{entry.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className='inspectorEvidenceReason'>Evidence source unavailable.</p>
        )}
      </section>

      <p className='inspectorTerminalNote'>
        The pasted JSON-RPC method or envelope was not forwarded or used to sign, broadcast, or queue. When
        shown, configured-RPC evidence may use the disclosed transaction fields above.
      </p>
      <span className='inspectorCopyStatus' role='status' aria-live='polite' aria-atomic='true'>
        {copyStatus}
      </span>
    </section>
  )
}

export class Inspector extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      mode: MODES[0].id,
      fields: { ...EMPTY_FIELDS },
      pending: false,
      error: '',
      inspection: undefined,
      copyStatus: ''
    }
    this.requestGeneration = 0
    this.editorRef = React.createRef()
    this.resultRef = React.createRef()
  }

  componentDidMount() {
    this.editorRef.current?.focus()
  }

  componentWillUnmount() {
    this.requestGeneration += 1
  }

  selectMode(mode) {
    if (mode === this.state.mode) return
    this.requestGeneration += 1
    this.setState(
      {
        mode,
        fields: { ...EMPTY_FIELDS },
        pending: false,
        error: '',
        inspection: undefined,
        copyStatus: ''
      },
      () => this.editorRef.current?.focus()
    )
  }

  selectModeFromKeyboard(event) {
    const current = MODES.findIndex(({ id }) => id === this.state.mode)
    let next
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = MODES.length - 1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % MODES.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + MODES.length) % MODES.length
    }
    if (next === undefined) return
    event.preventDefault()
    const mode = MODES[next].id
    this.requestGeneration += 1
    this.setState(
      {
        mode,
        fields: { ...EMPTY_FIELDS },
        pending: false,
        error: '',
        inspection: undefined,
        copyStatus: ''
      },
      () => document.getElementById(`inspector-tab-${mode}`)?.focus()
    )
  }

  updateField(field, value) {
    this.setState((state) => ({
      fields: { ...state.fields, [field]: value },
      error: '',
      inspection: undefined,
      copyStatus: ''
    }))
  }

  request() {
    const { mode, fields } = this.state
    if (mode === 'transaction') return { kind: mode, input: fields.transaction.trim() }
    if (mode === 'typed-data') {
      return {
        kind: mode,
        input: fields.typedData.trim(),
        ...(fields.chainId !== '' ? { chainId: fields.chainId } : {}),
        version: fields.typedVersion
      }
    }
    if (mode === 'json-rpc') {
      return {
        kind: mode,
        input: fields.jsonRpc.trim(),
        ...(fields.chainId !== '' ? { chainId: fields.chainId } : {})
      }
    }
    return {
      kind: mode,
      data: fields.calldata.trim(),
      ...(fields.chainId !== '' ? { chainId: fields.chainId } : {}),
      ...(fields.from.trim() ? { from: fields.from.trim() } : {}),
      ...(fields.to.trim() ? { to: fields.to.trim() } : {}),
      ...(fields.value.trim() ? { value: fields.value.trim() } : {})
    }
  }

  canInspect() {
    const { mode, fields, pending } = this.state
    if (pending) return false
    if (mode === 'transaction') return Boolean(fields.transaction.trim())
    if (mode === 'typed-data') return Boolean(fields.typedData.trim())
    if (mode === 'json-rpc') return Boolean(fields.jsonRpc.trim())
    return Boolean(fields.calldata.trim())
  }

  async inspect(event) {
    event.preventDefault()
    if (!this.canInspect()) return
    const generation = ++this.requestGeneration
    this.setState({ pending: true, error: '', inspection: undefined, copyStatus: '' })
    try {
      const result = await inspectReadOnlyInput(this.request())
      if (generation !== this.requestGeneration) return
      if (!result.success) {
        this.setState({ pending: false, error: boundedInspectorError(result.error) })
        return
      }
      this.setState({ pending: false, inspection: result.inspection }, () => this.focusResult())
    } catch (error) {
      if (generation !== this.requestGeneration) return
      this.setState({ pending: false, error: boundedInspectorError(error) })
    }
  }

  copy(value, label) {
    link.send('tray:clipboardData', value)
    this.setState({ copyStatus: `${label} copied.` })
  }

  focusResult() {
    const result = this.resultRef.current
    result?.scrollIntoView?.({ block: 'start' })
    const scroll = result?.closest('.dashMainScroll')
    if (scroll) scroll.scrollTop = Math.max(0, scroll.scrollTop - 144)
    result?.focus({ preventScroll: true })
  }

  renderContextFields() {
    const { mode, fields } = this.state
    if (mode === 'transaction') return null
    return (
      <div className='inspectorContextFields'>
        <label>
          <span>
            Chain ID <em>optional</em>
          </span>
          <input
            className='wrenInput'
            type='text'
            value={fields.chainId}
            placeholder='1 or 0x1'
            autoComplete='off'
            spellCheck='false'
            onChange={(event) => this.updateField('chainId', event.target.value)}
          />
        </label>
        {mode === 'calldata' ? (
          <>
            <label>
              <span>
                Sender <em>optional</em>
              </span>
              <input
                className='wrenInput'
                type='text'
                value={fields.from}
                placeholder='0x…'
                autoComplete='off'
                spellCheck='false'
                onChange={(event) => this.updateField('from', event.target.value)}
              />
            </label>
            <label>
              <span>
                Target <em>optional</em>
              </span>
              <input
                className='wrenInput'
                type='text'
                value={fields.to}
                placeholder='0x…'
                autoComplete='off'
                spellCheck='false'
                onChange={(event) => this.updateField('to', event.target.value)}
              />
            </label>
            <label>
              <span>
                Value <em>optional · wei quantity</em>
              </span>
              <input
                className='wrenInput'
                type='text'
                value={fields.value}
                placeholder='0x0'
                autoComplete='off'
                spellCheck='false'
                onChange={(event) => this.updateField('value', event.target.value)}
              />
            </label>
          </>
        ) : null}
        {mode === 'typed-data' ? (
          <label>
            <span>Typed-data version</span>
            <select
              className='wrenInput'
              value={fields.typedVersion}
              onChange={(event) => this.updateField('typedVersion', event.target.value)}
            >
              <option value='V4'>V4</option>
              <option value='V3'>V3</option>
            </select>
          </label>
        ) : null}
      </div>
    )
  }

  render() {
    const { mode, fields, pending, error, inspection, copyStatus } = this.state
    const selected = modeFor(mode)
    const field = mode === 'typed-data' ? 'typedData' : mode === 'json-rpc' ? 'jsonRpc' : mode

    return (
      <main className='inspector cardShow' aria-busy={pending ? 'true' : 'false'}>
        <header className='inspectorHeader'>
          <div>
            <span className='inspectorEyebrow'>Local wallet utility</span>
            <h1>Read-only inspector</h1>
            <p>
              Decode without signing. Raw input is not saved; configured-RPC evidence shares the disclosed
              transaction fields.
            </p>
          </div>
          <div className='inspectorSafetyContract'>
            <Icon name='eye' size={16} />
            <span>
              <strong>Read-only</strong>
              Never signs or broadcasts
            </span>
          </div>
        </header>

        <div className='inspectorModeTabs' role='tablist' aria-label='Inspection mode'>
          {MODES.map((item) => (
            <button
              key={item.id}
              type='button'
              role='tab'
              id={`inspector-tab-${item.id}`}
              aria-controls='inspector-input-panel'
              aria-selected={mode === item.id ? 'true' : 'false'}
              tabIndex={mode === item.id ? 0 : -1}
              className={`wrenControl wrenControlGhost${mode === item.id ? ' inspectorModeSelected' : ''}`}
              onClick={() => this.selectMode(item.id)}
              onKeyDown={(event) => this.selectModeFromKeyboard(event)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <form
          id='inspector-input-panel'
          className='inspectorInputPanel'
          role='tabpanel'
          aria-labelledby={`inspector-tab-${mode}`}
          onSubmit={(event) => this.inspect(event)}
        >
          <div className='inspectorModeCopy'>
            <h2>{selected.title}</h2>
            <p>{selected.description}</p>
          </div>
          <label className='inspectorRawInput'>
            <span>{selected.inputLabel}</span>
            <textarea
              className='wrenInput'
              ref={this.editorRef}
              value={fields[field]}
              placeholder={selected.placeholder}
              autoCapitalize='off'
              autoComplete='off'
              spellCheck='false'
              rows='8'
              onChange={(event) => this.updateField(field, event.target.value)}
            />
          </label>
          {this.renderContextFields()}
          <div className='inspectorActions'>
            <span className='inspectorLocalNote'>
              Raw input is not saved. With enough context, transaction and calldata modes share sender,
              target, value, and calldata with your configured RPC for evidence.
            </span>
            <button
              type='submit'
              className='inspectorInspectButton wrenControl wrenControlSecondary wrenControlLarge'
              disabled={!this.canInspect()}
            >
              {pending ? 'Inspecting…' : 'Inspect read-only'}
            </button>
          </div>
          {error ? (
            <div className='inspectorError' role='alert'>
              {error}
            </div>
          ) : null}
          {pending ? (
            <div className='inspectorBusy' role='status' aria-live='polite'>
              Gathering bounded evidence. No signing, broadcast, or queueing occurs.
            </div>
          ) : null}
        </form>

        {inspection ? (
          <InspectorResult
            inspection={inspection}
            onCopy={(value, label) => this.copy(value, label)}
            copyStatus={copyStatus}
            resultRef={this.resultRef}
          />
        ) : null}
      </main>
    )
  }
}

export default Inspector
