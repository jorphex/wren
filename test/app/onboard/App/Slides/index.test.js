import fs from 'fs'

import { act, fireEvent, render, screen } from '../../../../componentSetup'
import Accounts from '../../../../../app/onboard/App/Slides/Accounts'
import Slides, { GUIDED_SLIDE_COUNT, guidedStepForSlide } from '../../../../../app/onboard/App/Slides'

jest.mock('../../../../../resources/link', () => ({
  off: jest.fn(),
  on: jest.fn(),
  send: jest.fn()
}))

beforeEach(() => {
  global.store = (...path) => {
    if (path.join('.') === 'main.shortcuts.summon') {
      return { enabled: true, modifierKeys: ['Alt'], shortcutKey: 'Slash' }
    }
    if (path.join('.') === 'tray.open') return true
  }
  global.store.observer = () => ({ remove: jest.fn() })
})

afterEach(() => {
  delete global.store
})

it('keeps the existing Accounts slide as the single hardware-signing introduction', () => {
  render(<Accounts setProceed={jest.fn()} setTitle={jest.fn()} />)

  expect(
    screen.getByText('Hardware signers, local accounts, and watch-only addresses all belong here.')
  ).toBeTruthy()
  expect(screen.getByText('Choose Add account, then choose how you want to connect.')).toBeTruthy()
})

it('numbers every guided slide while leaving the immersive welcome unnumbered', () => {
  expect(GUIDED_SLIDE_COUNT).toBe(7)
  expect(guidedStepForSlide(1)).toBe(1)
  expect(guidedStepForSlide(2)).toBe(1)
  expect(guidedStepForSlide(8)).toBe(7)
})

it('shows first and final progress with the visible slide title as context', () => {
  render(<Slides platform='linux' />)

  expect(screen.queryByText(/Step \d of 7/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))

  expect(screen.getByText('Step 1 of 7')).toBeTruthy()
  expect(
    screen.getByRole('heading', { name: 'Wren when you need it' }).getAttribute('aria-describedby')
  ).toBe('onboarding-slide-progress')

  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  for (let slide = 0; slide < 5; slide += 1) {
    act(() => jest.advanceTimersByTime(601))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }

  expect(screen.getByText('Step 7 of 7')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Ready to begin' })).toBeTruthy()
})

it('uses the same restrained scrollbar treatment as the wallet shells', () => {
  const source = fs.readFileSync('app/onboard/App/index.styl', 'utf8')

  expect(source).toMatch(
    /::-webkit-scrollbar[\s\S]*?width 6px[\s\S]*?::-webkit-scrollbar-track[\s\S]*?background transparent[\s\S]*?::-webkit-scrollbar-thumb[\s\S]*?border 2px solid transparent[\s\S]*?border-radius 2px[\s\S]*?background-color var\(--wren-text-muted\)/
  )
})
