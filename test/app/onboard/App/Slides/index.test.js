import fs from 'fs'
import link from '../../../../../resources/link'

import { fireEvent, render, screen } from '../../../../componentSetup'
import Accounts from '../../../../../app/onboard/App/Slides/Accounts'
import Extension from '../../../../../app/onboard/App/Slides/Extension'
import Slides from '../../../../../app/onboard/App/Slides'

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
  expect(screen.getByText('Select Add account, then choose how to add it.')).toBeTruthy()
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

it.each([
  ['Create wallet', { newAccountType: 'create-seed' }],
  ['Import wallet', { accountChooserMode: 'import' }],
  ['Connect hardware wallet', { accountChooserMode: 'hardware' }],
  ['Watch address', { newAccountType: 'nonsigning' }]
])('starts %s directly', (label, data) => {
  link.send.mockClear()
  render(<Slides />)
  fireEvent.click(screen.getByRole('button', { name: label }))
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navReplace', 'dash', [{ view: 'accounts', data: { showAddAccounts: true, ...data } }]],
    ['frame:close']
  ])
})

it('uses the same restrained scrollbar treatment as the wallet shells', () => {
  const source = fs.readFileSync('app/onboard/App/index.styl', 'utf8')

  expect(source).toMatch(
    /::-webkit-scrollbar[\s\S]*?width 6px[\s\S]*?::-webkit-scrollbar-track[\s\S]*?background transparent[\s\S]*?::-webkit-scrollbar-thumb[\s\S]*?border 2px solid transparent[\s\S]*?border-radius 2px[\s\S]*?background-color var\(--wren-text-muted\)/
  )
})
