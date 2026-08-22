import link from '../../../../../resources/link'
import { Recovery } from '../../../../../app/dash/Settings/Recovery'
import { fireEvent, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ invoke: jest.fn() }))

const password = 'orchard-sparrow-26'
const backup = {
  formatVersion: 1,
  createdAt: '2026-08-12T14:00:00.000Z',
  signerCount: 3
}
const restoreToken = '11111111-1111-4111-8111-111111111111'

beforeEach(() => link.invoke.mockReset())

const startExport = () => fireEvent.click(screen.getByRole('button', { name: 'Export backup' }))
const startRestore = () => fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))

const fillExportPasswords = (value = password, confirmation = value) => {
  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirmation } })
}

it('explains the encrypted backup scope and opens one inline workflow at a time', () => {
  render(<Recovery />)

  expect(screen.getByText(/Live balances, rates, and pending requests are left out/)).toBeTruthy()
  startExport()

  expect(screen.getByRole('dialog', { name: 'Export encrypted backup' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('Backup password'))
  expect(screen.getByRole('button', { name: 'Restore backup' }).disabled).toBe(true)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('requires a new matching password with at least 8 characters before export', () => {
  render(<Recovery />)
  startExport()

  fillExportPasswords('short', 'short')
  fireEvent.submit(screen.getByRole('dialog', { name: 'Export encrypted backup' }))
  expect(screen.getByRole('alert').textContent).toBe('Use at least 8 characters.')
  expect(link.invoke).not.toHaveBeenCalled()

  fillExportPasswords(password, `${password}-different`)
  fireEvent.submit(screen.getByRole('dialog', { name: 'Export encrypted backup' }))
  expect(screen.getByRole('alert').textContent).toBe('The passwords do not match.')
  expect(link.invoke).not.toHaveBeenCalled()
})

it('exports through the profile IPC and reports success without retaining the password fields', async () => {
  link.invoke.mockResolvedValue({ success: true, bytes: 4096 })
  render(<Recovery />)
  startExport()
  fillExportPasswords()

  fireEvent.submit(screen.getByRole('dialog', { name: 'Export encrypted backup' }))
  await screen.findByRole('status')

  expect(link.invoke).toHaveBeenCalledWith('profile:export', password)
  expect(screen.getByRole('status').textContent).toBe('Encrypted backup saved (4 KB).')
  expect(screen.queryByLabelText('Backup password')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('status'))
})

it('handles export cancellation and bounded errors without claiming a backup exists', async () => {
  link.invoke
    .mockResolvedValueOnce({ success: false, canceled: true })
    .mockResolvedValueOnce({ success: false, error: '/private/path must not be exposed' })
  render(<Recovery />)

  startExport()
  fillExportPasswords()
  fireEvent.submit(screen.getByRole('dialog', { name: 'Export encrypted backup' }))
  await screen.findByRole('status')
  expect(screen.getByRole('status').textContent).toBe('Export canceled. No backup was written.')

  startExport()
  fillExportPasswords()
  fireEvent.submit(screen.getByRole('dialog', { name: 'Export encrypted backup' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe(
    'Couldn’t export the encrypted backup. Nothing was changed. Try again.'
  )
  expect(document.body.textContent).not.toContain('/private/path')
})

it('inspects a selected backup before exposing the destructive replacement confirmation', async () => {
  link.invoke.mockResolvedValue({
    success: true,
    backup,
    restoreToken,
    tokenExpiresAt: '2026-08-12T14:05:00.000Z'
  })
  render(<Recovery />)
  startRestore()
  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: password } })

  fireEvent.submit(screen.getByRole('dialog', { name: 'Inspect encrypted backup' }))
  await screen.findByRole('alertdialog')

  expect(link.invoke).toHaveBeenCalledWith('profile:inspectBackup', password)
  const confirmation = screen.getByRole('alertdialog', { name: 'Replace this Wren profile?' })
  expect(confirmation.hasAttribute('aria-modal')).toBe(false)
  expect(confirmation.textContent).toContain('Version 1')
  expect(confirmation.textContent).toContain('Signer records3')
  expect(confirmation.textContent).toContain('atomically replaces the current profile')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
})

it('treats restore file selection cancellation as a no-change outcome', async () => {
  link.invoke.mockResolvedValue({ success: false, canceled: true })
  render(<Recovery />)
  startRestore()
  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: password } })

  fireEvent.submit(screen.getByRole('dialog', { name: 'Inspect encrypted backup' }))
  await screen.findByRole('status')

  expect(screen.getByRole('status').textContent).toBe('Restore canceled. Your current profile is unchanged.')
  expect(screen.queryByLabelText('Backup password')).toBeNull()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('cancels replacement with Escape and never stages the inspected backup', async () => {
  link.invoke.mockResolvedValue({
    success: true,
    backup,
    restoreToken,
    tokenExpiresAt: '2026-08-12T14:05:00.000Z'
  })
  const { user } = render(<Recovery />)
  startRestore()
  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: password } })
  fireEvent.submit(screen.getByRole('dialog', { name: 'Inspect encrypted backup' }))
  await screen.findByRole('alertdialog')

  await user.keyboard('{Escape}')

  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(link.invoke).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore backup' }))
})

it('stages the exact inspected backup token only after explicit replacement confirmation', async () => {
  link.invoke
    .mockResolvedValueOnce({
      success: true,
      backup,
      restoreToken,
      tokenExpiresAt: '2026-08-12T14:05:00.000Z'
    })
    .mockResolvedValueOnce({
      success: true,
      restore: {
        restoreId: '22222222-2222-4222-8222-222222222222',
        stagedAt: '2026-08-12T14:01:00.000Z',
        expiresAt: '2026-08-12T14:11:00.000Z',
        signerCount: 3,
        relaunchRequired: true
      }
    })
  render(<Recovery />)
  startRestore()
  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: password } })
  fireEvent.submit(screen.getByRole('dialog', { name: 'Inspect encrypted backup' }))
  await screen.findByRole('alertdialog')

  fireEvent.click(screen.getByRole('button', { name: 'Replace this Wren profile' }))
  await screen.findByRole('status')

  expect(link.invoke).toHaveBeenLastCalledWith(
    'profile:stageRestore',
    restoreToken,
    password,
    'REPLACE_PROFILE_ON_RESTART'
  )
  expect(screen.getByRole('status').textContent).toContain('restarting to replace this profile atomically')
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('keeps the current profile in place after inspect or staging failure', async () => {
  link.invoke
    .mockResolvedValueOnce({ success: false, error: 'bad password' })
    .mockResolvedValueOnce({
      success: true,
      backup,
      restoreToken,
      tokenExpiresAt: '2026-08-12T14:05:00.000Z'
    })
    .mockResolvedValueOnce({ success: false, error: 'token expired' })
  render(<Recovery />)

  startRestore()
  fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: password } })
  fireEvent.submit(screen.getByRole('dialog', { name: 'Inspect encrypted backup' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toContain('Check the file and password')

  fireEvent.submit(screen.getByRole('dialog', { name: 'Inspect encrypted backup' }))
  await screen.findByRole('alertdialog')
  fireEvent.click(screen.getByRole('button', { name: 'Replace this Wren profile' }))
  await screen.findByRole('status')
  expect(screen.getByRole('status').textContent).toBe(
    'Couldn’t stage this restore. Your current profile is unchanged. Inspect the backup again.'
  )
  expect(document.body.textContent).not.toContain('token expired')
})
