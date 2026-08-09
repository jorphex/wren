import { render, screen } from '@testing-library/react'

import { RingIconGlyph } from '../../../../resources/Components/RingIcon'

test.each([
  ['chain', 'network', '0 0 20 20'],
  ['seedling', 'seedling', '0 0 20 20'],
  ['sign', 'sign', '0 0 24 24'],
  ['tokens', 'tokens', '0 0 20 20']
])('routes the inherited %s glyph name through the Wren %s icon', (legacyName, _wrenName, viewBox) => {
  render(<RingIconGlyph alt={legacyName} svgName={legacyName} svgSize={19} />)

  const glyph = screen.getByRole('img', { name: legacyName })
  expect(glyph.getAttribute('viewBox')).toBe(viewBox)
  expect(glyph.getAttribute('width')).toBe('19')
})
