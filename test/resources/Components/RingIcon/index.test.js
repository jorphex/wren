import { fireEvent, render, screen } from '@testing-library/react'

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

test('uses a symbol initial when a remote token image fails', () => {
  render(<RingIconGlyph alt='USDC' fallback='U' img='https://assets.coingecko.com/usdc.png' />)

  fireEvent.error(screen.getByRole('img', { name: 'USDC' }))

  expect(screen.getByText('U')).toBeTruthy()
  expect(screen.queryByRole('img', { name: 'USDC' })).toBeNull()
})
