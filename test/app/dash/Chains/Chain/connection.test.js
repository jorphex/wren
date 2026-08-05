import { presetLabel } from '../../../../../app/dash/Chains/Chain/Connection'

it('presents the PublicNode preset with its provider name', () => {
  expect(presetLabel('publicnode')).toBe('PublicNode')
  expect(presetLabel('custom')).toBe('custom')
})
