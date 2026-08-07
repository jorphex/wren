import { v5 as uuid } from 'uuid'

import {
  enforceRequestOriginAuthorization,
  isRequestOriginAuthorized
} from '../../../main/rpc/requestAuthorization'

const origin = 'https://alpha.example'
const request = { type: 'transaction', origin: uuid(origin, uuid.DNS) }

it('authorizes a request only while its external origin permission is enabled', () => {
  expect(
    isRequestOriginAuthorized(request, {
      permission: { origin, provider: true }
    })
  ).toBe(true)
  expect(
    isRequestOriginAuthorized(request, {
      permission: { origin, provider: false }
    })
  ).toBe(false)
  expect(isRequestOriginAuthorized(request, {})).toBe(false)
})

it('does not authorize a different origin with the same account permission set', () => {
  expect(
    isRequestOriginAuthorized(
      { ...request, origin: uuid('https://other.example', uuid.DNS) },
      { permission: { origin, provider: true } }
    )
  ).toBe(false)
})

it.each(['frame-internal', 'frame-extension'])(
  'requires account authorization before %s can request signing',
  (trustedOrigin) => {
    expect(
      isRequestOriginAuthorized({ type: 'transaction', origin: uuid(trustedOrigin, uuid.DNS) }, {})
    ).toBe(false)
  }
)

it('allows an access request to establish permission', () => {
  expect(isRequestOriginAuthorized({ type: 'access', origin: request.origin }, {})).toBe(true)
})

it('rejects an unauthorized approval against its stored account and handler', () => {
  const reject = jest.fn()
  const approvalRequest = {
    ...request,
    account: '0x0000000000000000000000000000000000000001',
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
      account: '0x0000000000000000000000000000000000000001',
      handlerId: 'request-id'
    },
    { permission: { origin, provider: true } },
    reject
  )

  expect(error).toBeUndefined()
  expect(reject).not.toHaveBeenCalled()
})
