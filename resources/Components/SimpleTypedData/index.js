import useCopiedMessage from '../../Hooks/useCopiedMessage'
import { formatTokenBaseUnitAmount } from '../../domain/token/amount'
import { getPermit2Authority } from '../../../main/signatures/permit2'
import { getEip3009Authorization } from '../../../main/signatures/eip3009'
import Icon from '../Icon'
import { ReviewAddress, ReviewContext } from '../SigningReview'

const tokenForSigning = (tokens, context, address) => {
  const chainId = context?.requestChainId
  if (!Number.isSafeInteger(chainId) || chainId < 1 || Number(context?.domainChainId) !== chainId) return
  const matching = tokens.filter(
    (token) => token?.chainId === chainId && token.address?.toLowerCase() === address?.toLowerCase()
  )
  const token = matching[0]
  if (!token || matching.some((candidate) => candidate.decimals !== token.decimals)) return
  const symbol = typeof token.symbol === 'string' ? token.symbol.trim() : ''
  if (symbol.length > 24 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(symbol)) return
  return formatTokenBaseUnitAmount('0', token.decimals) === undefined
    ? undefined
    : { ...token, symbol: symbol || 'Token' }
}

const signingTime = (seconds) => {
  if (typeof seconds !== 'string' || !/^[0-9]{1,78}$/u.test(seconds)) return 'Not declared'
  const value = BigInt(seconds)
  if (value === 0n || value > 8_640_000_000_000n) return `${seconds} (Unix seconds)`
  return new Date(Number(value) * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  })
}

const SigningTokenAmount = ({
  amount,
  context,
  tokenAddress,
  tokenMetadata,
  unlimited = false,
  compact = false
}) => {
  const token = tokenForSigning(tokenMetadata, context, tokenAddress)
  const formatted = token && formatTokenBaseUnitAmount(amount, token.decimals)
  return (
    <div>
      {!compact ? (
        <span className='signingAuthorityLabel'>
          {unlimited || formatted !== undefined ? 'Amount' : 'Amount in base units'}
        </span>
      ) : null}
      <strong className={formatted === undefined ? '' : 'signingTokenAmountFormatted'}>
        {unlimited
          ? 'Unlimited'
          : formatted === undefined
            ? `${amount}${compact ? ' base units' : ''}`
            : compact
              ? formatted
              : `${formatted} ${token.symbol.trim()}`}
      </strong>
    </div>
  )
}

const completeAuthoritySummary = (context, typedMessage) => {
  try {
    const permit2 = getPermit2Authority(typedMessage)
    const authorization = permit2 || getEip3009Authorization(typedMessage)
    const summary = permit2 ? context?.permit2 : context?.eip3009
    const { domain, message, primaryType, types } = typedMessage.data
    const knownDomain = ['name', 'version', 'chainId', 'verifyingContract']
    if (
      types.EIP712Domain.some(({ name }) => !knownDomain.includes(name)) ||
      Object.keys(domain).some((name) => !knownDomain.includes(name))
    )
      return false
    if (Object.keys(message).some((name) => !types[primaryType]?.some((field) => field.name === name)))
      return false
    const knownTypes = [
      'EIP712Domain',
      primaryType,
      ...(permit2 ? [permit2.kind === 'allowance' ? 'PermitDetails' : 'TokenPermissions'] : [])
    ]
    if (Object.keys(types).some((name) => !knownTypes.includes(name))) return false
    return Boolean(
      authorization &&
      summary &&
      !permit2?.witness &&
      Object.keys(authorization).every(
        (key) => JSON.stringify(authorization[key]) === JSON.stringify(summary[key])
      )
    )
  } catch {
    return false
  }
}

const RISK_MESSAGES = {
  'legacy-v1': () =>
    'Legacy V1 typed data has no EIP-712 domain separation. Verify every field before signing.',
  'domain-chain-missing': () =>
    'This signature does not declare a domain chain ID and may be valid on more than one chain.',
  'domain-chain-invalid': () =>
    'The domain chain ID cannot be compared with the chain handling this request.',
  'domain-chain-mismatch': ({ domainChainId, requestChainId }) =>
    `Domain chain ${domainChainId} does not match request chain ${requestChainId}.`,
  'permit2-allowance': () =>
    'This Permit2 signature creates standing token allowances for the displayed spender until each allowance expires.',
  'permit2-transfer': () =>
    'This Permit2 signature authorizes the displayed spender to make one-time token transfers up to the displayed amounts.',
  'permit2-maximum-amount': () =>
    'At least one Permit2 amount is the maximum value supported by this permission type.',
  'permit2-noncanonical-contract': ({ permit2 }) =>
    `The verifying contract ${permit2?.verifyingContract || 'is unknown and'} is not the canonical Uniswap Permit2 deployment.`,
  'eip3009-transfer': ({ eip3009 }) =>
    eip3009?.kind === 'transfer'
      ? 'This ERC-3009 signature directly authorizes the displayed token transfer without an onchain approval transaction. Anyone holding the signature can relay this transfer.'
      : 'This ERC-3009 signature directly authorizes the displayed token transfer without an onchain approval transaction. The displayed recipient must submit the receive authorization.',
  'eip3009-maximum-amount': () => 'This ERC-3009 transfer uses the maximum uint256 token amount.'
}

