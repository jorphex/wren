import { render, screen } from '../../../../componentSetup'
import { Item } from '../../../../../app/notify/App/styled'

it('renders notification items as column flex containers', () => {
  render(<Item data-testid='notification-item' />)

  const style = window.getComputedStyle(screen.getByTestId('notification-item'))
  expect(style.display).toBe('flex')
  expect(style.flexDirection).toBe('column')
})
