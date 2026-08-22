import link from '../../../../../../resources/link'
import EnsOverview from '../../Ens'

import Icon from '../../../../../../resources/Components/Icon'
import AssetMark from '../../../../../../resources/Components/AssetMark'
import { isNonZeroHex } from '../../../../../../resources/utils'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../../resources/Components/Cluster'
import { DisplayValue } from '../../../../../../resources/Components/DisplayValue'
import RequestHeader from '../../../../../../resources/Components/RequestHeader'
import BigNumber from 'bignumber.js'
import { isBroadTokenAuthorityEffect } from '../../../../../../resources/domain/transaction/effects'
import { summarizeAccessList } from '../../../../../../resources/domain/transaction/accessList'
import { transactionAccountCodeEvidence } from '../ViewData/effects'

const SimpleContractCallOverview = ({ method }) => {
  const body = method ? `Call contract method: ${method}` : 'Call contract'

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

const SendOverview = ({ req, symbol, decimals, amount: ammt, currencyRate, isTestnet, asset }) => {
  const amount = ammt || req.data.value
  return (
    <div className='_txDescriptionTransfer'>
      <span className='_txDescriptionAction'>{'Send'}</span>
      <div className='transactionReviewAmountLine'>
        {asset ? <AssetMark asset={asset} className='transactionReviewAssetMark' showChain={false} /> : null}
        <DisplayValue
          type='ether'
          value={amount}
          valueDataParams={{ decimals }}
          currencySymbol={symbol}
          currencySymbolPosition='last'
        />
      </div>
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

export const YearnOverview = ({ action, vaultName, amountRaw, symbol, decimals, asset }) => {
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
        <div className='transactionReviewAmountLine'>
          {asset && ['deposit', 'withdraw'].includes(action) ? (
            <AssetMark asset={asset} className='transactionReviewAssetMark' showChain={false} />
          ) : null}
          <DisplayValue
            type='ether'
            value={amountRaw}
            valueDataParams={{ decimals }}
            currencySymbol={symbol || ''}
            currencySymbolPosition='last'
          />
        </div>
      ) : (
        <span>{vaultName}</span>
      )}
    </div>
  )
}

const DeployContractOverview = () => <div>Deploy contract</div>
const DataOverview = () => <div>Send contract data</div>

export const ReplacementNotice = ({ replacement }) => {
  if (!replacement) return null
  const hash = replacement.originalHash
  const shortHash = `${hash.slice(0, 10)}…${hash.slice(-8)}`
  return (
    <ClusterRow>
      <ClusterValue>
        <div className='_txMainTag' role='status' aria-live='polite'>
          {replacement.kind === 'cancel'
            ? `Cancellation attempt for ${shortHash}. This self-transfer only cancels it if this transaction confirms first.`
            : `Speed-up attempt for ${shortHash}. This transaction uses the same nonce and must confirm first.`}
        </div>
      </ClusterValue>
    </ClusterRow>
  )
}

export const ReplacementAssessment = ({ status }) => {
  if (!status?.replacement) return null
  return status.possible ? (
    <ClusterRow>
      <ClusterValue>
        <div className='_txMainTag _txMainTagGood' role='status' aria-live='polite'>
          Valid replacement
        </div>
      </ClusterValue>
    </ClusterRow>
  ) : (
    <ClusterRow>
      <ClusterValue>
        <div className='_txMainTag _txMainTagBad' role='alert'>
          {status.notice || 'Invalid duplicate'}
        </div>
      </ClusterValue>
    </ClusterRow>
  )
}

const ContractCallOverview = ({ req, assetContext = {} }) => {
  const { decodedData: { method } = {} } = req
  return renderRecognizedActions(req, assetContext) || <SimpleContractCallOverview method={method} />
}

const actionOverviews = {
  'erc20:transfer': SendOverview,
  'erc20:approve': ApproveOverview,
  yearn: YearnOverview,
  ens: EnsOverview
}

const renderActionOverview = (action, index, req, assetContext) => {
  const { id = '', data } = action
  const key = id + index
  const [_actionClass, actionType] = id.split(':')
  const ActionOverview = actionOverviews[id] || actionOverviews[_actionClass] || SimpleContractCallOverview

  const asset =
    id === 'erc20:transfer'
      ? { ...assetContext, address: req.data.to, symbol: data.symbol }
      : _actionClass === 'yearn'
        ? {
            ...assetContext,
            address: data.token,
            artworkKey: data.vaultId,
            chainId: data.chainId || assetContext.chainId,
            symbol: data.symbol
          }
        : undefined

  return <ActionOverview asset={asset} key={key} type={actionType} {...{ ...data }} />
}

function renderRecognizedActions(req, assetContext) {
  const { recognizedActions: actions = [] } = req

  return !actions.length ? (
    <div className='_txDescriptionSummaryLine'>Call contract</div>
  ) : (
    actions.map((action, index) => renderActionOverview(action, index, req, assetContext))
  )
}

const simulationLabels = {
  pending: 'Checking transaction',
  reverted: 'Simulation reverted',
  unavailable: 'Simulation unavailable',
  failed: 'Simulation failed'
}

export function getSimulationPresentation(simulation) {
  if (!simulation || (simulation.status !== 'succeeded' && !simulationLabels[simulation.status])) return null

  const label =
    simulation.status === 'succeeded'
      ? simulation.source === 'eth_call'
        ? 'Basic simulation complete'
        : 'Simulation completed'
      : simulationLabels[simulation.status]
  const className =
    simulation.status === 'succeeded'
      ? '_txMainTagGood'
      : simulation.status === 'reverted' || simulation.status === 'failed'
        ? '_txMainTagBad'
        : '_txMainTagWarning'

  return {
    className,
    label
  }
}

