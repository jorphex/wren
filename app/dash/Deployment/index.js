import React from 'react'
import { createPortal } from 'react-dom'

import DialogSurface from '../../../resources/Components/DialogSurface'
import link from '../../../resources/link'
import { isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { isNetworkConnected } from '../../../resources/utils/chains'
import { setDashNavigationGuard } from '../navigationGuard'
import {
  deploymentByteCount,
  prepareDeployment,
  queueDeployment,
  validateCreationData,
  validateNativeValue
} from './api'

const STALE_MESSAGE = 'Inputs changed. Check deployment again.'
const QUEUE_FAILURE =
  'Could not queue native review. Nothing was signed or broadcast. Run “Check deployment” again.'
const PENDING_DEPLOYMENT_MESSAGE =
  'A deployment is already waiting for review on another network. Finish or decline it, then check this deployment again.'
const PREPARE_FAILURE = 'Could not check this deployment. Nothing was signed or broadcast.'

const compactAddress = (value = '') => (value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value)

const canonicalAccountId = (id, account) => account?.id || account?.address || id
const sameAccount = (left, right) =>
  typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()

export const eligibleDeploymentAccounts = (accounts = {}, signers = {}) =>
  Object.entries(accounts)
    .map(([id, account]) => ({
      ...account,
      id: canonicalAccountId(id, account),
      name: account?.ensName || account?.name || 'Account'
    }))
    .filter(
      (account) =>
        account.status === 'ok' &&
        !isWatchOnlyAccountType(account.lastSignerType) &&
        typeof account.signer === 'string' &&
        Boolean(signers[account.signer])
    )

export const connectedDeploymentNetworks = (networks = {}, networksMeta = {}) =>
  Object.entries(networks)
    .filter(([storedId, network]) => {
      const chainId = Number(network?.id ?? storedId)
      const metadata = networksMeta[chainId]
      const decimals = metadata?.nativeCurrency?.decimals
      return (
        network?.on === true &&
        Number.isSafeInteger(chainId) &&
        chainId > 0 &&
        Array.isArray(network?.connection?.endpoints) &&
        isNetworkConnected(network) &&
        metadata &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= 255
      )
    })
    .map(([storedId, network]) => {
      const id = Number(network.id ?? storedId)
      return {
        id,
        name: network.name || `Chain ${id}`,
        symbol: networksMeta[id]?.nativeCurrency?.symbol || '',
        decimals: networksMeta[id]?.nativeCurrency?.decimals
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

const rpcQuantity = (value) => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/iu.test(value)) return value || 'Unavailable'
  try {
    return BigInt(value).toLocaleString('en-US')
  } catch {
    return 'Unavailable'
  }
}

export const nativeQuantity = (value, decimals, symbol) => {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-f]+$/iu.test(value) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    return 'Unavailable'
  }
  try {
    const integer = BigInt(value).toString(10)
    const padded = decimals ? integer.padStart(decimals + 1, '0') : integer
    const whole = decimals ? padded.slice(0, -decimals) : padded
    const fraction = decimals ? padded.slice(-decimals).replace(/0+$/u, '') : ''
    return `${whole}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`
  } catch {
    return 'Unavailable'
  }
}

const simulationCopy = (simulation) => {
  if (simulation?.status === 'succeeded') {
    return 'Simulation is evidence only for the selected account, network, value, and current state.'
  }
  if (simulation?.status === 'reverted') {
    return 'Simulation reverted. Check the data and network state.'
  }
  return 'Simulation unavailable from the configured RPC. Check the RPC or continue without it.'
}

const evidenceValue = (evidence, formatter = (value) => value) =>
  evidence?.status === 'succeeded' ? formatter(evidence.value) : 'Unavailable from configured RPC'

const EvidenceRow = ({ label, children, mono = false }) => (
  <div className='deploymentEvidenceRow'>
    <dt>{label}</dt>
    <dd className={mono ? 'deploymentMono' : undefined}>{children}</dd>
  </div>
)

export class Deployment extends React.Component {
  constructor(props) {
    super(props)
    const accounts = eligibleDeploymentAccounts(props.accounts, props.signers)
    const networks = connectedDeploymentNetworks(props.networks, props.networksMeta)
    const current = accounts.find((account) => sameAccount(account.id, props.currentAccount))?.id || ''
    this.state = {
      account: current,
      chainId: networks[0]?.id || '',
      initcode: '',
      value: '',
      errors: {},
      inspection: undefined,
      frozenDraft: undefined,
      preparing: false,
      queueing: false,
      selectingAccount: false,
      pendingNavigation: false,
      message: '',
      messageTone: 'status'
    }
    this.operationGeneration = 0
    this.mounted = false
    this.resultRef = React.createRef()
    this.alertRef = React.createRef()
    this.abandonCancelRef = React.createRef()
    this.pendingNavigation = undefined
  }

