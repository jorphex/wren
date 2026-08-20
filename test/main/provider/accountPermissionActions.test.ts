import { FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN, originIdForInvoker } from '../../../resources/domain/origin'
import { applyAccountPermissionRendererAction } from '../../../main/provider/accountPermissionActions'

const account = '0x0000000000000000000000000000000000000001'
const externalOrigin = 'https://alpha.example'
const disabledOrigin = 'https://disabled.example'
const externalId = originIdForInvoker(externalOrigin, { provenance: 'direct' })
const disabledId = originIdForInvoker(disabledOrigin, { provenance: 'direct' })
const permissions = {
  managed: { handlerId: 'managed', origin: FRAME_SEND_ORIGIN, provider: true },
  deployment: { handlerId: 'deployment', origin: WREN_DEPLOY_ORIGIN, provider: true },
  [externalId]: { handlerId: externalId, origin: externalOrigin, provider: true },
  [disabledId]: { handlerId: disabledId, origin: disabledOrigin, provider: false }
}

const setup = (storedPermissions = permissions) => {
  const accounts = {
    getSelectedAddresses: jest.fn(() => [account]),
    rejectUnapprovedRequestsForOrigins: jest.fn(() => true)
  }
  const provider = { accountsChanged: jest.fn() }
  const dependencies = {
    accounts,
    provider,
    getPermissions: jest.fn(() => storedPermissions),
    mutate: jest.fn(),
    removeGuardrails: jest.fn()
  }
  return { accounts, provider, dependencies }
}

it('disables an external permission and rejects its untouched pending requests', () => {
  const { accounts, provider, dependencies } = setup()

  expect(
    applyAccountPermissionRendererAction(
      'toggleAccess',
      [account.toUpperCase(), externalId, false],
      dependencies
    )
  ).toBe(true)

  expect(dependencies.getPermissions).toHaveBeenCalledWith(account)
  expect(dependencies.mutate).toHaveBeenCalledWith(account, externalId, false)
  expect(dependencies.removeGuardrails).toHaveBeenCalledWith(account, [externalId])
  expect(provider.accountsChanged).toHaveBeenCalledWith([account], [externalId])
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, [externalId])
})

it('clears external permissions while preserving managed access and rejecting only enabled origins', () => {
  const { accounts, provider, dependencies } = setup()

  expect(applyAccountPermissionRendererAction('clearPermissions', [account], dependencies)).toBe(true)

  expect(dependencies.mutate).toHaveBeenCalledWith(account)
  expect(dependencies.removeGuardrails).toHaveBeenCalledWith(account, [externalId, disabledId])
  expect(provider.accountsChanged).toHaveBeenCalledWith([account], undefined)
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, [externalId, disabledId])
})

it('still rejects revoked-origin requests when subscription delivery fails after mutation', () => {
  const { accounts, provider, dependencies } = setup()
  provider.accountsChanged.mockImplementation(() => {
    throw new Error('subscription delivery failed')
  })

  expect(() =>
    applyAccountPermissionRendererAction('toggleAccess', [account, externalId, false], dependencies)
  ).toThrow('subscription delivery failed')
  expect(dependencies.mutate).toHaveBeenCalledWith(account, externalId, false)
  expect(dependencies.removeGuardrails).toHaveBeenCalledWith(account, [externalId])
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, [externalId])
})

it.each([
  ['missing permission', ['toggleAccess', [account, 'missing', false]]],
  ['unchanged desired state', ['toggleAccess', [account, externalId, true]]],
  ['managed permission', ['toggleAccess', [account, 'managed', false]]]
])('ignores %s without mutation or provider events', (_label, [action, args]) => {
  const { accounts, provider, dependencies } = setup()

  expect(
    applyAccountPermissionRendererAction(action as 'toggleAccess', args as unknown[], dependencies)
  ).toBe(false)
  expect(dependencies.mutate).not.toHaveBeenCalled()
  expect(dependencies.removeGuardrails).not.toHaveBeenCalled()
  expect(provider.accountsChanged).not.toHaveBeenCalled()
  expect(accounts.rejectUnapprovedRequestsForOrigins).not.toHaveBeenCalled()
})

it('ignores clearing when only managed Wren access remains', () => {
  const { accounts, provider, dependencies } = setup({
    managed: permissions.managed,
    deployment: permissions.deployment
  })

  expect(applyAccountPermissionRendererAction('clearPermissions', [account], dependencies)).toBe(false)
  expect(dependencies.mutate).not.toHaveBeenCalled()
  expect(dependencies.removeGuardrails).not.toHaveBeenCalled()
  expect(provider.accountsChanged).not.toHaveBeenCalled()
  expect(accounts.rejectUnapprovedRequestsForOrigins).not.toHaveBeenCalled()
})

it.each(['managed', 'deployment'])('never toggles the %s permission from the external-app UI', (id) => {
  const { provider, dependencies } = setup()

  expect(applyAccountPermissionRendererAction('toggleAccess', [account, id, false], dependencies)).toBe(false)
  expect(dependencies.mutate).not.toHaveBeenCalled()
  expect(provider.accountsChanged).not.toHaveBeenCalled()
})
