import { render, screen } from '../../../../../componentSetup'
import { ProviderRequest } from '../../../../../../app/tray/Account/Requests/ProviderRequest'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({ send: jest.fn() }))

beforeEach(() => link.send.mockReset())

it('explains account visibility boundaries and copies the shared address', async () => {
  const address = '0x0000000000000000000000000000000000000001'
  const { user } = render(
    <ProviderRequest
      accountName='Workshop'
      originName='example.test'
      req={{ handlerId: 'access-request', type: 'access', account: address }}
    />
  )

  expect(screen.getByText('Share Workshop with this site?')).toBeTruthy()
  expect(screen.getByText('This account only')).toBeTruthy()
  expect(screen.getByText('Each request appears separately for your review.')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Copy shared account address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)
  expect(screen.getByText('Copied')).toBeTruthy()
})
