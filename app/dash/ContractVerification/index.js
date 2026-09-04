import React from 'react'

import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import {
  getExplorerCredentialStatus,
  getVerification,
  inspectVerificationArtifact,
  listVerifications,
  openVerificationResult,
  prepareVerification,
  publishVerification,
  publishVerificationToEtherscan,
  refreshVerification,
  reselectVerificationSource,
  selectVerificationArtifact
} from './api'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const HASH = /^0x[0-9a-f]{64}$/u
const STALE_MESSAGE = 'Choose the artifact again, then check source.'
export const ACTIVE_JOB_REFRESH_MS = 2_000

const ERROR_COPY = Object.freeze({
  'address-has-no-code': 'No deployed contract code was found at this address.',
  'api-key-required': 'Add an Etherscan API key in Settings before submitting directly.',
  'artifact-bundle-too-large': 'The selected artifact files are too large.',
  'artifact-file-too-large': 'This artifact file is too large.',
  'artifact-too-deep': 'This artifact is nested too deeply.',
  'artifact-mismatch': 'This source artifact does not match the deployed contract.',
  'credential-unavailable': 'Secure API-key storage is unavailable on this system.',
  'invalid-artifact-bundle': 'These files do not form a valid artifact bundle.',
  'invalid-artifact': 'Wren could not use this verification artifact.',
  'invalid-file': 'This artifact file could not be read safely.',
  'invalid-file-selection': 'Choose one or two JSON artifact files.',
  'invalid-json': 'This artifact does not contain valid JSON.',
  'invalid-standard-json': 'This file is not valid compiler Standard JSON.',
  'invalid-vyper-solc-json': 'This file is not a valid Vyper solc_json artifact.',
  'invalid-vyper-integrity': 'This Vyper artifact has invalid integrity metadata.',
  'invalid-compiler-version': 'This artifact does not include a valid exact compiler version.',
  'invalid-compiler-output': 'This artifact contains invalid compiler output.',
  'invalid-contract-identifier': 'This artifact contains an invalid contract identifier.',
  'invalid-deployed-bytecode': 'This artifact contains invalid deployed bytecode.',
  'invalid-bytecode-reference': 'This artifact contains an invalid bytecode reference.',
  'invalid-source-content': 'This artifact contains invalid source data.',
  'invalid-source-path': 'This artifact contains an invalid source path.',
  'invalid-utf8': 'This artifact is not valid UTF-8 text.',
  'mismatched-build-info-pair': 'These build-info files do not match.',
  'missing-build-output': 'Choose the matching compiler-output artifact too.',
  'missing-compiler-version': 'This artifact does not include an exact compiler version.',
  'output-too-large': 'This artifact’s compiler output is too large.',
  'overlapping-bytecode-reference': 'This artifact has overlapping bytecode references.',
  'source-checksum-mismatch': 'A Vyper source checksum does not match its content.',
  'source-content-too-large': 'A source in this artifact is too large.',
  'source-path-too-long': 'A source path in this artifact is too long.',
  'submission-too-large': 'This verification artifact is too large.',
  'too-many-artifacts': 'Choose no more than two artifact files.',
  'too-many-contracts': 'This artifact contains too many contracts.',
  'too-many-sources': 'This artifact contains too many sources.',
  'total-source-content-too-large': 'The sources in this artifact are too large.',
  'unsupported-artifact-format': 'This verification artifact format is not supported.',
  'unsupported-language': 'This verification artifact language is not supported.',
  'invalid-artifact-session': 'This source selection expired. Choose the artifact again.',
  'invalid-operation': 'This deployment can no longer be verified from its saved receipt.',
  'job-unavailable': 'This verification record is unavailable.',
  'network-disabled': 'Enable this network before checking source.',
  'network-disconnected': 'Connect this network before checking source.',
  'network-missing': 'Choose a configured network.',
  'operation-not-confirmed': 'Wait for the deployment to confirm before checking source.',
  'operation-unsettled': 'Wait for deployment finality before publishing source.',
  'refresh-unavailable': 'Status is temporarily unavailable. Nothing was resubmitted.',
  'rpc-unavailable': 'The configured RPC is unavailable.',
  'session-expired': 'This checked source expired. Check it again before publishing.',
  'source-reselection-required': 'Choose the same source artifact again to submit directly.',
  'target-changed': 'The deployed contract evidence changed. Check the target again.',
  'unstable-chain': 'The network changed while Wren checked the contract. Try again.',
  'etherscan-unsupported': 'Direct Etherscan submission is unavailable for this network.',
  'already-submitted': 'This submission is already in progress.'
})

const errorCopy = (value, fallback) => ERROR_COPY[value] || fallback

const compactAddress = (value = '') =>
  value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value

const networkConnected = (network) => {
  if (network?.connected === false || network?.connection?.connected === false) return false
  if (network?.connected === true) return true
  if (network?.connection?.connected === true) return true
  if (Array.isArray(network?.connection?.endpoints)) {
    return network.connection.endpoints.some((endpoint) => endpoint?.connected === true)
  }
  // The public component contract accepts an already-filtered connected-network list.
  return true
}

