import { act, screen, render } from '../../../../../componentSetup'
import CreateGenerated from '../../../../../../app/dash/Accounts/Add/CreateGenerated'
import { requestDashNavigation } from '../../../../../../app/dash/navigationGuard'
import link from '../../../../../../resources/link'

const password = 'correct horse battery staple'
const phrase = 'test test test test test test test test test test test junk'
const privateKey = `0x${'1'.padStart(64, '0')}`
const address = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
const phrasePresentation = {
  address,
  challenge: [2, 6, 10],
  kind: 'phrase',
  secret: phrase,
  sessionId: '1'.repeat(32)
}
const keyPresentation = {
  address,
  challenge: 'private-key',
  kind: 'private-key',
  secret: privateKey,
  sessionId: '2'.repeat(32)
}

jest.mock('../../../../../../resources/link', () => ({
  invoke: jest.fn().mockResolvedValue({ success: true }),
  send: jest.fn(),
  rpc: jest.fn()
}))

const advancePassword = async (view, presentation) => {
  await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
  act(() => jest.advanceTimersByTime(300))
  await view.user.click(screen.getByRole('button', { name: 'Continue' }))
  await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
  act(() => jest.advanceTimersByTime(300))
  link.rpc
    .mockImplementationOnce((method, cb) => cb(null, { sessionId: presentation.sessionId }))
    .mockImplementationOnce((method, id, kind, enteredPassword, cb) => cb(null, presentation))
  await view.user.click(screen.getByRole('button', { name: 'Create' }))
}

const expectActiveText = (text) =>
  expect(screen.getAllByText(text).some((element) => element.closest('[aria-hidden="false"]'))).toBe(true)

