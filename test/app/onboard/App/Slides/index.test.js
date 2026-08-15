import fs from 'fs'

import { act, fireEvent, render, screen } from '../../../../componentSetup'
import Accounts from '../../../../../app/onboard/App/Slides/Accounts'
import Extension from '../../../../../app/onboard/App/Slides/Extension'
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

it('introduces every supported account type without internal signer terminology', () => {
  render(<Accounts setProceed={jest.fn()} setTitle={jest.fn()} />)

  expect(
    screen.getByText('Connect a hardware wallet, create a local account, or add a watch-only address.')
  ).toBeTruthy()
  expect(screen.getByText('Select Add account, then choose how to connect it.')).toBeTruthy()
})

it('labels both Companion download controls without the compact icon-only override', () => {
  render(<Extension setProceed={jest.fn()} setTitle={jest.fn()} />)

  const chrome = screen.getByRole('button', {
    name: 'Open Wren Companion release downloads for Chrome'
  })
  const firefox = screen.getByRole('button', {
    name: 'Open Wren Companion release downloads for Firefox'
  })

  expect(chrome.textContent).toContain('Chrome')
  expect(firefox.textContent).toContain('Firefox')
  expect(chrome.className).not.toContain('wrenControlIcon')
  expect(firefox.className).not.toContain('wrenControlIcon')
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
  expect(screen.getByRole('heading', { name: 'Open Wren quickly' }).getAttribute('aria-describedby')).toBe(
    'onboarding-slide-progress'
  )

  fireEvent.click(screen.getByRole('button', { name: 'Skip shortcut' }))
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
