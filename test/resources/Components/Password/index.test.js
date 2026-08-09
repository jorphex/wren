import { screen, render } from '../../../componentSetup'
import { CreatePassword, ConfirmPassword } from '../../../../resources/Components/Password'

const validPassword = 'thisisagoodpassword123'

describe('creating password', () => {
  const setupComponent = ({ onCreate = jest.fn() } = {}) => {
    const { user } = render(<CreatePassword {...{ password: validPassword, onCreate }} />, {
      advanceTimersAfterInput: true
    })

    return {
      user,
      getSubmitButton: () => screen.getByRole('button', { name: 'Continue' }),
      enterPassword: async (text) => user.type(screen.getByRole('textbox', { name: 'Create Password' }), text)
    }
  }

  it('should display the correct title when entering the password', () => {
    setupComponent()

    expect(screen.getByRole('heading').textContent).toBe('Create Password')
  })

  it('should show an error when the password is too short', async () => {
    const { enterPassword } = setupComponent()

    await enterPassword('INVALID')

    expect(screen.getByRole('alert').textContent).toBe('PASSWORD MUST BE AT LEAST 12 CHARACTERS')
  })

  it('should show the warning when the password is too weak', async () => {
    const { enterPassword } = setupComponent()

    await enterPassword('aaaaaaaaaaaa')

    expect(screen.getByRole('alert').textContent).toBe('REPEATS LIKE "AAA" ARE EASY TO GUESS')
  })

  it('should show the continue button when a valid password is entered', async () => {
    const { enterPassword, getSubmitButton } = setupComponent()

    await enterPassword(validPassword)

    expect(getSubmitButton().textContent).toBe('Continue')
  })

  it('should call the onCreate function when a password is submitted', async () => {
    const onCreate = jest.fn()
    const { user, enterPassword, getSubmitButton } = setupComponent({ onCreate })

    await enterPassword(validPassword)
    await user.click(getSubmitButton())

    expect(onCreate).toHaveBeenCalledWith(validPassword)
  })
})

describe('confirming password', () => {
  const setupComponent = ({ onConfirm = jest.fn() } = {}) => {
    const { user } = render(<ConfirmPassword {...{ password: validPassword, onConfirm }} />, {
      advanceTimersAfterInput: true
    })

    return {
      user,
      getConfirmButton: () => screen.getByRole('button', { name: 'Create' }),
      enterPassword: async (text) =>
        user.type(screen.getByRole('textbox', { name: 'Confirm Password' }), text)
    }
  }
  it('should show an error when the password does not match previously entered password', async () => {
    const { enterPassword } = setupComponent()

    await enterPassword('DOES_NOT_MATCH')

    expect(screen.getByRole('alert').textContent).toBe('PASSWORDS DO NOT MATCH')
  })

  it('should show the create button when a valid password is entered', async () => {
    const { enterPassword, getConfirmButton } = setupComponent()

    await enterPassword(validPassword)

    expect(getConfirmButton().textContent).toBe('Create')
  })

  it('should call the onConfirm function when the password is confirmed', async () => {
    const onConfirm = jest.fn()
    const { user, enterPassword, getConfirmButton } = setupComponent({ onConfirm })

    await enterPassword(validPassword)
    await user.click(getConfirmButton())

    expect(onConfirm).toHaveBeenCalledWith(validPassword)
  })

  it('submits a valid confirmation from the keyboard', async () => {
    const onConfirm = jest.fn()
    const { user, enterPassword } = setupComponent({ onConfirm })

    await enterPassword(validPassword)
    await user.keyboard('{Enter}')

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('locks final confirmation against repeated activation', async () => {
    const onConfirm = jest.fn()
    const { user, enterPassword, getConfirmButton } = setupComponent({ onConfirm })

    await enterPassword(validPassword)
    await user.dblClick(getConfirmButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('unlocks final confirmation when the step is revisited after a failed creation', async () => {
    const onConfirm = jest.fn()
    const view = render(
      <ConfirmPassword password={validPassword} onConfirm={onConfirm} active={true} lastStep={true} />,
      { advanceTimersAfterInput: true }
    )

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm Password' }), validPassword)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('status').textContent).toBe('Processing...')

    view.rerender(
      <ConfirmPassword password={validPassword} onConfirm={onConfirm} active={false} lastStep={true} />
    )
    view.rerender(
      <ConfirmPassword password={validPassword} onConfirm={onConfirm} active={true} lastStep={true} />
    )

    expect(screen.getByRole('alert').textContent).toBe('Enter password')
    await view.user.type(screen.getByRole('textbox', { name: 'Confirm Password' }), validPassword)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
