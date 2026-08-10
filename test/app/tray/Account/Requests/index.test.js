import { render, screen, waitFor } from '../../../../componentSetup'
import { Requests } from '../../../../../app/tray/Account/Requests'
import RequestItem from '../../../../../resources/Components/RequestItem'
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

beforeEach(() => {
  link.send.mockReset()
})

const createRequest = (handlerId, created, origin = 'https://example.test') => ({
  handlerId,
  created,
  origin,
  status: 'pending',
  type: 'access'
})

class ExpandedRequestsHarness extends Requests {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.accounts.0xabc') return { requests: this.props.requests }
    if (key === 'main.origins.https://example.test.name') return 'Example'
    return undefined
  }
}

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

it('stages grouped clearing, cancels with Escape, and submits confirmation only once', async () => {
  const requests = {
    first: createRequest('first', 2),
    second: createRequest('second', 1)
  }
  const { user } = render(
    <ExpandedRequestsHarness expanded account='0xabc' moduleId='requests' requests={requests} />
  )

  const clearTrigger = screen.getByRole('button', { name: 'Clear requests from Example' })
  await user.click(clearTrigger)

  expect(screen.getByRole('alertdialog')).toBeTruthy()
  expect(screen.getByText('Clear 2 staged requests?')).toBeTruthy()
  expect(
    screen.getByText(
      'This removes the staged requests from this list. It does not cancel transactions already submitted.'
    )
  ).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(clearTrigger))
  expect(link.send).not.toHaveBeenCalled()

  await user.click(clearTrigger)
  await user.dblClick(screen.getByRole('button', { name: 'Clear all' }))
  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('tray:clearRequestsByOrigin', '0xabc', 'https://example.test')
})

it('uses singular confirmation copy for one staged request', async () => {
  const { user } = render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      moduleId='requests'
      requests={{ only: createRequest('only', 1) }}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Clear requests from Example' }))

  expect(screen.getByText('Clear 1 staged request?')).toBeTruthy()
  expect(
    screen.getByText(
      'This removes the staged request from this list. It does not cancel transactions already submitted.'
    )
  ).toBeTruthy()
})

it('restores request focus to its originating row after returning', async () => {
  const { user, unmount } = render(
    <RequestItem
      account='0xabc'
      color='var(--outerspace)'
      i={0}
      req={createRequest('returning', 1)}
      svgName='accounts'
      title='Account access'
    />
  )

  await user.click(screen.getByRole('button', { name: 'Review Account access' }))
  unmount()

  render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      moduleId='requests'
      requests={{ returning: createRequest('returning', 1) }}
    />
  )

  const row = screen.getByRole('button', { name: 'Review Account access' })
  await waitFor(() => expect(document.activeElement).toBe(row))
})

it('restores request focus to the next logical row when the originating request disappeared', async () => {
  const { user, unmount } = render(
    <RequestItem
      account='0xabc'
      color='var(--outerspace)'
      i={1}
      req={createRequest('removed', 2)}
      svgName='accounts'
      title='Account access'
    />
  )

  await user.click(screen.getByRole('button', { name: 'Review Account access' }))
  unmount()

  render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      moduleId='requests'
      requests={{ first: createRequest('first', 3), next: createRequest('next', 1) }}
    />
  )

  const rows = screen.getAllByRole('button', { name: 'Review Account access' })
  await waitFor(() => expect(document.activeElement).toBe(rows[1]))
})

it('restores request focus to the inbox heading when no row remains', async () => {
  const { user, unmount } = render(
    <RequestItem
      account='0xabc'
      color='var(--outerspace)'
      i={0}
      req={createRequest('only', 1)}
      svgName='accounts'
      title='Account access'
    />
  )

  await user.click(screen.getByRole('button', { name: 'Review Account access' }))
  unmount()

  render(<ExpandedRequestsHarness expanded account='0xabc' moduleId='requests' requests={{}} />)

  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Requests' })))
})
