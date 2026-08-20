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
  expect(screen.getByText(/not included in profile backups/i)).toBeTruthy()
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
