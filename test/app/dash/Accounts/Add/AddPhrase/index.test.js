import Restore from 'react-restore'

import { act, fireEvent, screen, render } from '../../../../../componentSetup'
import store from '../../../../../../main/store'
import link from '../../../../../../resources/link'
import AddPhraseAccountComponent from '../../../../../../app/dash/Accounts/Add/AddPhrase'

const phrase = 'there lab weapon cost bounce smart trial pulse ceiling beach upset hockey illegal chef leaf'
const password = 'thisisagoodpassword123'

jest.mock('../../../../../../main/store/persist')
jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn().mockResolvedValue({}),
  send: jest.fn(),
  rpc: jest.fn()
}))

const AddPhrase = Restore.connect(AddPhraseAccountComponent, store)

const setupComponent = () => render(<AddPhrase />, { advanceTimersAfterInput: true })

const enterPhrase = (user) => user.type(screen.getByRole('textbox', { name: 'Recovery phrase' }), phrase)

const advanceToPassword = async (view) => {
  await enterPhrase(view.user)
  await view.user.click(screen.getByRole('button', { name: 'Next' }))
  view.rerender(<AddPhrase accountSetupStep='password' />)
}

const advanceToConfirmation = async (view) => {
  await advanceToPassword(view)
  await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
  await view.user.click(screen.getByRole('button', { name: 'Continue' }))
  view.rerender(<AddPhrase accountSetupStep='confirm' />)
}

describe('entering seed phrase', () => {
  it('should display the correct title when entering the seed phrase', () => {
    setupComponent()

    expect(screen.getAllByRole('heading')[0].textContent).toBe('Recovery phrase')
  })

  it('protects the recovery-phrase input from text assistance', () => {
    setupComponent()

    const input = screen.getByRole('textbox', { name: 'Recovery phrase' })
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('none')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  it('should show an error message when an incorrect seed phrase is submitted', async () => {
    const view = setupComponent()

    await view.user.type(screen.getByRole('textbox', { name: 'Recovery phrase' }), 'INVALID')

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid recovery phrase')
  })

  it('keeps a submitted seed phrase out of navigation data', async () => {
    const view = setupComponent()

    await enterPhrase(view.user)
    await view.user.click(screen.getByRole('button', { name: 'Next' }))

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'seed', accountSetupStep: 'password' }
    })
  })

  it('normalizes a multiline pasted seed phrase without concatenating words', async () => {
    const view = setupComponent()
    const input = screen.getByRole('textbox', { name: 'Recovery phrase' })
    fireEvent.change(input, { target: { value: phrase.replaceAll(' ', '\n') } })
    act(() => jest.advanceTimersByTime(300))

    await view.user.click(screen.getByRole('button', { name: 'Next' }))

    expect(link.send).toHaveBeenCalledWith(
      'nav:forward',
      'dash',
      expect.objectContaining({ data: expect.not.objectContaining({ accountData: expect.anything() }) })
    )
  })

  it('preserves modified and composing Enter for multiline phrase entry', async () => {
    const view = setupComponent()
    const input = screen.getByRole('textbox', { name: 'Recovery phrase' })

    await enterPhrase(view.user)
    await view.user.keyboard('{Shift>}{Enter}{/Shift}')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(link.send).not.toHaveBeenCalled()
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
      data: { showAddAccounts: true, newAccountType: 'seed', accountSetupStep: 'confirm' }
    })
  })
})

describe('confirming password', () => {
  it('sends the recovery phrase and password only to the signer-creation IPC', async () => {
    const view = setupComponent()
    await advanceToConfirmation(view)

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    expect(link.rpc).toHaveBeenCalledWith('createFromPhrase', phrase, password, expect.any(Function))
  })

  it('clears the draft before displaying an error', async () => {
    link.rpc.mockImplementationOnce((action, secret, enteredPassword, cb) => cb('ERROR HERE'))
    const view = setupComponent()
    await advanceToConfirmation(view)

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    expect(link.send).toHaveBeenLastCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'seed', accountSetupStep: 'error', error: 'ERROR HERE' }
    })
    view.rerender(<AddPhrase accountSetupStep='password' />)
    expect(screen.getByRole('textbox', { name: 'Recovery phrase' })).toBeTruthy()
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
