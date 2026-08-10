import Restore from 'react-restore'

import { Main } from '../../../../app/dash/Main'
import {
  WREN_COMPANION_RELEASES_URL,
  WREN_LICENSE_URL,
  WREN_SUPPORT_URL
} from '../../../../resources/constants'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const instanceId = '11111111-1111-4111-8111-111111111111'

const renderMain = () => {
  const store = Restore.create(
    {
      main: {
        instanceId,
        latticeSettings: { endpointCustom: '', endpointMode: 'default' },
        networks: {}
      }
    },
    {}
  )
  class TestMain extends Main {
    constructor(props) {
      super(props, { store })
      this.store = store
    }
  }
  return render(<TestMain />)
}

it.each([
  ['Accounts', 'accounts'],
  ['Contacts', 'addressBook'],
  ['Earn', 'earn'],
  ['Networks', 'chains'],
  ['Tokens', 'tokens'],
  ['Settings', 'settings']
])('opens %s from the dashboard', (label, view) => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view, data: {} })
})

it('keeps connected-app controls scoped to the selected account surface', () => {
  renderMain()

  expect(screen.queryByText('Connected apps')).toBeNull()
})

it('includes each destination description in its accessible name', () => {
  renderMain()

  expect(
    screen.getByRole('button', {
      name: 'Accounts Manage signing and watch-only accounts.'
    })
  ).toBeTruthy()
})

it.each(['Download Chrome companion', 'Download Firefox companion'])(
  'routes %s to community companion releases',
  (label) => {
    renderMain()

    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(link.send).toHaveBeenCalledWith('tray:openExternal', WREN_COMPANION_RELEASES_URL)
  }
)

it('routes support, tutorial, quit, and license actions', () => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
  fireEvent.click(screen.getByRole('button', { name: 'View License' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:openExternal', WREN_SUPPORT_URL],
    ['tray:action', 'setOnboard', { showing: true }],
    ['tray:quit'],
    ['tray:openExternal', WREN_LICENSE_URL]
  ])
})

it('stages app reset, focuses the safe action, and restores focus after cancelling', async () => {
  const { user } = renderMain()

  const reset = screen.getByRole('button', { name: 'Reset app' })
  await user.click(reset)
  expect(link.send).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset app' }))

  await user.click(screen.getByRole('button', { name: 'Reset app' }))
  await user.click(screen.getByRole('button', { name: 'Reset app' }))
  expect(link.send).toHaveBeenCalledWith('tray:resetAllSettings')
})

it('cancels a staged reset with Escape', async () => {
  const { user } = renderMain()

  await user.click(screen.getByRole('button', { name: 'Reset app' }))
  await user.keyboard('{Escape}')

  expect(screen.queryByRole('group', { name: 'Reset app?' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset app' }))
})

it('copies the visible instance ID', () => {
  renderMain()
  const instanceButton = screen.getByRole('button', { name: instanceId })

  fireEvent.click(instanceButton)

  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', instanceId)
  expect(screen.getByText('Instance ID Copied')).toBeTruthy()
})

it('returns the workspace home to its top-level navigation', () => {
  const scroll = document.createElement('div')
  scroll.className = 'dashMainScroll'
  scroll.scrollTop = 240
  document.body.appendChild(scroll)

  renderMain()

  expect(scroll.scrollTop).toBe(0)
  scroll.remove()
})