export function getAdvancedChecksPresentation(simulation) {
  if (simulation?.advancedChecks?.status !== 'pending') return null
  return { className: '_txMainTagQuiet', label: 'Additional checks pending' }
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

export function getNativeBalanceChangesPresentation(simulation, options = {}) {
  const evidence = simulation?.nativeBalanceChanges
  if (!evidence) return null
  if (evidence.status !== 'succeeded') {
    if (evidence.status === 'unavailable' && options.suppressUnavailable) return null
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
    label: `${count} RPC-reported execution trace${count === 1 ? '' : 's'}${
      details.length ? ` (${details.join(', ')})` : ''
    }${evidence.truncated ? ' (truncated)' : ''}`
  }
}

export function getProxyImplementationChangesPresentation(simulation, options = {}) {
  const evidence = simulation?.proxyImplementationCheck
  if (!evidence) return null
  if (evidence.status !== 'succeeded') {
    if (evidence.status === 'unavailable' && options.suppressUnavailable) return null
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
  const { sender, target } = transactionAccountCodeEvidence(simulation)
  if (target?.status === 'delegated' && target.delegate) {
    if (target.delegateCodeStatus === 'no-code') {
      return {
        className: '_txMainTagWarning',
        label: `Target delegates to ${target.delegate}; RPC returned empty code`
      }
    }
    if (target.delegateCodeStatus === 'unavailable') {
      return {
        className: '_txMainTagWarning',
        label: `Delegate code check unavailable for ${target.delegate}`
      }
    }
    if (target.delegateCodeStatus === 'delegated') {
      return {
        className: '_txMainTagWarning',
        label: `Target delegates to ${target.delegate}; nested delegation is not followed`
      }
    }
    return {
      className: '_txMainTagBad',
      label: `Recipient delegates execution to ${target.delegate}.`
    }
  }
  if (target?.status === 'unavailable') {
    return { className: '_txMainTagWarning', label: 'Recipient delegation check unavailable' }
  }
  if (sender?.status === 'delegated' && sender.delegate) {
    return {
      className: '_txMainTagBad',
      label: `Sending account delegated to ${sender.delegate}`
    }
  }
  if (sender?.status === 'unavailable') {
    return { className: '_txMainTagWarning', label: 'Sending account delegation check unavailable' }
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

export function getReviewStatusPresentation(presentations) {
  const severity = {
    _txMainTagBad: 3,
    _txMainTagWarning: 2,
    _txMainTagGood: 1
  }
  const selected = presentations
    .filter(Boolean)
    .map((presentation, index) => ({ ...presentation, index }))
    .sort((left, right) =>
      severity[right.className] === severity[left.className]
        ? left.index - right.index
        : (severity[right.className] || 0) - (severity[left.className] || 0)
    )[0]
  if (!selected) return null
  return { className: selected.className, label: selected.label }
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
  const simulation = getSimulationPresentation(req.simulation)
  const advancedChecks = getAdvancedChecksPresentation(req.simulation)
  const simulationEffects = getSimulationEffectsPresentation(req.simulation, req.account)
  const nativeBalanceChanges = getNativeBalanceChangesPresentation(req.simulation, {
    suppressUnavailable: true
  })
  const callTrace = getCallTracePresentation(req.simulation)
  const proxyImplementationChanges = getProxyImplementationChangesPresentation(req.simulation, {
    suppressUnavailable: true
  })
  const allowance = getAllowancePresentation(req.simulation)
  const delegation = getDelegationPresentation(req.simulation)
  const accessList = getAccessListPresentation(req.data)
  const reviewStatus = getReviewStatusPresentation([
    simulationEffects?.broadApproval
      ? { className: '_txMainTagBad', label: 'RPC reports broad token approval' }
      : null,
    proxyImplementationChanges,
    delegation,
    allowance,
    callTrace,
    nativeBalanceChanges,
    simulationEffects ? { className: '_txMainTagWarning', label: simulationEffects.label } : null,
    accessList
  ])
  const supportingStatus = reviewStatus || advancedChecks

  const Description = BaseOverviews[classification]
  const chainId = typeof tx.chainId === 'string' ? Number.parseInt(tx.chainId, 16) : Number(tx.chainId)
  const assetContext = { chainId, primaryColor: chainColor }

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
          <ClusterValue style={{ background: valueColor }}>
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
                    asset={
                      classification === 'NATIVE_TRANSFER'
                        ? { ...assetContext, native: true, symbol }
                        : undefined
                    }
                    assetContext={assetContext}
                  />
                </div>
              </RequestHeader>
            </div>
          </ClusterValue>
        </ClusterRow>
        {(simulation || supportingStatus) && (
          <ClusterRow className='transactionReviewStatusRow'>
            <ClusterValue>
              <div className='transactionReviewSummaryStatus' role='status' aria-live='polite'>
                <span className={simulation?.className || ''}>{simulation?.label || ''}</span>
                <span className={supportingStatus?.className || ''}>{supportingStatus?.label || ''}</span>
              </div>
            </ClusterValue>
          </ClusterRow>
        )}
        <ReplacementNotice replacement={req.replacement} />
        <ReplacementAssessment status={replacementStatus} />
        {isNonZeroHex(calldata) && <TransactionDataRow method={req.decodedData?.method} />}
      </Cluster>
    )
  }
}

export default TxOverview
