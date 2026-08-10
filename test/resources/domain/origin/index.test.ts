import {
  FRAME_SEND_DISPLAY_NAME,
  FRAME_SEND_ORIGIN,
  WREN_INTERNAL_DISPLAY_NAME,
  WREN_INTERNAL_ORIGIN,
  getOriginDisplayName
} from '../../../../resources/domain/origin'

test('uses a friendly name for the exact built-in Send origin', () => {
  expect(getOriginDisplayName(FRAME_SEND_ORIGIN)).toBe(FRAME_SEND_DISPLAY_NAME)
})

test('does not expose the inherited internal origin identifier', () => {
  expect(getOriginDisplayName(WREN_INTERNAL_ORIGIN)).toBe(WREN_INTERNAL_DISPLAY_NAME)
})

test.each([
  'https://send.frame.eth.localhost:8421',
  'http://send.frame.eth.localhost:8421/',
  'http://send.frame.eth.localhost:8421.example.com'
])('does not label a lookalike origin: %s', (origin) => {
  expect(getOriginDisplayName(origin)).toBe(origin)
})

test('provides a safe fallback for absent origin metadata', () => {
  expect(getOriginDisplayName(undefined)).toBe('Unknown origin')
  expect(getOriginDisplayName('')).toBe('Unknown origin')
})
