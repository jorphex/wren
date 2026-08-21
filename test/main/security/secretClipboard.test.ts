import { createSecretClipboard } from '../../../main/security/secretClipboard'

function setup(ttlMs = 30_000) {
  let value = ''
  const clipboard = {
    clear: jest.fn(() => {
      value = ''
    }),
    readText: jest.fn(() => value),
    writeText: jest.fn((next: string) => {
      value = next
    })
  }
  const managed = createSecretClipboard(clipboard, { ttlMs })

  return { clipboard, managed, read: () => value, replace: (next: string) => (value = next) }
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

it('clears unchanged sensitive clipboard data after its bounded lifetime', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('sensitive')
  jest.advanceTimersByTime(29_999)
  expect(read()).toBe('sensitive')

  jest.advanceTimersByTime(1)
  expect(clipboard.clear).toHaveBeenCalledTimes(1)
  expect(read()).toBe('')
})

it('does not clear clipboard data that another application replaced', () => {
  const { clipboard, managed, read, replace } = setup()

  managed.writeSecret('sensitive')
  replace('new clipboard value')
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).not.toHaveBeenCalled()
  expect(read()).toBe('new clipboard value')
})

it('cancels secret cleanup when Wren performs a later ordinary copy', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('sensitive')
  managed.writePublic('ordinary')
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).not.toHaveBeenCalled()
  expect(read()).toBe('ordinary')
})

it('does not erase a later ordinary copy whose text happens to match the secret', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('same value')
  managed.writePublic('same value')
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).not.toHaveBeenCalled()
  expect(read()).toBe('same value')
})

it('preserves prior secret cleanup when a later ordinary clipboard write fails', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('sensitive')
  clipboard.writeText.mockImplementationOnce(() => {
    throw new Error('clipboard unavailable')
  })
  expect(() => managed.writePublic('ordinary')).toThrow('clipboard unavailable')
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).toHaveBeenCalledTimes(1)
  expect(read()).toBe('')
})

it('replaces the cleanup window when a later secret is copied', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('first')
  jest.advanceTimersByTime(15_000)
  managed.writeSecret('second')
  jest.advanceTimersByTime(15_000)

  expect(clipboard.clear).not.toHaveBeenCalled()
  expect(read()).toBe('second')

  jest.advanceTimersByTime(15_000)
  expect(clipboard.clear).toHaveBeenCalledTimes(1)
  expect(read()).toBe('')
})

it('preserves prior secret cleanup when a later secret clipboard write fails', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('first')
  clipboard.writeText.mockImplementationOnce(() => {
    throw new Error('clipboard unavailable')
  })
  expect(() => managed.writeSecret('second')).toThrow('clipboard unavailable')
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).toHaveBeenCalledTimes(1)
  expect(read()).toBe('')
})

it('clears unchanged sensitive data and cancels pending cleanup during shutdown', () => {
  const { clipboard, managed, read } = setup()

  managed.writeSecret('sensitive')
  managed.dispose()
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).toHaveBeenCalledTimes(1)
  expect(read()).toBe('')
})

it('does not clear externally replaced clipboard data during shutdown', () => {
  const { clipboard, managed, read, replace } = setup()

  managed.writeSecret('sensitive')
  replace('new clipboard value')
  managed.dispose()
  jest.runOnlyPendingTimers()

  expect(clipboard.clear).not.toHaveBeenCalled()
  expect(read()).toBe('new clipboard value')
})

it('contains clipboard read failures inside the expiry callback', () => {
  const clipboard = {
    clear: jest.fn(),
    readText: jest.fn(() => {
      throw new Error('clipboard unavailable')
    }),
    writeText: jest.fn()
  }
  const onError = jest.fn()
  const managed = createSecretClipboard(clipboard, { ttlMs: 1, onError })

  managed.writeSecret('sensitive')
  expect(() => jest.runOnlyPendingTimers()).not.toThrow()
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'clipboard unavailable' }))
  expect(clipboard.clear).not.toHaveBeenCalled()
})

it('clears a newly written secret immediately if cleanup scheduling fails', () => {
  const clipboard = {
    clear: jest.fn(),
    readText: jest.fn(() => 'sensitive'),
    writeText: jest.fn()
  }
  const error = new Error('timer unavailable')
  const onError = jest.fn()
  const managed = createSecretClipboard(clipboard, {
    onError,
    schedule: () => {
      throw error
    }
  })

  expect(() => managed.writeSecret('sensitive')).not.toThrow()
  expect(clipboard.clear).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledWith(error)
})

it('does not keep the application alive solely for sensitive clipboard cleanup', () => {
  const unref = jest.fn()
  const schedule = jest.fn(() => ({ unref }) as unknown as ReturnType<typeof setTimeout>)
  const clipboard = {
    clear: jest.fn(),
    readText: jest.fn(() => 'sensitive'),
    writeText: jest.fn()
  }
  const managed = createSecretClipboard(clipboard, { schedule })

  managed.writeSecret('sensitive')

  expect(schedule).toHaveBeenCalledWith(expect.any(Function), 60_000)
  expect(unref).toHaveBeenCalledTimes(1)
})
