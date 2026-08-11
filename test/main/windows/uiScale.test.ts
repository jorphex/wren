import {
  getEffectiveInterfaceScale,
  INTERFACE_SCALES,
  normalizeInterfaceScale
} from '../../../main/windows/uiScale'

describe('interface scale', () => {
  it('accepts only supported requested scales', () => {
    expect(INTERFACE_SCALES).toEqual([1, 1.25, 1.5])
    expect(INTERFACE_SCALES.map(normalizeInterfaceScale)).toEqual([1, 1.25, 1.5])
    expect([undefined, null, 0, 1.1, 2, '1.25'].map(normalizeInterfaceScale)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('chooses the largest requested scale whose minimum viewport fits', () => {
    expect(getEffectiveInterfaceScale(1.5, { width: 1140, height: 1116 })).toBe(1.5)
    expect(getEffectiveInterfaceScale(1.5, { width: 1139, height: 1116 })).toBe(1.25)
    expect(getEffectiveInterfaceScale(1.5, { width: 950, height: 930 })).toBe(1.25)
    expect(getEffectiveInterfaceScale(1.5, { width: 949, height: 930 })).toBe(1)
    expect(getEffectiveInterfaceScale(1.25, { width: 4000, height: 3000 })).toBe(1.25)
  })

  it('falls back to one on undersized work areas and invalid requests', () => {
    expect(getEffectiveInterfaceScale(1.5, { width: 759, height: 743 })).toBe(1)
    expect(getEffectiveInterfaceScale(9, { width: 4000, height: 3000 })).toBe(1)
  })
})