  componentDidMount() {
    this.mounted = true
    this.removeNavigationGuard = setDashNavigationGuard(({ navigate }) => {
      if (this.props.active === false) return false
      if (!this.hasDraft()) return false
      if (!this.state.pendingNavigation) {
        this.pendingNavigation = navigate
        this.setState({ pendingNavigation: true })
      }
      return true
    })
  }

  componentWillUnmount() {
    this.mounted = false
    this.operationGeneration += 1
    this.removeNavigationGuard?.()
    this.pendingNavigation = undefined
  }

  componentDidUpdate(previousProps) {
    if (previousProps.active !== false && this.props.active === false && this.state.pendingNavigation) {
      this.pendingNavigation = undefined
      this.setState({ pendingNavigation: false })
      return
    }

    const currentChanged = !sameAccount(previousProps.currentAccount, this.props.currentAccount)
    if (currentChanged && !this.state.selectingAccount) {
      const accounts = eligibleDeploymentAccounts(this.props.accounts, this.props.signers)
      const nextAccount =
        accounts.find((account) => sameAccount(account.id, this.props.currentAccount))?.id || ''
      if (nextAccount !== this.state.account) {
        this.invalidate({ account: nextAccount }, Boolean(this.state.inspection))
        return
      }
    }

    const eligibleAccounts = eligibleDeploymentAccounts(this.props.accounts, this.props.signers)
    if (
      this.state.account &&
      !eligibleAccounts.some((account) => sameAccount(account.id, this.state.account))
    ) {
      this.invalidate({ account: '' }, Boolean(this.state.inspection))
      return
    }

    const connectedNetworks = connectedDeploymentNetworks(this.props.networks, this.props.networksMeta)
    if (
      this.state.chainId &&
      !connectedNetworks.some((network) => network.id === Number(this.state.chainId))
    ) {
      this.invalidate({ chainId: connectedNetworks[0]?.id || '' }, Boolean(this.state.inspection))
      return
    }

    if (!this.state.inspection) return
    const accountWas = this.accountContext(previousProps)
    const accountIs = this.accountContext(this.props)
    const networkWas = this.networkContext(previousProps)
    const networkIs = this.networkContext(this.props)
    if (
      accountWas !== accountIs ||
      networkWas !== networkIs ||
      !sameAccount(this.props.currentAccount, this.state.account)
    ) {
      this.invalidate({}, true)
    }
  }

  accountContext(props) {
    const account = Object.entries(props.accounts || {})
      .map(([id, item]) => ({ ...item, id: canonicalAccountId(id, item) }))
      .find((item) => item.id === this.state.account)
    return JSON.stringify([
      props.currentAccount,
      account?.status,
      account?.lastSignerType,
      account?.signer,
      Boolean(account?.signer && props.signers?.[account.signer])
    ])
  }

  networkContext(props) {
    const network = props.networks?.[this.state.chainId]
    const meta = props.networksMeta?.[this.state.chainId]
    return JSON.stringify([
      network?.on,
      network?.connection?.endpoints?.map((endpoint) => Boolean(endpoint.connected)),
      meta?.nativeCurrency?.decimals,
      meta?.nativeCurrency?.symbol
    ])
  }

  invalidate(nextState = {}, announce = Boolean(this.state.inspection)) {
    this.operationGeneration += 1
    this.setState({
      ...nextState,
      inspection: undefined,
      frozenDraft: undefined,
      preparing: false,
      queueing: false,
      errors: {},
      message: announce ? STALE_MESSAGE : '',
      messageTone: 'status'
    })
  }

  updateField(field, value) {
    this.invalidate({ [field]: value })
  }

  selectAccount(account) {
    if (!account || account === this.state.account || this.state.selectingAccount) return
    const generation = ++this.operationGeneration
    this.setState({ selectingAccount: true, message: '', messageTone: 'status' })
    link.rpc('setSigner', account, (error) => {
      if (!this.mounted || generation !== this.operationGeneration) return
      if (error) {
        this.setState({
          selectingAccount: false,
          message: 'Could not select this signer account.',
          messageTone: 'alert'
        })
        return
      }
      this.setState({ selectingAccount: false })
      this.invalidate({ account }, Boolean(this.state.inspection))
    })
  }

  draft() {
    return {
      account: this.state.account,
      chainId: Number(this.state.chainId),
      initcode: this.state.initcode,
      value: this.state.value
    }
  }

