import link from '../../../../../../resources/link'
import EnsOverview from '../../Ens'

import Icon from '../../../../../../resources/Components/Icon'
import { isNonZeroHex } from '../../../../../../resources/utils'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../../resources/Components/Cluster'
import { DisplayValue } from '../../../../../../resources/Components/DisplayValue'
import RequestHeader from '../../../../../../resources/Components/RequestHeader'
import BigNumber from 'bignumber.js'
import { isBroadTokenAuthorityEffect } from '../../../../../../resources/domain/transaction/effects'
import { summarizeAccessList } from '../../../../../../resources/domain/transaction/accessList'

const SimpleContractCallOverview = ({ method }) => {
  const body = method ? `Calling Contract Method ${method}` : 'Calling Contract'

  return <div className='_txDescriptionSummaryLine'>{body}</div>
}

const ApproveOverview = ({ amount, decimals, symbol }) => {
  const isRevoke = BigNumber(amount).isZero()
  return (
    <div>
      {isRevoke ? (
        <span>{`Revoke Approval for ${symbol}`}</span>
      ) : (
        <>
          <span>{'Approve Spending'}</span>
          <DisplayValue
            type='ether'
            value={amount}
            valueDataParams={{ decimals }}
            currencySymbol={symbol}
            currencySymbolPosition='last'
          />
        </>
      )}
    </div>
  )
}

const SendOverview = ({ req, symbol, decimals, amount: ammt, currencyRate, isTestnet }) => {
  const amount = ammt || req.data.value
  return (
    <div className='_txDescriptionTransfer'>
      <span className='_txDescriptionAction'>{'Send'}</span>
      <DisplayValue
        type='ether'
        value={amount}
        valueDataParams={{ decimals }}
        currencySymbol={symbol}
        currencySymbolPosition='last'
      />
      {currencyRate && !isTestnet ? (
        <div className='_txDescriptionFiat'>
          <span aria-hidden='true'>≈</span>
          <DisplayValue
            type='fiat'
            value={amount}
            valueDataParams={{ currencyRate, decimals, isTestnet }}
            currencySymbol='$'
          />
        </div>
      ) : null}
    </div>
  )
}

export const YearnOverview = ({ action, vaultName, amountRaw, symbol, decimals }) => {
  const unlimitedApproval =
    action === 'approve' &&
    amountRaw === '115792089237316195423570985008687907853269984665640564039457584007913129639935'
  const labels = {
    approve:
      amountRaw === '0'
        ? 'Revoke Yearn approval'
        : unlimitedApproval
          ? 'Unlimited Yearn approval'
          : 'Approve Yearn vault',
    deposit: 'Deposit into Yearn',
    withdraw: 'Withdraw from Yearn',
    stake: 'Stake Yearn position',
    'start-cooldown': 'Start Yearn cooldown',
    'cancel-cooldown': 'Cancel Yearn cooldown'
  }
  return (
    <div>
      <span>{labels[action] || 'Yearn vault action'}</span>
      {amountRaw !== undefined && decimals !== undefined ? (
        <DisplayValue
          type='ether'
          value={amountRaw}
          valueDataParams={{ decimals }}
          currencySymbol={symbol || ''}
          currencySymbolPosition='last'
        />
      ) : (
        <span>{vaultName}</span>
      )}
    </div>
  )
}

const DeployContractOverview = () => <div>Deploying Contract</div>
const DataOverview = () => <div>Sending data</div>

const ContractCallOverview = ({ req }) => {
  const { decodedData: { method } = {} } = req
  return renderRecognizedActions(req) || <SimpleContractCallOverview method={method} />
}

const actionOverviews = {
  'erc20:transfer': SendOverview,
  'erc20:approve': ApproveOverview,
  yearn: YearnOverview,
  ens: EnsOverview
}

