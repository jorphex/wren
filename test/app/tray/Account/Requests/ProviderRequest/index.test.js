import { fireEvent, render, screen } from '../../../../../componentSetup'
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

  const copyAddress = screen.getByRole('button', { name: 'Copy shared account address' })
  expect(copyAddress.textContent).toBe('0x0000…0001')
  await user.hover(copyAddress)
  expect(copyAddress.textContent).toBe('0x0000…0001')
  await user.unhover(copyAddress)
  expect(copyAddress.textContent).toBe('0x0000…0001')

  fireEvent.focus(copyAddress)
  expect(copyAddress.textContent).toBe('0x0000…0001')
  fireEvent.blur(copyAddress)
  expect(copyAddress.textContent).toBe('0x0000…0001')

  await user.click(copyAddress)
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)
  expect(screen.getByText('Copied')).toBeTruthy()
})
