import React from 'react'
import BigNumber from 'bignumber.js'
import { SimulationAllowance, SimulationEffects } from '../TransactionRequest/ViewData/effects'

const callDestination = (call) => call.to || 'Contract deployment'

const simulationPresentation = (simulation) => {
  if (!simulation || simulation.status === 'pending') {
    return { label: 'Checking ordered batch...', className: 'walletCallsSimulationPending' }
  }
  if (simulation.status === 'succeeded') {
    return { label: 'RPC reports all calls succeed', className: 'walletCallsSimulationGood' }
  }
  if (simulation.status === 'reverted') {
    return { label: 'RPC reports one or more calls revert', className: 'walletCallsSimulationBad' }
  }
  if (simulation.status === 'unavailable') {
    return { label: 'Stateful simulation unavailable', className: 'walletCallsSimulationWarning' }
  }
  return { label: 'Stateful simulation failed', className: 'walletCallsSimulationBad' }
}

const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/

const feeQuantity = (value) => {
  if (typeof value !== 'string' || !QUANTITY.test(value)) return null
  return BigInt(value)
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

const maximumFeeDisplay = (value, decimals, symbol) => {
  if (value === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null
  return `${new BigNumber(value.toString()).shiftedBy(-decimals).toFixed()} ${symbol}`
}

const preparationPresentation = (req, chainData) => {
  const preparation = req.preparation
  if (!preparation || preparation.status === 'pending') {
    return { status: 'pending', label: 'Calculating maximum execution gas fees' }
  }
  if (preparation.status === 'failed') {
    return { status: 'failed', label: 'Execution gas fee preparation failed', reason: preparation.reason }
  }
  if (preparation.status !== 'succeeded' || preparation.calls?.length !== req.calls.length) {
    return {
      status: 'failed',
      label: 'Execution gas fee preparation failed',
      reason: 'Prepared call count does not match the requested batch.'
    }
  }
  if (!preparedCallsMatchRequest(req, preparation.calls)) {
    return {
      status: 'failed',
      label: 'Execution gas fee preparation failed',
      reason: 'Prepared transactions do not match the requested batch.'
    }
  }

  const decimals = chainData?.nativeCurrencyDecimals ?? 18
  const symbol = chainData?.nativeCurrencySymbol || '?'
  const aggregateFee = feeQuantity(preparation.maxFee)
  const callFees = preparation.calls.map((call) => feeQuantity(call.maxFee))
  const feeSum = callFees.every((fee) => fee !== null)
    ? callFees.reduce((total, fee) => total + fee, 0n)
    : null
  const maximum = maximumFeeDisplay(aggregateFee, decimals, symbol)
  const calls = callFees.map((fee) => maximumFeeDisplay(fee, decimals, symbol))
  if (feeSum === null || aggregateFee !== feeSum || !maximum || calls.some((call) => !call)) {
    return {
      status: 'failed',
      label: 'Execution gas fee preparation failed',
      reason: 'Prepared fee data is invalid.'
    }
  }

  return { status: 'succeeded', label: 'Maximum execution gas fee', maximum, calls }
}

export class WalletCallsRequest extends React.Component {
  render() {
    const { req } = this.props
    const originName = this.props.originName || 'Unknown'
    const chainName = this.props.chainData?.chainName || `Chain ${parseInt(req.chainId, 16)}`
    const callLabel = req.calls.length === 1 ? 'call' : 'calls'
    const simulation = simulationPresentation(req.simulation)
    const preparation = preparationPresentation(req, this.props.chainData)
    const delegation = req.simulation?.delegation

    return (
      <div key={req.handlerId} className='signerRequest cardShow'>
        <div className='approveRequest'>
          <div className='walletCallsReview'>
            <div className='walletCallsHeader'>
              <div className='walletCallsOrigin'>{originName}</div>
              <div className='walletCallsIntent'>
                requests {req.calls.length} ordered {callLabel}
              </div>
              <div className='walletCallsChain'>
                {chainName} ({req.chainId})
              </div>
              <div className='walletCallsSender'>{req.account}</div>
            </div>

            <div className='walletCallsWarning' role='alert'>
              <div className='walletCallsWarningTitle'>Non-atomic batch</div>
              <div>
                Each call becomes a separate transaction and can incur its own gas fee. A later call can
                remain unsent after earlier calls are already onchain. No call is sent before the whole batch
                is approved.
              </div>
            </div>

            {delegation?.status === 'delegated' && (
              <div className='walletCallsWarning' role='alert'>
                <div className='walletCallsWarningTitle'>Delegated account batch blocked</div>
                <div>
                  Your configured RPC reports that {delegation.account} delegates execution to{' '}
                  {delegation.delegate}. Wren does not submit wallet-call batches from delegated accounts.
                </div>
              </div>
            )}
            {delegation?.status === 'unavailable' && (
              <div className='walletCallsSimulation walletCallsSimulationWarning' role='status'>
                <div className='walletCallsSimulationTitle'>Account delegation check unavailable</div>
                <div className='walletCallsSimulationReason'>{delegation.reason}</div>
              </div>
            )}

            <div className={`walletCallsSimulation ${simulation.className}`} role='status'>
              <div className='walletCallsSimulationTitle'>{simulation.label}</div>
              {req.simulation?.reason && (
                <div className='walletCallsSimulationReason'>{req.simulation.reason}</div>
              )}
              <div className='walletCallsSimulationNotice'>
                Results and token effects are reported by your configured RPC and are not independently
                verified.
              </div>
            </div>

            <div
              className={`walletCallsPreparation walletCallsPreparation-${preparation.status}`}
              role={preparation.status === 'failed' ? 'alert' : 'status'}
            >
              <div className='walletCallsPreparationTitle'>{preparation.label}</div>
              {preparation.maximum && (
                <>
                  <div className='walletCallsPreparationMaximum'>{preparation.maximum}</div>
                  <div className='walletCallsPreparationRaw'>Raw base units: {req.preparation.maxFee}</div>
                </>
              )}
              {preparation.reason && <div className='walletCallsPreparationReason'>{preparation.reason}</div>}
              <div className='walletCallsPreparationNotice'>
                Execution gas only. L2 data fees or other network-specific charges may be additional.
              </div>
            </div>

            <div className='walletCallsList'>
              {req.calls.map((call, index) => {
                const callSimulation = req.simulation?.calls?.[index]
                return (
                  <div className='walletCall' key={`${index}:${call.to || 'deployment'}`}>
                    <div className='walletCallNumber'>Call {index + 1}</div>
                    <dl>
                      <div className='walletCallField'>
                        <dt>Destination</dt>
                        <dd>{callDestination(call)}</dd>
                      </div>
                      <div className='walletCallField'>
                        <dt>Raw value</dt>
                        <dd>{call.value}</dd>
                      </div>
                      <div className='walletCallField'>
                        <dt>Calldata</dt>
                        <dd>{(call.data.length - 2) / 2} bytes</dd>
                      </div>
                      {preparation.calls?.[index] && (
                        <div className='walletCallField'>
                          <dt>Max exec gas</dt>
                          <dd>
                            {preparation.calls[index]} ({req.preparation.calls[index].maxFee} raw)
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className='walletCallData'>{call.data}</div>
                    {callSimulation && (
                      <div className={`walletCallSimulation walletCallSimulation-${callSimulation.status}`}>
                        <div className='walletCallSimulationStatus'>
                          RPC result: {callSimulation.status}
                          {callSimulation.gasUsed ? ` - gas used ${callSimulation.gasUsed}` : ''}
                        </div>
                        {callSimulation.reason && (
                          <div className='walletCallSimulationReason'>{callSimulation.reason}</div>
                        )}
                        <SimulationAllowance simulation={callSimulation} />
                        {(callSimulation.effects?.length || callSimulation.effectsTruncated) && (
                          <SimulationEffects account={req.account} simulation={callSimulation} />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }
}

export default WalletCallsRequest
