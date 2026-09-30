import link from '../../../../../resources/link'

import { fireEvent, render, screen } from '../../../../componentSetup'

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

it('labels both Companion download controls without the compact icon-only override', () => {
  render(<Extension setProceed={jest.fn()} setTitle={jest.fn()} />)

  const chrome = screen.getByRole('button', {
    name: 'Open Wren Companion release downloads for Chrome'
  })
  const firefox = screen.getByRole('button', {
    name: 'Open Wren Companion on Firefox Add-ons'
  })

  expect(chrome.textContent).toContain('Chrome')
  expect(firefox.textContent).toContain('Firefox')
  fireEvent.click(firefox)
  expect(link.send).toHaveBeenCalledWith(
    'tray:openExternal',
    'https://addons.mozilla.org/en-US/firefox/addon/wren-companion/'
  )
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
