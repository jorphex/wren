import useCopiedMessage from '../../Hooks/useCopiedMessage'
import { formatTokenBaseUnitAmount } from '../../domain/token/amount'
import { getPermit2Authority } from '../../../main/signatures/permit2'
import { getEip3009Authorization } from '../../../main/signatures/eip3009'

const tokenForSigning = (tokens, context, address) => {
  const chainId = context?.requestChainId
  if (!Number.isSafeInteger(chainId) || chainId < 1 || Number(context?.domainChainId) !== chainId) return
  const matching = tokens.filter(
    (token) => token?.chainId === chainId && token.address?.toLowerCase() === address?.toLowerCase()
  )
  const token = matching[0]
  if (!token || matching.some((candidate) => candidate.decimals !== token.decimals)) return
  const symbol = typeof token.symbol === 'string' ? token.symbol.trim() : ''
  if (!symbol || symbol.length > 24 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(symbol)) return
  return formatTokenBaseUnitAmount('0', token.decimals) === undefined ? undefined : token
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

const SigningTokenAmount = ({ amount, context, tokenAddress, tokenMetadata, unlimited = false }) => {
  const token = tokenForSigning(tokenMetadata, context, tokenAddress)
  const formatted = token && formatTokenBaseUnitAmount(amount, token.decimals)
  return (
    <div>
      <span className='signingAuthorityLabel'>
        {unlimited || formatted !== undefined ? 'Amount' : 'Amount in base units'}
      </span>
      <strong className={formatted === undefined ? '' : 'signingTokenAmountFormatted'}>
        {unlimited ? 'Unlimited' : formatted === undefined ? amount : `${formatted} ${token.symbol.trim()}`}
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

const TypedDataReviewSummary = ({ context, typedMessage }) => {
  const presentation = getTypedDataReviewPresentation(context, typedMessage)

  return (
    <div className='typedDataReviewSummary'>
      <div className='typedDataReviewSummaryMain'>
        <div className='typedDataReviewEyebrow'>{presentation.eyebrow}</div>
        <div className='typedDataReviewTitle'>{presentation.title}</div>
      </div>
    </div>
  )
}

const CopyableAuthorityValue = ({ label, value }) => {
  const [copied, copyValue] = useCopiedMessage(value)

  return (
    <button
      type='button'
      aria-label={`Copy ${label}`}
      className='signingAuthorityCopy'
      onClick={() => copyValue()}
    >
      {value}
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
  const risks = context?.risks || []

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

const Permit2Authority = ({ authority, context, tokenMetadata }) => {
  if (!authority) return null

  const authorityType = authority.kind === 'allowance' ? 'Standing allowance' : 'One-time transfer'

  return (
    <Section first title='Permission'>
      <div className='signingAuthorityGrid'>
        <div>
          <span className='signingAuthorityLabel'>Permit2 authority</span>
          <strong>{authorityType}</strong>
          <small>{authority.batch ? 'Batch request' : 'Single request'}</small>
        </div>
        <div>
          <span className='signingAuthorityLabel'>Spender</span>
          <CopyableAuthorityValue label='Permit2 spender address' value={authority.spender} />
        </div>
        <div>
          <span className='signingAuthorityLabel'>Permit2 contract</span>
          <CopyableAuthorityValue label='Permit2 contract address' value={authority.verifyingContract} />
          <small>{authority.canonicalContract ? 'Canonical deployment' : 'Noncanonical deployment'}</small>
        </div>
        <div>
          <span className='signingAuthorityLabel'>Signature deadline</span>
          <strong title={`${authority.deadline} Unix seconds`}>{signingTime(authority.deadline)}</strong>
        </div>
      </div>
      <div className='signingPermissionList'>
        {authority.permissions.map(({ token, amount, expiration }, index) => (
          <div className='signingPermissionRow' key={`${token}:${index}`}>
            <div>
              <span className='signingAuthorityLabel'>Token</span>
              <CopyableAuthorityValue label={`permission ${index + 1} token address`} value={token} />
            </div>
            <SigningTokenAmount
              amount={amount}
              context={context}
              tokenAddress={token}
              tokenMetadata={tokenMetadata}
              unlimited={authority.kind === 'allowance' && amount === ((1n << 160n) - 1n).toString()}
            />
            <div>
              <span className='signingAuthorityLabel'>Permission expiration</span>
              <strong title={expiration === undefined ? undefined : `${expiration} Unix seconds`}>
                {signingTime(expiration)}
              </strong>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

const Eip3009Authorization = ({ authorization, context, tokenMetadata }) => {
  if (!authorization) return null

  return (
    <Section first title='ERC-3009 Authorization'>
      {authorization.value !== undefined && (
        <div className='signingPermissionRow'>
          <SigningTokenAmount
            amount={authorization.value}
            context={context}
            tokenAddress={authorization.verifyingContract}
            tokenMetadata={tokenMetadata}
          />
        </div>
      )}
      <SimpleJSON
        copyableKeys={{
          tokenContract: 'authorization token address',
          authorizer: 'authorizer address',
          to: 'recipient address'
        }}
        humanizeKeys
        quoteStrings={false}
        json={{
          operation:
            authorization.kind === 'cancel'
              ? 'Cancel authorization'
              : authorization.kind === 'receive'
                ? 'Recipient-submitted transfer'
                : 'Relayed transfer',
          tokenContract: authorization.verifyingContract,
          authorizer: authorization.authorizer,
          ...(authorization.to ? { to: authorization.to } : {}),
          ...(authorization.validAfter ? { validAfter: signingTime(authorization.validAfter) } : {}),
          ...(authorization.validBefore ? { validBefore: signingTime(authorization.validBefore) } : {}),
          nonce: authorization.nonce
        }}
      />
    </Section>
  )
}

const SigningContext = ({ account, chainName, context, origin, originName, tokenMetadata }) => {
  const requestChainId = context?.requestChainId
  const requestChain =
    requestChainId !== undefined ? `${chainName || 'Unknown chain'} (${requestChainId})` : 'Unknown chain'

  return (
    <>
      <Permit2Authority authority={context?.permit2} context={context} tokenMetadata={tokenMetadata} />
      <Eip3009Authorization
        authorization={context?.eip3009}
        context={context}
        tokenMetadata={tokenMetadata}
      />
      <Section first={!context?.permit2 && !context?.eip3009} title='Signing Context'>
        <SimpleJSON
          copyableKeys={{ account: 'signing account address' }}
          humanizeKeys
          quoteStrings={false}
          json={{
            origin: originName || origin || 'Unknown origin',
            account,
            requestNetwork: requestChain
          }}
        />
      </Section>
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

export const SimpleTypedData = ({ chainName, deviceWarning, originName, req, tokenMetadata = [] }) => {
  const { context, origin, typedMessage, type } = req
  const hasCompleteSummary = completeAuthoritySummary(context, typedMessage)

  return type === 'signTypedData' || type === 'signErc20Permit' ? (
    <div className='accountViewScroll cardShow'>
      <div className='txViewData signingReview typedDataSigningReview'>
        <TypedDataReviewSummary context={context} typedMessage={typedMessage} />
        <div className='signTypedDataInner'>
          <TypedDataDeviceWarning warning={deviceWarning} />
          <SigningContext
            account={req.account}
            {...{ chainName, context, origin, originName, tokenMetadata }}
          />
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
