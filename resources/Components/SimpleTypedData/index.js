import useCopiedMessage from '../../Hooks/useCopiedMessage'

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
        <div className='typedDataReviewHelp'>{presentation.help}</div>
      </div>
      <div className='typedDataReviewRecognition'>
        <div>{presentation.status}</div>
        <span>Recognition describes structure, not safety.</span>
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
      {copied ? 'Address copied' : value}
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
      {copied ? 'Address copied' : displayValue(value, quoteStrings)}
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

const Permit2Authority = ({ authority }) => {
  if (!authority) return null

  const authorityType = authority.kind === 'allowance' ? 'Standing allowance' : 'One-time transfer'

  return (
    <Section title='Permission'>
      <div className='signingAuthorityGrid'>
        <div>
          <span className='signingAuthorityLabel'>Permit2 authority</span>
          <strong>{authorityType}</strong>
          <small>{authority.batch ? 'Batch request' : 'Single request'}</small>
        </div>
        <div>
          <span className='signingAuthorityLabel'>Spender</span>
          <CopyableAuthorityValue label='Permit2 spender address' value={authority.spender} />
          <small>Requested authority holder</small>
        </div>
        <div>
          <span className='signingAuthorityLabel'>Permit2 contract</span>
          <CopyableAuthorityValue label='Permit2 contract address' value={authority.verifyingContract} />
          <small>{authority.canonicalContract ? 'Canonical deployment' : 'Noncanonical deployment'}</small>
        </div>
      </div>
      <div className='signingPermissionList'>
        {authority.permissions.map(({ token, amount, expiration }, index) => (
          <div className='signingPermissionRow' key={`${token}:${index}`}>
            <div>
              <span className='signingAuthorityLabel'>Token</span>
              <CopyableAuthorityValue label={`permission ${index + 1} token address`} value={token} />
            </div>
            <div>
              <span className='signingAuthorityLabel'>Amount in base units</span>
              <strong
                className={
                  authority.maximumAmount && authority.permissions.length === 1
                    ? 'signingAuthorityDanger'
                    : ''
                }
              >
                {amount}
              </strong>
            </div>
            <div>
              <span className='signingAuthorityLabel'>Permission expiration</span>
              <strong>{expiration === undefined ? 'Not declared' : expiration}</strong>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

const Eip3009Authorization = ({ authorization }) => {
  if (!authorization) return null

  return (
    <Section title='ERC-3009 Authorization'>
      <SimpleJSON
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
          ...(authorization.from ? { from: authorization.from } : {}),
          ...(authorization.to ? { to: authorization.to } : {}),
          ...(authorization.value ? { amountBaseUnits: authorization.value } : {}),
          ...(authorization.validAfter ? { validAfterUnixSeconds: authorization.validAfter } : {}),
          ...(authorization.validBefore ? { validBeforeUnixSeconds: authorization.validBefore } : {}),
          nonce: authorization.nonce
        }}
      />
    </Section>
  )
}

const SigningContext = ({ chainName, context, origin, originName, typedMessage }) => {
  const structured = !Array.isArray(typedMessage.data)
  const requestChainId = context?.requestChainId
  const requestChain =
    requestChainId !== undefined ? `${chainName || 'Unknown chain'} (${requestChainId})` : 'Unknown chain'

  return (
    <>
      <Section first title='Signing Context'>
        <SimpleJSON
          humanizeKeys
          quoteStrings={false}
          json={{
            origin: originName || origin || 'Unknown origin',
            requestNetwork: requestChain,
            signatureVersion: typedMessage.version,
            primaryType: structured ? typedMessage.data.primaryType : 'Legacy fields'
          }}
        />
      </Section>
      <Permit2Authority authority={context?.permit2} />
      <Eip3009Authorization authorization={context?.eip3009} />
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
    <Section title='Type Definitions'>
      <SimpleJSON json={typedData.types} />
    </Section>
  </>
)

const LegacyTypedData = ({ typedData }) => (
  <Section title='Signed Fields'>
    <SimpleJSON json={typedData} />
  </Section>
)

export const SimpleTypedData = ({ chainName, deviceWarning, originName, req }) => {
  const { context, origin, typedMessage, type } = req

  return type === 'signTypedData' || type === 'signErc20Permit' ? (
    <div className='accountViewScroll cardShow'>
      <div className='txViewData signingReview typedDataSigningReview'>
        <TypedDataReviewSummary context={context} typedMessage={typedMessage} />
        <div className='signTypedDataInner'>
          <TypedDataDeviceWarning warning={deviceWarning} />
          <SigningContext {...{ chainName, context, origin, originName, typedMessage }} />
          <details className='signingRawDisclosure'>
            <summary>
              <span>Exact signed data</span>
              <span>
                {Array.isArray(typedMessage.data) ? 'Signed fields' : 'Domain, message, and types'} ›
              </span>
            </summary>
            <div className='signingRawDisclosureBody'>
              {Array.isArray(typedMessage.data) ? (
                <LegacyTypedData typedData={typedMessage.data} />
              ) : (
                <StructuredTypedData typedData={typedMessage.data} />
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  ) : (
    <div className='unknownType'>{'Unknown: ' + type}</div>
  )
}