describe('generated recovery-phrase wallet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => jest.useRealTimers())

  test('requests entropy only after password confirmation and presents twelve words once', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)

    expect(link.rpc).toHaveBeenCalledWith('reserveGeneratedWallet', expect.any(Function))
    expect(link.rpc).toHaveBeenCalledWith(
      'beginGeneratedWallet',
      phrasePresentation.sessionId,
      'phrase',
      password,
      expect.any(Function)
    )
    expect(screen.getByRole('heading', { name: 'Your recovery phrase' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expectActiveText('Leaving now deletes this new wallet.')
    expect(link.send).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('test test'))
    act(() => jest.advanceTimersByTime(100))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your recovery phrase' }))
  })

  test('shows a fail-closed generation error without leaving the frame carousel blank', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
    act(() => jest.advanceTimersByTime(300))
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    act(() => jest.advanceTimersByTime(300))
    link.rpc
      .mockImplementationOnce((method, cb) => cb(null, { sessionId: phrasePresentation.sessionId }))
      .mockImplementationOnce((method, id, kind, enteredPassword, cb) => cb('rng unavailable'))
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert').textContent).toBe('Wren could not create this wallet safely.')
    expect(screen.getByText('No account was added.')).toBeTruthy()
    act(() => jest.advanceTimersByTime(100))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start again' }))
  })

  test('copies explicitly, verifies requested words, and returns with the selected account', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)

    await view.user.click(screen.getByRole('button', { name: 'Copy recovery phrase' }))
    expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: true, value: phrase })
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))
    expectActiveText('Leaving now deletes this new wallet.')
    expect(screen.queryByText('test')).toBeNull()
    act(() => jest.advanceTimersByTime(100))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Word 2' }))

    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'test')
    }
    link.rpc.mockImplementationOnce((method, id, proof, cb) => cb(null, { id: 'new-seed-signer' }))
    await view.user.click(screen.getByRole('button', { name: 'Finish setup' }))

    expect(link.rpc).toHaveBeenLastCalledWith(
      'completeGeneratedWallet',
      phrasePresentation.sessionId,
      { words: ['test', 'test', 'test'] },
      expect.any(Function)
    )
    expect(link.send).toHaveBeenCalledWith('nav:back', 'dash', 2)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', { view: 'accounts', data: {} })
    expect(screen.queryByText('test')).toBeNull()
  })

  test('keeps proof mismatches retryable, clears the stale error on edit, and marks invalid fields', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))

    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'wrong')
    }
    link.rpc.mockImplementationOnce((method, id, proof, cb) =>
      cb(new Error('Backup confirmation does not match'))
    )
    await view.user.click(screen.getByRole('button', { name: 'Finish setup' }))

    expect(screen.getByRole('alert').textContent).toContain('Those words do not match')
    expect(screen.getByRole('textbox', { name: 'Word 2' }).getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Word 2' }))
    await view.user.type(screen.getByRole('textbox', { name: 'Word 2' }), 'x')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Word 2' }).getAttribute('aria-invalid')).toBe('false')
  })

  test('scrubs and restarts after a terminal completion failure', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))
    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'test')
    }
    link.rpc.mockImplementationOnce((method, id, proof, cb) =>
      cb(new Error('Wallet creation session is no longer available'))
    )
    await view.user.click(screen.getByRole('button', { name: 'Finish setup' }))

    expect(screen.getByRole('alert').textContent).toBe('This wallet setup expired.')
    expect(screen.getByText('No account was added.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy()
    expect(screen.queryByText('test')).toBeNull()
    expect(link.rpc).toHaveBeenCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )
  })

  test('directs an incomplete rollback to Accounts without claiming nothing was saved', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))
    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'test')
    }
    link.rpc.mockImplementationOnce((method, id, proof, cb) =>
      cb(
        new Error('Wallet creation could not be rolled back completely. Check Accounts before trying again.')
      )
    )
    await view.user.click(screen.getByRole('button', { name: 'Finish setup' }))

    expect(screen.getByText('Check Accounts before starting again.')).toBeTruthy()
    expect(screen.queryByText('No account was added.')).toBeNull()
    await view.user.click(screen.getByRole('button', { name: 'Check accounts' }))
    expect(link.send).toHaveBeenCalledWith('nav:back', 'dash', 2)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', { view: 'accounts', data: {} })
  })

  test('expires in place, scrubs the secret, and offers a clean restart', async () => {
    const expiring = { ...phrasePresentation, expiresAt: Date.now() + 5_000 }
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: 0 })
    await advancePassword(view, expiring)
    expect(screen.getAllByText('test')).toHaveLength(11)
    expectActiveText('Finish setup within less than a minute.')

    act(() => jest.advanceTimersByTime(4_400))

    expect(screen.getByRole('alert').textContent).toBe('This wallet setup expired.')
    expect(screen.queryByText('test')).toBeNull()
  })

  test('updates the visible setup deadline while the secret is displayed', async () => {
    const expiring = { ...phrasePresentation, expiresAt: Date.now() + 90_000 }
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: 0 })
    await advancePassword(view, expiring)

    expect(
      screen
        .getAllByText('Finish setup within about 2 minutes.')
        .some((element) => element.closest('[aria-hidden="false"]'))
    ).toBe(true)
    act(() => jest.advanceTimersByTime(30_000))
    expect(
      screen
        .getAllByText('Finish setup within less than a minute.')
        .some((element) => element.closest('[aria-hidden="false"]'))
    ).toBe(true)
  })

  test('returns from confirmation to password creation without leaving the route', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
    act(() => jest.advanceTimersByTime(300))
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    const navigate = jest.fn()

    let navigated
    act(() => {
      navigated = requestDashNavigation('back', navigate)
    })
    expect(navigated).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expectActiveText('Create password')
  })

  test('discards a late generation result after Back cancels the pending step', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
    act(() => jest.advanceTimersByTime(300))
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    act(() => jest.advanceTimersByTime(300))
    let finishBegin
    link.rpc
      .mockImplementationOnce((method, cb) => cb(null, { sessionId: phrasePresentation.sessionId }))
      .mockImplementationOnce((method, id, kind, enteredPassword, cb) => {
        finishBegin = cb
      })
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    act(() => requestDashNavigation('back', jest.fn()))
    expectActiveText('Create password')
    expect(link.rpc).toHaveBeenCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )
    act(() => finishBegin(null, phrasePresentation))

    expect(screen.queryByRole('heading', { name: 'Your recovery phrase' })).toBeNull()
    expect(link.rpc).toHaveBeenCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )
  })

  test('recovers if wallet generation never answers and rejects a late result', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: 0 })
    await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
    act(() => jest.advanceTimersByTime(300))
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
    act(() => jest.advanceTimersByTime(300))
    let finishBegin
    link.rpc
      .mockImplementationOnce((method, cb) => cb(null, { sessionId: phrasePresentation.sessionId }))
      .mockImplementationOnce((method, id, kind, enteredPassword, cb) => {
        finishBegin = cb
      })
    await view.user.click(screen.getByRole('button', { name: 'Create' }))

    act(() => jest.advanceTimersByTime(65_000))

    expect(screen.getByRole('alert').textContent).toBe('Wren could not create this wallet safely.')
    expect(screen.getByText('No account was added.')).toBeTruthy()
    expect(link.rpc).toHaveBeenCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )

    act(() => finishBegin(null, phrasePresentation))
    expect(screen.queryByRole('heading', { name: 'Your recovery phrase' })).toBeNull()
  })

  test('confirms destructive Back or Close after generation before discarding', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    const navigate = jest.fn()

    let navigated
    act(() => {
      navigated = requestDashNavigation('close', navigate)
    })
    expect(navigated).toBe(false)
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this new wallet?' })
    expect(dialog).toBeTruthy()
    expect(dialog.parentElement).toBe(document.body)
    expect(navigate).not.toHaveBeenCalled()

    await view.user.click(screen.getByRole('button', { name: 'Keep creating' }))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Your recovery phrase' })).toBeTruthy()

    act(() => requestDashNavigation('back', navigate))
    await view.user.click(screen.getByRole('button', { name: 'Delete and leave' }))
    expect(link.rpc).toHaveBeenCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  test('does not promise deletion while account completion is in flight', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: 0 })
    await advancePassword(view, phrasePresentation)
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))
    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'test')
    }
    let completionCallback
    link.rpc.mockImplementationOnce((method, id, proof, cb) => {
      completionCallback = cb
    })
    await view.user.click(screen.getByRole('button', { name: 'Finish setup' }))

    const navigate = jest.fn()
    act(() => requestDashNavigation('close', navigate))

    expect(screen.getByRole('alertdialog', { name: 'Wallet setup is finishing' })).toBeTruthy()
    expect(screen.getByText('Wait for Wren to finish before leaving.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete and leave' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep creating' })).toBeTruthy()

    act(() => completionCallback(null, { id: 'new-seed-signer' }))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(link.send).not.toHaveBeenCalledWith('nav:back', 'dash', 2)
  })

  test('reports a failed one-time clipboard copy and permits retry', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    let rejectCopy
    link.invoke.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectCopy = reject
        })
    )

    await view.user.click(screen.getByRole('button', { name: 'Copy recovery phrase' }))
    await act(async () => rejectCopy(new Error('clipboard unavailable')))

    expect(screen.getByRole('button', { name: 'Copy recovery phrase again' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Copy failed. Try again.')
  })

  test('recovers from a stalled completion without accepting a late result', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: 0 })
    await advancePassword(view, phrasePresentation)
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))
    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'test')
    }
    let completionCallback
    link.rpc.mockImplementationOnce((method, id, proof, cb) => {
      completionCallback = cb
    })
    await view.user.click(screen.getByRole('button', { name: 'Finish setup' }))

    act(() => jest.advanceTimersByTime(30_000))

    expect(screen.getByRole('alert').textContent).toBe('Wallet setup is taking longer than expected.')
    expect(screen.getByText('Check Accounts before starting again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check accounts' })).toBeTruthy()
    act(() => completionCallback(null, { accountId: address, selected: true }))
    expect(link.send).not.toHaveBeenCalledWith('nav:back', 'dash', 2)
  })

  test('discards the staged signer when the one-time screen is abandoned', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    view.unmount()
    const navigate = jest.fn()

    expect(link.rpc).toHaveBeenLastCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )
    expect(requestDashNavigation('back', navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})

