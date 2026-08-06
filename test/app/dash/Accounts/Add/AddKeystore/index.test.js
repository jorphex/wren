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

describe('selecting a keystore', () => {
  it('should display any errors raised whilst selecting the keystore file', async () => {
    link.rpc.mockImplementationOnce((action, cb) => {
      expect(action).toBe('locateKeystore')
      cb('ERROR HERE')
    })

    const { user } = render(<AddKeystore accountData={{}} />, { advanceTimersAfterInput: 650 })
    const selectKeystoreButton = screen.getByRole('button', { name: 'Locate Keystore File (json)' })

    await user.click(selectKeystoreButton)

    expect(screen.getByRole('alert').textContent).toBe('ERROR HERE')

    act(() => jest.advanceTimersByTime(1_500))

    expect(screen.getByRole('button', { name: 'Locate Keystore File (json)' })).toBeTruthy()
  })

  it('should update the navigation with the keystore password entry screen when a keystore file is located', async () => {
    link.rpc.mockImplementationOnce((action, cb) => {
      expect(action).toBe('locateKeystore')
      cb(null, keystore)
    })

    const { user } = render(<AddKeystore accountData={{}} />, { advanceTimersAfterInput: true })
    const selectKeystoreButton = screen.getByRole('button', { name: 'Locate Keystore File (json)' })

    await user.click(selectKeystoreButton)

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: {
        showAddAccounts: true,
        newAccountType: 'keystore',
        accountData: {
          keystore
        }
      }
    })
  })

  it('cancels the delayed file picker when the flow unmounts', async () => {
    const view = render(<AddKeystore accountData={{}} />)

    await view.user.click(screen.getByRole('button', { name: 'Locate Keystore File (json)' }))
    view.unmount()
    act(() => jest.advanceTimersByTime(640))

    expect(link.rpc).not.toHaveBeenCalledWith('locateKeystore', expect.any(Function))
  })

  it('cancels the delayed file picker when navigation leaves the locating step', async () => {
    const view = render(<AddKeystore accountData={{}} />)

    await view.user.click(screen.getByRole('button', { name: 'Locate Keystore File (json)' }))
    view.rerender(<AddKeystore accountData={{ selecting: true }} />)
    view.rerender(<AddKeystore accountData={{}} />)
    act(() => jest.advanceTimersByTime(640))

    expect(link.rpc).not.toHaveBeenCalledWith('locateKeystore', expect.any(Function))
    expect(screen.getByRole('button', { name: 'Locate Keystore File (json)' })).toBeTruthy()
  })

  it('ignores a file picker result after navigation leaves the locating step', async () => {
    let finishSelection
    link.rpc.mockImplementationOnce((action, callback) => {
      expect(action).toBe('locateKeystore')
      finishSelection = callback
    })
    const view = render(<AddKeystore accountData={{}} />)

    await view.user.click(screen.getByRole('button', { name: 'Locate Keystore File (json)' }))
    view.rerender(<AddKeystore accountData={{ selecting: true }} />)
    act(() => jest.advanceTimersByTime(640))
    view.rerender(<AddKeystore accountData={{}} />)
    link.send.mockClear()
    act(() => finishSelection(null, keystore))

    expect(link.send).not.toHaveBeenCalled()
  })
})

describe('entering keystore password', () => {
  it('should update the navigation to the confirmation screen when a password is submitted', async () => {
    const { user } = render(<AddKeystore accountData={{ keystore }} />, {
      advanceTimersAfterInput: true
    })
    const passwordEntryTextArea = screen.getByRole('textbox', { name: 'Enter Keystore Password' })

    await user.type(passwordEntryTextArea, keystorePassword)

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await user.click(continueButton)

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: {
        showAddAccounts: true,
        newAccountType: 'keystore',
        accountData: {
          secret: keystore,
          creationArgs: [keystorePassword]
        }
      }
    })
  })
})

describe('entering signer password', () => {
  it('should update the navigation to the confirmation screen when a password is submitted', async () => {
    const { user } = render(<AddKeystore accountData={{ secret: keystore }} />, {
      advanceTimersAfterInput: true
    })
    const passwordEntryTextArea = screen.getByRole('textbox', { name: 'Create Password' })

    await user.type(passwordEntryTextArea, signerPassword)

    const createButton = screen.getByRole('button', { name: 'Continue' })
    await user.click(createButton)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: {
        showAddAccounts: true,
        newAccountType: 'keystore',
        accountData: {
          secret: keystore,
          password: signerPassword,
          creationArgs: []
        }
      }
    })
  })
})

describe('confirming signer password', () => {
  it('should try to create keystore account when a matching password is submitted', async () => {
    const { user } = render(
      <AddKeystore
        accountData={{ secret: keystore, password: signerPassword, creationArgs: [keystorePassword] }}
      />,
      { advanceTimersAfterInput: true }
    )
    const confirmInput = screen.getByRole('textbox', { name: 'Confirm Password' })
    await user.type(confirmInput, signerPassword)

    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(link.rpc).toHaveBeenCalledWith(
      'createFromKeystore',
      keystore,
      signerPassword,
      keystorePassword,
      expect.any(Function)
    )
  })

  it('should remove the previous screens related to adding an account from the navigation', async () => {
    const { user } = render(
      <AddKeystore
        accountData={{ secret: keystore, password: signerPassword, creationArgs: [keystorePassword] }}
      />,
      { advanceTimersAfterInput: true }
    )
    const confirmInput = screen.getByRole('textbox', { name: 'Confirm Password' })
    link.rpc.mockImplementationOnce((action, secret, passwd, keystorePsswd, cb) => {
      cb(null, { id: '1234' })
    })

    await user.type(confirmInput, signerPassword)

    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(link.send).toHaveBeenCalledWith('nav:back', 'dash', 6)
  })

  it('should update the navigation to view the newly created account', async () => {
    const { user } = render(
      <AddKeystore
        accountData={{ secret: keystore, password: signerPassword, creationArgs: [keystorePassword] }}
      />,
      { advanceTimersAfterInput: true }
    )
    const confirmInput = screen.getByRole('textbox', { name: 'Confirm Password' })
    link.rpc.mockImplementationOnce((action, secret, passwd, keystorePsswd, cb) => {
      cb(null, { id: '1234' })
    })

    await user.type(confirmInput, signerPassword)

    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'expandedSigner',
      data: { signer: '1234' }
    })
  })
})
