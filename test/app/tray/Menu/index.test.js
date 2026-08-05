import Restore from 'react-restore'

import { Menu } from '../../../../app/tray/Menu'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const renderMenu = () => {
  const store = Restore.create({ windows: { dash: { showing: false } } }, {})
  const ConnectedMenu = Restore.connect(Menu, store)
  return render(<ConnectedMenu />)
}

it('opens the dashboard with the current visibility inverted', () => {
  renderMenu()

  fireEvent.click(screen.getByRole('button', { name: 'Open dashboard' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: true })
})

it('opens the dashboard from the keyboard', () => {
  renderMenu()

  fireEvent.keyDown(screen.getByRole('button', { name: 'Open dashboard' }), { key: 'Enter' })

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: true })
})

it('opens Wren Send and closes the dashboard after the click delay', () => {
  renderMenu()

  fireEvent.click(screen.getByRole('button', { name: 'Open Wren Send' }))
  act(() => jest.advanceTimersByTime(50))

  expect(link.send.mock.calls).toEqual([
    ['*:addFrame', 'dappLauncher'],
    ['tray:action', 'setDash', { showing: false }]
  ])
})

it('cancels a pending Wren Send action when the menu unmounts', () => {
  const { unmount } = renderMenu()

  fireEvent.click(screen.getByRole('button', { name: 'Open Wren Send' }))
  unmount()
  act(() => jest.advanceTimersByTime(50))

  expect(link.send).not.toHaveBeenCalled()
})
