import { render, screen } from '../../../../componentSetup'
import { SlideItem, SlideTitle } from '../../../../../app/onboard/App/styled'

it('spaces slide items as readable text blocks', () => {
  render(
    <div>
      <SlideItem data-testid='slide-item' />
      <SlideItem />
    </div>
  )

  const style = window.getComputedStyle(screen.getByTestId('slide-item'))
  expect(style.margin).toBe('0px 0px 14px 0px')
  expect(style.lineHeight).toBe('1.5')
})

it('uses a semantic heading for each onboarding slide title', () => {
  render(<SlideTitle>Choose your networks</SlideTitle>)

  expect(screen.getByRole('heading', { level: 1, name: 'Choose your networks' })).toBeTruthy()
})
