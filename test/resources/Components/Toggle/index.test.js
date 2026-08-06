import Toggle from '../../../../resources/Components/Toggle'
import { render, screen } from '../../../componentSetup'

test('exposes checked state and toggles from keyboard activation', async () => {
  const onChange = jest.fn()
  const { user } = render(<Toggle checked={false} label='Auto-hide' onChange={onChange} />)
  const toggle = screen.getByRole('switch', { name: 'Auto-hide' })

  expect(toggle.getAttribute('aria-checked')).toBe('false')
  toggle.focus()
  await user.keyboard('[Space]')

  expect(onChange).toHaveBeenCalledWith(true)
})

test('does not toggle while disabled', async () => {
  const onChange = jest.fn()
  const { user } = render(<Toggle checked={false} disabled label='Auto-hide' onChange={onChange} />)

  await user.click(screen.getByRole('switch', { name: 'Auto-hide' }))

  expect(onChange).not.toHaveBeenCalled()
})
