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
      enterPassword: async (text) => user.type(screen.getByRole('textbox', { name: 'Create password' }), text)
    }
  }

  it('should display the correct title when entering the password', () => {
    setupComponent()

    expect(screen.getByRole('heading').textContent).toBe('Create password')
  })

  it('supports password-manager creation semantics and an explicit reveal action', async () => {
    const { user } = setupComponent()
    const input = screen.getByRole('textbox', { name: 'Create password' })

    expect(input.getAttribute('autocomplete')).toBe('new-password')
    expect(input.getAttribute('type')).toBe('password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy()
  })

  it('should show an error when the password is too short', async () => {
    const { enterPassword } = setupComponent()

    await enterPassword('INVALID')

    expect(screen.getByRole('alert').textContent).toBe('Password must be at least 12 characters')
  })

  it('should show the warning when the password is too weak', async () => {
    const { enterPassword } = setupComponent()

    await enterPassword('aaaaaaaaaaaa')

    expect(screen.getByRole('alert').textContent).toBe('Repeats like "aaa" are easy to guess')
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
        user.type(screen.getByRole('textbox', { name: 'Confirm password' }), text)
    }
  }
  it('should show an error when the password does not match previously entered password', async () => {
    const { enterPassword } = setupComponent()

    await enterPassword('DOES_NOT_MATCH')

    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match')
  })

  it('uses confirmation-specific empty guidance', () => {
    setupComponent()

    expect(screen.getByText('Enter your password again')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Confirm password' }).getAttribute('aria-describedby')).toBe(
      screen.getByText('Enter your password again').id
    )
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

    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), validPassword)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('status').textContent).toBe('Processing…')

    view.rerender(
      <ConfirmPassword password={validPassword} onConfirm={onConfirm} active={false} lastStep={true} />
    )
    view.rerender(
      <ConfirmPassword password={validPassword} onConfirm={onConfirm} active={true} lastStep={true} />
    )

    expect(screen.getByText('Enter your password again')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), validPassword)
    await view.user.click(screen.getByRole('button', { name: 'Create' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