const displayKey = (key) => key.replace(/([A-Z])/g, ' $1').trim()

export const getTypedDataReviewPresentation = (context = {}, typedMessage = {}) => {
  if (context.permit2) {
    const allowance = context.permit2.kind === 'allowance'
    return {
      eyebrow: allowance ? 'Permit2 allowance' : 'Permit2 transfer',
      title: allowance ? 'Authorize token spending' : 'Authorize token transfer',
      help: allowance
        ? 'This signature can grant spending authority without a transaction.'
        : 'This signature can authorize token movement without a transaction.',
      status: 'Permit2 structure recognized'
    }
  }

  if (context.eip3009) {
    const cancel = context.eip3009.kind === 'cancel'
    return {
      eyebrow: 'ERC-3009 authorization',
      title: cancel ? 'Cancel token authorization' : 'Authorize token transfer',
      help: cancel
        ? 'This signature invalidates the displayed token authorization.'
        : 'This signature can authorize a token transfer without a transaction.',
      status: 'ERC-3009 structure recognized'
    }
  }

  const legacy = Array.isArray(typedMessage.data)
  return {
    eyebrow: legacy ? 'Legacy typed data' : `EIP-712 ${typedMessage.version || ''}`.trim(),
    title: legacy ? 'Review signed fields' : 'Review structured message',
    help: 'Verify the signing context and every exact field before approving.',
    status: legacy ? 'Legacy field structure' : 'Typed-data structure recognized'
  }
}

const TypedDataReviewSummary = ({ context, typedMessage, originName, chainName }) => {
  const presentation = getTypedDataReviewPresentation(context, typedMessage)

  return (
    <>
      <ReviewContext origin={originName} network={chainName} />
      <div className='typedDataReviewSummary'>
        <div className='typedDataReviewSummaryMain'>
          <div className='typedDataReviewTitle'>{presentation.title}</div>
        </div>
      </div>
    </>
  )
}

const CopyableAuthorityValue = ({ label, value }) => {
  const [copied, copyValue] = useCopiedMessage(value)

  return (
    <button
      type='button'
      aria-label={`Copy ${label}`}
      className='signingAuthorityCopy wrenControlCompact'
      onClick={() => copyValue()}
    >
      {value}
      <Icon name='copy' size={16} />
      <span className='signingCopyFeedback' role='status'>
        {copied ? 'Address copied' : ''}
      </span>
    </button>
  )
}

const displayValue = (value, quoteStrings) => {
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'string') return quoteStrings ? JSON.stringify(value) : value || '""'
  return JSON.stringify(value)
}

const SimpleJSONScalar = ({ copyLabel, quoteStrings, value }) => {
  const [copied, copyValue] = useCopiedMessage(value)

  return copyLabel ? (
    <button
      type='button'
      aria-label={`Copy ${copyLabel}`}
      className='simpleJsonCopyValue'
      onClick={() => copyValue()}
    >
      {displayValue(value, quoteStrings)}
      <span className='signingCopyFeedback' role='status'>
        {copied ? 'Address copied' : ''}
      </span>
    </button>
  ) : (
    displayValue(value, quoteStrings)
  )
}

