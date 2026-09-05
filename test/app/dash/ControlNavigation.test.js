import { ControlNavigation, primaryDashboardItems } from '../../../app/dash/ControlNavigation'
import link from '../../../resources/link'
import { fireEvent, render, screen } from '../../componentSetup'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))

beforeEach(() => link.send.mockReset())

it('owns the stable Control destination order and replaces top-level routes', () => {
  render(<ControlNavigation current='chains' counts={{ accounts: 3, networks: 8, dapps: 12 }} replace />)

  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(
    primaryDashboardItems.map((item) => item.title)
  )

  expect(primaryDashboardItems.map((item) => item.title)).toEqual([
    'Home',
    'Accounts',
    'Networks',
    'Connected apps',
    'Settings'
  ])

  fireEvent.click(screen.getByRole('button', { name: 'Home' }))
  fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navReplace', 'dash', []],
    ['tray:action', 'navReplace', 'dash', [{ view: 'accounts', data: {} }]]
  ])
})

it('keeps the selected destination stable and allows keyboard navigation', async () => {
  const { user } = render(<ControlNavigation current='overview' replace />)
  const home = screen.getByRole('button', { name: 'Home' })
  expect(home.getAttribute('aria-current')).toBe('page')
  await user.click(home)
  expect(link.send).not.toHaveBeenCalled()
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accounts' }))
  await user.keyboard('{Enter}')
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navReplace', 'dash', [
    { view: 'accounts', data: {} }
  ])
})
