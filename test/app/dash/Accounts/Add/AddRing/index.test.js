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

describe('entering private key', () => {
  const setupComponent = () => {
    const { user } = render(<AddRing accountData={{}} />, { advanceTimersAfterInput: true })

    return {
      user,
      getTitle: () => screen.getAllByRole('heading')[0],
      getNextButton: () => screen.getByRole('button', { name: 'Next' }),
      enterPrivateKey: async (text) => user.type(screen.getByRole('textbox', { name: 'Private key' }), text)
    }
  }

  it('should display the correct title when entering the private key', () => {
    const { getTitle, getNextButton } = setupComponent()

    expect(getTitle().textContent).toBe('Private key')
    expect(getNextButton().disabled).toBe(true)
  })

  it('should show an error message when private key is an invalid hex string', async () => {
    const { enterPrivateKey } = setupComponent()

    await enterPrivateKey('INVALID')

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid private key')
  })

  it('should show an error message when private key is invalid', async () => {
    const { enterPrivateKey } = setupComponent()

    await enterPrivateKey('0xffffffffffffffffffffffffffffffffbaaedce6af48a03bbfd25e8cd0364148')

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid private key')
  })

  it('should update the navigation with the password entry screen when a private key is submitted', async () => {
    const { user, enterPrivateKey, getNextButton } = setupComponent()

    await enterPrivateKey(privateKey)
    await user.click(getNextButton())

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: {
        showAddAccounts: true,
        newAccountType: 'keyring',
        accountData: {
          secret: privateKey
        }
      }
    })
  })

  it('submits a valid private key from the keyboard', async () => {
    const { user, enterPrivateKey } = setupComponent()

    await enterPrivateKey(privateKey)
    await user.keyboard('{Enter}')

    expect(link.send).toHaveBeenCalledWith(
      'nav:forward',
      'dash',
      expect.objectContaining({
        data: expect.objectContaining({ accountData: { secret: privateKey } })
      })
    )
  })

  it('unlocks private-key entry when the step is revisited', async () => {
    const view = render(<AddRing accountData={{}} />, { advanceTimersAfterInput: true })
    const input = screen.getByRole('textbox', { name: 'Private key' })

    await view.user.type(input, privateKey)
    await view.user.click(screen.getByRole('button', { name: 'Next' }))
    view.rerender(<AddRing accountData={{ secret: privateKey }} />)
    view.rerender(<AddRing accountData={{}} />)

    expect(screen.getByRole('alert').textContent).toBe('Enter private key')
    await view.user.type(screen.getByRole('textbox', { name: 'Private key' }), privateKey)
    await view.user.click(screen.getByRole('button', { name: 'Next' }))
    expect(link.send).toHaveBeenCalledTimes(2)
  })
})

describe('entering password', () => {
  it('should update the navigation to the confirmation screen when a password is submitted', async () => {
    const { user } = render(<AddRing accountData={{ secret: privateKey }} />, {
      advanceTimersAfterInput: true
    })

    const passwordEntryTextArea = screen.getByRole('textbox', { name: 'Create Password' })
    await user.type(passwordEntryTextArea, password)

    const confirmButton = screen.getByRole('button', { name: 'Continue' })
    await user.click(confirmButton)

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'accounts',
      data: {
        showAddAccounts: true,
        newAccountType: 'keyring',
        accountData: {
          secret: privateKey,
          password,
          creationArgs: []
        }
      }
    })
  })
})

describe('confirming password', () => {
  const setupComponent = () => {
    const { user } = render(<AddRing accountData={{ secret: privateKey, password }} />, {
      advanceTimersAfterInput: true
    })

    return {
      user,
      getConfirmButton: () => screen.getByRole('button', { name: 'Create' }),
      enterPasswordConfirmation: async (text) =>
        user.type(screen.getByRole('textbox', { name: 'Confirm Password' }), text)
    }
  }

  it('should try to create a private key account when a matching password is submitted', async () => {
    const { user, enterPasswordConfirmation, getConfirmButton } = setupComponent()

    await enterPasswordConfirmation(password)
    await user.click(getConfirmButton())

    expect(link.rpc).toHaveBeenCalledWith('createFromPrivateKey', privateKey, password, expect.any(Function))
  })

  it('should remove the previous screens related to adding an account from the navigation', async () => {
    link.rpc.mockImplementationOnce((action, secret, passwd, cb) => {
      expect(action).toBe('createFromPrivateKey')
      expect(secret).toBe(privateKey)
      expect(passwd).toBe(password)
      cb(null, { id: '1234' })
    })

    const { user, enterPasswordConfirmation, getConfirmButton } = setupComponent()

    await enterPasswordConfirmation(password)
    await user.click(getConfirmButton())

    expect(link.send).toHaveBeenCalledWith('nav:back', 'dash', 4)
  })

  it('should update the navigation to view the newly created account', async () => {
    link.rpc.mockImplementationOnce((action, secret, passwd, cb) => {
      expect(action).toBe('createFromPrivateKey')
      expect(secret).toBe(privateKey)
      expect(passwd).toBe(password)
      cb(null, { id: '1234' })
    })

    const { user, enterPasswordConfirmation, getConfirmButton } = setupComponent()

    await enterPasswordConfirmation(password)
    await user.click(getConfirmButton())

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'expandedSigner',
      data: { signer: '1234' }
    })
  })
})
