import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../../resources/Components/Icon'
import link from '../../../../../../resources/link'
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

const nonceHasBeenChanged = (req) => {
  return req.data.nonce && req.payload.params?.[0]?.nonce !== req.data.nonce
}

const NonceValue = ({ req, nonce }) => {
  const mutable = !req.locked && req.status === undefined

  return (
    <>
      <div style={{ width: '24px' }}>{nonce}</div>
      {mutable && (
        <div className='txNonceControl'>
          <button
            type='button'
            aria-label='Decrease nonce'
            className='txNonceButton txNonceButtonLower'
            onClick={() => {
              link.send('tray:adjustNonce', { account: req.account, handlerId: req.handlerId }, -1)
            }}
          >
            <Icon name='chevron-down' size={14} />
          </button>
          <button
            type='button'
            aria-label='Increase nonce'
            className='txNonceButton txNonceButtonRaise'
            onClick={() =>
              link.send('tray:adjustNonce', { account: req.account, handlerId: req.handlerId }, 1)
            }
          >
            <Icon name='chevron-up' size={14} />
          </button>
          {nonceHasBeenChanged(req) && (
            <button
              type='button'
              aria-label='Reset nonce'
              className='txNonceButton txNonceButtonReset'
              onClick={() => link.send('tray:resetNonce', { account: req.account, handlerId: req.handlerId })}
            >
              <Icon name='sync' size={14} />
            </button>
          )}
        </div>
      )}
    </>
  )
}

const TextValue = ({ value }) =>
  typeof value === 'object' ? (
    <pre className='simpleJsonStructuredValue'>{JSON.stringify(value, null, 2)}</pre>
  ) : (
    <span>{value}</span>
  )

export const SimpleTxJSON = ({ json, req }) => {
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
          const value =
            key === 'nonce' ? <NonceValue nonce={json[key]} req={req} /> : <TextValue value={json[key]} />

          return (
            <div key={key + o} className='simpleJsonChild'>
              <div className=' simpleJsonKey simpleJsonKeyTx'>{key.replace(/([A-Z])/g, ' $1').trim()}</div>
              <div className='simpleJsonValue'>{value}</div>
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
      <div className='accountViewScroll cardShow'>
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
