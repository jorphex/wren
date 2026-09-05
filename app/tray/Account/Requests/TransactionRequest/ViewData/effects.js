import { SimpleJSON } from '../../../../../../resources/Components/SimpleTypedData'
import { MAX_UINT256 } from '../../../../../../resources/domain/transaction/quantity'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_UINT256_DECIMAL = MAX_UINT256.toString(10)

const STANDARD_NAMES = {
  erc20: 'ERC-20',
  erc721: 'ERC-721',
  erc1155: 'ERC-1155'
}

const standardName = (standard) => STANDARD_NAMES[standard] || 'ERC-721 / ERC-1155'

const transferTitle = (effect, account) => {
  const selected = account?.toLowerCase()
  const direction =
    effect.from === ZERO_ADDRESS
      ? 'Mint'
      : effect.to === ZERO_ADDRESS
        ? 'Burn'
        : selected && effect.from === selected && effect.to === selected
          ? 'Self Transfer'
          : selected && effect.from === selected
            ? 'Send'
            : selected && effect.to === selected
              ? 'Receive'
              : 'Transfer'

  return `${standardName(effect.standard)} ${direction}`
}

export const getEffectPresentation = (effect, account) => {
  if (effect.type === 'transfer') {
    return {
      title: transferTitle(effect, account),
      fields: {
        tokenContract: effect.token,
        from: effect.from,
        to: effect.to,
        ...(effect.tokenId !== undefined ? { tokenId: effect.tokenId } : {}),
        ...(effect.amount !== undefined ? { amountRawUnits: effect.amount } : {})
      },
      risky: false
    }
  }

  if (effect.type === 'approval') {
    const unlimited = effect.standard === 'erc20' && effect.amount === MAX_UINT256_DECIMAL
    const revoke = effect.standard === 'erc20' && effect.amount === '0'
    return {
      title: `${standardName(effect.standard)} ${unlimited ? 'Unlimited ' : revoke ? 'Revoke ' : ''}Approval`,
      fields: {
        tokenContract: effect.token,
        owner: effect.owner,
        spender: effect.spender,
        ...(effect.tokenId !== undefined ? { tokenId: effect.tokenId } : {}),
        ...(effect.amount !== undefined ? { amountRawUnits: effect.amount } : {})
      },
      risky: unlimited
    }
  }

  return {
    title: `${effect.approved ? 'Enable' : 'Disable'} ERC-721 / ERC-1155 Operator`,
    fields: {
      tokenContract: effect.token,
      owner: effect.owner,
      operator: effect.operator,
      approvedForAll: effect.approved
    },
    risky: effect.approved
  }
}

export const SimulationEffects = ({ account, simulation }) => {
  if (simulation?.status !== 'succeeded' || simulation.source !== 'eth_simulateV1') return null

  const effects = simulation.effects || []
  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>Token effects</div>
      <div className='simulationEffectsNotice' role='note'>
        Reported by your RPC simulation. The preview may be incomplete.
      </div>
      {effects.length ? (
        effects.map((effect, index) => {
          const presentation = getEffectPresentation(effect, account)
          return (
            <section className='simulationEffect' key={`${effect.type}:${effect.token}:${index}`}>
              <div
                className={
                  presentation.risky ? 'simulationEffectTitle simulationEffectRisk' : 'simulationEffectTitle'
                }
              >
                {presentation.title}
              </div>
              <SimpleJSON humanizeKeys json={presentation.fields} quoteStrings={false} />
            </section>
          )
        })
      ) : (
        <div className='simulationEffectsEmpty'>No supported token events were reported.</div>
      )}
      {simulation.effectsTruncated && (
        <div className='simulationEffectsTruncated' role='alert'>
          Partial effect preview · Some effects are not shown
        </div>
      )}
    </div>
  )
}

export const SimulationNativeBalanceChanges = ({ simulation }) => {
  const evidence = simulation?.nativeBalanceChanges
  if (!evidence) return null

  const unavailable = evidence.status !== 'succeeded'
  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>RPC-Reported Native Balance Changes</div>
      <div className='simulationEffectsNotice' role='note'>
        {unavailable
          ? `Wren could not derive native balance changes. ${evidence.reason || ''}`.trim()
          : 'Derived from a prestateTracer diff returned by your configured RPC. Amounts are Wei, may omit gas fees, and are not independently verified.'}
      </div>
      {!unavailable &&
        (evidence.changes.length ? (
          evidence.changes.map((change) => (
            <section className='simulationEffect' key={change.account}>
              <div className='simulationEffectTitle'>
                {String(change.change).startsWith('-')
                  ? 'Native Balance Decrease'
                  : 'Native Balance Increase'}
              </div>
              <SimpleJSON
                humanizeKeys
                quoteStrings={false}
                json={{
                  account: change.account,
                  beforeWei: change.before,
                  afterWei: change.after,
                  changeWei: change.change
                }}
              />
            </section>
          ))
        ) : (
          <div className='simulationEffectsEmpty'>No native balance changes were reported.</div>
        ))}
      {evidence.status === 'succeeded' && evidence.truncated && (
        <div className='simulationEffectsTruncated' role='alert'>
          Partial balance-change preview · Some changes are not shown
        </div>
      )}
    </div>
  )
}

