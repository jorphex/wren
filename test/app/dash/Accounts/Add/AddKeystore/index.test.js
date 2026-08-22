import Restore from 'react-restore'
import { act, screen, render } from '../../../../../componentSetup'

import store from '../../../../../../main/store'
import link from '../../../../../../resources/link'
import AddKeystoreAccountComponent from '../../../../../../app/dash/Accounts/Add/AddKeystore'

const keystore =
  '{"address":"0x91248de71222f40fa27f66f42ea07a6e58a259ed","crypto":{"kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"633bd27a4b2a8103cb7e88159bc4d97eb7a31a9a9ad2823f4365519932b63db1"},"cipher":"aes-128-ctr","ciphertext":"7cf2eda36f15bb033df75c4313a0d780ae7f80a6fb2ff0483113b1dd3b6d293e","cipherparams":{"iv":"6eccc2fcb8f5a85eb8383a71c00c889d"},"mac":"4cfdb4463acdd990d372fc68e87a3f2a393783ce92c0201d547eda17955c533b"},"id":"ce6f4a5f-0257-458b-b640-3ff5eebe5da2","version":3}'
const keystorePassword = 'keystorepassword123'
const signerPassword = 'thisisagoodpassword123'

jest.mock('../../../../../../main/store/persist')
jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn().mockResolvedValue({}),
  send: jest.fn(),
  rpc: jest.fn()
}))

const AddKeystore = Restore.connect(AddKeystoreAccountComponent, store)

const setupComponent = () => render(<AddKeystore />, { advanceTimersAfterInput: true })

const advanceToKeystorePassword = async (view) => {
  link.rpc.mockImplementationOnce((action, callback) => callback(null, keystore))
  await view.user.click(screen.getByRole('button', { name: 'Choose keystore JSON file' }))
  act(() => jest.advanceTimersByTime(640))
  view.rerender(<AddKeystore accountSetupStep='keystorePassword' />)
}

const advanceToSignerPassword = async (view) => {
  await advanceToKeystorePassword(view)
  await view.user.type(screen.getByRole('textbox', { name: 'Enter keystore password' }), keystorePassword)
  await view.user.click(screen.getByRole('button', { name: 'Continue' }))
  view.rerender(<AddKeystore accountSetupStep='password' />)
}

const advanceToConfirmation = async (view) => {
  await advanceToSignerPassword(view)
  await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), signerPassword)
  await view.user.click(screen.getByRole('button', { name: 'Continue' }))
  view.rerender(<AddKeystore accountSetupStep='confirm' />)
}

describe('selecting a keystore', () => {
  it('keeps located keystore contents out of navigation data', async () => {
    const view = render(<AddKeystore />, { advanceTimersAfterInput: 0 })
    await advanceToKeystorePassword(view)

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'keystore', accountSetupStep: 'keystorePassword' }
    })
  })

  it('cancels the delayed file picker when the flow unmounts', async () => {
    const view = render(<AddKeystore />, { advanceTimersAfterInput: 0 })

    await view.user.click(screen.getByRole('button', { name: 'Choose keystore JSON file' }))
    view.unmount()
    act(() => jest.advanceTimersByTime(640))

    expect(link.rpc).not.toHaveBeenCalledWith('locateKeystore', expect.any(Function))
  })
})

describe('entering passwords', () => {
  it('keeps keystore and signer passwords out of navigation data', async () => {
    const view = setupComponent()
    await advanceToKeystorePassword(view)
    expect(
      screen.getByRole('textbox', { name: 'Enter keystore password' }).getAttribute('autocomplete')
    ).toBe('off')
    await view.user.type(screen.getByRole('textbox', { name: 'Enter keystore password' }), keystorePassword)
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    view.rerender(<AddKeystore accountSetupStep='password' />)

    expect(link.send).toHaveBeenLastCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'keystore', accountSetupStep: 'password' }
    })

    await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), signerPassword)
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(link.send).toHaveBeenLastCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: { showAddAccounts: true, newAccountType: 'keystore', accountSetupStep: 'confirm' }
    })
  })

  it('sends the secrets only to the signer-creation IPC', async () => {
    const view = setupComponent()
    await advanceToConfirmation(view)

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), signerPassword)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    expect(link.rpc).toHaveBeenCalledWith(
      'createFromKeystore',
      keystore,
      signerPassword,
      keystorePassword,
      { allowWeakPassword: false },
      expect.any(Function)
    )
  })
})
