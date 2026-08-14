import {
  shouldAnimateShell,
  shouldAnimateWorkspaceClose,
  shouldAnimateWorkspaceOpen,
  shouldSuppressRepeatedShow
} from '../../../main/windows/displayTransition'

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

it('keeps a cold workspace opening deterministic until its renderer has loaded', () => {
  expect(shouldAnimateWorkspaceOpen(false, true, false, false)).toBe(false)
  expect(shouldAnimateWorkspaceOpen(true, true, false, false)).toBe(true)
  expect(shouldAnimateWorkspaceOpen(true, true, false, true)).toBe(false)
  expect(shouldAnimateWorkspaceOpen(true, false, false, false)).toBe(false)
  expect(shouldAnimateWorkspaceOpen(true, true, true, false)).toBe(false)
})

it('animates a visible workspace closing unless reduced motion is preferred', () => {
  expect(shouldAnimateWorkspaceClose(true, false, false)).toBe(true)
  expect(shouldAnimateWorkspaceClose(true, false, true)).toBe(false)
  expect(shouldAnimateWorkspaceClose(false, false, false)).toBe(false)
  expect(shouldAnimateWorkspaceClose(true, true, false)).toBe(false)
})
