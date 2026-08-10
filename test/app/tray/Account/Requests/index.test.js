import { render, screen, waitFor } from '../../../../componentSetup'
import { Requests } from '../../../../../app/tray/Account/Requests'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({
  send: jest.fn()
}))

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

it('opens pending requests from a native keyboard-operable button and restores focus on return', async () => {
  const requests = new Requests({ expanded: true, account: '0xabc', moduleId: 'requests' })
  requests.props = { expanded: false, account: '0xabc', moduleId: 'requests' }
  requests.store = (...path) => {
    if (path.join('.') === 'main.accounts.0xabc.requests') return { first: { id: 'first' } }
  }

  const { user, unmount } = render(requests.renderPreview())
  const button = screen.getByRole('button', { name: /1 Request/i })

  button.focus()
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'expandedModule',
    data: { id: 'requests', account: '0xabc' }
  })

  unmount()
  const returned = new Requests({ expanded: false, account: '0xabc', moduleId: 'requests' })
  returned.store = requests.store
  render(returned.renderPreview())
  returned.componentDidMount()
  const restored = screen.getByRole('button', { name: /1 Request/i })
  await waitFor(() => expect(document.activeElement).toBe(restored))
})
