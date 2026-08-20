import { FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN } from '../../../resources/domain/origin'
import { getPermissionIds, isManagedPermission } from '../../../resources/domain/permissions'

const activePermission = (origin) => ({
  version: 1,
  handlerId: origin,
  origin,
  provider: true,
  parentCapability: 'eth_accounts',
  caveats: [
    {
      type: 'wren:permissionScope',
      value: { expiresAt: 2 }
    }
  ]
})

test.each([FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN])(
  'classifies and hides the exact managed permission for %s',
  (origin) => {
    expect(isManagedPermission({ origin })).toBe(true)
    expect(getPermissionIds({ managed: activePermission(origin) }, '', 1)).toEqual([])
  }
)

test('does not classify or hide an unrelated active permission', () => {
  const origin = 'https://app.example'
  expect(isManagedPermission({ origin })).toBe(false)
  expect(getPermissionIds({ external: activePermission(origin) }, '', 1)).toEqual(['external'])
})
