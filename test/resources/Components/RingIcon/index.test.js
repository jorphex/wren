import { fireEvent, render, screen } from '@testing-library/react'

import { RingIconGlyph } from '../../../../resources/Components/RingIcon'

test('uses a symbol initial when a remote token image fails', () => {
  render(<RingIconGlyph alt='USDC' fallback='U' img='https://assets.coingecko.com/usdc.png' />)

  fireEvent.error(screen.getByRole('img', { name: 'USDC' }))

  expect(screen.getByText('U')).toBeTruthy()
  expect(screen.queryByRole('img', { name: 'USDC' })).toBeNull()
})
