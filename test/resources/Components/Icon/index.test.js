import { render, screen } from '@testing-library/react'

import Icon, { iconNames } from '../../../../resources/Components/Icon'

test('renders decorative icons outside the accessibility tree', () => {
  render(<Icon data-testid='icon' name='accounts' size={20} />)
  const icon = screen.getByTestId('icon')

  expect(icon.getAttribute('aria-hidden')).toBe('true')
  expect(icon.getAttribute('focusable')).toBe('false')
  expect(icon.getAttribute('height')).toBe('20')
  expect(icon.getAttribute('width')).toBe('20')
})

test('supports a label when an icon conveys standalone meaning', () => {
  render(<Icon label='Connected' name='check' />)

  expect(screen.getByRole('img', { name: 'Connected' })).toBeTruthy()
})

test('publishes unique names and rejects unknown icons', () => {
  expect(new Set(iconNames).size).toBe(iconNames.length)
  expect(() => render(<Icon name='missing' />)).toThrow('Unknown Wren icon: missing')
})

test('renders every published icon alias', () => {
  render(
    <>
      {iconNames.map((name) => (
        <Icon data-testid='published-icon' key={name} name={name} />
      ))}
    </>
  )

  expect(screen.getAllByTestId('published-icon')).toHaveLength(iconNames.length)
})
