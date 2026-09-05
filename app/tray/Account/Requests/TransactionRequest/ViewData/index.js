import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../../resources/Components/Icon'
import { SimpleJSON } from '../../../../../../resources/Components/SimpleTypedData'
import { parseRpcQuantity } from '../../../../../../resources/domain/transaction/quantity'
import {
  SimulationAllowance,
  SimulationAdvancedChecks,
  SimulationCallTrace,
  SimulationDelegation,
  SimulationEffects,
  SimulationNativeBalanceChanges,
  SimulationProxyImplementationChanges
} from './effects'

const txFieldPriority = [
  'chainId',
  'nonce',
  'value',
  'data',
  'to',
  'from',
  'gasLimit',
  'gas',
  'gasPrice',
  'maxFeePerGas',
  'maxPriorityFeePerGas',
  'accessList',
  'authorizationList',
  'type'
]

const reviewableTransactionFields = new Set(txFieldPriority)

export const projectRawTransaction = (data = {}) =>
  Object.fromEntries(
    Object.entries({ nonce: 'TBD', ...data }).filter(([key]) => reviewableTransactionFields.has(key))
  )

const TextValue = ({ value }) =>
  typeof value === 'object' ? (
    <pre className='simpleJsonStructuredValue'>{JSON.stringify(value, null, 2)}</pre>
  ) : (
    <span>{value}</span>
  )

export const SimpleTxJSON = ({ json }) => {
  return (
    <div className='simpleJson'>
      {Object.keys(json)
        .sort((a, b) => {
          const aIndex = txFieldPriority.indexOf(a)
          const bIndex = txFieldPriority.indexOf(b)
          if (aIndex === -1 && bIndex === -1) return 0
          if (aIndex === -1) return 1
          if (bIndex === -1) return -1
          return aIndex - bIndex
        })
        .map((key, o) => {
          return (
            <div key={key + o} className='simpleJsonChild'>
              <div className=' simpleJsonKey simpleJsonKeyTx'>{key.replace(/([A-Z])/g, ' $1').trim()}</div>
              <div className='simpleJsonValue'>
                <TextValue value={json[key]} />
              </div>
            </div>
          )
        })}
    </div>
  )
}

export class ViewData extends React.Component {
  renderEvidenceGroup(title, children, className = '', disclosure = {}) {
    const groupClassName = `transactionEvidenceGroup ${className}`.trim()
    if (disclosure.collapsible) {
      return (
        <details
          className={`${groupClassName} transactionEvidenceGroupDisclosure`}
          aria-label={title}
          open={disclosure.open}
          role='region'
        >
          <summary className='transactionEvidenceGroupSummary'>
            <span className='transactionEvidenceGroupTitle'>{title}</span>
            <Icon className='transactionEvidenceGroupChevron' name='chevron-down' size={15} />
          </summary>
          <div className='transactionEvidenceGroupBody'>{children}</div>
        </details>
      )
    }

    return (
      <section className={groupClassName} aria-label={title}>
        <h2 className='transactionEvidenceGroupTitle'>{title}</h2>
        <div className='transactionEvidenceGroupBody'>{children}</div>
      </section>
    )
  }

  renderDecodedData() {
    const { req } = this.props
    if (req.decodedData) {
      const verified = req.decodedData.confidence === 'verified-abi'
      const fields = {
        Contract: req.decodedData.contractName,
        Method: req.decodedData.method
      }
      for (const argument of req.decodedData.args) {
        fields[`${argument.name} (${argument.type})`] = argument.value
      }
      return (
        <div className='decodedDataContract'>
          <div className='decodedDataConfidence'>
            {verified ? 'Method verified' : 'Method identified'} · ABI source: {req.decodedData.source}
          </div>
          {req.decodedData.retained ? (
            <div className='dataRetained'>Showing method details retained from an earlier decode.</div>
          ) : null}
          <SimpleJSON humanizeKeys quoteStrings={false} json={fields} />
        </div>
      )
    }

    if (req.suggestedData) {
      return (
        <div className='decodedDataContract'>
          <div className='decodedDataConfidence decodedDataConfidencePossible'>
            Possible method: <span className='decodedDataSignature'>{req.suggestedData.signature}</span>
          </div>
          <div className='simulationEffectsNotice'>Selector match only. Arguments are not decoded.</div>
        </div>
      )
    }

    if (req.calldataDecodeStatus === 'pending') {
      return (
        <div className='decodedDataContract'>
          <div className='decodedDataConfidence'>Identifying contract method…</div>
        </div>
      )
    }

    const selector = typeof req.data?.data === 'string' ? req.data.data.slice(0, 10) : ''
    return (
      <div className='decodedDataContract'>
        <div className='decodedDataConfidence'>Contract method not identified</div>
        {selector.length === 10 ? (
          <SimpleJSON humanizeKeys quoteStrings={false} json={{ Selector: selector }} />
        ) : null}
      </div>
    )
  }

