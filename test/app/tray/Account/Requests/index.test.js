import { render, screen } from '../../../../componentSetup'
import { Requests } from '../../../../../app/tray/Account/Requests'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({
  send: jest.fn()
}))

it('opens pending requests from a native keyboard-operable button', async () => {
  const requests = new Requests({ expanded: true, account: '0xabc', moduleId: 'requests' })
  requests.props = { expanded: false, account: '0xabc', moduleId: 'requests' }
  requests.store = (...path) => {
    if (path.join('.') === 'main.accounts.0xabc.requests') return { first: { id: 'first' } }
  }

  const { user } = render(requests.renderPreview())
  const button = screen.getByRole('button', { name: /1 Request/i })

  button.focus()
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'expandedModule',
    data: { id: 'requests', account: '0xabc' }
  })
})
