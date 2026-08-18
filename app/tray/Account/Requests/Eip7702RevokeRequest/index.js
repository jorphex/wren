import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import { DisplayCoinBalance } from '../../../../../resources/Components/DisplayValue'
import { resolveLocalAddressIdentity } from '../../../../../resources/domain/addressBook/identity'
import { isRequestInteractionLocked } from '../../../../../resources/domain/request'
import { getAddress } from '../../../../../resources/utils'
import { displayValueData } from '../../../../../resources/utils/displayValue'
import { chainUsesOptimismFees } from '../../../../../resources/utils/chains'
import { CopyableRequestValue } from '../LightweightRequest'
import AdjustFee from '../TransactionRequest/AdjustFee'

export const revokeLifecyclePresentation = (req, active = true) => {
  if (!active && req?.mode !== 'monitor') {
    return {
      kind: 'waiting',
      title: 'Waiting in request queue',
      detail: 'An earlier request for this account must finish first.'
    }
  }

  if (!req?.status) {
    return {
      kind: 'review',
      title: 'Review details',
      detail: 'Check everything above before revoking.'
    }
  }

  if (req.status === 'declined') {
    return { kind: 'declined', title: 'Request declined', detail: 'Nothing was sent.' }
  }

  if (req.status === 'pending') {
    return {
      kind: 'signing',
      title: 'Ready to sign',
      detail: 'Confirm this revocation with your Wren software signer.'
    }
  }

  if (req.status === 'verifying' && req.mode === 'monitor' && req.submission?.status === 'unconfirmed') {
    return {
      kind: 'unclear',
      title: 'Submission status unclear',
      detail:
        'Wren is monitoring the expected transaction hash, and this account’s request queue is paused until its status is known.'
    }
  }

  if (['sending', 'verifying', 'confirming'].includes(req.status)) {
    return {
      kind: 'pending',
      title: 'Revocation transaction pending',
      detail: 'Wait for the network to confirm it.'
    }
  }

  if (req.status === 'confirmed' && req.result?.revocationStatus === 'cleared') {
    return {
      kind: 'verified',
      title: 'Delegation cleared',
      detail:
        'Transaction confirmed. Wren’s latest RPC check reports no EIP-7702 delegation for this account.'
    }
  }

  if (req.failureReason === 'evidence-changed') {
    return {
      kind: 'changed',
      title: 'Review expired',
      detail: 'Delegation details changed. Review again before signing. Request not sent.'
    }
  }

  if (!req.tx?.hash && req.failureReason === 'not-delegated') {
    return {
      kind: 'skipped',
      title: 'Nothing to revoke',
      detail: 'No delegation found. Nothing was sent.'
    }
  }

  if (req.tx?.hash) {
    return {
      kind: 'unverified',
      title: 'Clearance not verified',
      detail: 'Transaction confirmed. Wren could not verify that the delegation is cleared.'
    }
  }

  return {
    kind: 'unavailable',
    title: 'Delegation status unavailable',
    detail: 'Delegation status unavailable. Nothing was sent.'
  }
}

export const feeRequestFromRevocation = (req) => ({
  ...req,
  data: {
    chainId: `0x${Number(req.chainId).toString(16)}`,
    type: '0x2',
    gasLimit: req.fees.gasLimit,
    maxFeePerGas: req.fees.maxFeePerGas,
    maxPriorityFeePerGas: req.fees.maxPriorityFeePerGas
  }
})

const displayQuantity = (value) => {
  try {
    return BigInt(value).toString()
  } catch {
    return String(value)
  }
}

export class RevocationFee extends React.Component {
  constructor(props) {
    super(props)
    this.state = { expanded: false }
  }

  render() {
    const { req } = this.props
    const chainId = Number(req.chainId)
    const network = this.store('main.networks.ethereum', chainId) || {}
    const nativeCurrency = this.store('main.networksMeta.ethereum', chainId, 'nativeCurrency') || {}
    const gasLimit = BigNumber(req.fees.gasLimit, 16)
    const maxFeePerGas = BigNumber(req.fees.maxFeePerGas, 16)
    const executionFee = displayValueData(maxFeePerGas.multipliedBy(gasLimit), {
      currencyRate: nativeCurrency.usd,
      isTestnet: Boolean(network.isTestnet)
    })
    const interactionLocked = isRequestInteractionLocked(req)

    return (
      <div className='eip7702RevokeFeeBody'>
        <div className='eip7702RevokeFeeRow'>
          <span>
            <strong>Maximum execution fee</strong>
            <small>
              {chainUsesOptimismFees(chainId)
                ? 'Network-added L1 data fees are not included.'
                : 'The final network fee may be lower.'}
            </small>
          </span>
          <span className='eip7702RevokeFeeAmount'>
            {executionFee.bn && !executionFee.bn.isNaN() ? (
              <DisplayCoinBalance amount={executionFee} symbol={nativeCurrency.symbol || '?'} />
            ) : (
              `? ${nativeCurrency.symbol || ''}`
            )}
          </span>
          <button
            type='button'
            className='wrenControl wrenControlSecondary wrenControlCompact'
            aria-expanded={this.state.expanded}
            disabled={interactionLocked}
            onClick={() => {
              if (!interactionLocked) this.setState((state) => ({ expanded: !state.expanded }))
            }}
          >
            Adjust
          </button>
        </div>
        {req.feesUpdatedByUser ? <div className='eip7702RevokeFeeUpdated'>Gas values set by you</div> : null}
        {this.state.expanded && !interactionLocked ? (
          <AdjustFee inline={true} req={feeRequestFromRevocation(req)} />
        ) : null}
      </div>
    )
  }
}

