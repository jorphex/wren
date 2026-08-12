import link from '../../../resources/link'
import { refreshKeyboardLayout, watchKeyboardLayout } from '../../../resources/keyboard'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  jest.mocked(link.send).mockClear()
})

it('refreshes the physical keyboard layout used by shortcut presentation', async () => {
  await refreshKeyboardLayout({
    getLayoutMap: async () => ({ get: (key) => (key === 'Backslash' ? '\\' : key) })
  })

  expect(link.send).toHaveBeenCalledWith('tray:action', 'setKeyboardLayout', { isUS: true })
})

it('refreshes again when Chromium reports a keyboard layout change', async () => {
  let listener: (() => void) | undefined
  let isUS = true
  const source = {
    getLayoutMap: async () => ({ get: (key: string) => (key === 'Backslash' && isUS ? '\\' : key) }),
    addEventListener: (_event: 'layoutchange', next: () => void) => {
      listener = next
    }
  }

  watchKeyboardLayout(source)
  await flush()
  isUS = false
  listener?.()
  await flush()

  expect(link.send).toHaveBeenNthCalledWith(1, 'tray:action', 'setKeyboardLayout', { isUS: true })
  expect(link.send).toHaveBeenNthCalledWith(2, 'tray:action', 'setKeyboardLayout', { isUS: false })
})

it('falls back without sending when layout lookup fails', async () => {
  await expect(
    refreshKeyboardLayout({ getLayoutMap: async () => Promise.reject(new Error('unavailable')) })
  ).resolves.toBeUndefined()

  expect(link.send).not.toHaveBeenCalled()
})
