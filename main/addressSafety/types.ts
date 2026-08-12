export type AddressSafetyTarget = Readonly<{
  address: string
  state: 'new' | 'previous' | 'lookalike'
  lastSubmittedAt?: number
}>

export type AddressSafetyAssessment = Readonly<{
  assessedAt: number
  fingerprint: string
  targets: readonly AddressSafetyTarget[]
}>
