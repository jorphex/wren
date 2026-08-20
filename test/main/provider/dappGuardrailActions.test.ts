import { FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN, originIdForInvoker } from '../../../resources/domain/origin'
import { createAccountPermission } from '../../../main/provider/permissions'
import { applyDappGuardrailRendererAction } from '../../../main/provider/dappGuardrailActions'

const account = '0x1111111111111111111111111111111111111111'
const originName = 'https://app.example'
const originId = originIdForInvoker(originName, { provenance: 'direct' })
const now = 1_800_000_000_000
const body = {
  mode: 'block' as const,
  targets: ['0x2222222222222222222222222222222222222222']
}

const setup = (overrides: Record<string, unknown> = {}) => {
  const permission = createAccountPermission({
    account,
    chains: [1],
    handlerId: originId,
    origin: originName,
    now
  })
  const dependencies = {
    getAccount: jest.fn(() => ({})),
    getPermission: jest.fn(() => permission),
    getOrigin: jest.fn(() => ({
      name: originName,
      provenance: 'direct' as const,
      sessionOnly: false,
      chain: { id: 1, type: 'ethereum' as const },
      session: { requests: 1, startedAt: now, lastUpdatedAt: now }
    })),
    getChain: jest.fn(() => ({ on: true })),
    getCompanionCredential: jest.fn(),
    getNativeCredential: jest.fn(),
    getGuardrails: jest.fn(() => ({})),
    save: jest.fn(),
    remove: jest.fn(),
    onPolicyChanged: jest.fn(),
    now: jest.fn(() => now),
    ...overrides
  }
  return dependencies
}

test('persists only a main-authored canonical policy for the exact current principal', () => {
  const dependencies = setup()

  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId, chainId: '0x1', body },
      dependencies
    )
  ).toBe(true)

  expect(dependencies.save).toHaveBeenCalledWith({
    version: 1,
    account,
    originId,
    chainId: '0x1',
    ...body,
    createdAt: now,
    updatedAt: now,
    revision: 1
  })
  expect(dependencies.onPolicyChanged).toHaveBeenCalledWith(account, originId)
})

test('preserves creation time and increments revision on update', () => {
  const existing = {
    version: 1 as const,
    account,
    originId,
    chainId: '0x1',
    ...body,
    createdAt: now - 100,
    updatedAt: now - 50,
    revision: 4
  }
  const dependencies = setup({
    getGuardrails: jest.fn(() => ({ [account]: { [originId]: { '0x1': existing } } }))
  })

  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId, chainId: '0x1', body: { ...body, mode: 'warn' } },
      dependencies
    )
  ).toBe(true)
  expect(dependencies.save).toHaveBeenCalledWith(
    expect.objectContaining({ createdAt: now - 100, updatedAt: now, revision: 5, mode: 'warn' })
  )
})

test('allows any enabled chain covered by the exact permission, not only the origin default', () => {
  const dependencies = setup({
    getOrigin: jest.fn(() => ({
      name: originName,
      provenance: 'direct' as const,
      sessionOnly: false,
      chain: { id: 10, type: 'ethereum' as const },
      session: { requests: 1, startedAt: now, lastUpdatedAt: now }
    }))
  })
  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId, chainId: '0x1', body },
      dependencies
    )
  ).toBe(true)
})

test('refuses a save that would exceed a bounded state level', () => {
  const guardrailAccounts = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => {
      const storedAccount = `0x${(index + 2).toString(16).padStart(40, '0')}`
      const storedOrigin = `stored-origin-${index}`
      return [
        storedAccount,
        {
          [storedOrigin]: {
            '0x1': {
              version: 1,
              account: storedAccount,
              originId: storedOrigin,
              chainId: '0x1',
              ...body,
              createdAt: now,
              updatedAt: now,
              revision: 1
            }
          }
        }
      ]
    })
  )
  const dependencies = setup({ getGuardrails: jest.fn(() => guardrailAccounts) })
  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId, chainId: '0x1', body },
      dependencies
    )
  ).toBe(false)
  expect(dependencies.save).not.toHaveBeenCalled()
})

test('allows authenticated companion, native, and direct session-bound principals', () => {
  const principals = [
    { provenance: 'direct' as const, origin: 'Unknown/session', sourceId: undefined },
    { provenance: 'companion' as const, origin: originName, sourceId: 'companion-key' },
    { provenance: 'native' as const, origin: 'wren-native', sourceId: 'native-key' }
  ]

  principals.forEach(({ provenance, origin, sourceId }) => {
    const id = originIdForInvoker(origin, sourceId ? { provenance, sourceId } : { provenance })
    const permission = createAccountPermission({ account, chains: [1], handlerId: id, origin, now })
    const dependencies = setup({
      getPermission: jest.fn(() => permission),
      getOrigin: jest.fn(() => ({
        name: origin,
        provenance,
        ...(sourceId ? { sourceId } : {}),
        sessionOnly: provenance === 'direct',
        chain: { id: 1, type: 'ethereum' },
        session: { requests: 1, startedAt: now, lastUpdatedAt: now }
      })),
      getCompanionCredential: jest.fn(() =>
        provenance === 'companion' ? { protocolVersion: 3, fingerprint: sourceId } : undefined
      ),
      getNativeCredential: jest.fn(() =>
        provenance === 'native' ? { protocolVersion: 3, kind: 'native', fingerprint: sourceId } : undefined
      )
    })
    expect(
      applyDappGuardrailRendererAction(
        'saveDappGuardrail',
        { account, originId: id, chainId: '0x1', body },
        dependencies
      )
    ).toBe(true)
  })
})

