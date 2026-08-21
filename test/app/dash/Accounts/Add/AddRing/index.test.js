import Restore from 'react-restore'

import { render, screen } from '../../../../../componentSetup'
import store from '../../../../../../main/store'
import link from '../../../../../../resources/link'
import AddRingAccountComponent from '../../../../../../app/dash/Accounts/Add/AddRing'

const privateKey = '4001069d4fe9b22dc767dfa7767e72f151e00dafa05d9ef0b89069a4f04820cb'
const password = 'thisisagoodpassword123'

jest.mock('../../../../../../main/store/persist')
jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn().mockResolvedValue({}),
  send: jest.fn(),
  rpc: jest.fn()
}))

const AddRing = Restore.connect(AddRingAccountComponent, store)

const setupComponent = () => render(<AddRing />, { advanceTimersAfterInput: true })

const advanceToPassword = async (view) => {
  await view.user.type(screen.getByRole('textbox', { name: 'Private key' }), privateKey)
  await view.user.click(screen.getByRole('button', { name: 'Next' }))
  view.rerender(<AddRing accountSetupStep='password' />)
}

const advanceToConfirmation = async (view) => {
  await advanceToPassword(view)
  await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
  await view.user.click(screen.getByRole('button', { name: 'Continue' }))
  view.rerender(<AddRing accountSetupStep='confirm' />)
}

describe('entering private key', () => {
  it('should display the correct title when entering the private key', () => {
    setupComponent()

    expect(screen.getAllByRole('heading')[0].textContent).toBe('Private key')
    expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(true)
  })

  it('protects the private-key input from text assistance', () => {
    setupComponent()

    const input = screen.getByRole('textbox', { name: 'Private key' })
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('none')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  it('should show an error message when private key is an invalid hex string', async () => {
    const view = setupComponent()

    await view.user.type(screen.getByRole('textbox', { name: 'Private key' }), 'INVALID')

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid private key')
  })

  it('keeps a submitted private key out of navigation data', async () => {
    const view = setupComponent()

    await view.user.type(screen.getByRole('textbox', { name: 'Private key' }), privateKey)
    await view.user.click(screen.getByRole('button', { name: 'Next' }))

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'keyring', accountSetupStep: 'password' }
    })
  })

  it('submits a valid private key from the keyboard without putting it in navigation', async () => {
    const view = setupComponent()

    await view.user.type(screen.getByRole('textbox', { name: 'Private key' }), privateKey)
    await view.user.keyboard('{Enter}')

    expect(link.send).toHaveBeenCalledWith(
      'nav:forward',
      'dash',
      expect.objectContaining({ data: expect.not.objectContaining({ accountData: expect.anything() }) })
    )
  })

  it('clears the private key when the setup is cancelled', async () => {
    const view = setupComponent()
    await advanceToPassword(view)

    view.rerender(<AddRing />)
    view.rerender(<AddRing accountSetupStep='password' />)

    expect(screen.getByRole('textbox', { name: 'Private key' })).toBeTruthy()
  })
})

describe('entering password', () => {
  it('keeps the new password out of navigation data', async () => {
    const view = setupComponent()
    await advanceToPassword(view)

    const passwordEntry = screen.getByRole('textbox', { name: 'Create password' })
    expect(passwordEntry.getAttribute('autocomplete')).toBe('new-password')
    expect(passwordEntry.getAttribute('autocapitalize')).toBe('none')
    expect(passwordEntry.getAttribute('spellcheck')).toBe('false')
    await view.user.type(passwordEntry, password)
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(link.send).toHaveBeenLastCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'keyring', accountSetupStep: 'confirm' }
    })
  })
})

describe('confirming password', () => {
  it('sends the private key and password only to the signer-creation IPC', async () => {
    const view = setupComponent()
    await advanceToConfirmation(view)

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    expect(link.rpc).toHaveBeenCalledWith('createFromPrivateKey', privateKey, password, expect.any(Function))
  })

  it('removes the previous account-setup screens and opens the signer on success', async () => {
    link.rpc.mockImplementationOnce((action, secret, enteredPassword, cb) => cb(null, { id: '1234' }))
    const view = setupComponent()
    await advanceToConfirmation(view)

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    expect(link.send).toHaveBeenCalledWith('nav:back', 'dash', 4)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'expandedSigner',
      data: { signer: '1234' }
    })
  })
})