export const verificationNetworks = (networks = {}) => {
  const entries = Array.isArray(networks)
    ? networks.map((network) => [network?.id ?? network?.chainId, network])
    : Object.entries(networks)
  return entries
    .map(([storedId, network]) => ({
      id: Number(network?.id ?? network?.chainId ?? storedId),
      name: network?.name || `Chain ${network?.id ?? network?.chainId ?? storedId}`,
      configured: network?.configured !== false,
      enabled: network?.enabled !== false && network?.on !== false,
      connected: networkConnected(network)
    }))
    .filter(
      (network) =>
        Number.isSafeInteger(network.id) &&
        network.id > 0 &&
        network.configured &&
        network.enabled &&
        network.connected
    )
    .sort((left, right) => left.name.localeCompare(right.name))
}

const formatLabel = (format) =>
  ({
    'solidity-standard-json': 'Solidity standard JSON',
    'vyper-standard-json': 'Vyper standard JSON',
    'vyper-solc-json': 'Vyper solc_json',
    'foundry-build-info': 'Foundry build-info',
    'hardhat-2-build-info': 'Hardhat build-info',
    'hardhat-3-build-info': 'Hardhat 3 build-info'
  })[format] || 'Verification artifact'

const destinationLabel = (destination) =>
  ({
    sourcify: 'Sourcify',
    'etherscan-forwarded': 'Etherscan',
    'blockscout-forwarded': 'Blockscout',
    'routescan-forwarded': 'Routescan',
    'etherscan-direct': 'Etherscan · direct'
  })[destination] || destination

const destinationStatus = (status) =>
  ({
    'not-submitted': 'Not submitted',
    checking: 'Checking',
    published: 'Published',
    verified: 'Verified',
    'already-published': 'Already published',
    'already-verified': 'Already verified',
    rejected: 'Not verified',
    unavailable: 'Unavailable',
    'needs-api-key': 'API key needed',
    unknown: 'Status unknown'
  })[status] || 'Status unavailable'

const validTarget = (chainId, address) => Number(chainId) > 0 && ADDRESS.test(address.trim())
const hasActiveJobObservation = (job) =>
  Boolean(
    job?.destinations?.some(({ status }) => status === 'checking') ||
    (job?.status === 'publishing' &&
      job?.destinations?.some(
        ({ destination, status }) => destination === 'sourcify' && status === 'not-submitted'
      ))
  )

const destinationGuidance = (entry) => {
  if (entry?.destination !== 'etherscan-direct' || entry.status !== 'unknown') return ''
  if (entry.reasonCode === 'transport-failure') {
    return 'Etherscan’s response was not confirmed. Wren will not submit this publication again; check the contract on Etherscan later.'
  }
  if (entry.reasonCode === 'status-unavailable') {
    return 'Wren cannot confirm whether direct publication began. It will not submit this publication again; check the contract on Etherscan later.'
  }
  return 'Wren cannot confirm this direct submission. It will not be submitted again; check the contract on Etherscan later.'
}

const preparedEvidenceReady = (prepared) =>
  Boolean(
    prepared &&
    HASH.test(prepared.target?.runtimeCodeHash) &&
    ['matched', 'server-required'].includes(prepared.localRuntimeMatch) &&
    ['complete', 'not-applicable'].includes(prepared.deploymentSettlement) &&
    typeof prepared.contractIdentifier === 'string' &&
    prepared.contractIdentifier &&
    typeof prepared.compilerVersion === 'string' &&
    prepared.compilerVersion
  )

const EvidenceRow = ({ label, children, mono = false }) => (
  <div className='contractVerificationLedgerRow'>
    <dt>{label}</dt>
    <dd className={mono ? 'contractVerificationMono' : undefined}>{children}</dd>
  </div>
)

const ArtifactSummary = ({ artifact, busy, buttonRef, frozen = false, onReplace }) => {
  const summary = artifact.summary
  const candidates = summary.contractCandidates || []
  return (
    <section className='contractVerificationArtifact' aria-labelledby='contract-verification-artifact'>
      <div className='contractVerificationSectionHeading'>
        <div>
          <h2 id='contract-verification-artifact'>Source artifact</h2>
          <p>{formatLabel(summary.format)}</p>
        </div>
        {!frozen ? (
          <button
            type='button'
            ref={buttonRef}
            className='wrenControl wrenControlGhost'
            disabled={busy}
            onClick={onReplace}
          >
            Replace
          </button>
        ) : null}
      </div>
      <dl className='contractVerificationLedger'>
        <EvidenceRow label='Language'>{summary.language}</EvidenceRow>
        <EvidenceRow label='Sources'>{Number(summary.sourceCount).toLocaleString()}</EvidenceRow>
        <EvidenceRow label='Compiler'>
          {summary.compilerVersion ||
            (summary.compilerStatus === 'required' ? 'Enter exact version' : 'Included')}
        </EvidenceRow>
        <EvidenceRow label={candidates.length === 1 ? 'Contract candidate' : 'Contracts'}>
          {candidates.length === 0
            ? 'Enter a fully qualified identifier below'
            : candidates.length === 1
              ? candidates[0]
              : `${candidates.length.toLocaleString()} candidates · select below`}
        </EvidenceRow>
        <EvidenceRow label='Local runtime match'>
          {summary.localRuntimeMatch ? 'Available' : 'Checked by Sourcify after publishing'}
        </EvidenceRow>
      </dl>
    </section>
  )
}

