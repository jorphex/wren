import { MAX_UINT256 } from '../../../../../resources/domain/transaction/quantity'
import {
  formatTokenBaseUnitAmount,
  MAX_TOKEN_DECIMALS,
  parseTokenBaseUnitAmount
} from '../../../../../resources/domain/token/amount'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import Countdown from '../../../../../resources/Components/Countdown'
import EditTokenSpend from '../../../../../resources/Components/EditTokenSpend'
import {
  SimpleTypedData as TypedSignatureOverview,
  getTypedDataDeviceWarning,
  TypedDataDeviceWarning,
  TypedDataWarnings
} from '../../../../../resources/Components/SimpleTypedData'
import { getSignatureRequestClass } from '../../../../../resources/domain/request'
import useCopiedMessage from '../../../../../resources/Hooks/useCopiedMessage'
import AddressIdentity from '../../../../../resources/Components/AddressIdentity'
import { resolveLocalAddressIdentity } from '../../../../../resources/domain/addressBook/identity'

const compactAddress = (address = '') =>
  address.length > 13 ? `${address.slice(0, 7)}…${address.slice(-4)}` : address

const PermitOverview = ({
  req,
  chainData,
  deviceWarning,
  originName,
  addressBook,
  accounts,
  accountName
}) => {
  const { chainName } = chainData
  const {
    permit: { spender, value, deadline },
    tokenData
  } = req
  const localIdentity = resolveLocalAddressIdentity(addressBook, accounts, spender.address)

  const [showCopiedMessage, copySpender] = useCopiedMessage(spender.address)

  const amount = parseTokenBaseUnitAmount(value)
  const hasTokenDecimals =
    Number.isInteger(tokenData.decimals) &&
    tokenData.decimals >= 0 &&
    tokenData.decimals <= MAX_TOKEN_DECIMALS
  const canEditAmount = amount !== undefined && hasTokenDecimals
  const amountDisplay =
    amount === undefined
      ? 'UNKNOWN AMOUNT'
      : amount === MAX_UINT256
        ? '~UNLIMITED'
        : hasTokenDecimals
          ? formatTokenBaseUnitAmount(value, tokenData.decimals)
          : 'UNKNOWN AMOUNT'

  const amountSuffix = tokenData.symbol || 'UNKNOWN TOKEN'

  return (
    <div className='approveTransaction approvePermit approvePermitPerch'>
      <section className='permitOriginCard' aria-label='Request origin'>
        <span className='permitOriginMark' aria-hidden='true'>
          <Icon name='apps' size={19} />
        </span>
        <span className='permitOriginIdentity'>
          <strong>{originName || 'Unknown app'}</strong>
          <span>{chainName} · signature</span>
        </span>
        <span className='permitOriginKind'>signature</span>
      </section>

      <section className='permitActionCard'>
        <h2>Action</h2>
        <strong>
          Permit {localIdentity?.label || compactAddress(spender.address)} to spend up to {amountDisplay}{' '}
          {amountSuffix}.
        </strong>
        <button
          aria-label='View raw permit data'
          className='permitRawAction'
          onClick={() => {
            link.send('nav:update', 'panel', { data: { step: 'viewRaw' } })
          }}
          type='button'
        >
          <span>Permit(address owner, address spender, uint256 value, uint256 nonce, uint256 deadline)</span>
          <code>spender: {compactAddress(spender.address)}</code>
        </button>
      </section>

      <section className='permitDetailsCard'>
        <h2>Details</h2>
        <dl>
          <div>
            <dt>From</dt>
            <dd>
              {accountName || 'Account'} · {compactAddress(req.account)}
            </dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>{amountSuffix}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>
              <button
                aria-label={canEditAmount ? 'Edit permit amount' : undefined}
                className='permitEditAmount'
                disabled={!canEditAmount}
                onClick={() => {
                  link.send('nav:update', 'panel', { data: { step: 'adjustPermit', tokenData } })
                }}
                type='button'
              >
                {`${amountDisplay} ${amountSuffix}`}
              </button>
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{chainName}</dd>
          </div>
          <div>
            <dt>Spender</dt>
            <dd>
              <button
                aria-label='Copy permit spender address'
                className='permitCopySpender'
                onClick={() => copySpender()}
                type='button'
              >
                <AddressIdentity
                  address={spender.address}
                  copied={showCopiedMessage}
                  label={localIdentity?.label || spender.ens}
                  revealOnHover={false}
                  source={localIdentity?.source || (spender.ens ? 'ENS' : '')}
                />
              </button>
            </dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>
              <Countdown
                end={deadline * 1000}
                innerClass='permitReviewValue'
                titleClass='permitReviewCountdown'
              />
            </dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>EIP-712</dd>
          </div>
        </dl>
        <span className='permitCopyStatus' role='status'>
          {showCopiedMessage ? 'Permit spender address copied' : ''}
        </span>
      </section>
      <TypedDataWarnings context={req.context} />
      <TypedDataDeviceWarning warning={deviceWarning} />
    </div>
  )
}

const EditPermit = ({ req }) => {
  const { permit, tokenData } = req

  const { verifyingContract: contract, spender, value: amount, deadline: deadlineInSeconds } = permit

  const updateRequest = (newAmt, callback = () => {}) => {
    link.rpc('updateRequest', req.account, req.handlerId, { amount: newAmt }, null, callback)
  }
  const deadline = deadlineInSeconds * 1000

  const requestedAmount = req.payload.params[1].message.value

  const data = {
    ...tokenData,
    contract,
    spender,
    amount
  }

  return (
    <EditTokenSpend
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
  accountName
}) => {
  const requestClass = getSignatureRequestClass(req)
  const deviceWarning = getTypedDataDeviceWarning(signer)

  const renderStep = () => {
    switch (step) {
      case 'adjustPermit':
        return <EditPermit req={req} />
      case 'viewRaw':
        return (
          <TypedSignatureOverview
            chainName={chainData.requestChainName}
            deviceWarning={deviceWarning}
            originName={originName}
            req={req}
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