const renderActionOverview = (action, index) => {
  const { id = '', data } = action
  const key = id + index
  const [_actionClass, actionType] = id.split(':')
  const ActionOverview = actionOverviews[id] || actionOverviews[_actionClass] || SimpleContractCallOverview

  return <ActionOverview key={key} type={actionType} {...{ ...data }} />
}

function renderRecognizedActions(req) {
  const { recognizedActions: actions = [] } = req

  return !actions.length ? (
    <div className='_txDescriptionSummaryLine'>Calling Contract</div>
  ) : (
    actions.map(renderActionOverview)
  )
}

const simulationLabels = {
  pending: 'Checking execution with network RPC',
  succeeded: 'RPC execution check passed',
  reverted: 'RPC reports execution will revert',
  unavailable: 'RPC execution check unavailable',
  failed: 'RPC execution check failed'
}

export function getSimulationPresentation(simulation) {
  if (!simulation || !simulationLabels[simulation.status]) return null

  const method = simulation.source ? ` via ${simulation.source}` : ''
  const className =
    simulation.status === 'succeeded'
      ? '_txMainTagGood'
      : simulation.status === 'reverted' || simulation.status === 'failed'
        ? '_txMainTagBad'
        : '_txMainTagWarning'

  return {
    className,
    label: `${simulationLabels[simulation.status]}${method}`
  }
}

export function getSimulationEffectsPresentation(simulation, account) {
  if (simulation?.status !== 'succeeded' || simulation.source !== 'eth_simulateV1') return null

  const effects = simulation.effects || []
  if (!effects.length && !simulation.effectsTruncated) return null

  const broadApproval = effects.some((effect) => isBroadTokenAuthorityEffect(effect, account))
  const count = effects.length
  const countLabel = `${count} RPC-reported token effect${count === 1 ? '' : 's'}`

  return {
    broadApproval,
    label: `${countLabel}${simulation.effectsTruncated ? ' (truncated)' : ''}`
  }
}

export function getNativeBalanceChangesPresentation(simulation, { suppressUnavailable = false } = {}) {
  const evidence = simulation?.nativeBalanceChanges
  if (!evidence) return null
  if (evidence.status !== 'succeeded') {
    if (evidence.status === 'unavailable' && suppressUnavailable) return null
    return {
      className: '_txMainTagWarning',
      label:
        evidence.status === 'failed'
          ? 'Native balance-change preview failed'
          : 'Native balance-change preview unavailable'
    }
  }

  const count = evidence.changes.length
  return {
    className: count || evidence.truncated ? '_txMainTagWarning' : '_txMainTagGood',
    label: `${count} RPC-reported native balance change${count === 1 ? '' : 's'}${
      evidence.truncated ? ' (truncated)' : ''
    }`
  }
}

export function getCallTracePresentation(simulation) {
  const evidence = simulation?.callTrace
  if (!evidence || (!evidence.calls.length && !evidence.truncated)) return null

  const count = evidence.calls.length
  const creations = evidence.calls.filter((call) => call.type === 'CREATE' || call.type === 'CREATE2').length
  const failures = evidence.calls.filter((call) => call.failure).length
  const details = [
    creations ? `${creations} creation${creations === 1 ? '' : 's'}` : '',
    failures ? `${failures} failed` : ''
  ].filter(Boolean)

  return {
    className: failures ? '_txMainTagBad' : '_txMainTagWarning',
    label: `${count} RPC-reported execution frame${count === 1 ? '' : 's'}${
      details.length ? ` (${details.join(', ')})` : ''
    }${evidence.truncated ? ' (truncated)' : ''}`
  }
}

