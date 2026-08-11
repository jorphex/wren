import { SignerUserRejectedError, USER_REJECTED_REQUEST } from '../../../main/signers/errors'

describe('SignerUserRejectedError', () => {
  it('preserves the EIP-1193 rejection code for provider responses', () => {
    const error = new SignerUserRejectedError()

    expect(error).toMatchObject({
      name: 'SignerUserRejectedError',
      message: 'User rejected the request',
      code: USER_REJECTED_REQUEST
    })
  })
})
