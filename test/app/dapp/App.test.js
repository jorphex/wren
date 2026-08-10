import { FailedToLoad, LoadingDapp } from '../../../app/dapp/App'
import link from '../../../resources/link'
import { render, screen } from '../../componentSetup'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))

beforeEach(() => link.send.mockReset())

it('shows a generic cancellable embedded-dapp loading state without network assumptions', async () => {
  const { user } = render(<LoadingDapp />)

  expect(screen.getByRole('status').textContent).toContain('Loading dapp')
  expect(screen.queryByText(/Mainnet|ENS|Send/)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(link.send).toHaveBeenCalledWith('frame:close')
})

it('shows a recoverable generic failure and closes the embedded frame', async () => {
  const { user } = render(<FailedToLoad dappId='installed-dapp' />)

  expect(screen.getByRole('alert').textContent).toContain('Could not load dapp')
  await user.click(screen.getByRole('button', { name: 'Retry' }))

  expect(link.send).toHaveBeenNthCalledWith(1, 'tray:action', 'retryDapp', 'installed-dapp')
  expect(link.send).toHaveBeenNthCalledWith(2, 'frame:close')
  link.send.mockClear()
  await user.click(screen.getByRole('button', { name: 'Close' }))

  expect(link.send).toHaveBeenCalledWith('frame:close')
})
