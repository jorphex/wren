import React from 'react'
import BigNumber from 'bignumber.js'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import { resolveLocalAddressIdentity } from '../../../../../resources/domain/addressBook/identity'
import { SimulationAllowance, SimulationEffects } from '../TransactionRequest/ViewData/effects'
import {
  createWalletCallsDraft,
  formatNativeMaximum,
  parseWalletCallsDraft,
  walletCallMaximum
} from './adjustment'

const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/

const quantity = (value) => {
  if (typeof value !== 'string' || !QUANTITY.test(value)) return
  try {
    return BigInt(value)
  } catch {
    return
  }
}

const shortAddress = (value = '') =>
  typeof value === 'string' && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value

const formatNative = (value, decimals, symbol) => {
  const parsed = quantity(value)
  return parsed === undefined ? `? ${symbol}` : formatNativeMaximum(parsed, decimals, symbol)
}

const formatInteger = (value) => quantity(value)?.toLocaleString('en-US') || 'unavailable'

const formatGwei = (value) => {
  const parsed = quantity(value)
  if (parsed === undefined) return 'unavailable'
  const whole = parsed / 1_000_000_000n
  const fraction = (parsed % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} Gwei`
}

const formatFiat = (value, decimals, usd) => {
  const parsed = quantity(value)
  if (parsed === undefined || !Number.isFinite(usd)) return ''
  const display = new BigNumber(parsed.toString()).shiftedBy(-decimals).multipliedBy(usd)
  return display.isFinite() ? `≈ $${display.toFormat(2)}` : ''
}

const simulationLabel = (simulation) => {
  if (!simulation || simulation.status === 'pending')
    return { label: 'Simulation in progress', tone: 'pending' }
  if (simulation.status === 'succeeded') return { label: 'Simulation found no failures', tone: 'success' }
  if (simulation.status === 'reverted') return { label: 'Simulation found a reverting call', tone: 'danger' }
  if (simulation.status === 'unavailable')
    return { label: 'Stateful simulation unavailable', tone: 'warning' }
  return { label: 'Stateful simulation failed', tone: 'danger' }
}

const preparedCallsMatchRequest = (req, preparedCalls) =>
  preparedCalls.every(({ transaction }, index) => {
    const call = req.calls[index]
    const fromMatches =
      typeof transaction?.from === 'string' &&
      typeof req.account === 'string' &&
      transaction.from.toLowerCase() === req.account.toLowerCase()
    const toMatches = call.to
      ? typeof transaction?.to === 'string' && transaction.to.toLowerCase() === call.to.toLowerCase()
      : transaction?.to === undefined

    return (
      fromMatches &&
      transaction.chainId === req.chainId &&
      toMatches &&
      transaction.data === call.data &&
      transaction.value === call.value
    )
  })

const preparationData = (req) => {
  const preparation = req.preparation
  if (!preparation || preparation.status === 'pending') return { status: 'pending' }
  if (preparation.status === 'failed') return { status: 'failed', reason: preparation.reason }
  if (!Array.isArray(preparation.calls) || preparation.calls.length !== req.calls.length) {
    return { status: 'failed', reason: 'Prepared transactions no longer match this batch.' }
  }
  if (!preparedCallsMatchRequest(req, preparation.calls)) {
    return { status: 'failed', reason: 'Prepared transactions no longer match this batch.' }
  }
  const total = quantity(preparation.maxFee)
  const calls = preparation.calls.map((call) => quantity(call.maxFee))
  if (total === undefined || calls.some((call) => call === undefined)) {
    return { status: 'failed', reason: 'Prepared fee evidence is invalid.' }
  }
  const sum = calls.reduce((value, call) => value + call, 0n)
  if (sum !== total) return { status: 'failed', reason: 'Prepared fee totals do not match.' }
  return { status: 'succeeded', total, calls }
}

const destination = (req, index, addressBook, accounts) => {
  const call = req.calls[index]
  if (!call?.to) return { label: 'Contract deployment', source: 'New contract' }
  const detail = req.callDetails?.[index]
  if (detail?.label) return { label: detail.label, source: detail.source, method: detail.method }
  const local = resolveLocalAddressIdentity(addressBook, accounts, call.to)
  return local
    ? { label: local.label, source: local.source }
    : { label: shortAddress(call.to), source: 'Address' }
}

const targetAccountCodeEvidence = (req, call, index) =>
  req.simulation?.accountCodeEvidence?.targets?.find(
    (target) => target.account === call.to?.toLowerCase() && target.callIndexes?.includes(index)
  )

const targetDelegationCopy = (evidence) => {
  if (evidence?.status === 'unavailable') return 'Target delegation check unavailable'
  if (evidence?.status !== 'delegated') return
  if (evidence.delegateCodeStatus === 'no-code') {
    return `Target delegates to ${shortAddress(evidence.delegate)}; RPC returned empty code`
  }
  if (evidence.delegateCodeStatus === 'unavailable') {
    return `Delegate code check unavailable for ${shortAddress(evidence.delegate)}`
  }
  if (evidence.delegateCodeStatus === 'delegated') {
    return `Target delegates to ${shortAddress(evidence.delegate)}; nested delegation is not followed`
  }
  return `Target delegates execution to ${shortAddress(evidence.delegate)}.`
}

export class WalletCallsRequest extends React.Component {
  constructor(props) {
    super(props)
    this.state = { copiedCall: -1, expandedCall: -1 }
  }

  componentWillUnmount() {
    clearTimeout(this.copyTimer)
  }

  updateDraft = (update) => {
    const draft = this.props.requestData?.walletCallsDraft
    if (!draft) return
    const next = {
      ...draft,
      calls: draft.calls.map((call) => ({ ...call }))
    }
    update(next)
    link.send(
      'nav:update',
      'panel',
      { data: { walletCallsDraft: next, walletCallsAdjustmentError: '' } },
      false
    )
  }

  copyCallAddress = (index, address) => {
    if (!address) return
    link.send('tray:clipboardData', address)
    clearTimeout(this.copyTimer)
    this.setState({ copiedCall: index })
    this.copyTimer = setTimeout(() => this.setState({ copiedCall: -1 }), 1000)
  }

  openAdjustment = () => {
    const walletCallsDraft = createWalletCallsDraft(this.props.req)
    if (!walletCallsDraft) return
    link.send('nav:update', 'panel', { data: { step: 'adjustWalletCalls', walletCallsDraft } })
  }

  renderAdjustment() {
    const { req, chainData, requestData } = this.props
    const draft = requestData?.walletCallsDraft
    const parsed = parseWalletCallsDraft(req, draft)
    const decimals = chainData?.nativeCurrencyDecimals ?? 18
    const symbol = chainData?.nativeCurrencySymbol || '?'
    const maximums = draft?.calls?.map(walletCallMaximum) || []
    const total = maximums.every((value) => typeof value === 'bigint')
      ? maximums.reduce((sum, value) => sum + value, 0n)
      : undefined

    return (
      <div className='walletCallsSurface walletCallsAdjust'>
        <section className='walletCallsAdjustSummary'>
          <div>
            <div className='walletCallsEyebrow'>Batch settings</div>
            <h2>Adjust gas and nonce</h2>
            <p>Each transaction keeps its own gas limit and fee ceiling.</p>
          </div>
          <div className='walletCallsAdjustTotal'>
            <span>Total maximum</span>
            <strong>{formatNativeMaximum(total, decimals, symbol)}</strong>
          </div>
        </section>

        <section className='walletCallsSection walletCallsNonceSection'>
          <div>
            <strong>Starting nonce</strong>
            <span>Transactions use contiguous nonces beginning at {draft?.startingNonce || '?'}.</span>
          </div>
          <div className='walletCallsNonceControl'>
            <button
              type='button'
              aria-label='Decrease starting nonce'
              onClick={() =>
                this.updateDraft((next) => {
                  const current = /^\d+$/.test(next.startingNonce) ? BigInt(next.startingNonce) : 0n
                  next.startingNonce = (current > 0n ? current - 1n : 0n).toString()
                })
              }
            >
              −
            </button>
            <input
              aria-label='Starting nonce'
              inputMode='numeric'
              value={draft?.startingNonce || ''}
              onChange={(event) => this.updateDraft((next) => (next.startingNonce = event.target.value))}
            />
            <button
              type='button'
              aria-label='Increase starting nonce'
              onClick={() =>
                this.updateDraft((next) => {
                  const current = /^\d+$/.test(next.startingNonce) ? BigInt(next.startingNonce) : 0n
                  next.startingNonce = (current + 1n).toString()
                })
              }
            >
              +
            </button>
          </div>
        </section>

        <section className='walletCallsSection'>
          <div className='walletCallsSectionHeading'>
            <h3>Transaction settings</h3>
            <span>{draft?.calls?.every((call) => call.mode === 'eip1559') ? 'EIP-1559' : 'Legacy'}</span>
          </div>
          <div className='walletCallsAdjustList'>
            {(draft?.calls || []).map((call, index) => {
              const identity = destination(req, index, this.props.addressBook, this.props.accounts)
              const nonce = /^\d+$/.test(draft.startingNonce)
                ? (BigInt(draft.startingNonce) + BigInt(index)).toString()
                : '?'
              return (
                <div className='walletCallsAdjustCall' key={index}>
                  <span className='walletCallsCallNumber'>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <div className='walletCallsAdjustCallHeader'>
                      <strong>{identity.label}</strong>
                      <span>Nonce {nonce}</span>
                    </div>
                    {req.calls[index]?.to && (
                      <div className='walletCallsDestinationAddress'>{req.calls[index].to}</div>
                    )}
                    <div className='walletCallsAdjustFields'>
                      <label>
                        <span>Gas limit</span>
                        <input
                          aria-label={`${identity.label} gas limit`}
                          inputMode='numeric'
                          value={call.gasLimit}
                          onChange={(event) =>
                            this.updateDraft((next) => (next.calls[index].gasLimit = event.target.value))
                          }
                        />
                      </label>
                      {call.mode === 'eip1559' ? (
                        <>
                          <label>
                            <span>Max fee</span>
                            <span className='walletCallsUnitInput'>
                              <input
                                aria-label={`${identity.label} maximum fee per gas`}
                                inputMode='decimal'
                                value={call.maxFeePerGas}
                                onChange={(event) =>
                                  this.updateDraft(
                                    (next) => (next.calls[index].maxFeePerGas = event.target.value)
                                  )
                                }
                              />
                              <em>Gwei</em>
                            </span>
                          </label>
                          <label>
                            <span>Priority fee</span>
                            <span className='walletCallsUnitInput'>
                              <input
                                aria-label={`${identity.label} priority fee`}
                                inputMode='decimal'
                                value={call.maxPriorityFeePerGas}
                                onChange={(event) =>
                                  this.updateDraft(
                                    (next) => (next.calls[index].maxPriorityFeePerGas = event.target.value)
                                  )
                                }
                              />
                              <em>Gwei</em>
                            </span>
                          </label>
                        </>
                      ) : (
                        <label>
                          <span>Gas price</span>
                          <span className='walletCallsUnitInput'>
                            <input
                              aria-label={`${identity.label} gas price`}
                              inputMode='decimal'
                              value={call.gasPrice}
                              onChange={(event) =>
                                this.updateDraft((next) => (next.calls[index].gasPrice = event.target.value))
                              }
                            />
                            <em>Gwei</em>
                          </span>
                        </label>
                      )}
                      <div className='walletCallsAdjustCost'>
                        <span>Maximum cost</span>
                        <strong>{formatNativeMaximum(maximums[index], decimals, symbol)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {(!parsed.valid || requestData?.walletCallsAdjustmentError) && (
            <div className='walletCallsAdjustError'>
              {requestData?.walletCallsAdjustmentError || parsed.error}
            </div>
          )}
        </section>
      </div>
    )
  }

  renderReview() {
    const { req, chainData, originName, accountName } = this.props
    const callLabel = req.calls.length === 1 ? 'transaction' : 'transactions'
    const simulation = simulationLabel(req.simulation)
    const preparation = preparationData(req)
    const decimals = chainData?.nativeCurrencyDecimals ?? 18
    const symbol = chainData?.nativeCurrencySymbol || '?'
    const usd = chainData?.nativeCurrencyUsd
    const aggregateFiat = formatFiat(req.preparation?.maxFee, decimals, usd)

    return (
      <div className='walletCallsSurface walletCallsReview'>
        <section className='walletCallsSummary'>
          <div>
            <div className='walletCallsEyebrow'>{req.calls.length} ordered calls</div>
            <h2>Submit {req.calls.length === 1 ? 'one transaction' : `${req.calls.length} transactions`}?</h2>
            <p>Wren will submit these calls in order from {accountName || 'this account'}.</p>
          </div>
          <div className='walletCallsAtomicWarning'>
            <strong>
              <Icon name='alert' size={17} /> Partial execution possible
            </strong>
            <span>An earlier transaction can succeed even if a later one fails.</span>
          </div>
        </section>

        <section className='walletCallsSection'>
          <h3>Batch context</h3>
          <div className='walletCallsContext'>
            <div>
              <span>Origin</span>
              <strong>{originName}</strong>
            </div>
            <div>
              <span>Account</span>
              <strong>{accountName || shortAddress(req.account)}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>{chainData?.chainName || req.chainId}</strong>
            </div>
          </div>
        </section>

        <section className='walletCallsSection walletCallsFeeSummary'>
          <span>Total maximum network fees</span>
          <div>
            <strong>
              {preparation.status === 'succeeded'
                ? formatNativeMaximum(preparation.total, decimals, symbol)
                : preparation.status === 'pending'
                  ? 'Calculating…'
                  : 'Unavailable'}
            </strong>
            {preparation.status === 'succeeded' && (
              <small>
                {aggregateFiat ? `${aggregateFiat} · ` : ''}
                {req.calls.length} separate {callLabel}
              </small>
            )}
          </div>
          <button
            type='button'
            disabled={preparation.status !== 'succeeded' || req.locked || req.status !== undefined}
            onClick={this.openAdjustment}
          >
            Adjust <span aria-hidden='true'>›</span>
          </button>
        </section>

        <section className='walletCallsSection'>
          <div className='walletCallsSectionHeading'>
            <h3>Calls execute in this order</h3>
            <span className={`walletCallsSimulationState walletCallsSimulationState-${simulation.tone}`}>
              {simulation.label}
            </span>
          </div>
          <div className='walletCallsList'>
            {req.calls.map((call, index) => {
              const identity = destination(req, index, this.props.addressBook, this.props.accounts)
              const callSimulation = req.simulation?.calls?.[index]
              const targetEvidence = targetAccountCodeEvidence(req, call, index)
              const targetDelegation = targetDelegationCopy(targetEvidence)
              const maximum = preparation.status === 'succeeded' ? preparation.calls[index] : undefined
              const preparedTransaction =
                preparation.status === 'succeeded' ? req.preparation.calls[index]?.transaction : undefined
              const expanded = this.state.expandedCall === index
              return (
                <div className='walletCall' key={`${index}:${call.to || 'deployment'}`}>
                  <span className='walletCallsCallNumber'>{String(index + 1).padStart(2, '0')}</span>
                  <div className='walletCallsCallBody'>
                    <button
                      type='button'
                      className='walletCallsDestination'
                      disabled={!call.to}
                      onClick={() => this.copyCallAddress(index, call.to)}
                    >
                      <strong>{identity.label}</strong>
                      <span>
                        {this.state.copiedCall === index
                          ? 'Address copied'
                          : call.to
                            ? `${identity.source} · ${call.to}`
                            : identity.source}
                      </span>
                    </button>
                    <div className='walletCallsCallEvidence'>
                      <span>{identity.method ? `${identity.method} call` : 'Contract call'}</span>
                      <span>Value · {formatNative(call.value, decimals, symbol)}</span>
                      {preparedTransaction && (
                        <>
                          <span>Gas limit · {formatInteger(preparedTransaction.gasLimit)}</span>
                          <span>
                            Max rate ·{' '}
                            {formatGwei(
                              quantity(preparedTransaction.type) === 2n
                                ? preparedTransaction.maxFeePerGas
                                : preparedTransaction.gasPrice
                            )}
                          </span>
                        </>
                      )}
                      <button
                        type='button'
                        onClick={() => this.setState({ expandedCall: expanded ? -1 : index })}
                      >
                        Calldata · {(call.data.length - 2) / 2} bytes {expanded ? '⌃' : '›'}
                      </button>
                    </div>
                    {targetDelegation && (
                      <div
                        className={
                          targetEvidence.status === 'delegated' &&
                          targetEvidence.delegateCodeStatus === 'contract'
                            ? 'walletCallsTargetDelegation walletCallsTargetDelegation-danger'
                            : 'walletCallsTargetDelegation'
                        }
                        role='status'
                        aria-label={
                          targetEvidence.status === 'delegated'
                            ? `Call ${index + 1} target ${targetEvidence.account} delegates execution to ${targetEvidence.delegate}.`
                            : `Call ${index + 1} target ${targetEvidence.account}. Target delegation check unavailable.`
                        }
                      >
                        <strong>{targetDelegation}</strong>
                        {expanded &&
                          targetEvidence.status === 'delegated' &&
                          targetEvidence.delegateCodeStatus === 'no-code' && (
                            <span>
                              The configured RPC returned empty code for this delegate. Precompiles can
                              execute without bytecode, and code lookup alone cannot distinguish them from
                              empty accounts.
                            </span>
                          )}
                        {expanded &&
                          targetEvidence.status === 'delegated' &&
                          targetEvidence.delegateCodeStatus === 'delegated' && (
                            <span>
                              EIP-7702 resolves only the first delegate address; it does not follow this
                              delegate’s delegation.
                            </span>
                          )}
                        {expanded &&
                          targetEvidence.status === 'delegated' &&
                          targetEvidence.delegateCodeStatus === 'contract' && (
                            <span>
                              This call runs code from {targetEvidence.delegate} in the target account’s
                              context.
                            </span>
                          )}
                        {expanded && targetEvidence.status === 'unavailable' && targetEvidence.reason && (
                          <span>{targetEvidence.reason}</span>
                        )}
                      </div>
                    )}
                    {expanded && <div className='walletCallsCalldata'>{call.data}</div>}
                    {callSimulation && callSimulation.status !== 'succeeded' && (
                      <div className='walletCallsCallWarning'>
                        Simulation: {callSimulation.status}
                        {callSimulation.gasUsed ? ` · gas used ${formatInteger(callSimulation.gasUsed)}` : ''}
                        {callSimulation.reason ? ` · ${callSimulation.reason}` : ''}
                      </div>
                    )}
                    {callSimulation && (
                      <>
                        <SimulationAllowance simulation={callSimulation} />
                        {(callSimulation.effects?.length || callSimulation.effectsTruncated) && (
                          <SimulationEffects account={req.account} simulation={callSimulation} />
                        )}
                      </>
                    )}
                  </div>
                  <div className='walletCallsCallMaximum'>
                    <span>Maximum cost</span>
                    <strong>
                      {maximum === undefined ? '—' : formatNativeMaximum(maximum, decimals, symbol)}
                    </strong>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {req.simulation?.delegation?.status === 'delegated' && (
          <div className='walletCallsEvidenceWarning walletCallsEvidenceWarning-danger' role='alert'>
            <Icon name='alert' size={17} />
            <span>Wallet-call batches from delegated sending accounts are not supported.</span>
          </div>
        )}

        {req.simulation?.accountCodeEvidence?.sender.status === 'unavailable' && (
          <div className='walletCallsEvidenceWarning' role='alert'>
            <Icon name='alert' size={17} />
            <span>
              Sending account delegation check unavailable.{' '}
              {req.simulation.accountCodeEvidence.sender.reason || ''}
            </span>
          </div>
        )}

        {(preparation.status === 'failed' ||
          simulation.tone === 'danger' ||
          simulation.tone === 'warning') && (
          <div className='walletCallsEvidenceWarning' role='alert'>
            <Icon name='alert' size={17} />
            <span>
              {preparation.reason ||
                req.simulation?.delegation?.reason ||
                req.simulation?.reason ||
                simulation.label}
            </span>
          </div>
        )}
      </div>
    )
  }

  render() {
    return this.props.step === 'adjustWalletCalls' ? this.renderAdjustment() : this.renderReview()
  }
}

export default WalletCallsRequest
