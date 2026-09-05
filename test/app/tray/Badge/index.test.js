import Restore from 'react-restore'

import { Bridge } from '../../../../app/tray/Badge'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const renderBadge = (badge) => {
  const store = Restore.create({ view: { badge } }, {})
  const ConnectedBadge = Restore.connect(Bridge, store)
  return {
    ...render(
      <>
        <button data-testid='outside-update-dialog' type='button'>
          Outside
        </button>
        <ConnectedBadge />
      </>
    ),
    store
  }
}

beforeEach(() => {
  link.send.mockReset()
})

it('renders the available update as an accessible dialog and preserves each IPC action', () => {
  renderBadge({ type: 'updateAvailable', version: '0.1.3' })

  const dialog = screen.getByRole('dialog', { name: 'Update available' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(screen.getByTestId('outside-update-dialog').hasAttribute('inert')).toBe(true)
  expect(screen.getByText('Wren 0.1.3')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Get update' }))

  const skip = screen.getByRole('button', { name: 'Skip this version' })
  skip.focus()
  fireEvent.keyDown(skip, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Get update' }))

  fireEvent.click(screen.getByRole('button', { name: 'Get update' }))
  expect(link.send).toHaveBeenCalledWith('tray:installAvailableUpdate')
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(link.send).toHaveBeenCalledWith('tray:dismissUpdate', '0.1.3', true)
  fireEvent.click(skip)
  expect(link.send).toHaveBeenCalledWith('tray:dismissUpdate', '0.1.3', false)
})

it('treats Escape as Later without exposing the quiet skip action', () => {
  renderBadge({ type: 'updateReady', version: '0.1.3' })

  expect(screen.getByText('Wren 0.1.3')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Skip this version' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(link.send).toHaveBeenCalledWith('tray:action', 'updateBadge', '')

  fireEvent.click(screen.getByRole('button', { name: 'Restart and install' }))
  expect(link.send).toHaveBeenCalledWith('tray:updateRestart')
})
