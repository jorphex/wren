import { act, render, screen, waitFor } from '../../../componentSetup'
import useCopiedMessage, { useSecretCopiedMessage } from '../../../../resources/Hooks/useCopiedMessage'
import link from '../../../../resources/link'

const TestComponent = () => {
  const [showCopiedMessage, copyText] = useCopiedMessage('use frame!')

  return (
    <>
      <button onClick={copyText}>Copy</button>
      <div data-testid='iscopied'>{showCopiedMessage ? 'message copied!' : 'waiting for click'}</div>
    </>
  )
}

const SecretTestComponent = () => {
  const [showCopiedMessage, copyText] = useSecretCopiedMessage('use frame!')

  return (
    <>
      <button onClick={copyText}>Copy secret</button>
      <div data-testid='secret-copied'>{showCopiedMessage ? 'copied' : 'waiting'}</div>
    </>
  )
}

jest.mock('../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true }))
}))

beforeEach(() => {
  link.invoke.mockReset().mockResolvedValue({ success: true })
})

it('should not display the copied text by default', () => {
  render(<TestComponent />)

  expect(screen.getByTestId('iscopied').textContent).toBe('waiting for click')
})

it('should let the component know to display the copied text after the copy function is invoked', async () => {
  const { user } = render(<TestComponent />)

  const clickToCopyButton = screen.getByRole('button')
  await user.click(clickToCopyButton)
  await act(async () => Promise.resolve())

  await waitFor(() => expect(screen.getByTestId('iscopied').textContent).toBe('message copied!'))
})

it('should reset the copied text after one second', async () => {
  const { user } = render(<TestComponent />, { advanceTimersAfterInput: true })

  const clickToCopyButton = screen.getByRole('button')
  await user.click(clickToCopyButton)
  await act(async () => Promise.resolve())

  expect(screen.getByTestId('iscopied').textContent).toBe('waiting for click')
})

it('send the copied data to the clipboard', async () => {
  const { user } = render(<TestComponent />)

  const clickToCopyButton = screen.getByRole('button')
  await user.click(clickToCopyButton)
  await act(async () => Promise.resolve())

  expect(link.invoke).toHaveBeenCalledTimes(1)
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', {
    secret: false,
    value: 'use frame!'
  })
})

it('uses the expiring clipboard channel only for explicit secret copies', async () => {
  const { user } = render(<SecretTestComponent />)

  await user.click(screen.getByRole('button', { name: 'Copy secret' }))
  await act(async () => Promise.resolve())

  expect(link.invoke).toHaveBeenCalledTimes(1)
  expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', {
    secret: true,
    value: 'use frame!'
  })
})

it('does not claim success when the clipboard write is rejected', async () => {
  link.invoke.mockResolvedValueOnce({})
  const { user } = render(<SecretTestComponent />)

  await user.click(screen.getByRole('button', { name: 'Copy secret' }))
  await act(async () => Promise.resolve())

  expect(screen.getByTestId('secret-copied').textContent).toBe('waiting')
})
