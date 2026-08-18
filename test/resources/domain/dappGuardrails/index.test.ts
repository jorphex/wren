import {
  DappGuardrailIntentSchema,
  DappGuardrailSchema,
  DappGuardrailsSchema,
  evaluateDappGuardrail,
  lookupDappGuardrail,
  MAX_DAPP_GUARDRAIL_ENTRIES
} from '../../../../resources/domain/dappGuardrails'

const account = '0x0000000000000000000000000000000000000001'
const target = '0x0000000000000000000000000000000000000002'
const spender = '0x0000000000000000000000000000000000000003'
const token = '0x0000000000000000000000000000000000000004'
const originId = 'permission-handler-id'
const chainId = '0x1'

const guardrail = (restriction: Record<string, unknown> = { targets: [target] }) => ({
  version: 1,
  account,
  originId,
  chainId,
  mode: 'block',
  ...restriction,
  createdAt: 10,
  updatedAt: 10,
  revision: 1
})

const intent = (override: Record<string, unknown> = {}) => ({
  targets: [target],
  nativeValue: '0x0',
  tokenAmounts: [],
  spenders: [],
  unverifiable: [],
  ...override
})

test('accepts strict normalized v1 guardrails and exact principal lookup', () => {
  const record = guardrail({
    targets: [],
    spenders: [spender],
    nativeValueCeiling: '0x0',
    tokenCeilings: [{ token, amount: `0x${'f'.repeat(64)}` }],
    expiresAt: 20
  })
  const state = { [account]: { [originId]: { [chainId]: record } } }

  expect(DappGuardrailsSchema.parse(state)).toEqual(state)
  expect(lookupDappGuardrail(state, { account, originId, chainId })).toEqual(record)
  expect(lookupDappGuardrail(state, { account, originId, chainId: '0x2' })).toBeUndefined()
})

test('requires at least one restriction while preserving empty deny-all lists', () => {
  expect(() => DappGuardrailSchema.parse(guardrail({}))).toThrow()
  expect(() => DappGuardrailSchema.parse(guardrail({ targets: undefined }))).toThrow()
  expect(DappGuardrailSchema.parse(guardrail({ targets: [] })).targets).toEqual([])
  expect(DappGuardrailSchema.parse(guardrail({ tokenCeilings: [] })).tokenCeilings).toEqual([])
})

test('rejects malformed, noncanonical, unsorted, duplicate, and overflowing policy values', () => {
  const invalidRecords = [
    { ...guardrail(), extra: true },
    { ...guardrail(), account: `0x${'A'.repeat(40)}` },
    { ...guardrail(), chainId: '0x01' },
    { ...guardrail(), chainId: '0x20000000000000' },
    guardrail({ nativeValueCeiling: '0x00' }),
    guardrail({ nativeValueCeiling: `0x1${'0'.repeat(64)}` }),
    guardrail({ targets: [target, target] }),
    guardrail({ targets: [spender, target] }),
    guardrail({ tokenCeilings: [{ token, amount: '0x01' }] }),
    { ...guardrail(), updatedAt: 9 },
    { ...guardrail(), revision: 0 }
  ]

  invalidRecords.forEach((record) => expect(DappGuardrailSchema.safeParse(record).success).toBe(false))
})

test('rejects cross-key principal mismatches and nesting overflow instead of dropping entries', () => {
  const record = guardrail()
  expect(DappGuardrailsSchema.safeParse({ [account]: { other: { [chainId]: record } } }).success).toBe(false)
  expect(DappGuardrailsSchema.safeParse({ [account]: { [originId]: { '0x2': record } } }).success).toBe(false)

  const origins = Object.fromEntries(
    Array.from({ length: MAX_DAPP_GUARDRAIL_ENTRIES + 1 }, (_, index) => {
      const id = `origin-${index}`
      return [id, { [chainId]: { ...record, originId: id } }]
    })
  )
  expect(DappGuardrailsSchema.safeParse({ [account]: origins }).success).toBe(false)

  const addresses = Array.from(
    { length: MAX_DAPP_GUARDRAIL_ENTRIES + 1 },
    (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`
  )
  expect(DappGuardrailSchema.safeParse(guardrail({ targets: addresses })).success).toBe(false)
  expect(
    DappGuardrailSchema.safeParse(
      guardrail({ tokenCeilings: addresses.map((entry) => ({ token: entry, amount: '0x0' })) })
    ).success
  ).toBe(false)
  expect(() => lookupDappGuardrail({ malformed: true }, { account, originId, chainId })).toThrow()
})

test('requires deterministic aggregate intents', () => {
  expect(DappGuardrailIntentSchema.parse(intent())).toEqual(intent())
  expect(() =>
    DappGuardrailIntentSchema.parse(
      intent({
        tokenAmounts: [
          { token, amount: '0x1' },
          { token, amount: '0x2' }
        ]
      })
    )
  ).toThrow()
  expect(() => DappGuardrailIntentSchema.parse(intent({ unverifiable: ['spenders', 'targets'] }))).toThrow()
})

test('evaluates every configured restriction in deterministic field order', () => {
  const policy = guardrail({
    targets: [],
    spenders: [],
    nativeValueCeiling: '0x1',
    tokenCeilings: [{ token, amount: '0x2' }],
    expiresAt: 20
  })

  expect(
    evaluateDappGuardrail(
      policy,
      intent({
        nativeValue: '0x2',
        tokenAmounts: [
          { token, amount: '0x3' },
          { token: '0x0000000000000000000000000000000000000005', amount: '0x1' }
        ],
        spenders: [spender]
      }),
      20
    ).map(({ code }) => code)
  ).toEqual([
    'expired',
    'target-not-allowed',
    'native-value-exceeded',
    'token-not-allowed',
    'token-amount-exceeded',
    'spender-not-allowed'
  ])
})

test('fails closed on unverifiable relevant fields and ignores unrelated reasons', () => {
  expect(
    evaluateDappGuardrail(
      guardrail({ targets: [target], nativeValueCeiling: '0x1' }),
      intent({ unverifiable: ['targets', 'nativeValue', 'spenders'] }),
      10
    ).map(({ code }) => code)
  ).toEqual(['targets-unverifiable', 'native-value-unverifiable'])
})