export function getProxyImplementationChangesPresentation(simulation, { suppressUnavailable = false } = {}) {
  const evidence = simulation?.proxyImplementationCheck
  if (!evidence) return null
  if (evidence.status !== 'succeeded') {
    if (evidence.status === 'unavailable' && suppressUnavailable) return null
    return {
      className: '_txMainTagWarning',
      label:
        evidence.status === 'failed'
          ? 'ERC-1967 implementation-slot check failed'
          : 'ERC-1967 implementation-slot check unavailable'
    }
  }
  if (!evidence.changes.length) return null

  const count = evidence.changes.length
  return {
    className: '_txMainTagBad',
    label: `RPC reports ${evidence.truncated ? 'at least ' : ''}${count} net ERC-1967 implementation slot change${
      count === 1 ? '' : 's'
    }${evidence.truncated ? ' (truncated)' : ''}`
  }
}

export function getAllowancePresentation(simulation) {
  const allowance = simulation?.allowance
  if (!allowance) return null

  if (allowance.currentAmount === allowance.requestedAmount) {
    return { className: '_txMainTagGood', label: 'RPC reports allowance already matches request' }
  }
  if (allowance.currentAmount === '0') {
    return { className: '_txMainTagWarning', label: 'RPC reports no current token allowance' }
  }
  if (allowance.requestedAmount === '0') {
    return { className: '_txMainTagGood', label: 'RPC reports existing token allowance will be revoked' }
  }

  return { className: '_txMainTagBad', label: 'RPC reports a different nonzero token allowance' }
}

export function getDelegationPresentation(simulation) {
  const delegation = simulation?.delegation
  if (delegation?.status === 'delegated' && delegation.delegate) {
    return {
      className: '_txMainTagBad',
      label: `RPC reports delegated account: ${delegation.delegate}`
    }
  }
  if (delegation?.status === 'unavailable') {
    return { className: '_txMainTagWarning', label: 'Account delegation check unavailable' }
  }

  return null
}

export function getAccessListPresentation(transaction) {
  const summary = summarizeAccessList(transaction?.accessList)
  if (!summary) return null

  const entryLabel = `${summary.entries} address${summary.entries === 1 ? '' : 'es'}`
  const keyLabel = `${summary.storageKeys} storage key${summary.storageKeys === 1 ? '' : 's'}`
  return { className: '_txMainTagWarning', label: `Access list: ${entryLabel}, ${keyLabel}` }
}

const BaseOverviews = {
  CONTRACT_DEPLOY: DeployContractOverview,
  CONTRACT_CALL: ContractCallOverview,
  SEND_DATA: DataOverview,
  NATIVE_TRANSFER: SendOverview
}

export const TransactionDataRow = ({ method }) => (
  <ClusterRow className='transactionReviewDataRow'>
    <ClusterValue
      ariaLabel='View transaction data'
      onClick={() => {
        link.send('nav:update', 'panel', { data: { step: 'viewData' } })
      }}
    >
      <div className='_txMainTag _txMainTagWarning transactionDataDisclosure'>
        <span>Contract data</span>
        <span>{method || 'Review'} ›</span>
      </div>
    </ClusterValue>
  </ClusterRow>
)