  hasDraft() {
    return Boolean(
      this.state.initcode.trim() ||
      this.state.value.trim() ||
      this.state.inspection ||
      this.state.preparing ||
      this.state.queueing
    )
  }

  cancelAbandon() {
    this.pendingNavigation = undefined
    this.setState({ pendingNavigation: false })
  }

  confirmAbandon() {
    const navigate = this.pendingNavigation
    this.pendingNavigation = undefined
    this.operationGeneration += 1
    this.setState({ pendingNavigation: false }, () => navigate?.())
  }

  validate() {
    const errors = {
      initcode: validateCreationData(this.state.initcode),
      value: validateNativeValue(this.state.value)
    }
    if (!errors.initcode) delete errors.initcode
    if (!errors.value) delete errors.value
    this.setState({ errors })
    return Object.keys(errors).length === 0
  }

  async prepare(event) {
    event.preventDefault()
    if (this.state.preparing || this.state.queueing || !this.validate()) return
    if (
      !this.state.account ||
      !this.state.chainId ||
      !sameAccount(this.props.currentAccount, this.state.account)
    )
      return

    const draft = Object.freeze(this.draft())
    const generation = ++this.operationGeneration
    this.setState({
      preparing: true,
      inspection: undefined,
      frozenDraft: undefined,
      message: '',
      messageTone: 'status'
    })
    try {
      const result = await prepareDeployment(draft)
      if (!this.mounted || generation !== this.operationGeneration) return
      if (!result?.success || !result.inspection?.id) {
        const stale = ['account-changed', 'network-changed', 'inspection-changed'].includes(result?.error)
        this.setState({
          preparing: false,
          message: stale ? STALE_MESSAGE : PREPARE_FAILURE,
          messageTone: 'alert'
        })
        return
      }
      this.setState(
        {
          preparing: false,
          inspection: result.inspection,
          frozenDraft: draft,
          message: '',
          messageTone: 'status'
        },
        () => {
          this.resultRef.current?.scrollIntoView?.({ block: 'start' })
          this.resultRef.current?.focus({ preventScroll: true })
        }
      )
    } catch {
      if (!this.mounted || generation !== this.operationGeneration) return
      this.setState({ preparing: false, message: PREPARE_FAILURE, messageTone: 'alert' })
    }
  }

  async queue() {
    const { inspection, frozenDraft, queueing, preparing } = this.state
    if (!inspection?.id || !frozenDraft || queueing || preparing) return
    const generation = ++this.operationGeneration
    this.setState({ queueing: true, message: '', messageTone: 'status' })
    try {
      const result = await queueDeployment(inspection.id, frozenDraft)
      if (!this.mounted || generation !== this.operationGeneration) return
      if (!result?.success || !result.handlerId) {
        this.setState(
          {
            queueing: false,
            inspection: undefined,
            frozenDraft: undefined,
            message: result?.error === 'deployment-pending' ? PENDING_DEPLOYMENT_MESSAGE : QUEUE_FAILURE,
            messageTone: 'alert'
          },
          () => {
            this.alertRef.current?.focus()
          }
        )
        return
      }
      this.setState({ queueing: false })
      link.send('tray:action', 'closeDash')
      link.send('nav:forward', 'panel', {
        view: 'requestView',
        data: {
          step: 'confirm',
          accountId: frozenDraft.account,
          requestId: result.handlerId
        }
      })
    } catch {
      if (!this.mounted || generation !== this.operationGeneration) return
      this.setState(
        {
          queueing: false,
          inspection: undefined,
          frozenDraft: undefined,
          message: QUEUE_FAILURE,
          messageTone: 'alert'
        },
        () => {
          this.alertRef.current?.focus()
        }
      )
    }
  }

