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

const SiweReview = ({ siwe }) => (
  <>
    <Section title='Sign-In Request'>
      <SimpleJSON
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
        <div className='txViewData'>
          <div className='txViewDataHeader'>Message Signing Review</div>
          <Section first title='Signing Context'>
            <SimpleJSON
              humanizeKeys
              quoteStrings={false}
              json={{
                origin: originName || context.origin || 'Unknown origin',
                account,
                requestChain,
                method,
                encoding: context.encoding === 'utf8' ? 'UTF-8 text' : 'Opaque hex',
                bytes: context.byteLength
              }}
            />
          </Section>
          <MessageWarnings account={account} context={context} />
          {context.siwe ? <SiweReview siwe={context.siwe} /> : null}
          <Section title={context.siwe ? 'Exact Signed Message' : 'Message'}>
            <div className='signMessageRaw'>{decodedMessage || '""'}</div>
          </Section>
        </div>
      </div>
    </div>
  ) : (
    <div className='unknownType'>{'Unknown: ' + type}</div>
  )
}

export default SignatureRequest
