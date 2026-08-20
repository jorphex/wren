import { screen, render } from '../../../componentSetup'
import link from '../../../../resources/link'
import RequestItem from '../../../../resources/Components/RequestItem'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../../resources/Components/RingIcon', () => () => null)
jest.mock('../../../../resources/Components/Icon', () => {
  return function MockIcon({ name }) {
    return <span data-icon={name} />
  }
})

const account = '0x0000000000000000000000000000000000000001'
const handlerId = '8073729a-5e59-53b7-9e69-5d9bcff94087'

beforeEach(() => {
  link.send.mockReset()
})

it('opens a request with a validated navigation breadcrumb', async () => {
  const { user } = render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      handlerId={handlerId}
      req={{ created: Date.now(), handlerId, status: 'pending', type: 'transaction' }}
      title='Base Sepolia Transaction'
    />
  )

  const requestButton = screen.getByRole('button', { name: 'Review Base Sepolia Transaction' })
  requestButton.focus()
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'requestView',
    data: { step: 'confirm', accountId: account, requestId: handlerId }
  })
})

it('removes the generic backing plate around chain artwork', () => {
  render(
    <RequestItem
      account={account}
      color='var(--accent1)'
      img='https://example.test/chain.png'
      req={{ created: Date.now(), handlerId, status: 'confirming', type: 'transaction' }}
      title='Ethereum transaction'
    />
  )

  expect(document.querySelector('.requestItemIconRing')).toBeTruthy()
})

it('opens a request only once for duplicate activation', async () => {
  const { user } = render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      req={{ created: Date.now(), handlerId, status: 'pending', type: 'transaction' }}
      title='Base Sepolia Transaction'
    />
  )

  await user.dblClick(screen.getByRole('button', { name: 'Review Base Sepolia Transaction' }))

  expect(link.send).toHaveBeenCalledTimes(1)
})

it('keeps queued requests visible but unavailable until they become current', async () => {
  const { user } = render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      queued
      req={{ created: Date.now(), handlerId, status: 'pending', type: 'transaction' }}
      title='Base Sepolia Transaction'
    />
  )

  const requestButton = screen.getByRole('button', { name: 'Base Sepolia Transaction. Waiting' })
  expect(requestButton.disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('waiting')

  await user.click(requestButton)
  expect(link.send).not.toHaveBeenCalled()
})

it('marks the current request without replacing its lifecycle status', () => {
  render(
    <RequestItem
      account={account}
      active
      color='var(--outerspace)'
      req={{ created: Date.now(), handlerId, status: 'pending', type: 'transaction' }}
      title='Base Sepolia Transaction'
    />
  )

  expect(screen.getByText('Current')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('pending')
  expect(screen.getByRole('button', { name: 'Review Base Sepolia Transaction. Current' }).disabled).toBe(
    false
  )
})

it('preserves a terminal lifecycle status on a later queue row', () => {
  render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      queued
      req={{ created: Date.now(), handlerId, status: 'declined', type: 'transaction' }}
      title='Base Sepolia Transaction'
    />
  )

  expect(screen.getByRole('status').textContent).toBe('declined')
  expect(screen.getByRole('button', { name: 'Base Sepolia Transaction. declined' }).disabled).toBe(true)
})

it('keeps header request composition static so nested actions remain valid', () => {
  render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      headerMode
      req={{ created: Date.now(), handlerId, status: 'pending', type: 'transaction' }}
      title='Base Sepolia Transaction'
    >
      <button type='button'>Nested review action</button>
    </RequestItem>
  )

  expect(screen.queryByRole('button', { name: 'Review Base Sepolia Transaction' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Nested review action' })).toBeTruthy()
})

it('presents a declined request as neutral and inactive rather than failed', () => {
  render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      req={{ created: Date.now(), handlerId, status: 'declined', type: 'transaction' }}
      title='Base Sepolia Transaction'
    />
  )

  const status = screen.getByText('declined')
  const title = status.closest('.requestItemTitle')
  const details = Array.from(title.children).find((child) => child.classList.contains('requestItemDetails'))

  expect(details.classList.contains('requestItemDetailsNeutral')).toBe(true)
  expect(details.classList.contains('requestItemDetailsBad')).toBe(false)
  expect(details.querySelector('[data-icon="close"]')).toBeTruthy()
  expect(status.previousElementSibling.classList.contains('requestItemDetailsIndicatorStill')).toBe(true)
})

it.each([
  ['transaction', 'Transaction canceled.'],
  ['sign', 'Request canceled.']
])('presents an automatic %s cancellation truthfully', (type, outcome) => {
  render(
    <RequestItem
      account={account}
      color='var(--outerspace)'
      req={{
        created: Date.now(),
        handlerId,
        status: 'declined',
        type,
        notice: 'Network changed before signing'
      }}
      title='Queued request'
    />
  )

  expect(screen.getByRole('alert').textContent).toBe(
    `${outcome} The network changed before signing. Nothing was signed or sent.`
  )
})