  renderEvidence(inspection, network) {
    const gas = evidenceValue(
      inspection.gasEstimate,
      (value) => `${rpcQuantity(value)} gas · Wren padded configured-RPC estimate`
    )
    const nonce =
      inspection.pendingNonce?.status === 'succeeded'
        ? rpcQuantity(inspection.pendingNonce.nonce)
        : 'Unavailable from configured RPC'
    return (
      <section className='deploymentEvidence' aria-labelledby='deployment-evidence-title'>
        <div className='deploymentEvidenceHeader' ref={this.resultRef} tabIndex='-1'>
          <span>Prepared evidence</span>
          <h2 id='deployment-evidence-title'>Check results</h2>
        </div>
        <dl>
          <EvidenceRow label='Prepared data' mono>
            {`Value ${nativeQuantity(inspection.value, network?.decimals, network?.symbol)} · Canonical ${inspection.value} · Chain ${rpcQuantity(inspection.chainId)} · ${new Date(inspection.preparedAt).toLocaleString()}`}
          </EvidenceRow>
          <EvidenceRow label='Payload size'>{inspection.initcode?.bytes?.toLocaleString()} bytes</EvidenceRow>
          <EvidenceRow label='Keccak-256' mono>
            {inspection.initcode?.hash}
          </EvidenceRow>
          <EvidenceRow label='Gas estimate'>{gas}</EvidenceRow>
          <EvidenceRow label='Simulation'>{simulationCopy(inspection.simulation)}</EvidenceRow>
          <EvidenceRow label='Pending nonce'>{nonce}</EvidenceRow>
          {inspection.pendingNonce?.status === 'succeeded' ? (
            <EvidenceRow label='Provisional CREATE address' mono>
              {inspection.pendingNonce.provisionalAddress}
            </EvidenceRow>
          ) : null}
        </dl>
        {inspection.pendingNonce?.status === 'succeeded' ? (
          <p className='deploymentProvisionalNote'>
            Provisional address. It can change if the pending nonce changes.
          </p>
        ) : null}
      </section>
    )
  }

  render() {
    const accounts = eligibleDeploymentAccounts(this.props.accounts, this.props.signers)
    const networks = connectedDeploymentNetworks(this.props.networks, this.props.networksMeta)
    const selectedAccount = accounts.find((account) => sameAccount(account.id, this.state.account))
    const selectedNetwork = networks.find((network) => network.id === Number(this.state.chainId))
    const symbol = selectedNetwork?.symbol
    const busy = this.state.preparing || this.state.queueing || this.state.selectingAccount
    const canPrepare =
      Boolean(selectedAccount && selectedNetwork) &&
      sameAccount(this.props.currentAccount, this.state.account) &&
      !busy
    const hasEvidence = Boolean(this.state.inspection && this.state.frozenDraft)
    const statusMessage = this.state.selectingAccount
      ? 'Selecting signer account…'
      : this.state.preparing
        ? 'Checking…'
        : this.state.queueing
          ? 'Preparing review…'
          : this.state.message

    const Root = this.props.embedded ? 'div' : 'main'
    return (
      <Root
        className={`deployment cardShow ${this.props.embedded ? 'deploymentEmbedded' : ''}`}
        aria-busy={busy ? 'true' : 'false'}
      >
        {!this.props.embedded ? (
          <header className='deploymentHeader'>
            <span className='deploymentEyebrow'>Contract deployment</span>
            <h1>Check deployment data</h1>
            <p>Review bytecode and constructor arguments before native review.</p>
          </header>
        ) : null}

        <form className='deploymentForm' onSubmit={(event) => this.prepare(event)}>
          <div className='deploymentSelectors'>
            <label>
              <span>Account</span>
              <select
                className='wrenInput'
                aria-label='Account'
                value={this.state.account}
                disabled={busy || !accounts.length}
                aria-describedby='deployment-account-helper'
                onChange={(event) => this.selectAccount(event.target.value)}
              >
                {!this.state.account ? <option value=''>Choose a signer account</option> : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {compactAddress(account.id)}
                  </option>
                ))}
              </select>
              <small id='deployment-account-helper'>Select the active signer.</small>
            </label>
            <label>
              <span>Network</span>
              <select
                className='wrenInput'
                aria-label='Network'
                value={this.state.chainId}
                disabled={busy || !networks.length}
                aria-describedby='deployment-network-helper'
                onChange={(event) => this.invalidate({ chainId: Number(event.target.value) })}
              >
                {!networks.length ? <option value=''>No connected networks</option> : null}
                {networks.map((network) => (
                  <option key={network.id} value={network.id}>
                    {network.name} · Chain {network.id}
                  </option>
                ))}
              </select>
              <small id='deployment-network-helper'>Select a connected, configured network.</small>
            </label>
          </div>

          {!this.state.account ? (
            <p className='deploymentEmpty' role='status'>
              Select a signer-capable account to continue.
            </p>
          ) : !networks.length ? (
            <p className='deploymentEmpty' role='status'>
              Connect and select a configured network to continue.
            </p>
          ) : null}

