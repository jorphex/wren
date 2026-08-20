import {
  FRAME_SEND_DISPLAY_NAME,
  FRAME_SEND_ORIGIN,
  WREN_DEPLOY_DISPLAY_NAME,
  WREN_DEPLOY_ORIGIN,
  WREN_INTERNAL_DISPLAY_NAME,
  WREN_INTERNAL_ORIGIN,
  getManagedOriginNameForId,
  getOriginDisplayName,
  isManagedOriginName,
  isWrenOwnedOriginName,
  originIdForInvoker
} from '../../../../resources/domain/origin'

test('uses a friendly name for the exact built-in Send origin', () => {
  expect(getOriginDisplayName(FRAME_SEND_ORIGIN)).toBe(FRAME_SEND_DISPLAY_NAME)
})

test('defines a distinct exact managed deployment principal and friendly display name', () => {
  const deployId = originIdForInvoker(WREN_DEPLOY_ORIGIN, { provenance: 'managed' })
  const sendId = originIdForInvoker(FRAME_SEND_ORIGIN, { provenance: 'managed' })

  expect(WREN_DEPLOY_ORIGIN).toBe('http://deploy.wren.localhost:8421')
  expect(deployId).toBe('ae9af752-884b-5edc-a215-5d472486a6b9')
  expect(deployId).not.toBe(sendId)
  expect(getOriginDisplayName(WREN_DEPLOY_ORIGIN)).toBe(WREN_DEPLOY_DISPLAY_NAME)
  expect(getManagedOriginNameForId(deployId)).toBe(WREN_DEPLOY_ORIGIN)
})

test('classifies only exact Wren-owned origin names', () => {
  expect(isManagedOriginName(FRAME_SEND_ORIGIN)).toBe(true)
  expect(isManagedOriginName(WREN_DEPLOY_ORIGIN)).toBe(true)
  expect(isWrenOwnedOriginName(WREN_INTERNAL_ORIGIN)).toBe(true)
  expect(isWrenOwnedOriginName('frame-extension')).toBe(true)
  expect(isManagedOriginName(`${WREN_DEPLOY_ORIGIN}/`)).toBe(false)
  expect(isWrenOwnedOriginName('https://app.example')).toBe(false)
})

test('does not expose the inherited internal origin identifier', () => {
  expect(getOriginDisplayName(WREN_INTERNAL_ORIGIN)).toBe(WREN_INTERNAL_DISPLAY_NAME)
})

test.each([
  'https://send.frame.eth.localhost:8421',
  'http://send.frame.eth.localhost:8421/',
  'http://send.frame.eth.localhost:8421.example.com',
  'https://deploy.wren.localhost:8421',
  'http://deploy.wren.localhost:8421/'
])('does not label a lookalike origin: %s', (origin) => {
  expect(getOriginDisplayName(origin)).toBe(origin)
})

test('provides a safe fallback for absent origin metadata', () => {
  expect(getOriginDisplayName(undefined)).toBe('Unknown origin')
  expect(getOriginDisplayName('')).toBe('Unknown origin')
})
