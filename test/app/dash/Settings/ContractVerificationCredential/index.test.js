import { ContractVerificationCredential } from '../../../../../app/dash/Settings/ContractVerificationCredential'
import { act, render, screen } from '../../../../componentSetup'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({ invoke: jest.fn() }))

const available = { available: true, configured: false, backend: 'secret_service' }

beforeEach(() => link.invoke.mockReset())

it('fails closed when OS credential protection is unavailable', async () => {
  link.invoke.mockResolvedValue({
    success: true,
    credential: { available: false, configured: false, backend: 'unsupported' }
  })
  const view = render(<ContractVerificationCredential />)

  expect(await screen.findByText('Secure storage unavailable')).toBeTruthy()
  expect(screen.queryByLabelText('Etherscan API key')).toBeNull()
  expect(screen.getByText(/OS credential protection is unavailable/i)).toBeTruthy()
  expect(screen.queryByText(/Stored with OS credential protection/i)).toBeNull()
  expect(screen.getByText(/not included in profile backups/i)).toBeTruthy()
  view.unmount()
})

it('does not claim OS protection when credential status cannot be checked', async () => {
  link.invoke.mockResolvedValue({ success: false, error: 'credential-unavailable' })
  const view = render(<ContractVerificationCredential />)

  expect(await screen.findByText('Storage status unavailable')).toBeTruthy()
  expect(screen.getByText(/could not confirm OS credential protection/i)).toBeTruthy()
  expect(screen.queryByText(/Stored with OS credential protection/i)).toBeNull()
  expect(screen.queryByLabelText('Etherscan API key')).toBeNull()
  view.unmount()
})

it('shows the accepted format while Save is disabled', async () => {
  link.invoke.mockResolvedValue({ success: true, credential: available })
  const view = render(<ContractVerificationCredential />)
  const input = await screen.findByLabelText('Etherscan API key')
  const save = screen.getByRole('button', { name: 'Save' })
  const format = screen.getByText('Use 16–128 letters, numbers, underscores, or hyphens.')

  expect(save.disabled).toBe(true)
  expect(save.getAttribute('aria-describedby')).toBe(format.id)
  expect(input.getAttribute('aria-describedby')).toBe(format.id)
  await view.user.type(input, 'not valid')
  expect(save.disabled).toBe(true)
  expect(screen.getByText('Use 16–128 letters, numbers, underscores, or hyphens.')).toBeTruthy()
  await view.user.clear(input)
  await view.user.type(input, 'etherscan_key_1234')
  expect(save.disabled).toBe(false)
  expect(screen.queryByText('Use 16–128 letters, numbers, underscores, or hyphens.')).toBeNull()
  view.unmount()
})

it('allows removal when a stored key becomes unavailable to the current OS backend', async () => {
  link.invoke
    .mockResolvedValueOnce({
      success: true,
      credential: { available: false, configured: true, backend: 'unsupported' }
    })
    .mockResolvedValueOnce({
      success: true,
      credential: { available: false, configured: false, backend: 'unsupported' }
    })
  const view = render(<ContractVerificationCredential />)

  await view.user.click(await screen.findByRole('button', { name: 'Remove' }))

  expect(link.invoke).toHaveBeenLastCalledWith('contractVerification:removeCredential')
  expect(await screen.findByText('Etherscan API key removed.')).toBeTruthy()
  view.unmount()
})

it('clears the transient key before secure storage completes', async () => {
  let finishSave
  link.invoke.mockImplementation((channel) => {
    if (channel === 'contractVerification:credentialStatus') {
      return Promise.resolve({ success: true, credential: available })
    }
    return new Promise((resolve) => {
      finishSave = resolve
    })
  })
  const view = render(<ContractVerificationCredential />)
  const input = await screen.findByLabelText('Etherscan API key')
  const apiKey = 'etherscan_key_1234567890'

  await view.user.type(input, apiKey)
  await view.user.click(screen.getByRole('button', { name: 'Save' }))

  expect(link.invoke).toHaveBeenCalledWith('contractVerification:saveCredential', apiKey)
  expect(input.value).toBe('')
  expect(view.container.textContent).not.toContain(apiKey)

  await act(async () => {
    finishSave({ success: true, credential: { ...available, configured: true } })
  })
  expect(await screen.findByText('Etherscan API key saved.')).toBeTruthy()
  expect(screen.getByLabelText('Replace Etherscan API key').value).toBe('')
  view.unmount()
})

it('removes the stored credential without exposing it', async () => {
  link.invoke
    .mockResolvedValueOnce({ success: true, credential: { ...available, configured: true } })
    .mockResolvedValueOnce({ success: true, credential: available })
  const view = render(<ContractVerificationCredential />)

  await view.user.click(await screen.findByRole('button', { name: 'Remove' }))

  expect(link.invoke).toHaveBeenLastCalledWith('contractVerification:removeCredential')
  expect(await screen.findByText('Etherscan API key removed.')).toBeTruthy()
  expect(screen.getByLabelText('Etherscan API key')).toBeTruthy()
  view.unmount()
})