export class ContractVerification extends React.Component {
  constructor(props) {
    super(props)
    const networks = verificationNetworks(props.networks)
    const data = props.data || props.context || {}
    this.state = {
      chainId: data.chainId || networks[0]?.id || '',
      address: data.address || '',
      operationId: data.operationId || '',
      immutableTarget: Boolean(data.operationId),
      artifact: undefined,
      compilerVersion: '',
      contractIdentifier: '',
      prepared: undefined,
      acknowledged: false,
      job: undefined,
      recentJobs: [],
      recoveringSource: false,
      keyMissing: false,
      constructorArguments: '',
      noConstructorArguments: false,
      etherscanAcknowledged: false,
      busy: '',
      status: '',
      error: ''
    }
    this.generation = 0
    this.recentGeneration = 0
    this.jobObservationGeneration = 0
    this.jobObservationTimer = undefined
    this.activeOperation = false
    this.mounted = false
    this.addressInput = React.createRef()
    this.artifactButton = React.createRef()
    this.errorRef = React.createRef()
    this.resultRef = React.createRef()
  }

  componentDidMount() {
    this.mounted = true
    const data = this.props.data || this.props.context || {}
    if (data.verificationId) this.loadVerification(data.verificationId)
    else if (data.operationId && !(data.chainId && data.address)) {
      this.setState({
        error: 'This deployment target is unavailable. Reopen verification from its confirmation.'
      })
    } else if (!data.operationId) this.loadRecent()
  }

  componentWillUnmount() {
    this.mounted = false
    this.generation += 1
    this.recentGeneration += 1
    this.jobObservationGeneration += 1
    clearTimeout(this.jobObservationTimer)
    this.activeOperation = false
  }

  componentDidUpdate(previousProps, previousState) {
    if (this.state.error && this.state.error !== previousState.error) this.errorRef.current?.focus()
    if (this.state.prepared && this.state.prepared !== previousState.prepared) this.resultRef.current?.focus()
    if (this.state.job && !previousState.job) this.resultRef.current?.focus()

    if (previousProps.networks !== this.props.networks && !this.state.immutableTarget && !this.state.job) {
      const networks = verificationNetworks(this.props.networks)
      if (!networks.some(({ id }) => id === Number(this.state.chainId))) {
        this.invalidate({ chainId: networks[0]?.id || '' }, Boolean(this.state.prepared))
        return
      }
    }
    this.scheduleJobObservation()
  }

  scheduleJobObservation() {
    clearTimeout(this.jobObservationTimer)
    this.jobObservationTimer = undefined
    if (!this.mounted || this.props.active === false || !hasActiveJobObservation(this.state.job)) return
    this.jobObservationTimer = setTimeout(() => this.observeJob(), ACTIVE_JOB_REFRESH_MS)
  }

  async observeJob() {
    this.jobObservationTimer = undefined
    const jobId = this.state.job?.id
    if (!this.mounted || this.props.active === false || !jobId || !hasActiveJobObservation(this.state.job)) {
      return
    }
    if (this.activeOperation || this.state.busy) {
      this.scheduleJobObservation()
      return
    }
    const generation = ++this.jobObservationGeneration
    try {
      const result = await getVerification(jobId)
      if (!this.mounted || generation !== this.jobObservationGeneration || this.state.job?.id !== jobId) {
        return
      }
      if (result?.success && result.job) {
        if (JSON.stringify(result.job) !== JSON.stringify(this.state.job)) {
          this.setState({ job: result.job, status: 'Verification status updated.' })
          return
        }
      }
    } catch {
      // The visible manual refresh remains authoritative; local observation is best effort.
    }
    this.scheduleJobObservation()
  }

  async run(name, work, failure, onSuccess) {
    if (this.state.busy || this.activeOperation) return
    const generation = ++this.generation
    this.jobObservationGeneration += 1
    clearTimeout(this.jobObservationTimer)
    this.activeOperation = true
    this.setState({ busy: name, error: '', status: '' })
    try {
      const result = await work()
      if (!this.mounted || generation !== this.generation) return
      if (result?.canceled) {
        this.activeOperation = false
        await new Promise((resolve) => this.setState({ busy: '' }, resolve))
        return result
      }
      if (!result?.success) {
        this.activeOperation = false
        if (result?.error === 'already-submitted' && result.job) {
          this.setState({
            busy: '',
            error: '',
            status: 'Existing submission opened.',
            job: result.job
          })
          return result
        }
        this.setState({
          busy: '',
          error: errorCopy(result?.error, failure),
          ...(result?.job ? { job: result.job } : {})
        })
        return result
      }
      await new Promise((resolve) => {
        this.activeOperation = false
        this.setState({ busy: '' }, () => {
          onSuccess(result)
          resolve()
        })
      })
      return result
    } catch {
      if (!this.mounted || generation !== this.generation) return
      this.activeOperation = false
      this.setState({ busy: '', error: failure })
    }
  }

  loadVerification(verificationId) {
    return this.run(
      'loading',
      () => getVerification(verificationId),
      'Could not load this verification record.',
      ({ job }) => this.setState({ job, chainId: job.target.chainId, address: job.target.address })
    )
  }

