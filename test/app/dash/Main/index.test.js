import Restore from 'react-restore'

import { Main } from '../../../../app/dash/Main'
import {
  WREN_COMPANION_CHROME_WEB_STORE_URL,
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
  ['Earn', 'earn'],
  ['Contacts', 'addressBook'],
  ['Read-only inspector', 'inspector'],
  ['Contracts', 'contracts'],
  ['Tokens', 'tokens']
])('opens %s from the dashboard', (label, view) => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view, data: {} })
})

it('does not expose internal instance controls', () => {
  renderMain()

  expect(screen.queryByRole('button', { name: instanceId })).toBeNull()
})

it('leaves dashboard identity to the shared Control chrome', () => {
  renderMain()

  expect(screen.queryByTestId('control-center-wren')).toBeNull()
  expect(screen.queryByText('Desktop EVM wallet')).toBeNull()
})

it('includes each tool description in its accessible name', () => {
  renderMain()

  expect(
    screen.getByRole('button', {
      name: 'Contacts Save labels for addresses. Compare the full address before signing.'
    })
  ).toBeTruthy()
})

it('retains the additional tools owned by the Overview content', () => {
  renderMain()

  const toolItems = [...document.querySelectorAll('.dashToolList .dashModuleTitle')].map(
    (item) => item.textContent
  )
  expect(screen.queryByText('home')).toBeNull()
  expect(screen.queryByText('app')).toBeNull()
  expect(screen.getByText('More tools')).toBeTruthy()
  expect(toolItems).toEqual(['Earn', 'Contacts', 'Tokens', 'Read-only inspector', 'Contracts'])
  expect(
    screen.getByRole('button', { name: 'Read-only inspector Inspect requests without signing.' })
  ).toBeTruthy()
  expect(
    screen.getByRole('button', {
      name: 'Contracts Deploy prepared bytecode or publish verified source.'
    })
  ).toBeTruthy()
})

it('orders the lower Control surfaces by utility and keeps Support cardless', () => {
  renderMain()

  const sections = [...document.querySelector('.localSettingsWrap').children].map((element) =>
    ['dashModules', 'dashToolsCard', 'dashCompanion', 'dashSupportActions'].find((name) =>
      element.classList.contains(name)
    )
  )

  expect(sections).toEqual(['dashToolsCard', 'dashCompanion', 'dashSupportActions'])
  expect(document.querySelector('.dashSupportCard')).toBeNull()
  expect(document.querySelectorAll('.dashSupportActions > *')).toHaveLength(4)
})

it('routes Chrome to its Web Store listing', () => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: 'Download Chrome companion' }))

  expect(WREN_COMPANION_CHROME_WEB_STORE_URL).toBe(
    'https://chromewebstore.google.com/detail/wren-companion/ifimccfajfbgligbhcgfapdagpnfkbhn'
  )
  expect(link.send).toHaveBeenCalledWith('tray:openExternal', WREN_COMPANION_CHROME_WEB_STORE_URL)
})

it('keeps Firefox on companion releases while store approval is pending', () => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: 'Download Firefox companion' }))

  expect(link.send).toHaveBeenCalledWith('tray:openExternal', WREN_COMPANION_RELEASES_URL)
})

it('routes support, tutorial, and quit actions', () => {
  renderMain()

  fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quit Wren' }))

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
  expect(button.getAttribute('aria-describedby')).toBe('dash-support-wren-status')

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
