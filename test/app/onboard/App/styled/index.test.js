import { render, screen } from '../../../../componentSetup'
import fs from 'fs'

import {
  SlideBody,
  SlideContainer,
  SlideItem,
  SlideScroller,
  SlideTitle
} from '../../../../../app/onboard/App/styled'

const styledSource = fs.readFileSync('app/onboard/App/styled/index.jsx', 'utf8')
const introSource = fs.readFileSync('app/onboard/App/Slides/Intro/index.jsx', 'utf8')

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

it('keeps onboarding copy scrollable above the action shelf', () => {
  render(<SlideBody data-testid='slide-body'>Long onboarding copy</SlideBody>)

  const style = window.getComputedStyle(screen.getByTestId('slide-body'))
  expect(style.bottom).toBe('104px')
  expect(style.overflowY).toBe('auto')
  expect(style.scrollbarGutter).toBe('stable')
})

it('contains slide composition inside the available onboarding viewport', () => {
  render(
    <SlideContainer data-testid='slide-container'>
      <SlideScroller data-testid='slide-scroller' />
    </SlideContainer>
  )

  expect(window.getComputedStyle(screen.getByTestId('slide-container')).overflow).toBe('hidden')
  expect(window.getComputedStyle(screen.getByTestId('slide-scroller')).overflow).toBe('hidden')
  expect(styledSource).toMatch(/@media \(max-height: 700px\) and \(min-height: 541px\)/)
  expect(styledSource).toMatch(/@media \(max-width: 620px\)[\s\S]*?right: 28px;[\s\S]*?width: auto;/)
})

it('keeps the immersive welcome scrollable on very short displays', () => {
  expect(introSource).toMatch(/overflow-y: auto;/)
  expect(introSource).toMatch(
    /@media \(max-height: 480px\)[\s\S]*?position: relative;[\s\S]*?min-height: 100%;[\s\S]*?transform: none;/
  )
})
