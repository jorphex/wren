import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../../resources/Components/Icon'
import { parseRpcQuantity } from '../../../../../../resources/domain/transaction/quantity'
import {
  SimulationAllowance,
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
  'gasPrice',
  'maxFeePerGas',
  'maxPriorityFeePerGas',
  'accessList'
]

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
    return req.decodedData ? (
      <div className='decodedDataContract'>
        <div className='decodedDataContractArgHeader'>Contract Method</div>
        <div className='dataUnverified'>unverified abi</div>
        <div className='dataSource'>{'abi source: ' + req.decodedData.source}</div>
        <div className='decodedDataContractTarget'>
          <div className='decodedDataSync decodedDataSyncLeft'>
            <Icon name='sync' size={16} />
          </div>
          <div className='decodedDataSync decodedDataSyncRight'>
            <Icon name='sync' size={16} />
          </div>
          <div className='decodedDataContractName'>{req.decodedData.contractName}</div>
          <div className='decodedDataContractMethod'>
            <div>{req.decodedData.method}</div>
          </div>
        </div>
        <div className='decodedDataContractArgHeader'>Inputs</div>
        {req.decodedData.args.map((a) => {
          return (
            <div key={a.name} className='decodedDataContractArg'>
              <div className='overflowBox'>
                {a.type.includes('[]') ? (
                  a.value.split(',').map((i) => <div key={i}>{i}</div>)
                ) : (
                  <div>{a.value}</div>
                )}
              </div>
              <div className='decodedDataSubtitle'>{a.name + ' (' + a.type + ')'}</div>
            </div>
          )
        })}
      </div>
    ) : (
      'Could not decode data..'
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
    const tx = { nonce: 'TBD', ...data }
    const { simulation = {} } = req
    const showActions =
      Boolean(req.decodedData) ||
      (simulation.status === 'succeeded' && simulation.source === 'eth_simulateV1')
    const showPermissions =
      Boolean(simulation.allowance) ||
      simulation.delegation?.status === 'delegated' ||
      simulation.delegation?.status === 'unavailable'
    const showExecution =
      Boolean(simulation.nativeBalanceChanges) ||
      (Boolean(simulation.proxyImplementationCheck) &&
        (simulation.proxyImplementationCheck.status !== 'succeeded' ||
          simulation.proxyImplementationCheck.changes.length > 0)) ||
      Boolean(simulation.callTrace?.calls.length || simulation.callTrace?.truncated)
    const executionNeedsAttention =
      Boolean(
        simulation.nativeBalanceChanges &&
        (simulation.nativeBalanceChanges.status !== 'succeeded' || simulation.nativeBalanceChanges.truncated)
      ) ||
      Boolean(
        simulation.proxyImplementationCheck &&
        (simulation.proxyImplementationCheck.status !== 'succeeded' ||
          simulation.proxyImplementationCheck.changes.length > 0 ||
          simulation.proxyImplementationCheck.truncated)
      ) ||
      Boolean(
        simulation.callTrace &&
        (simulation.callTrace.truncated || (simulation.callTrace.calls || []).some((call) => call.failure))
      )

    return (
      <div className='accountViewScroll cardShow transactionEvidenceView'>
        {showActions &&
          this.renderEvidenceGroup(
            'Actions',
            <>
              {req.decodedData && <div className='txViewData'>{this.renderDecodedData()}</div>}
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
