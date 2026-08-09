import { render, screen } from '../../../../../componentSetup'
import Proceed from '../../../../../../app/onboard/App/Slides/Proceed'

it('completes when the user clicks close', async () => {
  const onComplete = jest.fn()
  const { user } = render(
    <Proceed
      slide={7}
      proceed={{ action: 'complete', text: 'Done' }}
      nextSlide={() => {}}
      prevSlide={() => {}}
      onComplete={onComplete}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Done' }))

  expect(onComplete).toHaveBeenCalled()

  const button = screen.getByRole('button', { name: 'Done' })
  const style = window.getComputedStyle(button)
  expect(style.minWidth).toBe('156px')
  expect(style.height).toBe('46px')
  expect(button.classList.contains('wrenOnboardPrimary')).toBe(true)
})

it('lets later slides move back without hiding the primary action', async () => {
  const prevSlide = jest.fn()
  const nextSlide = jest.fn()
  const { user } = render(
    <Proceed
      slide={4}
      proceed={{ action: 'next', text: 'Continue' }}
      nextSlide={nextSlide}
      prevSlide={prevSlide}
      onComplete={() => {}}
    />
  )

  const back = screen.getByRole('button', { name: 'Back' })
  const backStyle = window.getComputedStyle(back)

  expect(backStyle.minWidth).toBe('96px')
  expect(backStyle.height).toBe('48px')
  expect(back.classList.contains('wrenControlSecondary')).toBe(true)
  expect(back.classList.contains('wrenOnboardSecondary')).toBe(true)

  await user.click(back)

  expect(prevSlide).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
})
