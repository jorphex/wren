type MockNotification = {
  options: { title: string; body: string }
  show: jest.Mock
  emit: (event: string) => void
}

const mockNotifications: MockNotification[] = []
const mockIsSupported = jest.fn(() => true)

const mocks = {
  store: jest.fn(),
  windows: { isAnyWrenVisible: jest.fn(() => false), showTray: jest.fn() },
  showAccountActivity: jest.fn()
}

jest.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return mockIsSupported()
    }
    show = jest.fn()
    private click?: () => void
    options: { title: string; body: string }
    constructor(mockOptions: { title: string; body: string }) {
      this.options = mockOptions
      mockNotifications.push(this)
    }
    once(event: string, handler: () => void) {
      if (event === 'click') this.click = handler
    }
    emit(event: string) {
      if (event === 'click') this.click?.()
    }
  }
}))
jest.mock('../../../main/store', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mocks.store(...args)
}))
jest.mock('../../../main/windows', () => ({
  __esModule: true,
  default: {
    isAnyWrenVisible: () => mocks.windows.isAnyWrenVisible(),
    showTray: () => mocks.windows.showTray()
  }
}))
jest.mock('../../../main/store/action', () => ({
  requireStoreAction: () => mocks.showAccountActivity
}))

import {
  notifyTransactionOutcome,
  resetTransactionNotificationDeduplicationForTests
} from '../../../main/notifications/transaction'

const activityId = '00000000-0000-4000-8000-000000000001'
const account = `0x${'a'.repeat(40)}`

beforeEach(() => {
  mockNotifications.length = 0
  mocks.store.mockReset().mockReturnValue(true)
  mocks.windows.isAnyWrenVisible.mockReturnValue(false)
  mocks.windows.showTray.mockReset()
  mocks.showAccountActivity.mockReset()
  resetTransactionNotificationDeduplicationForTests()
})

it.each([
  ['confirmed', 'Wallet activity confirmed', 'A submitted wallet activity completed.'],
  ['failed', 'Wallet activity failed', 'A submitted wallet activity did not complete.'],
  ['replaced', 'Wallet activity replaced', 'A submitted wallet activity was replaced.'],
  ['long-pending', 'Wallet activity still pending', 'Wren is still checking a submitted wallet activity.'],
  [
    'long-pending-broadcasting',
    'Wallet activity broadcast status unknown',
    'Wren is checking whether a signed wallet activity was broadcast.'
  ]
])('shows one immediate privacy-static %s notification', (outcome, title, body) => {
  expect(notifyTransactionOutcome(activityId, account, outcome as never)).toBe(true)
  expect(mockNotifications).toHaveLength(1)
  expect(mockNotifications[0]?.options).toEqual({ title, body })
  expect(mockNotifications[0]?.show).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(mockNotifications[0]?.options)).not.toMatch(/0x|example|hash|address/i)
  expect(notifyTransactionOutcome(activityId, account, outcome as never)).toBe(false)
})

it('normalizes the legacy dropped outcome without changing private copy', () => {
  expect(notifyTransactionOutcome(activityId, account, 'dropped')).toBe(true)
  expect(mockNotifications[0]?.options).toEqual({
    title: 'Wallet activity replaced',
    body: 'A submitted wallet activity was replaced.'
  })
})

it('delivers a later terminal update after one long-pending update for the same activity', () => {
  expect(notifyTransactionOutcome(activityId, account, 'long-pending-broadcasting')).toBe(true)
  expect(notifyTransactionOutcome(activityId, account, 'long-pending')).toBe(false)
  expect(notifyTransactionOutcome(activityId, account, 'confirmed')).toBe(true)
  expect(notifyTransactionOutcome(activityId, account, 'confirmed')).toBe(false)
  expect(mockNotifications.map(({ options }) => options.title)).toEqual([
    'Wallet activity broadcast status unknown',
    'Wallet activity confirmed'
  ])
})

it('opens the exact persisted activity entry in Wren', () => {
  notifyTransactionOutcome(activityId, account, 'confirmed')
  mockNotifications[0]?.emit('click')

  expect(mocks.showAccountActivity).toHaveBeenCalledWith(account, activityId)
  expect(mocks.windows.showTray).toHaveBeenCalledTimes(1)
})

it('does nothing when unsupported, disabled, or visible', () => {
  mockIsSupported.mockReturnValueOnce(false)
  expect(notifyTransactionOutcome(`${activityId.slice(0, -1)}2`, account, 'confirmed')).toBe(false)

  mocks.store.mockReturnValueOnce(false)
  expect(notifyTransactionOutcome(`${activityId.slice(0, -1)}3`, account, 'confirmed')).toBe(false)

  mocks.windows.isAnyWrenVisible.mockReturnValueOnce(true)
  expect(notifyTransactionOutcome(`${activityId.slice(0, -1)}4`, account, 'confirmed')).toBe(false)
  expect(mockNotifications).toHaveLength(0)
})