describe('generated private-key account', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => jest.useRealTimers())

  test('shows the address and concealed key together with independent copy controls', async () => {
    const view = render(<CreateGenerated kind='private-key' />, { advanceTimersAfterInput: true })
    await advancePassword(view, keyPresentation)

    expect(screen.getByText(address)).toBeTruthy()
    expect(screen.queryByText(privateKey)).toBeNull()
    const concealed = screen.getByText('Private key concealed')
    expect(concealed.closest('code').querySelector('[aria-hidden="true"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy private key' })).toBeTruthy()
    expect(screen.getByRole('button', { name: "I've saved my key" }).disabled).toBe(true)
    act(() => jest.advanceTimersByTime(100))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show private key' }))
    let resolveSecretCopy
    link.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecretCopy = resolve
        })
    )
    await view.user.click(screen.getByRole('button', { name: 'Copy private key' }))
    await act(async () => resolveSecretCopy({ success: true }))
    expect(screen.getByRole('button', { name: "I've saved my key" }).disabled).toBe(false)

    await view.user.click(screen.getByRole('button', { name: 'Show private key' }))
    expect(screen.getByText(privateKey)).toBeTruthy()
    expect(screen.getByRole('button', { name: "I've saved my key" }).disabled).toBe(false)
    await view.user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: false, value: address })
    expect(link.invoke).toHaveBeenCalledWith('tray:writeClipboard', { secret: true, value: privateKey })
  })

  test('requires the complete saved key before committing', async () => {
    const view = render(<CreateGenerated kind='private-key' />, { advanceTimersAfterInput: true })
    await advancePassword(view, keyPresentation)
    await view.user.click(screen.getByRole('button', { name: 'Show private key' }))
    expect(screen.getByText(privateKey)).toBeTruthy()
    await view.user.click(screen.getByRole('button', { name: "I've saved my key" }))
    expectActiveText('Leaving now deletes this new account.')
    expect(screen.queryByText(privateKey)).toBeNull()

    const finish = screen.getByRole('button', { name: 'Finish setup' })
    expect(finish.disabled).toBe(true)
    const confirmation = screen.getByRole('textbox', { name: 'Verify your backup' })
    await view.user.type(confirmation, 'z'.repeat(64))
    expect(finish.disabled).toBe(true)
    await view.user.clear(confirmation)
    await view.user.type(confirmation, privateKey)
    expect(finish.disabled).toBe(false)

    link.rpc.mockImplementationOnce((method, id, proof, cb) => cb(null, { id: 'new-key-signer' }))
    await view.user.click(finish)
    expect(link.rpc).toHaveBeenLastCalledWith(
      'completeGeneratedWallet',
      keyPresentation.sessionId,
      { privateKey },
      expect.any(Function)
    )
  })
})
