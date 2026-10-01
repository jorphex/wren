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
  await user.click(back)

  expect(prevSlide).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
})