  async loadRecent() {
    const generation = ++this.recentGeneration
    try {
      const result = await listVerifications()
      if (!this.mounted || generation !== this.recentGeneration) return
      if (!result?.success) {
        if (this.activeOperation || this.state.artifact || this.state.prepared || this.state.job) return
        this.setState({
          error: errorCopy(result?.error, 'Could not load recent verification records.')
        })
        return
      }
      this.setState({ recentJobs: Array.isArray(result.jobs) ? result.jobs.slice(0, 10) : [] })
    } catch {
      if (!this.mounted || generation !== this.recentGeneration) return
      if (this.activeOperation || this.state.artifact || this.state.prepared || this.state.job) return
      this.setState({ error: 'Could not load recent verification records.' })
    }
  }

  invalidate(next = {}, announce = false) {
    this.generation += 1
    this.activeOperation = false
    this.setState({
      ...next,
      prepared: undefined,
      acknowledged: false,
      etherscanAcknowledged: false,
      busy: '',
      error: '',
      status: announce ? STALE_MESSAGE : ''
    })
  }

  update(field, value) {
    this.invalidate({ [field]: value }, Boolean(this.state.prepared))
  }

  async chooseArtifact() {
    const trigger = this.artifactButton.current
    const result = await this.run(
      'choosing',
      inspectVerificationArtifact,
      'Could not inspect this artifact.',
      ({ artifact }) => {
        if (!artifact) return
        const candidates = artifact.summary?.contractCandidates || []
        this.invalidate(
          {
            artifact,
            compilerVersion: artifact.summary?.compilerVersion || '',
            contractIdentifier:
              artifact.summary?.selectedContractIdentifier || (candidates.length === 1 ? candidates[0] : ''),
            ...(this.state.job ? { recoveringSource: true } : {})
          },
          Boolean(this.state.prepared)
        )
      }
    )
    if ((!result || result.canceled || !result.artifact) && this.mounted) trigger?.focus()
  }

  selectContract(contractIdentifier) {
    if (!contractIdentifier) {
      this.invalidate({ contractIdentifier: '' }, Boolean(this.state.prepared))
      return
    }
    return this.run(
      'selecting-contract',
      () => selectVerificationArtifact(this.state.artifact.token, contractIdentifier),
      'Could not select this contract.',
      ({ artifact }) =>
        this.invalidate(
          {
            artifact,
            contractIdentifier: artifact.summary?.selectedContractIdentifier || contractIdentifier
          },
          Boolean(this.state.prepared)
        )
    )
  }

  artifactSelectionValid() {
    const summary = this.state.artifact?.summary
    if (!summary) return false
    if (summary.compilerStatus === 'required' && !this.state.compilerVersion.trim()) return false
    const candidates = summary.contractCandidates || []
    if (candidates.length !== 1 && !this.state.contractIdentifier.trim()) return false
    return true
  }

  selectionPayload() {
    const summary = this.state.artifact.summary
    const candidates = summary.contractCandidates || []
    return {
      artifactToken: this.state.artifact.token,
      ...(summary.compilerStatus === 'required'
        ? { compilerVersion: this.state.compilerVersion.trim() }
        : {}),
      ...(this.state.contractIdentifier || candidates[0]
        ? { contractIdentifier: this.state.contractIdentifier || candidates[0] }
        : {})
    }
  }

  check(event) {
    event.preventDefault()
    if (
      this.state.busy ||
      !verificationNetworks(this.props.networks).some(({ id }) => id === Number(this.state.chainId)) ||
      !validTarget(this.state.chainId, this.state.address) ||
      !this.artifactSelectionValid()
    )
      return
    const input = {
      ...this.selectionPayload(),
      chainId: Number(this.state.chainId),
      address: this.state.address.trim(),
      ...(this.state.operationId ? { operationId: this.state.operationId } : {})
    }
    return this.run(
      'checking',
      () => prepareVerification(input),
      'Could not check this source. Nothing was published.',
      ({ prepared }) => this.setState({ prepared, acknowledged: false, status: 'Source check complete.' })
    )
  }

  publish() {
    if (
      this.state.busy ||
      !this.state.acknowledged ||
      !this.state.prepared ||
      !preparedEvidenceReady(this.state.prepared)
    )
      return
    return this.run(
      'publishing',
      () => publishVerification(this.state.prepared.acknowledgementToken),
      'Could not publish source. Check the source again before retrying.',
      ({ job }) =>
        this.setState({
          job,
          prepared: undefined,
          acknowledged: false,
          artifact: undefined,
          status: 'Publication started.'
        })
    )
  }

  refresh() {
    if (!this.state.job || this.state.busy) return
    return this.run(
      'refreshing',
      () => refreshVerification(this.state.job.id),
      'Could not refresh status. Nothing was resubmitted.',
      ({ job }) => this.setState({ job, status: 'Status refreshed.' })
    )
  }

  openResult(destination) {
    if (!this.state.job || this.state.busy) return
    return this.run(
      'opening-result',
      () => openVerificationResult(this.state.job.id, destination),
      'Could not open this verification result.',
      () => this.setState({ status: 'Opened verification result.' })
    )
  }

  reselect() {
    if (!this.state.job || !this.artifactSelectionValid() || this.state.busy) return
    return this.run(
      'reselecting',
      () =>
        reselectVerificationSource({
          jobId: this.state.job.id,
          ...this.selectionPayload()
        }),
      'This artifact could not restore the verification source.',
      ({ job }) =>
        this.setState({ job, recoveringSource: false, artifact: undefined, status: 'Source restored.' })
    )
  }

