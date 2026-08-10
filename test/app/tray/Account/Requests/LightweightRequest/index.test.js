import { render, screen } from '../../../../../componentSetup'
import {
  LightweightRequest,
  RequestFact
} from '../../../../../../app/tray/Account/Requests/LightweightRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../../../../resources/Components/Icon', () => {
  const MockIcon = ({ name }) => <span data-testid={`icon-${name}`} />
  MockIcon.displayName = 'MockIcon'
  return MockIcon
})

beforeEach(() => link.send.mockReset())

it('keeps a copyable fact stable while exposing copy feedback', async () => {
  const value = 'https://rpc.example/long/path'
  const { user } = render(
    <RequestFact copyLabel='Copy RPC' displayValue='rpc.example/…' label='RPC' value={value} />
  )
  const copy = screen.getByRole('button', { name: 'Copy RPC' })

  await user.hover(copy)
  expect(copy.textContent).toContain('rpc.example/…')
  expect(copy.textContent).not.toContain(value)

  await user.click(copy)
  expect(copy.textContent).toContain('rpc.example/…')
  expect(screen.getByRole('status').textContent).toBe('Copied')
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', value)
})

it('uses neutral terminal feedback for a declined lightweight request', () => {
  render(
    <LightweightRequest
      eyebrow='Request'
      help='Review this request.'
      icon='network'
      req={{ handlerId: 'request-1', status: 'declined' }}
      title='Review request'
    />
  )

  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.getByTestId('icon-close')).toBeTruthy()
  expect(screen.queryByTestId('icon-blocked')).toBeNull()
})