const TxOverview = ({
  req,
  chainName,
  chainColor,
  symbol,
  originName,
  replacementStatus,
  simple,
  valueColor,
  currencyRate,
  isTestnet
}) => {
  const { data: tx = {}, classification } = req
  const { data: calldata } = tx
  const recognizedYearn = (req.recognizedActions || []).some(({ id }) => id?.startsWith('yearn:'))
  const simulation = getSimulationPresentation(req.simulation)
  const simulationEffects = getSimulationEffectsPresentation(req.simulation, req.account)
  const nativeBalanceChanges = getNativeBalanceChangesPresentation(req.simulation, {
    suppressUnavailable: recognizedYearn && !isNonZeroHex(tx.value)
  })
  const callTrace = getCallTracePresentation(req.simulation)
  const proxyImplementationChanges = getProxyImplementationChangesPresentation(req.simulation, {
    suppressUnavailable: recognizedYearn
  })
  const allowance = getAllowancePresentation(req.simulation)
  const delegation = getDelegationPresentation(req.simulation)
  const accessList = getAccessListPresentation(req.data)

  const Description = BaseOverviews[classification]

  if (simple) {
    return (
      <div className='txDescriptionSummaryStandalone'>
        <span className='txDescriptionSummaryStandaloneWrap'>
          <Description req={req} decimals={18} symbol={symbol} />
        </span>
      </div>
    )
  } else {
    return (
      <Cluster className='transactionReviewOverview'>
        <ClusterRow>
          <ClusterValue
            ariaLabel='View transaction data'
            onClick={() => {
              link.send('nav:update', 'panel', { data: { step: 'viewData' } })
            }}
            style={{ background: valueColor }}
          >
            <div className='_txDescription'>
              <RequestHeader chain={chainName} chainColor={chainColor}>
                <div className='requestItemTitleSub'>
                  <div className='requestItemTitleSubIcon'>
                    <Icon name='apps' size={10} />
                  </div>
                  <div className='requestItemTitleSubText'>{originName}</div>
                </div>
                <div className='_txDescriptionSummaryMain'>
                  <Description
                    req={req}
                    decimals={18}
                    symbol={symbol}
                    currencyRate={currencyRate}
                    isTestnet={isTestnet}
                  />
                </div>
              </RequestHeader>
              {simulation ? (
                <div className={`transactionReviewSummaryStatus ${simulation.className}`} role='status'>
                  {simulation.label}
                </div>
              ) : null}
            </div>
          </ClusterValue>
        </ClusterRow>
        {replacementStatus.replacement &&
          (replacementStatus.possible ? (
            <ClusterRow>
              <ClusterValue>
                <div className='_txMainTag _txMainTagGood'>valid replacement</div>
              </ClusterValue>
            </ClusterRow>
          ) : (
            <ClusterRow>
              <ClusterValue>
                <div className='_txMainTag _txMainTagBad'>
                  {replacementStatus.notice || 'invalid duplicate'}
                </div>
              </ClusterValue>
            </ClusterRow>
          ))}
        {delegation && (
          <ClusterRow>
            <ClusterValue>
              <div className={`_txMainTag ${delegation.className}`}>{delegation.label}</div>
            </ClusterValue>
          </ClusterRow>
        )}
        {proxyImplementationChanges && (
          <ClusterRow>
            <ClusterValue>
              <div className={`_txMainTag ${proxyImplementationChanges.className}`}>
                {proxyImplementationChanges.label}
              </div>
            </ClusterValue>
          </ClusterRow>
        )}
        {accessList && (
          <ClusterRow>
            <ClusterValue>
              <div className={`_txMainTag ${accessList.className}`}>{accessList.label}</div>
            </ClusterValue>
          </ClusterRow>
        )}
        {simulationEffects && (
          <ClusterRow>
            <ClusterValue>
              <div className='_txMainTag _txMainTagWarning'>{simulationEffects.label}</div>
            </ClusterValue>
          </ClusterRow>
        )}
        {nativeBalanceChanges && (
          <ClusterRow>
            <ClusterValue>
              <div className={`_txMainTag ${nativeBalanceChanges.className}`}>
                {nativeBalanceChanges.label}
              </div>
            </ClusterValue>
          </ClusterRow>
        )}
        {callTrace && (
          <ClusterRow>
            <ClusterValue>
              <div className={`_txMainTag ${callTrace.className}`}>{callTrace.label}</div>
            </ClusterValue>
          </ClusterRow>
        )}
        {simulationEffects?.broadApproval && (
          <ClusterRow>
            <ClusterValue>
              <div className='_txMainTag _txMainTagBad'>RPC reports broad token approval</div>
            </ClusterValue>
          </ClusterRow>
        )}
        {allowance && (
          <ClusterRow>
            <ClusterValue>
              <div className={`_txMainTag ${allowance.className}`}>{allowance.label}</div>
            </ClusterValue>
          </ClusterRow>
        )}
        {isNonZeroHex(calldata) && <TransactionDataRow method={req.decodedData?.method} />}
      </Cluster>
    )
  }
}

export default TxOverview
