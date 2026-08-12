import {
  enforceRequestOriginAuthorization,
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
