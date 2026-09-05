import { SimpleJSON, Section } from '../../../../../resources/Components/SimpleTypedData'

const RISK_MESSAGES = {
  'legacy-eth-sign': () =>
    'Dangerous legacy eth_sign request. Wren applies the EIP-191 personal-message prefix for compatibility.',
  'opaque-message': () =>
    'This message is opaque hexadecimal data. Its meaning cannot be verified before signing.',
  'siwe-malformed': () => 'This message looks like Sign-In with Ethereum but does not conform to ERC-4361.',
  'siwe-origin-unverified': ({ origin }) =>
    `Wren can compare only the stored origin label (${
      origin || 'Unknown'
    }); native clients are not authenticated.`,
  'siwe-origin-mismatch': ({ origin, siwe }) =>
    `The SIWE domain (${siwe?.domain || 'Unknown'}) does not match the request origin label (${
      origin || 'Unknown'
    }).`,
  'siwe-address-mismatch': ({ account, siwe }) =>
    `The SIWE address (${siwe?.address || 'Unknown'}) does not match the signing account (${account}).`,
  'siwe-chain-mismatch': ({ requestChainId, siwe }) =>
    `The SIWE chain (${siwe?.chainId}) does not match the request chain (${requestChainId}).`,
  'siwe-expired': () => 'This SIWE request has expired.',
  'siwe-not-yet-valid': () => 'This SIWE request is not valid yet.',
  'siwe-issued-in-future': () => 'This SIWE request has an issue time in the future.'
}

const MessageWarnings = ({ account, context }) => {
  const risks = context?.risks || []

  return risks.length ? (
    <div className='messageSigningWarnings' aria-label='Signing warnings'>
      {risks.map((risk) => {
        const message = RISK_MESSAGES[risk]
        return message ? (
          <div key={risk} className='messageSigningWarning' role='alert'>
            {message({ account, ...context })}
          </div>
        ) : null
      })}
    </div>
  ) : null
}

const presentFields = (fields) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

const getRequestClass = (status) => {
  const suffix = status ? status[0].toUpperCase() + status.slice(1) : ''
  return `signerRequest${suffix ? ` signerRequest${suffix}` : ''}`
}

export const getMessageReviewPresentation = (context = {}) => ({
  eyebrow: context.siwe ? 'Sign-In with Ethereum' : 'Message signature',
  title: context.siwe ? 'Review sign-in request' : 'Sign a message',
  help: context.siwe
    ? 'Verify the domain, account, network, and exact sign-in statement.'
    : 'This signature can verify control of this account but does not submit a transaction.',
  status: context.siwe
    ? 'SIWE structure recognized'
    : context.encoding === 'utf8'
      ? 'Readable text message'
      : 'Opaque message data'
})

const MessageReviewSummary = ({ context }) => {
  const presentation = getMessageReviewPresentation(context)

  return (
    <div className='typedDataReviewSummary messageReviewSummary'>
      <div className='typedDataReviewSummaryMain'>
        <div className='typedDataReviewEyebrow'>{presentation.eyebrow}</div>
        <div className='typedDataReviewTitle'>{presentation.title}</div>
      </div>
    </div>
  )
}

const SiweReview = ({ siwe }) => (
  <>
    <Section title='Sign-In Request'>
      <SimpleJSON
        copyableKeys={{ address: 'SIWE account address' }}
        humanizeKeys
        json={presentFields({
          scheme: siwe.scheme,
          domain: siwe.domain,
          address: siwe.address,
          statement: siwe.statement,
          uri: siwe.uri,
          version: siwe.version,
          chainId: siwe.chainId,
          nonce: siwe.nonce,
          issuedAt: siwe.issuedAt,
          expirationTime: siwe.expirationTime,
          notBefore: siwe.notBefore,
          requestId: siwe.requestId,
          resources: siwe.resources
        })}
      />
    </Section>
  </>
)

const SignatureRequest = ({ req, originName, chainData = {} }) => {
  const { account, data, id, handlerId, status, type } = req
  const { context, decodedMessage } = data
  const requestChain = `${chainData.requestChainName || 'Unknown chain'} (${context.requestChainId})`
  const method = context.method === 'eth_sign' ? 'eth_sign (EIP-191-prefixed by Wren)' : 'personal_sign'
  const requestClass = getRequestClass(status)

  return type === 'sign' ? (
    <div key={id || handlerId} className={requestClass}>
      <div className='accountViewScroll cardShow'>
        <div className='txViewData signingReview messageSigningReview'>
          <MessageReviewSummary context={context} />
          <Section first title='Signing Context'>
            <SimpleJSON
              copyableKeys={{ account: 'signing account address' }}
              humanizeKeys
              quoteStrings={false}
              json={{
                origin: originName || context.origin || 'Unknown origin',
                account,
                requestNetwork: requestChain
              }}
            />
          </Section>
          <MessageWarnings account={account} context={context} />
          {context.siwe ? <SiweReview siwe={context.siwe} /> : null}
          <Section title={context.siwe ? 'Exact Signed Message' : 'Message'}>
            <div className='signMessageRaw'>{decodedMessage || '""'}</div>
          </Section>
          <details className='signingRawDisclosure'>
            <summary>Signature details</summary>
            <SimpleJSON
              humanizeKeys
              quoteStrings={false}
              json={{
                method,
                encoding: context.encoding === 'utf8' ? 'UTF-8 text' : 'Opaque hex',
                bytes: context.byteLength
              }}
            />
          </details>
        </div>
      </div>
    </div>
  ) : (
    <div className='unknownType'>{'Unknown: ' + type}</div>
  )
}

export default SignatureRequest
