import link from '../../../../../resources/link'
import { SignerProtection } from '../../../../../app/dash/Settings/SignerProtection'
import { fireEvent, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ invoke: jest.fn() }))

const status = (overrides = {}) => ({
  available: true,
  backend: 'gnome_libsecret',
  enabled: false,
  protectedFiles: 0,
  signerFiles: 2,
  state: 'disabled',
  ...overrides
})

beforeEach(() => link.invoke.mockReset())

it('explains the independent password and backup boundaries before opt-in', async () => {
  link.invoke.mockResolvedValue({ success: true, status: status() })
  render(<SignerProtection />)

  await screen.findByRole('button', { name: 'Enable protection' })
  expect(
    screen.getByText(/signer password and portable encrypted backups continue to work independently/)
  ).toBeTruthy()
  expect(link.invoke).toHaveBeenCalledWith('signers:protectionStatus')
})

it('requires explicit confirmation before enabling device protection', async () => {
  link.invoke.mockResolvedValueOnce({ success: true, status: status() }).mockResolvedValueOnce({
    success: true,
    status: status({ enabled: true, protectedFiles: 2, state: 'enabled' })
  })
  render(<SignerProtection />)

  fireEvent.click(await screen.findByRole('button', { name: 'Enable protection' }))
  expect(link.invoke).toHaveBeenCalledTimes(1)
  const dialog = screen.getByRole('alertdialog', { name: 'Protect software signers with this device?' })
  expect(dialog.textContent).toContain('Export an encrypted backup for recovery on another device')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

  fireEvent.click(screen.getByRole('button', { name: 'Enable device protection' }))
  await screen.findByRole('status')
  expect(link.invoke).toHaveBeenLastCalledWith('signers:enableProtection', 'ENABLE_OS_SIGNER_PROTECTION')
  expect(screen.getByRole('status').textContent).toBe('Device protection enabled for software signers.')
  expect(screen.getByText(/Your signer password is still required/)).toBeTruthy()
})

it('makes clear that insecure basic-text storage is refused', async () => {
  link.invoke.mockResolvedValue({
    success: true,
    status: status({ available: false, backend: 'basic_text', state: 'unavailable' })
  })
  render(<SignerProtection />)

  await screen.findByRole('button', { name: 'Retry' })
  expect(screen.getByText(/refuses Electron’s insecure basic-text fallback/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Enable protection' })).toBeNull()
})

it('directs a protected profile on another operating system to portable recovery', async () => {
  link.invoke.mockResolvedValue({
    success: true,
    status: status({
      available: false,
      backend: 'unsupported',
      enabled: true,
      protectedFiles: 2,
      state: 'unsupported'
    })
  })
  render(<SignerProtection />)

  expect(await screen.findByText(/cannot be opened here/)).toBeTruthy()
  expect(screen.getByText(/Restore a portable encrypted backup instead/)).toBeTruthy()
})

it('offers both safe recovery directions after an interrupted transition', async () => {
  link.invoke.mockResolvedValue({
    success: true,
    status: status({ enabled: true, protectedFiles: 1, state: 'recovery-required' })
  })
  render(<SignerProtection />)

  expect(await screen.findByRole('button', { name: 'Restore password-only' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Finish enabling' })).toBeTruthy()
  expect(screen.getByText(/Software signers stay unavailable/)).toBeTruthy()
})

it('does not expose main-process error details when a change fails', async () => {
  link.invoke
    .mockResolvedValueOnce({ success: true, status: status() })
    .mockResolvedValueOnce({ success: false, error: '/private/keyring/path failed' })
  render(<SignerProtection />)

  fireEvent.click(await screen.findByRole('button', { name: 'Enable protection' }))
  fireEvent.click(screen.getByRole('button', { name: 'Enable device protection' }))
  await screen.findByRole('alert')

  expect(screen.getByRole('alert').textContent).toContain('No weaker fallback was used')
  expect(document.body.textContent).not.toContain('/private/keyring/path')
})
