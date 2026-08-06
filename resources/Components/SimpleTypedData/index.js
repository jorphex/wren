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

const displayValue = (value, quoteStrings) => {
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'string') return quoteStrings ? JSON.stringify(value) : value || '""'
  return JSON.stringify(value)
}

export const SimpleJSON = ({ humanizeKeys = false, json, quoteStrings = true }) => {
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
              displayValue(value, quoteStrings)
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

  return (
    <Section title='Permit2 Authority'>
      <SimpleJSON
        humanizeKeys
        quoteStrings={false}
        json={{
          authorityType: authority.kind === 'allowance' ? 'Standing allowance' : 'One-time transfer',
          spender: authority.spender,
          verifyingContract: authority.verifyingContract,
          canonicalContract: authority.canonicalContract ? 'Yes' : 'No',
          signatureDeadlineUnixSeconds: authority.deadline,
          batch: authority.batch ? 'Yes' : 'No',
          witnessData: authority.witness ? 'Included' : 'None',
          permissions: authority.permissions.map(({ token, amount, expiration }) => ({
            token,
            amountBaseUnits: amount,
            ...(expiration === undefined ? {} : { expirationUnixSeconds: expiration })
          }))
        }}
      />
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
            requestChain,
            signatureVersion: typedMessage.version,
            primaryType: structured ? typedMessage.data.primaryType : 'Legacy fields'
          }}
        />
      </Section>
      <TypedDataWarnings context={context} />
      <Permit2Authority authority={context?.permit2} />
      <Eip3009Authorization authorization={context?.eip3009} />
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
      <div className='txViewData'>
        <div className='txViewDataHeader'>Typed Data Review</div>
        <div className='signTypedDataInner'>
          <SigningContext {...{ chainName, context, origin, originName, typedMessage }} />
          <TypedDataDeviceWarning warning={deviceWarning} />
          {Array.isArray(typedMessage.data) ? (
            <LegacyTypedData typedData={typedMessage.data} />
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