export const SimpleJSON = ({ copyableKeys = {}, humanizeKeys = false, json, quoteStrings = true }) => {
  if (json === null || typeof json !== 'object') {
    return <span>{displayValue(json, quoteStrings)}</span>
  }

  const entries = Object.entries(json)
  if (entries.length === 0) return <div className='simpleJsonEmpty'>{Array.isArray(json) ? '[]' : '{}'}</div>

  return (
    <div className='simpleJson'>
      {entries.map(([key, value], index) => (
        <div key={`${key}:${index}`} className='simpleJsonChild'>
          <div className='simpleJsonKey simpleJsonKeyTx'>
            {Array.isArray(json) ? `[${key}]` : humanizeKeys ? displayKey(key) : key}
          </div>
          <div className='simpleJsonValue'>
            {value !== null && typeof value === 'object' ? (
              <SimpleJSON humanizeKeys={humanizeKeys} json={value} quoteStrings={quoteStrings} />
            ) : (
              <SimpleJSONScalar copyLabel={copyableKeys[key]} quoteStrings={quoteStrings} value={value} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export const Section = ({ children, first = false, title }) => (
  <section>
    <div className={`simpleJsonHeader${first ? ' simpleJsonHeaderFirst' : ''}`}>{title}</div>
    {children}
  </section>
)

export const TypedDataWarnings = ({ context }) => {
  const risks = (context?.risks || []).filter(
    (risk) =>
      !(['permit2-allowance', 'permit2-transfer'].includes(risk) && context?.permit2) &&
      !(risk === 'eip3009-transfer' && context?.eip3009)
  )

  return risks.length ? (
    <div className='typedDataWarnings' aria-label='Signing warnings'>
      {risks.map((risk) => {
        const message = RISK_MESSAGES[risk]
        return message ? (
          <div key={risk} className='typedDataWarning' role='alert'>
            {message(context)}
          </div>
        ) : null
      })}
    </div>
  ) : null
}

export const getTypedDataDeviceWarning = (signer) => {
  if (signer?.signingCapabilities?.typedDataHashOnly) {
    return `${signer.model || 'This signer'} will display only the EIP-712 domain and message hashes. Verify every structured field in Wren before approving on-device.`
  }

  if (signer?.type?.toLowerCase() === 'trezor') {
    return `${signer.model || 'This Trezor'} may summarize EIP-712 structures on-device. Open the device menu and choose Show full message to inspect every value before signing.`
  }
}

export const TypedDataDeviceWarning = ({ warning }) =>
  warning ? (
    <div className='typedDataWarnings' aria-label='Device signing warning'>
      <div className='typedDataWarning' role='alert'>
        {warning}
      </div>
    </div>
  ) : null

const Permit2Authority = ({ authority, context, tokenMetadata, spenderIdentity }) => {
  if (!authority) return null

  const authorityType = authority.kind === 'allowance' ? 'Standing allowance' : 'One-time transfer'
  const commonExpiration =
    authority.kind === 'allowance' &&
    authority.permissions.length &&
    authority.permissions.every(({ expiration }) => expiration === authority.permissions[0].expiration)
      ? authority.permissions[0].expiration
      : undefined

  return (
    <>
      <section className='signingPermissionCard' aria-label='Permission'>
        <span className='signingAuthorityLabel'>
          {authorityType}
          {authority.batch ? ' · Batch request' : ''}
        </span>
        <div className='signingPermissionList'>
          {authority.permissions.map(({ token, amount, expiration }, index) => (
            <div className='signingPermissionRow' key={`${token}:${index}`}>
              <div className='signingPermissionTokenHeader'>
                <strong>{tokenForSigning(tokenMetadata, context, token)?.symbol || 'Token'}</strong>
                <SigningTokenAmount
                  amount={amount}
                  context={context}
                  tokenAddress={token}
                  tokenMetadata={tokenMetadata}
                  unlimited={authority.kind === 'allowance' && amount === ((1n << 160n) - 1n).toString()}
                  compact
                />
              </div>
              <CopyableAuthorityValue label={`permission ${index + 1} token address`} value={token} />
              {expiration !== undefined && commonExpiration === undefined ? (
                <div className='signingPermissionExpiration'>
                  <span className='signingAuthorityLabel'>Spending expires</span>
                  <strong title={expiration === undefined ? undefined : `${expiration} Unix seconds`}>
                    {signingTime(expiration)}
                  </strong>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className='signingPermissionDates'>
          {commonExpiration !== undefined ? (
            <div>
              <span className='signingAuthorityLabel'>Spending expires</span>
              <strong title={`${commonExpiration} Unix seconds`}>{signingTime(commonExpiration)}</strong>
            </div>
          ) : null}
          <div>
            <span className='signingAuthorityLabel'>Sign by</span>
            <strong title={`${authority.deadline} Unix seconds`}>{signingTime(authority.deadline)}</strong>
          </div>
        </div>
      </section>
      <div className='signingAuthorityFacts'>
        <ReviewAddress
          label='Spender'
          name='Permit2 spender address'
          address={authority.spender}
          source={spenderIdentity}
        />
        <div>
          <span className='signingAuthorityLabel'>Permit2 contract</span>
          <CopyableAuthorityValue label='Permit2 contract address' value={authority.verifyingContract} />
        </div>
      </div>
    </>
  )
}

const Eip3009Authorization = ({ authorization, context, tokenMetadata }) => {
  if (!authorization) return null
  const operation =
    authorization.kind === 'cancel'
      ? 'Cancel authorization'
      : authorization.kind === 'receive'
        ? 'Recipient-submitted transfer'
        : 'Relayed transfer'

  return (
    <>
      <section className='signingPermissionCard signingAuthorizationCard' aria-label='ERC-3009 Authorization'>
        <span className='signingAuthorityLabel'>{operation}</span>
        {authorization.value !== undefined ? (
          <div className='signingAuthorizationAmount'>
            <SigningTokenAmount
              amount={authorization.value}
              context={context}
              tokenAddress={authorization.verifyingContract}
              tokenMetadata={tokenMetadata}
            />
          </div>
        ) : null}
        {authorization.to ? (
          <ReviewAddress label='To' name='recipient address' address={authorization.to} />
        ) : null}
        <div className='signingPermissionDates'>
          {authorization.validAfter !== undefined ? (
            <div>
              <span className='signingAuthorityLabel'>Valid from</span>
              <strong title={authorization.validAfter + ' Unix seconds'}>
                {authorization.validAfter === '0' ? 'Any time' : signingTime(authorization.validAfter)}
              </strong>
            </div>
          ) : null}
          {authorization.validBefore !== undefined ? (
            <div>
              <span className='signingAuthorityLabel'>Valid until</span>
              <strong title={authorization.validBefore + ' Unix seconds'}>
                {signingTime(authorization.validBefore)}
              </strong>
            </div>
          ) : null}
        </div>
        {authorization.kind === 'cancel' ? <SimpleJSON json={{ nonce: authorization.nonce }} /> : null}
      </section>
      <ReviewAddress
        label='Token contract'
        name='authorization token address'
        address={authorization.verifyingContract}
      />
      <ReviewAddress label='Authorizer' name='authorizer address' address={authorization.authorizer} />
    </>
  )
}

const SigningContext = ({ context, tokenMetadata, spenderIdentity }) => {
  return (
    <>
      <Permit2Authority
        authority={context?.permit2}
        context={context}
        tokenMetadata={tokenMetadata}
        spenderIdentity={spenderIdentity}
      />
      <Eip3009Authorization
        authorization={context?.eip3009}
        context={context}
        tokenMetadata={tokenMetadata}
      />
      <TypedDataWarnings context={context} />
    </>
  )
}

const StructuredTypedData = ({ typedData }) => (
  <>
    <Section title='Domain'>
      <SimpleJSON json={typedData.domain} />
    </Section>
    <Section title={`Message: ${typedData.primaryType}`}>
      <SimpleJSON json={typedData.message} />
    </Section>
    <details className='signingRawDisclosure'>
      <summary>Type definitions</summary>
      <SimpleJSON json={typedData.types} />
    </details>
  </>
)

const LegacyTypedData = ({ typedData }) => (
  <Section title='Signed Fields'>
    <SimpleJSON json={typedData} />
  </Section>
)

export const SimpleTypedData = ({
  chainName,
  deviceWarning,
  originName,
  req,
  tokenMetadata = [],
  acknowledgements
}) => {
  const { context, origin, typedMessage, type } = req
  const hasCompleteSummary = completeAuthoritySummary(context, typedMessage)
  const rpcTokens = (req.signingMetadata?.tokens || []).filter(
    (token) => formatTokenBaseUnitAmount('0', token.decimals) !== undefined
  )
  const metadata = [
    ...rpcTokens,
    ...tokenMetadata.filter(
      (token) =>
        !rpcTokens.some(
          (read) =>
            read.chainId === token.chainId && read.address.toLowerCase() === token.address?.toLowerCase()
        )
    )
  ]
  const spender = req.signingMetadata?.spender
  const spenderIdentity =
    spender &&
    Number(context?.domainChainId) === context?.requestChainId &&
    spender.address === context?.permit2?.spender?.toLowerCase()
      ? { label: spender.contractName, source: spender.contractSource }
      : undefined

  return type === 'signTypedData' || type === 'signErc20Permit' ? (
    <div className='accountViewScroll cardShow'>
      <div className='txViewData signingReview typedDataSigningReview'>
        <TypedDataReviewSummary
          context={context}
          typedMessage={typedMessage}
          originName={originName || origin}
          chainName={
            chainName || (context?.requestChainId ? `Chain ${context.requestChainId}` : 'Unknown network')
          }
        />
        <div className='signTypedDataInner'>
          <TypedDataDeviceWarning warning={deviceWarning} />
          <SigningContext
            account={req.account}
            {...{ chainName, context, origin, originName, spenderIdentity }}
            tokenMetadata={metadata}
          />
          {acknowledgements}
          {Array.isArray(typedMessage.data) ? (
            <LegacyTypedData typedData={typedMessage.data} />
          ) : hasCompleteSummary ? (
            <details className='signingRawDisclosure'>
              <summary>Signed data</summary>
              <div className='signingRawDisclosureBody'>
                <StructuredTypedData typedData={typedMessage.data} />
              </div>
            </details>
          ) : (
            <StructuredTypedData typedData={typedMessage.data} />
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className='unknownType'>{'Unknown: ' + type}</div>
  )
}
