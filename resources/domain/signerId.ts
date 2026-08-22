export const SIGNER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

export const isSafeSignerId = (value: unknown): value is string =>
  typeof value === 'string' && SIGNER_ID_PATTERN.test(value)