export const SimulationProxyImplementationChanges = ({ simulation }) => {
  const evidence = simulation?.proxyImplementationCheck
  if (!evidence) return null

  if (evidence.status !== 'succeeded') {
    return (
      <div className='txViewData'>
        <div className='txViewDataHeader'>ERC-1967 Implementation Slot Check</div>
        <div className='simulationEffectsNotice' role='note'>
          {`Wren could not derive net ERC-1967 implementation-slot changes from the configured RPC. ${
            evidence.reason || ''
          }`.trim()}
        </div>
      </div>
    )
  }

  if (!evidence.changes.length) return null

  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>RPC-Reported ERC-1967 Implementation Slot Changes</div>
      <div className='simulationEffectsTruncated' role='alert'>
        Implementation changed · Execution code and asset authority may change.
        <details>
          <summary>Coverage</summary>Net ERC-1967 slot changes only. Temporary changes restored before
          completion are excluded.
        </details>
      </div>
      {evidence.changes.map((change) => (
        <section className='simulationEffect' key={change.proxy}>
          <div className='simulationEffectTitle simulationEffectRisk'>
            {`Proxy Implementation Slot ${
              change.kind === 'initialized'
                ? 'Initialized'
                : change.kind === 'cleared'
                  ? 'Cleared'
                  : 'Changed'
            }`}
          </div>
          <SimpleJSON
            humanizeKeys
            quoteStrings={false}
            json={{
              proxy: change.proxy,
              changeType: change.kind,
              ...(change.beforeImplementation ? { previousImplementation: change.beforeImplementation } : {}),
              ...(change.afterImplementation ? { nextImplementation: change.afterImplementation } : {}),
              previousSlotValue: change.beforeValue,
              nextSlotValue: change.afterValue,
              storageSlot: evidence.slot
            }}
          />
        </section>
      ))}
      {evidence.truncated && (
        <div className='simulationEffectsTruncated' role='alert'>
          Partial implementation-change preview · Some changes are not shown
        </div>
      )}
    </div>
  )
}

const callTraceTitle = (call) => {
  if (call.type === 'CREATE') return 'Contract Creation'
  if (call.type === 'CREATE2') return 'CREATE2 Contract Creation'
  if (call.type === 'SELFDESTRUCT') return 'Contract Self-Destruct'
  return `${call.type} Internal Call`
}

export const SimulationCallTrace = ({ simulation }) => {
  const evidence = simulation?.callTrace
  if (!evidence || (!evidence.calls.length && !evidence.truncated)) return null

  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>RPC-Reported Execution Trace</div>
      <div className='simulationEffectsNotice' role='note'>
        Call trace · Raw input and return data omitted
      </div>
      {evidence.calls.map((call, index) => (
        <section
          className='simulationEffect'
          key={`${call.depth}:${call.type}:${call.to || call.from}:${index}`}
        >
          <div
            className={call.failure ? 'simulationEffectTitle simulationEffectRisk' : 'simulationEffectTitle'}
          >
            {callTraceTitle(call)}
          </div>
          <SimpleJSON
            humanizeKeys
            quoteStrings={false}
            json={{
              depth: call.depth,
              from: call.from,
              ...(call.to ? { to: call.to } : {}),
              reportedValueWei: call.value,
              callInputBytes: call.inputBytes,
              ...(call.selector ? { selector: call.selector } : {}),
              ...(call.failure ? { failure: call.failure } : {})
            }}
          />
        </section>
      ))}
      {evidence.truncated && (
        <div className='simulationEffectsTruncated' role='alert'>
          Partial execution trace · Some calls are not shown
        </div>
      )}
    </div>
  )
}

export const SimulationAdvancedChecks = ({ simulation }) => {
  const status = simulation?.advancedChecks?.status
  if (!status || status === 'complete') return null

  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>Additional Checks</div>
      <div className='simulationEffectsNotice' role='note'>
        {status === 'pending'
          ? 'Wren is checking supporting transaction details.'
          : 'Some supporting checks could not be completed. Available results are shown below.'}
      </div>
    </div>
  )
}

