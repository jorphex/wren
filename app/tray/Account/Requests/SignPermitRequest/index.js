import { ReviewContext, ReviewAddress } from '../../../../../resources/Components/SigningReview'
import ReviewAcknowledgements from '../ReviewAcknowledgements'
import { MAX_UINT256 } from '../../../../../resources/domain/transaction/quantity'
import {
  formatTokenBaseUnitAmount,
  MAX_TOKEN_DECIMALS,
  parseTokenBaseUnitAmount
} from '../../../../../resources/domain/token/amount'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import EditTokenSpend, { formatApprovalExpiry } from '../../../../../resources/Components/EditTokenSpend'
import {
  SimpleTypedData as TypedSignatureOverview,
  getTypedDataDeviceWarning,
  TypedDataDeviceWarning,
  TypedDataWarnings
} from '../../../../../resources/Components/SimpleTypedData'
import { getSignatureRequestClass } from '../../../../../resources/domain/request'
import { resolveLocalAddressIdentity } from '../../../../../resources/domain/addressBook/identity'

const PermitOverview = ({ req, chainData, deviceWarning, originName, addressBook, accounts, readOnly }) => {
  const {
    permit: { spender, value, deadline, verifyingContract },
    tokenData
  } = req
  const tokenContract = verifyingContract?.address || req.typedMessage?.data?.domain?.verifyingContract
  const localIdentity = resolveLocalAddressIdentity(addressBook, accounts, spender.address)
  const amount = parseTokenBaseUnitAmount(value)
  const hasTokenDecimals =
    Number.isInteger(tokenData.decimals) &&
    tokenData.decimals >= 0 &&
    tokenData.decimals <= MAX_TOKEN_DECIMALS
  const canEditAmount =
    !readOnly && req.status === undefined && !req.locked && amount !== undefined && hasTokenDecimals
  const amountDisplay =
    amount === undefined
      ? 'Unknown amount'
      : amount === MAX_UINT256
        ? 'Unlimited'
        : hasTokenDecimals
          ? formatTokenBaseUnitAmount(value, tokenData.decimals)
          : value + ' base units'
  const symbol = tokenData.symbol || 'Token'
  return (
    <div className='approveTransaction approvePermit signingPermitReview'>
      <ReviewContext origin={originName} network={chainData.requestChainName || chainData.chainName} />
      <h2 className='signingReviewTitle'>
        {amount === 0n ? 'Revoke token spending' : 'Allow token spending'}
      </h2>
      <section className='signingPermissionCard'>
        <div className='signingPermitLimit'>
          <div>
            <span className='signingAuthorityLabel'>Spending limit</span>
            <strong>
              {amountDisplay} {symbol}
            </strong>
          </div>
          {canEditAmount ? (
            <button
              type='button'
              className='wrenControl wrenControlSecondary wrenControlCompact'
              aria-label='Edit permit amount'
              onClick={() => link.send('nav:update', 'panel', { data: { step: 'adjustPermit', tokenData } })}
            >
              Adjust
            </button>
          ) : null}
        </div>
        <ReviewAddress
          label='Spender'
          name='permit spender address'
          address={spender.address}
          source={localIdentity || (spender.ens ? { label: spender.ens, source: 'ENS' } : undefined)}
        />
        <div className='signingPermissionDates'>
          <div>
            <span className='signingAuthorityLabel'>Sign by</span>
            <strong>{formatApprovalExpiry(deadline)}</strong>
          </div>
          <div>
            <span className='signingAuthorityLabel'>Spending access</span>
            <strong>Until spent or revoked</strong>
          </div>
        </div>
      </section>
      {tokenContract ? (
        <ReviewAddress label='Token contract' name='permit token contract' address={tokenContract} />
      ) : (
        <p>Token contract unavailable</p>
      )}
      <TypedDataWarnings context={req.context} />
      <TypedDataDeviceWarning warning={deviceWarning} />
      <ReviewAcknowledgements req={req} readOnly={readOnly} />
      <button
        type='button'
        aria-label='View raw permit data'
        className='signingReviewDataLink'
        onClick={() => link.send('nav:update', 'panel', { data: { step: 'viewRaw' } })}
      >
        Signed data
        <Icon name='chevron-right' size={16} />
      </button>
    </div>
  )
}

const EditPermit = ({ req, hideBalances }) => {
  const { permit, tokenData } = req

  const { verifyingContract: contract, spender, value: amount, deadline: deadlineInSeconds } = permit

  const updateRequest = (newAmt, callback = () => {}) => {
    link.rpc('updateRequest', req.account, req.handlerId, { amount: newAmt }, null, callback)
  }
  const deadline = deadlineInSeconds

  const requestedAmount = req.payload.params[1].message.value

  const data = {
    ...tokenData,
    contract,
    spender,
    amount
  }

  return (
    <EditTokenSpend
      request={{ account: req.account, handlerId: req.handlerId }}
      hideBalance={hideBalances}
      {...{
        data,
        requestedAmount,
        updateRequest,
        deadline
      }}
    />
  )
}

const PermitRequest = ({
  req,
  originName,
  signer,
  step,
  chainData,
  addressBook = {},
  accounts = {},
  accountName,
  hideBalances = false,
  readOnly = false
}) => {
  const requestClass = getSignatureRequestClass(req)
  const deviceWarning = getTypedDataDeviceWarning(signer)

  const renderStep = () => {
    switch (step) {
      case 'adjustPermit':
        return <EditPermit req={req} hideBalances={hideBalances} />
      case 'viewRaw':
        return (
          <TypedSignatureOverview
            chainName={chainData.requestChainName}
            deviceWarning={deviceWarning}
            originName={originName}
            req={req}
            acknowledgements={<ReviewAcknowledgements req={req} readOnly={readOnly} />}
          />
        )
      default:
        return (
          <PermitOverview
            originName={originName}
            req={req}
            chainData={chainData}
            deviceWarning={deviceWarning}
            addressBook={addressBook}
            accounts={accounts}
            accountName={accountName}
            readOnly={readOnly}
          />
        )
    }
  }

  return (
    <div key={req.id || req.handlerId} className={requestClass}>
      {renderStep()}
    </div>
  )
}

export default PermitRequest
