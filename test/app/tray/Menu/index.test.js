import Restore from 'react-restore'

import { Menu } from '../../../../app/tray/Menu'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const renderMenu = (showing = false) => {
  const store = Restore.create({ windows: { dash: { showing } } }, {})
  const ConnectedMenu = Restore.connect(Menu, store)
  return render(<ConnectedMenu />)
}

it('opens the dashboard with the current visibility inverted', () => {
  renderMenu()

  const button = screen.getByRole('button', { name: 'Open dashboard' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(button.classList.contains('wrenShellNav')).toBe(true)
  expect(button.classList.contains('panelWorkspaceToggle')).toBe(true)
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(button.querySelectorAll('svg rect')).toHaveLength(1)
  fireEvent.click(button)

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: true })
})

it('uses the split-panel state to close an open dashboard', () => {
  renderMenu(true)

  const button = screen.getByRole('button', { name: 'Close dashboard' })
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.querySelectorAll('svg rect')).toHaveLength(2)
  fireEvent.click(button)

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: false })
})

it('opens the dashboard from the keyboard', async () => {
  const { user } = renderMenu()
  const button = screen.getByRole('button', { name: 'Open dashboard' })

  button.focus()
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: true })
})
