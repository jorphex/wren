import { render, screen, waitFor } from '../../../../componentSetup'
import { byRequestQueue, Requests } from '../../../../../app/tray/Account/Requests'
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

const createRequest = (handlerId, created, origin = 'https://example.test', queueIndex) => ({
  handlerId,
  created,
  origin,
  queueIndex,
  status: 'pending',
  type: 'access'
})

class ExpandedRequestsHarness extends Requests {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.accounts.0xabc') {
      const hasActiveRequestId = Object.prototype.hasOwnProperty.call(this.props, 'activeRequestId')
      return {
        requests: this.props.requests,
        activeRequestId: hasActiveRequestId
          ? this.props.activeRequestId
          : Object.values(this.props.requests).find((request) => request.mode !== 'monitor')?.handlerId
      }
    }
    if (key === 'main.origins.https://example.test.name') return 'Example'
    return undefined
  }
}

it('sorts indexed requests in FIFO order and places legacy requests after them', () => {
  const requests = [
    createRequest('legacy-newer', 30),
    createRequest('third', 10, 'https://example.test', 3),
    createRequest('first', 20, 'https://example.test', 1),
    createRequest('legacy-older', 5)
  ]

  expect(requests.sort(byRequestQueue).map(({ handlerId }) => handlerId)).toEqual([
    'first',
    'third',
    'legacy-older',
    'legacy-newer'
  ])
})

it('falls back to oldest creation time and stable identity for legacy requests', () => {
  const requests = [createRequest('z-last', 2), createRequest('b-tie', 1), createRequest('a-tie', 1)]

  expect(requests.sort(byRequestQueue).map(({ handlerId }) => handlerId)).toEqual([
    'a-tie',
    'b-tie',
    'z-last'
  ])
})

it('shows queue status and allows only the current FIFO request to open', async () => {
  const requests = {
    later: createRequest('later', 1, 'https://example.test', 2),
    current: createRequest('current', 2, 'https://example.test', 1),
    last: createRequest('last', 3, 'https://example.test', 3)
  }
  const { user } = render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      activeRequestId='current'
      moduleId='requests'
      requests={requests}
    />
  )

  expect(screen.getByText('Requests (3)').closest('.requestQueueStatus').textContent).toBe(
    'Requests (3)2 requests waiting'
  )
  expect(screen.getByText('Current')).toBeTruthy()

  const current = screen.getByRole('button', { name: 'Review Account access. Current' })
  const waiting = screen.getAllByRole('button', { name: 'Account access. Waiting' })
  expect(waiting).toHaveLength(2)
  expect(waiting.every((button) => button.disabled)).toBe(true)

  await user.click(waiting[0])
  expect(link.send).not.toHaveBeenCalled()

  await user.click(current)
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'requestView',
    data: { step: 'confirm', accountId: '0xabc', requestId: 'current' }
  })
})

it('uses singular waiting copy when one request follows the current request', () => {
  render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      moduleId='requests'
      requests={{
        current: createRequest('current', 1, 'https://example.test', 1),
        waiting: createRequest('waiting', 2, 'https://example.test', 2)
      }}
    />
  )

  expect(screen.getByText('Requests (2)')).toBeTruthy()
  expect(screen.getByText('1 request waiting')).toBeTruthy()
})

it('keeps FIFO row order when request origins are interleaved', () => {
  const current = createRequest('current', 1, 'https://first.test', 1)
  const middle = { ...createRequest('middle', 2, 'https://second.test', 2), type: 'sign' }
  const last = { ...createRequest('last', 3, 'https://first.test', 3), type: 'addToken' }

  render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      activeRequestId='current'
      moduleId='requests'
      requests={{ last, current, middle }}
    />
  )

  expect(
    screen
      .getAllByRole('button')
      .filter((button) => button.classList.contains('clusterValueAction'))
      .map((button) => button.getAttribute('aria-label'))
  ).toEqual(['Review Account access. Current', 'Sign message. Waiting', 'Add token. Waiting'])
})

it('keeps monitor evidence inspectable while gating only the review queue', () => {
  const monitor = {
    ...createRequest('monitor', 1, 'https://example.test', 1),
    mode: 'monitor',
    status: 'confirming'
  }
  const current = { ...createRequest('current', 2, 'https://example.test', 2), mode: 'normal' }
  const waiting = { ...createRequest('waiting', 3, 'https://example.test', 3), mode: 'normal' }

  render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      activeRequestId='current'
      moduleId='requests'
      requests={{ waiting, monitor, current }}
    />
  )

  expect(screen.getByRole('button', { name: 'Review Account access' }).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'Review Account access. Current' }).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'Account access. Waiting' }).disabled).toBe(true)
  expect(screen.getByText('1 request waiting')).toBeTruthy()
  expect(screen.getAllByText('Current')).toHaveLength(1)
})

it('does not infer a current request when the account has not exposed one', () => {
  render(
    <ExpandedRequestsHarness
      expanded
      account='0xabc'
      activeRequestId={null}
      moduleId='requests'
      requests={{
        first: { ...createRequest('first', 1, 'https://example.test', 1), mode: 'normal' },
        second: { ...createRequest('second', 2, 'https://example.test', 2), mode: 'normal' }
      }}
    />
  )

  expect(screen.queryByText('Current')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Account access. Waiting' })).toHaveLength(2)
  expect(screen.getByText('2 requests waiting')).toBeTruthy()
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

  await user.click(screen.getByRole('button', { name: 'Clear requests from Example' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(link.send).toHaveBeenCalledTimes(1)
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

  const row = screen.getByRole('button', { name: 'Review Account access. Current' })
  await waitFor(() => expect(document.activeElement).toBe(row))
})

it('restores request focus to the current row when the originating request disappeared', async () => {
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

  const current = screen.getByRole('button', { name: 'Review Account access. Current' })
  await waitFor(() => expect(document.activeElement).toBe(current))
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