  async submitDirect() {
    const constructorArgumentsReady =
      this.state.noConstructorArguments || /^(?:[0-9a-fA-F]{2})+$/u.test(this.state.constructorArguments)
    if (!this.state.job || this.state.busy || !constructorArgumentsReady || !this.state.etherscanAcknowledged)
      return
    const status = await this.run(
      'credential',
      getExplorerCredentialStatus,
      'Could not check secure API-key storage.',
      ({ credential }) => {
        if (!credential.configured) this.setState({ keyMissing: true })
      }
    )
    if (!status?.success || !status.credential?.configured || !this.mounted) return
    return this.run(
      'etherscan',
      () =>
        publishVerificationToEtherscan(
          this.state.job.id,
          this.state.constructorArguments,
          this.state.noConstructorArguments
        ),
      'Could not submit directly to Etherscan.',
      ({ job }) =>
        this.setState({
          job,
          keyMissing: false,
          etherscanAcknowledged: false,
          status: 'Direct submission started.'
        })
    )
  }

  openSettings() {
    link.send('tray:action', 'navDash', { view: 'settings', data: {} })
  }

  checkAnother() {
    this.generation += 1
    this.jobObservationGeneration += 1
    clearTimeout(this.jobObservationTimer)
    this.activeOperation = false
    const networks = verificationNetworks(this.props.networks)
    const chainId = networks.some(({ id }) => id === Number(this.state.chainId))
      ? this.state.chainId
      : networks[0]?.id || ''
    this.setState(
      {
        chainId,
        address: '',
        operationId: '',
        immutableTarget: false,
        artifact: undefined,
        compilerVersion: '',
        contractIdentifier: '',
        prepared: undefined,
        acknowledged: false,
        job: undefined,
        recoveringSource: false,
        keyMissing: false,
        constructorArguments: '',
        noConstructorArguments: false,
        etherscanAcknowledged: false,
        busy: '',
        status: '',
        error: ''
      },
      () => {
        this.addressInput.current?.focus()
        this.loadRecent()
      }
    )
  }

