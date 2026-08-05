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
  ['Chains', 'chains'],
  ['Tokens', 'tokens'],
  ['Dapps', 'dapps'],
  ['Settings', 'settings']
])('opens %s from the dashboard', (label, view) => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: label }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view, data: {} })
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

  fireEvent.click(screen.getByRole('button', { name: 'Request a Feature or Report an Issue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Get Community Support' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open Wren Tutorial' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
  fireEvent.click(screen.getByRole('button', { name: 'View License' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:openExternal', WREN_SUPPORT_URL],
    ['tray:openExternal', WREN_SUPPORT_URL],
    ['tray:action', 'setOnboard', { showing: true }],
    ['tray:quit'],
    ['tray:openExternal', WREN_LICENSE_URL]
  ])
})

it('requires confirmation before resetting all settings and data', () => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: 'Reset All Settings & Data' }))
  expect(link.send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'No' }))
  expect(screen.getByRole('button', { name: 'Reset All Settings & Data' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Reset All Settings & Data' }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
  expect(link.send).toHaveBeenCalledWith('tray:resetAllSettings')
})

it('copies the visible instance ID', () => {
  renderMain()
  const instanceButton = screen.getByRole('button', { name: instanceId })

  fireEvent.click(instanceButton)

  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', instanceId)
  expect(screen.getByText('Instance ID Copied')).toBeTruthy()
})