const ConnectedRevocationFee = Restore.connect(RevocationFee)

export class Eip7702RevokeRequest extends React.Component {
  renderIdentity(title, address, identity) {
    const checksummed = getAddress(address)
    return (
      <div className='eip7702RevokeIdentity'>
        <dt>{title}</dt>
        <dd>
          <span className='eip7702RevokeIdentityName'>{identity?.label || 'Ethereum address'}</span>
          {identity?.source ? <small>{identity.source}</small> : null}
          <CopyableRequestValue
            copyLabel={`Copy ${title.toLowerCase()} address`}
            displayValue={checksummed}
            value={checksummed}
          />
        </dd>
      </div>
    )
  }

  render() {
    const { req, chainData, accountName, addressBook, accounts } = this.props
    if (!req?.evidence?.delegate || !req?.fees) return null

    const activeRequestId = this.store('main.accounts', req.account, 'activeRequestId')
    const active = req.mode === 'monitor' || req.handlerId === activeRequestId
    const presentation = revokeLifecyclePresentation(req, active)
    const accountAddress = getAddress(req.account)
    const delegateAddress = getAddress(req.evidence.delegate)
    const accountIdentity = { label: accountName, source: 'Wren account' }
    const resolvedDelegateIdentity = resolveLocalAddressIdentity(addressBook, accounts, delegateAddress)
    const delegateIdentity = resolvedDelegateIdentity
      ? {
          ...resolvedDelegateIdentity,
          source:
            resolvedDelegateIdentity.kind === 'contact'
              ? `Address book · ${resolvedDelegateIdentity.source}`
              : resolvedDelegateIdentity.source
        }
      : undefined
    return (
      <article className={`eip7702RevokeRequest eip7702RevokeRequest-${presentation.kind}`}>
        <div className='eip7702RevokeDocument'>
          <header className='eip7702RevokeSummary'>
            <span className='eip7702RevokeEyebrow'>EIP-7702 delegation revocation</span>
            <h1>Review delegation revocation</h1>
            <p>After confirmation, this account will no longer delegate execution to {delegateAddress}.</p>
          </header>

          <section className='eip7702RevokeSection' aria-labelledby='revoke-identities-title'>
            <h2 id='revoke-identities-title'>Account and delegation</h2>
            <dl className='eip7702RevokeFacts'>
              {this.renderIdentity('Account', accountAddress, accountIdentity)}
              <div>
                <dt>Network</dt>
                <dd>{chainData.chainName || `Chain ${req.chainId}`}</dd>
              </div>
              {this.renderIdentity('Current delegate', delegateAddress, delegateIdentity)}
            </dl>
          </section>

          <section className='eip7702RevokeSection' aria-labelledby='revoke-evidence-title'>
            <h2 id='revoke-evidence-title'>Current delegation evidence</h2>
            <dl className='eip7702RevokeFacts eip7702RevokeEvidence'>
              <div>
                <dt>Source</dt>
                <dd>Configured RPC · eth_getCode</dd>
              </div>
              <div>
                <dt>Code hash</dt>
                <dd className='eip7702RevokeMono'>
                  <CopyableRequestValue
                    copyLabel='Copy delegation code hash'
                    displayValue={req.evidence.codeHash}
                    value={req.evidence.codeHash}
                  />
                </dd>
              </div>
              <div>
                <dt>Transaction nonce</dt>
                <dd>{displayQuantity(req.evidence.latestNonce)}</dd>
              </div>
            </dl>
          </section>

          <section className='eip7702RevokeSection eip7702RevokeFee' aria-labelledby='revoke-fee-title'>
            <h2 id='revoke-fee-title'>Network fee</h2>
            <ConnectedRevocationFee req={req} />
          </section>

          {presentation.kind !== 'review' ? (
            <section className='eip7702RevokeOutcome' role='status' aria-live='polite'>
              <strong>{presentation.title}</strong>
              <span>{presentation.detail}</span>
              {req.tx?.hash ? (
                <span className='eip7702RevokeHash' title={req.tx.hash}>
                  Transaction {req.tx.hash.slice(0, 10)}…{req.tx.hash.slice(-8)}
                </span>
              ) : null}
            </section>
          ) : null}
        </div>
      </article>
    )
  }
}

export default Restore.connect(Eip7702RevokeRequest)
