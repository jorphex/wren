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
        .filter((f) => {
          return txFieldPriority.indexOf(f) !== -1
        })
        .sort((a, b) => {
          const aIndex = txFieldPriority.indexOf(a)
          const bIndex = txFieldPriority.indexOf(b)
          return aIndex > bIndex ? 1 : aIndex < bIndex ? -1 : 0
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
                {a.type.indexOf('[]') ? (
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

    return (
      <div className='accountViewScroll cardShow transactionEvidenceView'>
        <SimulationDelegation simulation={req.simulation} />
        <SimulationProxyImplementationChanges simulation={req.simulation} />
        <SimulationAllowance simulation={req.simulation} />
        <SimulationCallTrace simulation={req.simulation} />
        <SimulationNativeBalanceChanges simulation={req.simulation} />
        <SimulationEffects account={req.account} simulation={req.simulation} />
        {/* <div className='txViewData'>
          <div className='txViewDataHeader'>{'Decoded Data'}</div>
          {this.renderDecodedData()}
        </div> */}
        <div className='txViewData'>
          <div className='txViewDataHeader'>{'Raw Transaction'}</div>
          <SimpleTxJSON json={this.decodeRawTx(tx)} req={req} />
        </div>
      </div>
    )
  }
}

export default Restore.connect(ViewData)
