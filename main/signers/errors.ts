export const USER_REJECTED_REQUEST = 4001

export class SignerUserRejectedError extends Error {
  readonly code = USER_REJECTED_REQUEST

  constructor(message = 'User rejected the request') {
    super(message)
    this.name = 'SignerUserRejectedError'
  }
}
