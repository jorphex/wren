import { ControlNavigation, primaryDashboardItems } from '../../../app/dash/ControlNavigation'
import link from '../../../resources/link'
import { fireEvent, render, screen } from '../../componentSetup'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))

beforeEach(() => link.send.mockReset())

it('owns the stable Control destination order and replaces top-level routes', () => {
  render(<ControlNavigation current='chains' replace />)

  expect(primaryDashboardItems.map((item) => item.title)).toEqual([
    'Home',
    'Accounts',
    'Networks',
    'App activity',
    'Settings'
  ])

  fireEvent.click(screen.getByRole('button', { name: 'Home Control center home.' }))
  fireEvent.click(screen.getByRole('button', { name: 'Accounts Manage signing and watch-only accounts.' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navReplace', 'dash', []],
    ['tray:action', 'navReplace', 'dash', [{ view: 'accounts', data: {} }]]
  ])
})
