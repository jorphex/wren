import { shouldSuppressRepeatedShow } from '../../../main/windows/displayTransition'

it('suppresses only duplicate shows while the tray is already visible', () => {
  expect(shouldSuppressRepeatedShow(true, true)).toBe(true)
  expect(shouldSuppressRepeatedShow(true, false)).toBe(false)
  expect(shouldSuppressRepeatedShow(false, true)).toBe(false)
})
