import Restore from 'react-restore'

import { ReviewAddress } from '../../../resources/Components/SigningReview'
import { safeNetworkMetadata } from '../../../resources/domain/networkMetadata'
import TxFee from '../Account/Requests/TransactionRequest/TxFee'
import { preparationData } from '../Account/Requests/WalletCallsRequest'
import {
  createWalletCallsDraft,
  formatNativeMaximum
} from '../Account/Requests/WalletCallsRequest/adjustment'
import link from '../../../resources/link'

export const SigningDecisionSummary = Restore.connect(function SigningDecisionSummary({ req, accountId }) {
  const store = this.store
  const address = req.account || accountId
  if (!address) return null
  const account = store('main.accounts', address) || {}
  const readOnly = account.activeRequestId !== req.handlerId || req.status !== undefined || req.locked
  const chainId = Number.parseInt(req.type === 'transaction' ? req.data.chainId : req.chainId || '0x0', 16)
  const network = store('main.networks.ethereum', chainId)
  const { nativeCurrency } = safeNetworkMetadata(store('main.networksMeta.ethereum', chainId), network)
  const preparation = req.type === 'walletCalls' ? preparationData(req) : undefined
  return (
    <div className='signingDecisionSummary' role='group' aria-label='Signing account and fee'>
      <div className='signingDecisionAccount'>
        <span className='signingReviewLabel'>Signing with</span>
        <strong>{account.name || 'Account'}</strong>
      </div>
      <ReviewAddress address={address} name='signing account address' />
      {req.type === 'transaction' && network ? <TxFee req={req} summary readOnly={readOnly} /> : null}
      {preparation ? (
        <div className='signingDecisionFee'>
          <span className='signingReviewLabel'>Maximum network fees</span>
          <strong className='signingDecisionFeeValue'>
            {preparation.status === 'succeeded'
              ? formatNativeMaximum(preparation.total, nativeCurrency.decimals ?? 18, nativeCurrency.symbol)
              : preparation.status === 'pending'
                ? 'Calculating…'
                : 'Unavailable'}
          </strong>
          {!readOnly && preparation.status === 'succeeded' ? (
            <button
              type='button'
              className='signingDecisionFeeAdjust wrenControlCompact'
              onClick={() => {
                const walletCallsDraft = createWalletCallsDraft(req)
                if (walletCallsDraft)
                  link.send('nav:update', 'panel', { data: { step: 'adjustWalletCalls', walletCallsDraft } })
              }}
            >
              Adjust
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

export default SigningDecisionSummary
