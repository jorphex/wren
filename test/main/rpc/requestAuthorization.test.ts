import {
  enforceRequestOriginAuthorization,
  isCurrentRequestOriginAuthorized,
  isRequestOriginAuthorized
} from '../../../main/rpc/requestAuthorization'
import { createAccountPermission } from '../../../main/provider/permissions'
import { FRAME_SEND_ORIGIN, originIdForInvoker } from '../../../resources/domain/origin'

const origin = 'https://alpha.example'
const account = '0x0000000000000000000000000000000000000001'
const originId = originIdForInvoker(origin, { provenance: 'direct' })
const request = {
  type: 'transaction',
  origin: originId,
  account,
  data: { chainId: '0x1' },
  payload: { method: 'eth_sendTransaction' }
}
const permission = createAccountPermission({ account, chains: [1], handlerId: originId, origin })
const directPrincipalState = {
  origins: {
    [originId]: {
      chain: { id: 1, type: 'ethereum' as const },
      name: origin,
      provenance: 'direct' as const,
      sessionOnly: false,
      session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
    }
  },
  extensionCredentials: {},
  nativePeerCredentials: {}
}

it('authorizes a request only while its external origin permission is enabled', () => {
  expect(
    isRequestOriginAuthorized(request, {
      [originId]: permission
    })
  ).toBe(true)
  expect(
    isRequestOriginAuthorized(request, {
      [originId]: { origin, provider: false }
    })
  ).toBe(false)
  expect(isRequestOriginAuthorized(request, {})).toBe(false)
})

it('does not authorize a different origin with the same account permission set', () => {
  expect(
    isRequestOriginAuthorized(
      { ...request, origin: originIdForInvoker('https://other.example', { provenance: 'direct' }) },
      { [originId]: permission }
    )
  ).toBe(false)
})

it.each(['frame-internal', 'frame-extension'])(
  'requires account authorization before %s can request signing',
  (trustedOrigin) => {
    expect(
      isRequestOriginAuthorized(
        {
          ...request,
          origin: originIdForInvoker(trustedOrigin, { provenance: 'direct' })
        },
        {}
      )
    ).toBe(false)
  }
)

it('allows an access request to establish permission', () => {
  expect(isRequestOriginAuthorized({ type: 'access', origin: request.origin }, {})).toBe(true)
})

it('allows the application-owned Send surface without a persisted external grant', () => {
  expect(
    isRequestOriginAuthorized(
      {
        ...request,
        origin: originIdForInvoker(FRAME_SEND_ORIGIN, { provenance: 'managed' })
      },
      {}
    )
  ).toBe(true)
})

it('keeps a locally-created cancel recoverable after its original dapp is disconnected', () => {
  const cancel = {
    ...request,
    replacement: { kind: 'cancel' }
  }

  expect(isRequestOriginAuthorized(cancel, {})).toBe(true)
  expect(
    isCurrentRequestOriginAuthorized(
      cancel,
      {},
      {
        origins: {},
        extensionCredentials: {},
        nativePeerCredentials: {}
      }
    )
  ).toBe(true)
})

it('does not exempt speed-ups or non-transaction requests from origin authorization', () => {
  expect(isRequestOriginAuthorized({ ...request, replacement: { kind: 'speed' } }, {})).toBe(false)
  expect(
    isRequestOriginAuthorized({ ...request, type: 'message', replacement: { kind: 'cancel' } }, {})
  ).toBe(false)
})

it('revalidates the exact direct principal and permission at the final signer boundary', () => {
  expect(isCurrentRequestOriginAuthorized(request, { [originId]: permission }, directPrincipalState)).toBe(
    true
  )
  expect(isCurrentRequestOriginAuthorized(request, {}, directPrincipalState)).toBe(false)
  expect(
    isCurrentRequestOriginAuthorized(
      request,
      { [originId]: permission },
      {
        ...directPrincipalState,
        origins: {
          [originId]: { ...directPrincipalState.origins[originId], name: 'https://forged.example' }
        }
      }
    )
  ).toBe(false)
})

it('rejects a stale source-bound permission when its credential is absent', () => {
  const sourceId = 'A'.repeat(43)
  const companionOriginId = originIdForInvoker(origin, { provenance: 'companion', sourceId })
  const companionPermission = createAccountPermission({
    account,
    chains: [1],
    handlerId: companionOriginId,
    origin
  })
  expect(
    isCurrentRequestOriginAuthorized(
      { ...request, origin: companionOriginId },
      { [companionOriginId]: companionPermission },
      {
        origins: {
          [companionOriginId]: {
            chain: { id: 1, type: 'ethereum' },
            name: origin,
            provenance: 'companion',
            sourceId,
            sessionOnly: false,
            session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
          }
        },
        extensionCredentials: {},
        nativePeerCredentials: {}
      }
    )
  ).toBe(false)
})

it('rejects an unauthorized approval against its stored account and handler', () => {
  const reject = jest.fn()
  const approvalRequest = {
    ...request,
    account,
    handlerId: 'request-id'
  }

  const error = enforceRequestOriginAuthorization(approvalRequest, {}, reject)

  expect(reject).toHaveBeenCalledWith(approvalRequest.account, approvalRequest.handlerId, {
    code: 4100,
    message: 'Request origin is no longer authorized'
  })
  expect(error).toMatchObject({ code: 4100, message: 'Request origin is no longer authorized' })
})

it('leaves an authorized approval pending for its normal signer path', () => {
  const reject = jest.fn()
  const error = enforceRequestOriginAuthorization(
    {
      ...request,
      account,
      handlerId: 'request-id'
    },
    { [originId]: permission },
    reject
  )

  expect(error).toBeUndefined()
  expect(reject).not.toHaveBeenCalled()
})
