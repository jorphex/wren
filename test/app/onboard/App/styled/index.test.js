import { render, screen } from '../../../../componentSetup'

import { SlideTitle } from '../../../../../app/onboard/App/styled'

it('uses a semantic heading for each onboarding slide title', () => {
  render(<SlideTitle>Choose your networks</SlideTitle>)

  expect(screen.getByRole('heading', { level: 1, name: 'Choose your networks' })).toBeTruthy()
})
