import Restore from 'react-restore'

import { Main } from '../../../../app/dash/Main'
import {
  WREN_COMPANION_RELEASES_URL,
  WREN_SUPPORT_ADDRESS,
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
  ['Earn', 'earn'],
  ['Contacts', 'addressBook'],
  ['Connected apps', 'dapps'],
  ['Read-only inspector', 'inspector'],
  ['Networks', 'chains'],
  ['Tokens', 'tokens'],
  ['Settings', 'settings']
])('opens %s from the dashboard', (label, view) => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view, data: {} })
})

it('opens the cross-account connected-app view without exposing internal instance controls', () => {
  renderMain()

  expect(
    screen.getByRole('button', {
      name: 'Connected apps Review active connections, retained access, and default networks.'
    })
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: instanceId })).toBeNull()
})

it('keeps one non-interactive Wren beside the Control Center title', () => {
  renderMain()
  const bird = screen.getByTestId('control-center-wren')

  expect(bird).toBeTruthy()
  expect(bird.getAttribute('alt')).toBe('')
  expect(bird.getAttribute('aria-hidden')).toBe('true')
  expect(screen.getAllByTestId('control-center-wren')).toHaveLength(1)
  expect(screen.queryByText('Desktop EVM wallet')).toBeNull()
})

it('includes each destination description in its accessible name', () => {
  renderMain()

  expect(
    screen.getByRole('button', {
      name: 'Accounts Manage signing and watch-only accounts.'
    })
  ).toBeTruthy()
})

it('orders wallet destinations and places the concise inspector in Tools', () => {
  renderMain()

  const walletItems = [...document.querySelectorAll('.dashModuleSection:first-child .dashModuleTitle')].map(
    (item) => item.textContent
  )
  const toolItems = [...document.querySelectorAll('.dashModuleSection:nth-child(2) .dashModuleTitle')].map(
    (item) => item.textContent
  )
  expect(walletItems).toEqual(['Accounts', 'Earn', 'Contacts', 'Connected apps'])
  expect(screen.getByText('Tools')).toBeTruthy()
  expect(toolItems).toEqual(['Networks', 'Tokens', 'Read-only inspector', 'Settings'])
  expect(
    screen.getByRole('button', { name: 'Read-only inspector Inspect requests without signing.' })
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

it('routes support, tutorial, and quit actions', () => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quit' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:openExternal', WREN_SUPPORT_URL],
    ['tray:action', 'setOnboard', { showing: true }],
    ['tray:quit']
  ])
})

it('copies the exact checksummed support address without another IPC action', () => {
  renderMain()

  expect(screen.queryByText(/Sending funds is optional/i)).toBeNull()
  expect(screen.queryByText(/Optional\. Verify this EVM address/i)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Support Wren' }))

  expect(WREN_SUPPORT_ADDRESS).toBe('0x6ac7F5A89E2eC6c30Aa687F9f2117bA1E31D0D97')
  expect(link.send.mock.calls).toEqual([['tray:clipboardData', WREN_SUPPORT_ADDRESS]])
  expect(screen.getByRole('status').textContent).toBe('Address copied')
  expect(screen.getByRole('button', { name: 'Support Wren' })).toBeTruthy()
})

it('reveals a local QR preview with the exact support address on hover', () => {
  renderMain()
  const button = screen.getByRole('button', { name: 'Support Wren' })

  fireEvent.mouseEnter(button.closest('.dashSupportWrenDisclosure'))

  expect(button.getAttribute('aria-expanded')).toBe('true')
  const qr = screen.getByRole('img', { name: 'QR code for the support address' })
  expect(qr.getAttribute('data-qr-payload')).toBe(WREN_SUPPORT_ADDRESS)
  expect(screen.getByText(WREN_SUPPORT_ADDRESS)).toBeTruthy()

  fireEvent.mouseLeave(button.closest('.dashSupportWrenDisclosure'))
  expect(screen.queryByRole('img', { name: 'QR code for the support address' })).toBeNull()
})

it('reveals the support QR preview on keyboard focus', () => {
  renderMain()
  const button = screen.getByRole('button', { name: 'Support Wren' })

  fireEvent.focus(button)

  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('img', { name: 'QR code for the support address' })).toBeTruthy()
  expect(button.getAttribute('aria-describedby')).toContain('dash-support-wren-description')

  fireEvent.mouseLeave(button.closest('.dashSupportWrenDisclosure'))
  expect(button.getAttribute('aria-expanded')).toBe('true')

  fireEvent.blur(button)
  expect(button.getAttribute('aria-expanded')).toBe('false')
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