test('refuses a source-bound principal whose credential is retired', () => {
  const sourceId = 'retired-companion-key'
  const companionId = originIdForInvoker(originName, { provenance: 'companion', sourceId })
  const permission = createAccountPermission({
    account,
    chains: [1],
    handlerId: companionId,
    origin: originName,
    now
  })
  const dependencies = setup({
    getPermission: jest.fn(() => permission),
    getOrigin: jest.fn(() => ({
      name: originName,
      provenance: 'companion' as const,
      sourceId,
      sessionOnly: false,
      chain: { id: 1, type: 'ethereum' as const },
      session: { requests: 1, startedAt: now, lastUpdatedAt: now }
    })),
    getCompanionCredential: jest.fn(() => ({ protocolVersion: 2, fingerprint: sourceId }))
  })
  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId: companionId, chainId: '0x1', body },
      dependencies
    )
  ).toBe(false)
})

test.each([
  ['unknown account', { getAccount: jest.fn() }],
  ['disabled chain', { getChain: jest.fn(() => ({ on: false })) }],
  [
    'forged direct identity',
    {
      getOrigin: jest.fn(() => ({
        name: originName,
        provenance: 'direct',
        sessionOnly: false,
        chain: { id: 1, type: 'ethereum' },
        session: { requests: 1, startedAt: now, lastUpdatedAt: now }
      })),
      getPermission: jest.fn(() =>
        createAccountPermission({ account, chains: [1], handlerId: 'forged', origin: originName, now })
      )
    }
  ],
  [
    'internal principal',
    {
      getOrigin: jest.fn(() => ({
        name: originName,
        provenance: 'internal',
        sessionOnly: false,
        chain: { id: 1, type: 'ethereum' },
        session: { requests: 1, startedAt: now, lastUpdatedAt: now }
      }))
    }
  ]
])('refuses %s without persistence', (_label, overrides) => {
  const dependencies = setup(overrides)
  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId, chainId: '0x1', body },
      dependencies
    )
  ).toBe(false)
  expect(dependencies.save).not.toHaveBeenCalled()
  expect(dependencies.onPolicyChanged).not.toHaveBeenCalled()
})

test.each([FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN])(
  'never treats the managed origin %s as an external guardrail principal',
  (managedOrigin) => {
    const managedId = originIdForInvoker(managedOrigin, { provenance: 'managed' })
    const dependencies = setup({
      getOrigin: jest.fn(() => ({
        name: managedOrigin,
        provenance: 'managed' as const,
        sessionOnly: false,
        chain: { id: 1, type: 'ethereum' as const },
        session: { requests: 1, startedAt: now, lastUpdatedAt: now }
      })),
      getPermission: jest.fn(() =>
        createAccountPermission({
          account,
          chains: [1],
          handlerId: managedId,
          origin: managedOrigin,
          now
        })
      )
    })

    expect(
      applyDappGuardrailRendererAction(
        'saveDappGuardrail',
        { account, originId: managedId, chainId: '0x1', body },
        dependencies
      )
    ).toBe(false)
    expect(dependencies.save).not.toHaveBeenCalled()
  }
)

test('rejects renderer-owned metadata and removes only an existing policy', () => {
  const existing = {
    version: 1 as const,
    account,
    originId,
    chainId: '0x1',
    ...body,
    createdAt: now,
    updatedAt: now,
    revision: 1
  }
  const dependencies = setup({
    getGuardrails: jest.fn(() => ({ [account]: { [originId]: { '0x1': existing } } }))
  })

  expect(
    applyDappGuardrailRendererAction(
      'saveDappGuardrail',
      { account, originId, chainId: '0x1', body: { ...body, revision: 99 } },
      dependencies
    )
  ).toBe(false)
  expect(
    applyDappGuardrailRendererAction(
      'removeDappGuardrail',
      { account, originId, chainId: '0x1' },
      dependencies
    )
  ).toBe(true)
  expect(dependencies.remove).toHaveBeenCalledWith({ account, originId, chainId: '0x1' })
})

test('allows exact local removal after the chain or permission becomes unavailable', () => {
  const existing = {
    version: 1 as const,
    account,
    originId,
    chainId: '0x1',
    ...body,
    createdAt: now,
    updatedAt: now,
    revision: 1
  }
  const dependencies = setup({
    getPermission: jest.fn(),
    getChain: jest.fn(),
    getGuardrails: jest.fn(() => ({ [account]: { [originId]: { '0x1': existing } } }))
  })

  expect(
    applyDappGuardrailRendererAction(
      'removeDappGuardrail',
      { account, originId, chainId: '0x1' },
      dependencies
    )
  ).toBe(true)
  expect(dependencies.remove).toHaveBeenCalledWith({ account, originId, chainId: '0x1' })
})