export const SimulationAllowance = ({ simulation }) => {
  const allowance = simulation?.allowance
  if (!allowance) return null

  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>RPC-Reported Current Allowance</div>
      <div className='simulationEffectsNotice' role='note'>
        Allowance at review time
      </div>
      <SimpleJSON
        humanizeKeys
        quoteStrings={false}
        json={{
          tokenContract: allowance.token,
          owner: allowance.owner,
          spender: allowance.spender,
          currentAmountRawUnits: allowance.currentAmount,
          requestedAmountRawUnits: allowance.requestedAmount
        }}
      />
    </div>
  )
}

export const transactionAccountCodeEvidence = (simulation) => {
  const evidence = simulation?.accountCodeEvidence
  if (evidence) {
    return {
      sender: evidence.sender,
      target: evidence.targets?.find((target) => target.callIndexes?.includes(0))
    }
  }

  const legacy = simulation?.delegation
  return legacy?.status === 'delegated' || legacy?.status === 'unavailable'
    ? { sender: { ...legacy, role: 'sender', trust: 'configured-rpc' }, target: undefined }
    : { sender: undefined, target: undefined }
}

const delegationFields = (evidence) => ({
  account: evidence.account,
  ...(evidence.delegate ? { delegate: evidence.delegate } : {}),
  ...(evidence.codeHash ? { delegationCodeHash: evidence.codeHash } : {}),
  ...(evidence.delegateCodeHash ? { delegateCodeHash: evidence.delegateCodeHash } : {}),
  source: 'configured RPC · eth_getCode'
})

const DelegationEvidence = ({ evidence, subject }) => {
  if (!evidence || !['delegated', 'unavailable'].includes(evidence.status)) return null

  if (evidence.status === 'unavailable') {
    const label =
      subject === 'recipient'
        ? 'Recipient delegation check unavailable'
        : 'Sending account delegation check unavailable'
    return (
      <div className='accountDelegationEvidence'>
        <div className='simulationEffectsNotice' role='note'>
          {label}. {evidence.reason || ''}
        </div>
        <SimpleJSON humanizeKeys quoteStrings={false} json={delegationFields(evidence)} />
      </div>
    )
  }

  const target = subject === 'recipient'
  const delegateUnavailable = target && evidence.delegateCodeStatus === 'unavailable'
  const delegateHasNoCode = target && evidence.delegateCodeStatus === 'no-code'
  const delegateIsDelegated = target && evidence.delegateCodeStatus === 'delegated'
  const headline = target
    ? delegateUnavailable
      ? `Delegate code check unavailable for ${evidence.delegate}`
      : delegateHasNoCode
        ? `Target delegates to ${evidence.delegate}; RPC returned empty code`
        : delegateIsDelegated
          ? `Target delegates to ${evidence.delegate}; nested delegation is not followed`
          : `Recipient delegates execution to ${evidence.delegate}.`
    : `This account delegates execution to ${evidence.delegate}. Calls to this account run the delegate’s code in this account’s context. Sending this transaction does not by itself run that code.`

  return (
    <div className='accountDelegationEvidence'>
      <div className='simulationEffectsTruncated' role={target ? 'status' : 'alert'}>
        {headline}
      </div>
      {target && delegateIsDelegated && (
        <div className='simulationEffectsNotice'>Nested delegation is not followed</div>
      )}
      {target && delegateHasNoCode && (
        <div className='simulationEffectsNotice'>
          No delegate bytecode · May be an empty account or a precompile
        </div>
      )}
      {target && !delegateUnavailable && !delegateHasNoCode && !delegateIsDelegated && (
        <div className='simulationEffectsNotice'>
          A transaction to this address runs code from {evidence.delegate} in the recipient’s account context.
        </div>
      )}
      <SimpleJSON humanizeKeys quoteStrings={false} json={delegationFields(evidence)} />
    </div>
  )
}

export const SimulationDelegation = ({ simulation }) => {
  const { sender, target } = transactionAccountCodeEvidence(simulation)
  if (![sender?.status, target?.status].some((status) => ['delegated', 'unavailable'].includes(status)))
    return null

  return (
    <div className='txViewData'>
      <div className='txViewDataHeader'>Account Delegation Check</div>
      <DelegationEvidence evidence={target} subject='recipient' />
      <DelegationEvidence evidence={sender} subject='sender' />
    </div>
  )
}