  renderTarget(networks) {
    const selected = networks.find(({ id }) => id === Number(this.state.chainId))
    if (this.state.immutableTarget || this.state.prepared || this.state.job) {
      return (
        <section className='contractVerificationContext' aria-label='Contract target'>
          <div>
            <span>Network</span>
            <strong>{selected?.name || `Chain ${this.state.chainId}`}</strong>
            <small>Chain {this.state.chainId}</small>
          </div>
          <div>
            <span>Contract</span>
            <strong className='contractVerificationMono'>{compactAddress(this.state.address)}</strong>
            <small className='contractVerificationMono'>{this.state.address}</small>
          </div>
        </section>
      )
    }
    const invalidAddress = Boolean(this.state.address && !ADDRESS.test(this.state.address.trim()))
    return (
      <div className='contractVerificationTargetFields'>
        <label htmlFor='contract-verification-network'>
          <span>Network</span>
          <select
            id='contract-verification-network'
            className='wrenInput'
            value={this.state.chainId}
            disabled={Boolean(this.state.busy) || !networks.length}
            onChange={(event) => this.update('chainId', Number(event.target.value))}
          >
            {!networks.length ? <option value=''>No connected networks</option> : null}
            {networks.map((network) => (
              <option key={network.id} value={network.id}>
                {network.name} · Chain {network.id}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor='contract-verification-address'>
          <span>Contract address</span>
          <input
            id='contract-verification-address'
            ref={this.addressInput}
            aria-label='Contract address'
            className='wrenInput contractVerificationMono'
            type='text'
            value={this.state.address}
            placeholder='0x…'
            autoCapitalize='off'
            autoComplete='off'
            spellCheck='false'
            disabled={Boolean(this.state.busy)}
            aria-invalid={invalidAddress ? 'true' : 'false'}
            aria-describedby={invalidAddress ? 'contract-verification-address-error' : undefined}
            onChange={(event) => this.update('address', event.target.value)}
          />
          {invalidAddress ? (
            <small id='contract-verification-address-error' className='contractVerificationFieldError'>
              Enter a 20-byte hexadecimal address beginning with 0x.
            </small>
          ) : null}
        </label>
      </div>
    )
  }

  renderArtifactFields() {
    const artifact = this.state.artifact
    if (!artifact) {
      return (
        <section className='contractVerificationChoose'>
          <button
            type='button'
            ref={this.artifactButton}
            className='wrenControl wrenControlSecondary wrenControlLarge'
            disabled={Boolean(this.state.busy)}
            onClick={() => this.chooseArtifact()}
          >
            {this.state.busy === 'choosing' ? 'Choosing artifact…' : 'Choose artifact'}
          </button>
          <p>
            Use Solidity or Vyper standard JSON, or Foundry or Hardhat build-info. Wren reads the selected
            file locally.
          </p>
        </section>
      )
    }
    const summary = artifact.summary
    const candidates = summary.contractCandidates || []
    if (this.state.prepared) return <ArtifactSummary artifact={artifact} frozen />
    return (
      <>
        <ArtifactSummary
          artifact={artifact}
          busy={Boolean(this.state.busy)}
          buttonRef={this.artifactButton}
          onReplace={() => this.chooseArtifact()}
        />
        {summary.compilerStatus === 'required' ? (
          <label className='contractVerificationField' htmlFor='contract-verification-compiler'>
            <span>Exact compiler version</span>
            <input
              id='contract-verification-compiler'
              className='wrenInput contractVerificationMono'
              value={this.state.compilerVersion}
              placeholder={summary.language === 'Vyper' ? '0.3.10' : '0.8.28+commit…'}
              disabled={Boolean(this.state.busy)}
              onChange={(event) => this.update('compilerVersion', event.target.value)}
            />
          </label>
        ) : null}
        {candidates.length > 1 ? (
          <label className='contractVerificationField' htmlFor='contract-verification-contract'>
            <span>Contract</span>
            <select
              id='contract-verification-contract'
              className='wrenInput contractVerificationMono'
              value={this.state.contractIdentifier}
              disabled={Boolean(this.state.busy)}
              onChange={(event) => this.selectContract(event.target.value)}
            >
              <option value=''>Choose a contract</option>
              {candidates.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {candidates.length === 0 ? (
          <label className='contractVerificationField' htmlFor='contract-verification-identifier'>
            <span>Contract identifier</span>
            <input
              id='contract-verification-identifier'
              className='wrenInput contractVerificationMono'
              value={this.state.contractIdentifier}
              placeholder='src/Contract.sol:Contract'
              disabled={Boolean(this.state.busy)}
              onChange={(event) => this.update('contractIdentifier', event.target.value)}
            />
          </label>
        ) : null}
      </>
    )
  }

  renderRecent(networks) {
    if (this.state.job || this.state.operationId || !this.state.recentJobs.length) return null
    return (
      <section
        className='contractVerificationRecent dashHomeCard'
        aria-labelledby='contract-verification-recent-title'
      >
        <header className='contractVerificationRecentHeading'>
          <h2 id='contract-verification-recent-title'>Recent verifications</h2>
        </header>
        <div className='contractVerificationRecentList'>
          {this.state.recentJobs.map((job) => {
            const network = networks.find(({ id }) => id === Number(job.target?.chainId))
            const address = compactAddress(job.target?.address)
            const networkName = network?.name || `Chain ${job.target?.chainId}`
            const status = String(job.status || 'unknown').replaceAll('-', ' ')
            return (
              <button
                type='button'
                className='contractVerificationRecentRow'
                key={job.id}
                aria-label={`${address} on ${networkName}, ${status}. Open verification.`}
                disabled={Boolean(this.state.busy)}
                onClick={() => this.loadVerification(job.id)}
              >
                <span className='contractVerificationRecentIdentity'>
                  <strong className='contractVerificationMono'>{address}</strong>
                  <small>{networkName}</small>
                </span>
                <span className='contractVerificationRecentMeta'>{status}</span>
                <Icon name='next' size={14} />
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  renderPrepared() {
    const prepared = this.state.prepared
    if (!prepared) return null
    const settlement =
      prepared.deploymentSettlement === 'complete'
        ? 'Finality complete'
        : prepared.deploymentSettlement === 'not-applicable'
          ? 'Not a managed deployment'
          : prepared.deploymentSettlement === 'pending'
            ? 'Waiting for finality'
            : 'Unavailable'
    const localMatch =
      prepared.localRuntimeMatch === 'matched'
        ? 'Matched locally'
        : prepared.localRuntimeMatch === 'server-required'
          ? 'Checked by Sourcify after publishing'
          : 'Unavailable'
    return (
      <section className='contractVerificationEvidence' ref={this.resultRef} tabIndex='-1'>
        <div className='contractVerificationSectionHeading'>
          <div>
            <h2>Source check</h2>
            <p>Evidence is bound to this exact target and artifact.</p>
          </div>
        </div>
        <dl className='contractVerificationLedger'>
          <EvidenceRow label='Runtime code' mono>
            {HASH.test(prepared.target?.runtimeCodeHash)
              ? `Bound to ${prepared.target.runtimeCodeHash}`
              : 'Unavailable'}
          </EvidenceRow>
          <EvidenceRow label='Compiled match'>{localMatch}</EvidenceRow>
          <EvidenceRow label='Deployment finality'>{settlement}</EvidenceRow>
          <EvidenceRow label='Contract' mono>
            {prepared.contractIdentifier}
          </EvidenceRow>
          <EvidenceRow label='Compiler' mono>
            {prepared.compilerVersion}
          </EvidenceRow>
        </dl>
      </section>
    )
  }

  directEligible(job) {
    const sourcify = job.destinations?.find(({ destination }) => destination === 'sourcify')
    const forwarded = job.destinations?.find(({ destination }) => destination === 'etherscan-forwarded')
    const direct = job.destinations?.find(({ destination }) => destination === 'etherscan-direct')
    return (
      ['published', 'already-published'].includes(sourcify?.status) &&
      ['not-submitted', 'unavailable', 'rejected', 'unknown'].includes(forwarded?.status) &&
      ['not-submitted', 'unavailable', 'needs-api-key'].includes(direct?.status) &&
      !direct?.remoteId
    )
  }

  renderResult() {
    const job = this.state.job
    if (!job) return null
    const direct = job.destinations?.find(({ destination }) => destination === 'etherscan-direct')
    const directPollNeedsKey = direct?.status === 'needs-api-key' && Boolean(direct.remoteId)
    const directNeedsSettings = this.state.keyMissing || direct?.status === 'needs-api-key'
    const constructorArgumentsValid = /^(?:[0-9a-fA-F]{2})+$/u.test(this.state.constructorArguments)
    const constructorArgumentsHelp = this.state.noConstructorArguments
      ? ''
      : this.state.constructorArguments
        ? constructorArgumentsValid
          ? ''
          : 'Use an even number of hexadecimal characters without 0x.'
        : 'Paste encoded constructor arguments, or confirm there are none.'
    return (
      <section className='contractVerificationResult' ref={this.resultRef} tabIndex='-1'>
        <div className='contractVerificationSectionHeading'>
          <div>
            <h2>Verification status</h2>
            <p>
              {job.status === 'partial'
                ? 'Source was published, but one or more explorer checks need attention.'
                : 'Each destination reports its own result.'}
            </p>
          </div>
          <div className='contractVerificationResultActions'>
            <button
              type='button'
              className='wrenControl wrenControlGhost'
              disabled={Boolean(this.state.busy)}
              onClick={() => this.checkAnother()}
            >
              Check another contract
            </button>
            <button
              type='button'
              className='wrenControl wrenControlGhost'
              disabled={Boolean(this.state.busy)}
              onClick={() => this.refresh()}
            >
              {this.state.busy === 'refreshing' ? 'Refreshing…' : 'Refresh status'}
            </button>
          </div>
        </div>
        <dl className='contractVerificationDestinations'>
          {(job.destinations || []).map((entry) => {
            const guidance = destinationGuidance(entry)
            return (
              <div className='contractVerificationDestination' key={entry.destination}>
                <dt>{destinationLabel(entry.destination)}</dt>
                <dd>
                  <span className='contractVerificationDestinationStatus'>
                    <span>{destinationStatus(entry.status)}</span>
                    {guidance ? <small>{guidance}</small> : null}
                  </span>
                  {entry.explorerUrl ? (
                    <button
                      type='button'
                      className='wrenControl wrenControlGhost contractVerificationExternal'
                      disabled={Boolean(this.state.busy)}
                      onClick={() => this.openResult(entry.destination)}
                    >
                      Open result
                    </button>
                  ) : null}
                </dd>
              </div>
            )
          })}
        </dl>
        {this.directEligible(job) ? (
          <div className='contractVerificationDirect'>
            <label
              className='contractVerificationField'
              htmlFor='contract-verification-constructor-arguments'
            >
              <span>Encoded constructor arguments</span>
              <input
                id='contract-verification-constructor-arguments'
                className='wrenInput contractVerificationMono'
                value={this.state.constructorArguments}
                placeholder='Hex without 0x'
                maxLength={2 * 1024 * 1024}
                disabled={Boolean(this.state.busy) || this.state.noConstructorArguments}
                aria-invalid={
                  this.state.constructorArguments && !constructorArgumentsValid ? 'true' : 'false'
                }
                aria-describedby='contract-verification-constructor-arguments-help'
                onChange={(event) =>
                  this.setState({
                    constructorArguments: event.target.value,
                    noConstructorArguments: false,
                    etherscanAcknowledged: false
                  })
                }
              />
            </label>
            <label className='contractVerificationAcknowledgement'>
              <input
                type='checkbox'
                checked={this.state.noConstructorArguments}
                disabled={Boolean(this.state.busy)}
                onChange={(event) =>
                  this.setState({
                    noConstructorArguments: event.target.checked,
                    etherscanAcknowledged: false,
                    ...(event.target.checked ? { constructorArguments: '' } : {})
                  })
                }
              />
              <span>This contract has no constructor arguments.</span>
            </label>
            <p
              id='contract-verification-constructor-arguments-help'
              className={
                this.state.constructorArguments && !constructorArgumentsValid
                  ? 'contractVerificationFieldError'
                  : undefined
              }
            >
              {constructorArgumentsHelp || 'Constructor arguments are ready.'}
            </p>
            <p className='contractVerificationNotice'>
              This fallback sends the already-checked source, metadata, and any encoded constructor arguments
              directly to Etherscan. Publication is permanent, public, and irreversible.
            </p>
            <label className='contractVerificationAcknowledgement'>
              <input
                type='checkbox'
                checked={this.state.etherscanAcknowledged}
                disabled={Boolean(this.state.busy)}
                onChange={(event) => this.setState({ etherscanAcknowledged: event.target.checked })}
              />
              <span>I consent to direct Etherscan submission.</span>
            </label>
            <button
              type='button'
              className='wrenControl wrenControlGhost'
              disabled={
                Boolean(this.state.busy) ||
                !this.state.etherscanAcknowledged ||
                (!this.state.noConstructorArguments && !constructorArgumentsValid)
              }
              onClick={() => this.submitDirect()}
            >
              {this.state.busy === 'etherscan' || this.state.busy === 'credential'
                ? 'Checking Etherscan…'
                : 'Submit directly with API key'}
            </button>
            {directNeedsSettings ? (
              <p>
                {this.state.keyMissing
                  ? 'No Etherscan API key is configured. '
                  : 'Replace the Etherscan API key before trying again. '}
                <button
                  type='button'
                  className='contractVerificationTextAction'
                  onClick={() => this.openSettings()}
                >
                  Open Settings
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        {directPollNeedsKey ? (
          <div className='contractVerificationDirect'>
            <p>
              Replace the Etherscan API key in Settings, then refresh the existing submission.{' '}
              <button
                type='button'
                className='contractVerificationTextAction'
                onClick={() => this.openSettings()}
              >
                Open Settings
              </button>
            </p>
          </div>
        ) : null}
        {this.state.recoveringSource ? (
          <section className='contractVerificationRecovery' aria-labelledby='verification-recovery-title'>
            <h3 id='verification-recovery-title'>Restore source for direct submission</h3>
            <p>Choose the same artifact. Wren checks its identity before restoring it.</p>
            {this.renderArtifactFields()}
            {this.state.artifact ? (
              <button
                type='button'
                className='wrenControl wrenControlSecondary'
                disabled={Boolean(this.state.busy) || !this.artifactSelectionValid()}
                onClick={() => this.reselect()}
              >
                Restore source
              </button>
            ) : null}
          </section>
        ) : null}
        {this.state.error.includes('Choose the same source artifact') && !this.state.recoveringSource ? (
          <button
            type='button'
            className='wrenControl wrenControlSecondary'
            disabled={Boolean(this.state.busy)}
            onClick={() => this.setState({ recoveringSource: true, error: '' })}
          >
            Reselect source
          </button>
        ) : null}
      </section>
    )
  }

  renderFeedback() {
    const checking = this.state.job?.destinations?.filter(({ status }) => status === 'checking') || []
    const checkingStatus = checking.length
      ? `${checking.length} verification destination${checking.length === 1 ? '' : 's'} checking.`
      : ''
    return (
      <div className='contractVerificationFeedback'>
        <p role='status' aria-live='polite' aria-atomic='true'>
          {this.state.busy === 'loading'
            ? 'Loading verification…'
            : this.state.busy === 'checking'
              ? 'Checking source… Nothing has been published.'
              : this.state.busy === 'publishing'
                ? 'Publishing source…'
                : this.state.busy
                  ? 'Working…'
                  : this.state.status || checkingStatus}
        </p>
        {this.state.error ? (
          <p role='alert' ref={this.errorRef} tabIndex='-1'>
            {this.state.error}
          </p>
        ) : null}
      </div>
    )
  }

  render() {
    const networks = verificationNetworks(this.props.networks)
    const busy = Boolean(this.state.busy)
    const prepared = this.state.prepared
    const canCheck =
      !busy &&
      networks.some(({ id }) => id === Number(this.state.chainId)) &&
      validTarget(this.state.chainId, this.state.address) &&
      this.artifactSelectionValid()
    const canPublish = !busy && preparedEvidenceReady(prepared) && this.state.acknowledged

    const Root = this.props.embedded ? 'div' : 'main'
    return (
      <Root
        className={`contractVerification cardShow ${this.props.embedded ? 'contractVerificationEmbedded' : ''}`}
        aria-busy={busy ? 'true' : 'false'}
      >
        {!this.props.embedded ? (
          <header className='contractVerificationHeader'>
            <span>Contract verification</span>
            <h1>Verify contract source</h1>
            <p>
              Match a source artifact to this deployed contract, then publish the verification record
              publicly.
            </p>
          </header>
        ) : null}

        {this.renderTarget(networks)}

        {this.state.job ? (
          <>
            {this.renderResult()}
            {this.renderFeedback()}
          </>
        ) : (
          <form className='contractVerificationForm' onSubmit={(event) => this.check(event)}>
            {this.renderArtifactFields()}
            {this.renderPrepared()}
            {this.renderFeedback()}

            {prepared ? (
              <div className='contractVerificationPublication'>
                <p className='contractVerificationNotice'>
                  Submitting sends the selected Solidity or Vyper source artifact and verification metadata to
                  Sourcify. Sourcify may forward them to Etherscan, Blockscout, or Routescan. Publication is
                  permanent, public, and irreversible.
                </p>
                <label className='contractVerificationAcknowledgement'>
                  <input
                    type='checkbox'
                    checked={this.state.acknowledged}
                    disabled={busy || !preparedEvidenceReady(prepared)}
                    onChange={(event) => this.setState({ acknowledged: event.target.checked })}
                  />
                  <span>I consent to this submission and possible forwarding.</span>
                </label>
              </div>
            ) : null}

            <div className='contractVerificationActionShelf'>
              {prepared ? (
                <button
                  type='button'
                  className='wrenControl wrenControlSecondary wrenControlLarge'
                  disabled={busy}
                  onClick={() =>
                    this.invalidate(
                      { artifact: undefined, compilerVersion: '', contractIdentifier: '' },
                      true
                    )
                  }
                >
                  Edit and recheck
                </button>
              ) : null}
              <button
                type={prepared ? 'button' : 'submit'}
                className={`wrenControl ${prepared ? 'wrenControlPrimary' : 'wrenControlSecondary'} wrenControlLarge`}
                disabled={prepared ? !canPublish : !canCheck}
                onClick={prepared ? () => this.publish() : undefined}
              >
                {this.state.busy === 'checking'
                  ? 'Checking source…'
                  : this.state.busy === 'publishing'
                    ? 'Publishing source…'
                    : prepared
                      ? 'Publish source'
                      : 'Check source'}
              </button>
            </div>
          </form>
        )}
        {this.renderRecent(networks)}
      </Root>
    )
  }
}

export default ContractVerification
