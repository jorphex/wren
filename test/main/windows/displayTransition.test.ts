import { shouldAnimateShell, shouldSuppressRepeatedShow } from '../../../main/windows/displayTransition'

it('suppresses only duplicate shows while the tray is already visible', () => {
  expect(shouldSuppressRepeatedShow(true, true)).toBe(true)
  expect(shouldSuppressRepeatedShow(true, false)).toBe(false)
  expect(shouldSuppressRepeatedShow(false, true)).toBe(false)
})

it('animates an already-visible shell unless reduced motion is preferred', () => {
  expect(shouldAnimateShell(true, false)).toBe(true)
  expect(shouldAnimateShell(true, true)).toBe(false)
  expect(shouldAnimateShell(false, false)).toBe(false)
})