  decodeRawTx(tx) {
    const decodeTx = {}
    Object.keys(tx).forEach((key) => {
      if (typeof tx[key] !== 'string' || !tx[key].startsWith('0x')) {
        decodeTx[key] = tx[key]
      } else if (
        [
          'chainId',
          'value',
          'nonce',
          'gasLimit',
          'gasPrice',
          'maxFeePerGas',
          'maxPriorityFeePerGas'
        ].includes(key)
      ) {
        const quantity = parseRpcQuantity(tx[key])
        decodeTx[key] = quantity === undefined ? tx[key] : quantity.toString(10)
      } else {
        decodeTx[key] = tx[key]
      }
    })
    return decodeTx
  }

  render() {
    const { req } = this.props
    const { data } = req
    const tx = projectRawTransaction(data)
    const { simulation = {} } = req
    const accountCodeEvidence = simulation.accountCodeEvidence
    const accountCodeNeedsAttention = [
      accountCodeEvidence?.sender,
      ...(accountCodeEvidence?.targets || [])
    ].some((evidence) => evidence?.status === 'delegated' || evidence?.status === 'unavailable')
    const showActions =
      Boolean(data?.data && data.data !== '0x') ||
      (simulation.status === 'succeeded' && simulation.source === 'eth_simulateV1')
    const showPermissions =
      Boolean(simulation.allowance) ||
      accountCodeNeedsAttention ||
      simulation.delegation?.status === 'delegated' ||
      simulation.delegation?.status === 'unavailable'
    const showExecution =
      Boolean(simulation.advancedChecks) ||
      Boolean(simulation.nativeBalanceChanges) ||
      (Boolean(simulation.proxyImplementationCheck) &&
        (simulation.proxyImplementationCheck.status !== 'succeeded' ||
          simulation.proxyImplementationCheck.changes.length > 0)) ||
      Boolean(simulation.callTrace?.calls.length || simulation.callTrace?.truncated)
    const executionNeedsAttention =
      Boolean(
        simulation.nativeBalanceChanges &&
        (simulation.nativeBalanceChanges.status === 'failed' || simulation.nativeBalanceChanges.truncated)
      ) ||
      Boolean(
        simulation.proxyImplementationCheck &&
        (simulation.proxyImplementationCheck.status === 'failed' ||
          (simulation.proxyImplementationCheck.changes?.length || 0) > 0 ||
          simulation.proxyImplementationCheck.truncated)
      ) ||
      Boolean(
        simulation.callTrace &&
        (simulation.callTrace.truncated || (simulation.callTrace.calls || []).some((call) => call.failure))
      )

    return (
      <div className='accountViewScroll cardShow transactionEvidenceView'>
        <p className='transactionEvidenceSource'>Source: configured RPC · Not independently verified</p>
        {showActions &&
          this.renderEvidenceGroup(
            'Actions',
            <>
              {data?.data && data.data !== '0x' ? (
                <div className='txViewData'>{this.renderDecodedData()}</div>
              ) : null}
              <SimulationEffects account={req.account} simulation={simulation} />
            </>
          )}
        {showPermissions &&
          this.renderEvidenceGroup(
            'Permissions',
            <>
              <SimulationDelegation simulation={simulation} />
              <SimulationAllowance simulation={simulation} />
            </>
          )}
        {showExecution &&
          this.renderEvidenceGroup(
            'Execution',
            <>
              <SimulationAdvancedChecks simulation={simulation} />
              <SimulationProxyImplementationChanges simulation={simulation} />
              <SimulationCallTrace simulation={simulation} />
              <SimulationNativeBalanceChanges simulation={simulation} />
            </>,
            '',
            { collapsible: true, open: executionNeedsAttention }
          )}
        {this.renderEvidenceGroup(
          'Raw data',
          <div className='txViewData'>
            <div className='txViewDataHeader'>{'Raw Transaction'}</div>
            <SimpleTxJSON json={this.decodeRawTx(tx)} req={req} />
          </div>,
          'transactionEvidenceGroupRaw',
          { collapsible: true, open: false }
        )}
      </div>
    )
  }
}

export default Restore.connect(ViewData)
