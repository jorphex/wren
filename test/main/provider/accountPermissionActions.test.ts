import { FRAME_SEND_ORIGIN, originIdForName } from '../../../resources/domain/origin'
import { applyAccountPermissionRendererAction } from '../../../main/provider/accountPermissionActions'

const account = '0x0000000000000000000000000000000000000001'
const externalOrigin = 'https://alpha.example'
const disabledOrigin = 'https://disabled.example'
const permissions = {
  managed: { handlerId: 'managed', origin: FRAME_SEND_ORIGIN, provider: true },
  external: { handlerId: 'external', origin: externalOrigin, provider: true },
  disabled: { handlerId: 'disabled', origin: disabledOrigin, provider: false }
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
    mutate: jest.fn()
  }
  return { accounts, provider, dependencies }
}

it('disables an external permission and rejects its untouched pending requests', () => {
  const { accounts, provider, dependencies } = setup()

  expect(
    applyAccountPermissionRendererAction(
      'toggleAccess',
      [account.toUpperCase(), 'external', false],
      dependencies
    )
  ).toBe(true)

  expect(dependencies.getPermissions).toHaveBeenCalledWith(account)
  expect(dependencies.mutate).toHaveBeenCalledWith(account, 'external', false)
  expect(provider.accountsChanged).toHaveBeenCalledWith([account], [originIdForName(externalOrigin)])
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, [
    originIdForName(externalOrigin)
  ])
})

it('clears external permissions while preserving managed access and rejecting only enabled origins', () => {
  const { accounts, provider, dependencies } = setup()

  expect(applyAccountPermissionRendererAction('clearPermissions', [account], dependencies)).toBe(true)

  expect(dependencies.mutate).toHaveBeenCalledWith(account)
  expect(provider.accountsChanged).toHaveBeenCalledWith([account], undefined)
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, [
    originIdForName(externalOrigin)
  ])
})

it('still rejects revoked-origin requests when subscription delivery fails after mutation', () => {
  const { accounts, provider, dependencies } = setup()
  provider.accountsChanged.mockImplementation(() => {
    throw new Error('subscription delivery failed')
  })

  expect(() =>
    applyAccountPermissionRendererAction('toggleAccess', [account, 'external', false], dependencies)
  ).toThrow('subscription delivery failed')
  expect(dependencies.mutate).toHaveBeenCalledWith(account, 'external', false)
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, [
    originIdForName(externalOrigin)
  ])
})

it.each([
  ['missing permission', ['toggleAccess', [account, 'missing', false]]],
  ['unchanged desired state', ['toggleAccess', [account, 'external', true]]],
  ['managed permission', ['toggleAccess', [account, 'managed', false]]]
])('ignores %s without mutation or provider events', (_label, [action, args]) => {
  const { accounts, provider, dependencies } = setup()

  expect(
    applyAccountPermissionRendererAction(action as 'toggleAccess', args as unknown[], dependencies)
  ).toBe(false)
  expect(dependencies.mutate).not.toHaveBeenCalled()
  expect(provider.accountsChanged).not.toHaveBeenCalled()
  expect(accounts.rejectUnapprovedRequestsForOrigins).not.toHaveBeenCalled()
})

it('ignores clearing when only managed Wren Send access remains', () => {
  const { accounts, provider, dependencies } = setup({ managed: permissions.managed })

  expect(applyAccountPermissionRendererAction('clearPermissions', [account], dependencies)).toBe(false)
  expect(dependencies.mutate).not.toHaveBeenCalled()
  expect(provider.accountsChanged).not.toHaveBeenCalled()
  expect(accounts.rejectUnapprovedRequestsForOrigins).not.toHaveBeenCalled()
})
