import { render, screen } from '../../../componentSetup'
import WrenEmptyState from '../../../../resources/Components/WrenEmptyState'

it('marks alpha-backed artwork for canvas-native rendering', () => {
  render(<WrenEmptyState image='empty.png' title='' transparentImage={true} />)

  expect(screen.getByRole('presentation', { hidden: true }).className).toContain(
    'wrenEmptyStateImageTransparent'
  )
})