          <label className='deploymentField'>
            <span>Deployment data</span>
            <textarea
              className='wrenInput'
              aria-label='Deployment data'
              value={this.state.initcode}
              rows='9'
              placeholder='0x…'
              autoCapitalize='off'
              autoComplete='off'
              spellCheck='false'
              disabled={busy}
              aria-invalid={this.state.errors.initcode ? 'true' : 'false'}
              aria-describedby='deployment-initcode-helper deployment-initcode-count deployment-initcode-error'
              onChange={(event) => this.updateField('initcode', event.target.value)}
            />
            <small id='deployment-initcode-helper'>
              Paste creation bytecode with encoded constructor arguments.
            </small>
            <small id='deployment-initcode-count' className='deploymentByteCount'>
              {deploymentByteCount(this.state.initcode).toLocaleString()} / 49,152 bytes
            </small>
            <small id='deployment-initcode-error' className='deploymentFieldError'>
              {this.state.errors.initcode || ''}
            </small>
          </label>

          <label className='deploymentField deploymentValueField'>
            <span>Optional native value{symbol ? ` · ${symbol}` : ''}</span>
            <input
              className='wrenInput'
              aria-label='Optional native value'
              type='text'
              inputMode='decimal'
              value={this.state.value}
              placeholder='0'
              autoComplete='off'
              spellCheck='false'
              disabled={busy}
              aria-invalid={this.state.errors.value ? 'true' : 'false'}
              aria-describedby='deployment-value-helper deployment-value-error'
              onChange={(event) => this.updateField('value', event.target.value)}
            />
            <small id='deployment-value-helper'>
              Native value sent with creation. Blank or 0 means none.
            </small>
            <small id='deployment-value-error' className='deploymentFieldError'>
              {this.state.errors.value || ''}
            </small>
          </label>

          <p className='deploymentRpcDisclosure'>
            Checking sends deployment data, value, and account context only to your configured RPC for gas
            estimates, simulation, and pending nonce. It does not sign or broadcast.
          </p>

          {hasEvidence ? this.renderEvidence(this.state.inspection, selectedNetwork) : null}

          <p className='deploymentBoundary'>
            Wren does not compile Solidity, parse artifacts or ABIs, decode constructor arguments, verify
            source, compiler, bytecode, or safety, or guarantee deployment.
          </p>

          {statusMessage ? (
            <p
              className={`deploymentMessage deploymentMessage-${this.state.messageTone}`}
              role={this.state.messageTone === 'alert' ? 'alert' : 'status'}
              aria-live={this.state.messageTone === 'alert' ? 'assertive' : 'polite'}
              ref={this.state.messageTone === 'alert' ? this.alertRef : undefined}
              tabIndex={this.state.messageTone === 'alert' ? '-1' : undefined}
            >
              {statusMessage}
            </p>
          ) : null}

          <div className='deploymentActionShelf'>
            {hasEvidence ? (
              <button
                type='button'
                className='wrenControl wrenControlSecondary wrenControlLarge'
                disabled={busy}
                onClick={() => this.invalidate({}, true)}
              >
                Edit and recheck
              </button>
            ) : null}
            <button
              type={hasEvidence ? 'button' : 'submit'}
              className={`wrenControl ${hasEvidence ? 'wrenControlPrimary' : 'wrenControlSecondary'} wrenControlLarge`}
              disabled={hasEvidence ? busy : !canPrepare}
              onClick={hasEvidence ? () => this.queue() : undefined}
            >
              {this.state.preparing
                ? 'Checking deployment…'
                : this.state.queueing
                  ? 'Queueing review…'
                  : hasEvidence
                    ? 'Review deployment'
                    : 'Check deployment'}
            </button>
          </div>
        </form>
        {this.state.pendingNavigation
          ? createPortal(
              <DialogSurface
                className='deploymentAbandonDialog'
                role='alertdialog'
                modal
                labelledBy='deployment-abandon-title'
                describedBy='deployment-abandon-description'
                initialFocusRef={this.abandonCancelRef}
                onCancel={() => this.cancelAbandon()}
              >
                <div className='deploymentAbandonPanel'>
                  <h2 id='deployment-abandon-title'>Discard this deployment?</h2>
                  <p id='deployment-abandon-description'>
                    Leaving now clears the deployment data and any prepared evidence. Nothing has been signed
                    or broadcast.
                  </p>
                  <div className='deploymentAbandonActions'>
                    <button
                      ref={this.abandonCancelRef}
                      type='button'
                      className='wrenControl wrenControlSecondary'
                      onClick={() => this.cancelAbandon()}
                    >
                      Keep editing
                    </button>
                    <button
                      type='button'
                      className='wrenControl wrenControlDanger'
                      onClick={() => this.confirmAbandon()}
                    >
                      Discard and leave
                    </button>
                  </div>
                </div>
              </DialogSurface>,
              document.body
            )
          : null}
      </Root>
    )
  }
}

export default Deployment
