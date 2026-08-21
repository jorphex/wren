import { act, screen, render } from '../../../../../componentSetup'
import CreateGenerated from '../../../../../../app/dash/Accounts/Add/CreateGenerated'
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
  send: jest.fn(),
  rpc: jest.fn()
}))

const advancePassword = async (view, presentation) => {
  await view.user.type(screen.getByRole('textbox', { name: 'Create password' }), password)
  act(() => jest.advanceTimersByTime(300))
  await view.user.click(screen.getByRole('button', { name: 'Continue' }))
  await view.user.type(screen.getByRole('textbox', { name: 'Confirm password' }), password)
  act(() => jest.advanceTimersByTime(300))
  link.rpc.mockImplementationOnce((method, kind, enteredPassword, cb) => cb(null, presentation))
  await view.user.click(screen.getByRole('button', { name: 'Create' }))
}

describe('generated recovery-phrase wallet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => jest.useRealTimers())

  test('requests entropy only after password confirmation and presents twelve words once', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)

    expect(link.rpc).toHaveBeenCalledWith('beginGeneratedWallet', 'phrase', password, expect.any(Function))
    expect(screen.getByRole('heading', { name: 'Your recovery phrase' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expect(screen.getByText('Leaving now deletes this new wallet.')).toBeTruthy()
    expect(link.send).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('test test'))
  })

  test('copies explicitly, verifies requested words, and opens the committed signer', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)

    await view.user.click(screen.getByRole('button', { name: 'Copy recovery phrase' }))
    expect(link.send).toHaveBeenCalledWith('tray:clipboardData', phrase)
    await view.user.click(screen.getByRole('button', { name: "I've written it down" }))

    for (const position of phrasePresentation.challenge) {
      await view.user.type(screen.getByRole('textbox', { name: `Word ${position}` }), 'test')
    }
    link.rpc.mockImplementationOnce((method, id, proof, cb) => cb(null, { id: 'new-seed-signer' }))
    await view.user.click(screen.getByRole('button', { name: 'Finish backup' }))

    expect(link.rpc).toHaveBeenLastCalledWith(
      'completeGeneratedWallet',
      phrasePresentation.sessionId,
      { words: ['test', 'test', 'test'] },
      expect.any(Function)
    )
    expect(link.send).toHaveBeenCalledWith('nav:back', 'dash', 2)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'expandedSigner',
      data: { signer: 'new-seed-signer' }
    })
    expect(screen.queryByText('test')).toBeNull()
  })

  test('discards the staged signer when the one-time screen is abandoned', async () => {
    const view = render(<CreateGenerated kind='phrase' />, { advanceTimersAfterInput: true })
    await advancePassword(view, phrasePresentation)
    view.unmount()

    expect(link.rpc).toHaveBeenLastCalledWith(
      'discardGeneratedWallet',
      phrasePresentation.sessionId,
      expect.any(Function)
    )
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
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy private key' })).toBeTruthy()

    await view.user.click(screen.getByRole('button', { name: 'Show private key' }))
    expect(screen.getByText(privateKey)).toBeTruthy()
    await view.user.click(screen.getByRole('button', { name: 'Copy address' }))
    await view.user.click(screen.getByRole('button', { name: 'Copy private key' }))
    expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)
    expect(link.send).toHaveBeenCalledWith('tray:clipboardData', privateKey)
  })

  test('requires the complete saved key before committing', async () => {
    const view = render(<CreateGenerated kind='private-key' />, { advanceTimersAfterInput: true })
    await advancePassword(view, keyPresentation)
    await view.user.click(screen.getByRole('button', { name: "I've saved my key" }))

    const finish = screen.getByRole('button', { name: 'Finish backup' })
    expect(finish.disabled).toBe(true)
    await view.user.type(screen.getByRole('textbox', { name: 'Verify your backup' }), privateKey)
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
