const mockListeners = new Map()
const mockHandlers = new Map()
const mockIpcMain = {
  handle: jest.fn((channel, listener) => mockHandlers.set(channel, listener)),
  on: jest.fn((channel, listener) => mockListeners.set(channel, listener)),
  removeListener: jest.fn((channel, listener) => {
    if (mockListeners.get(channel) === listener) mockListeners.delete(channel)
  })
}
const mockLog = { warn: jest.fn() }

jest.mock('electron', () => ({ ipcMain: mockIpcMain }))
jest.mock('electron-log', () => mockLog)

const { handleRenderer, onRenderer, onRendererRpc, onceRenderer, registerRendererRole } = jest.requireActual(
  '../../../main/ipc/renderer'
)

const sender = (role) => {
  const webContents = { send: jest.fn() }
  registerRendererRole(webContents, role)
  return { sender: webContents }
}

beforeEach(() => {
  mockListeners.clear()
  mockHandlers.clear()
  mockIpcMain.handle.mockClear()
  mockIpcMain.on.mockClear()
  mockIpcMain.removeListener.mockClear()
  mockLog.warn.mockClear()
})

test('authorizes event channels against the registered main-owned role', () => {
  const listener = jest.fn()
  onRenderer('tray:openExternal', listener)
  const dispatch = mockListeners.get('tray:openExternal')

  dispatch(sender('notify'), 'https://frame.sh')
  dispatch({ sender: {} }, 'https://frame.sh')
  dispatch(sender('onboard'), 'https://frame.sh')

  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenCalledWith(expect.any(Object), 'https://frame.sh')
  expect(mockLog.warn).toHaveBeenCalledTimes(2)
})

test('rejects the retired Pylon migration action in the main process', () => {
  const listener = jest.fn()
  onRenderer('tray:action', listener)
  const dispatch = mockListeners.get('tray:action')
  const notify = sender('notify')

  dispatch(notify, 'mutePylonMigrationNotice')

  expect(listener).not.toHaveBeenCalled()
  expect(mockLog.warn).toHaveBeenCalledWith(
    'Rejected unauthorized renderer IPC',
    expect.objectContaining({ channel: 'tray:action', role: 'notify' })
  )
})

test('rejects unauthorized invokes and permits privileged invokes', async () => {
  const result = { decimals: 18, name: 'Token', symbol: 'TKN', totalSupply: '1000' }
  const handler = jest.fn().mockResolvedValue(result)
  handleRenderer('tray:getTokenDetails', handler)
  const invoke = mockHandlers.get('tray:getTokenDetails')

  await expect(invoke(sender('dapp'), '0x0000000000000000000000000000000000000001', 1)).rejects.toThrow(
    'Unauthorized renderer IPC'
  )
  await expect(invoke(sender('dash'), '0x0000000000000000000000000000000000000001', 1)).resolves.toEqual(
    result
  )
  expect(handler).toHaveBeenCalledTimes(1)
})

test('drops invalid events without calling application handlers', () => {
  const listener = jest.fn()
  onRenderer('tray:copyTxHash', listener)
  const dispatch = mockListeners.get('tray:copyTxHash')

  dispatch(sender('tray'), 'not-a-transaction-hash')

  expect(listener).not.toHaveBeenCalled()
  expect(mockLog.warn).toHaveBeenCalledWith(
    'Rejected invalid renderer IPC payload',
    expect.objectContaining({ channel: 'tray:copyTxHash' })
  )
})

test('returns a bounded error for invalid invokes', async () => {
  const handler = jest.fn()
  handleRenderer('tray:getTokenDetails', handler)
  const invoke = mockHandlers.get('tray:getTokenDetails')

  await expect(invoke(sender('dash'), 'invalid', '1')).rejects.toThrow('Invalid renderer IPC payload')
  expect(handler).not.toHaveBeenCalled()
})

test('rejects invalid invoke results before they cross back to the renderer', async () => {
  const handler = jest.fn().mockResolvedValue({ symbol: 'x'.repeat(33) })
  handleRenderer('tray:getTokenDetails', handler)
  const invoke = mockHandlers.get('tray:getTokenDetails')

  await expect(invoke(sender('dash'), '0x0000000000000000000000000000000000000001', 1)).rejects.toThrow(
    'Invalid renderer IPC result'
  )
  expect(mockLog.warn).toHaveBeenCalledWith('Rejected invalid renderer IPC result', {
    channel: 'tray:getTokenDetails'
  })
})

test('refuses handler registration without a schema', () => {
  expect(() => onRenderer('tray:unknown', jest.fn())).toThrow(
    'Renderer IPC channel has no event schema: tray:unknown'
  )
  expect(() => handleRenderer('tray:unknown', jest.fn())).toThrow(
    'Renderer IPC channel has no invoke schema: tray:unknown'
  )
})

test('does not consume once-only listeners on unauthorized events', () => {
  const listener = jest.fn()
  onceRenderer('tray:ready', listener)
  const dispatch = mockListeners.get('tray:ready')

  dispatch(sender('dapp'))
  expect(mockIpcMain.removeListener).not.toHaveBeenCalled()
  expect(listener).not.toHaveBeenCalled()

  const trayEvent = sender('tray')
  dispatch(trayEvent)
  expect(mockIpcMain.removeListener).toHaveBeenCalledWith('tray:ready', dispatch)
  expect(listener).toHaveBeenCalledWith(trayEvent)
})

test('does not consume once-only listeners on invalid events', () => {
  const listener = jest.fn()
  onceRenderer('tray:copyTxHash', listener)
  const dispatch = mockListeners.get('tray:copyTxHash')

  dispatch(sender('tray'), 'invalid')
  expect(mockIpcMain.removeListener).not.toHaveBeenCalled()
  expect(listener).not.toHaveBeenCalled()

  const trayEvent = sender('tray')
  const hash = `0x${'a'.repeat(64)}`
  dispatch(trayEvent, hash)
  expect(mockIpcMain.removeListener).toHaveBeenCalledWith('tray:copyTxHash', dispatch)
  expect(listener).toHaveBeenCalledWith(trayEvent, hash)
})

test('authorizes decoded RPC methods and ignores malformed method values', () => {
  const listener = jest.fn()
  onRendererRpc(listener)
  const dispatch = mockListeners.get('main:rpc')
  const notify = sender('notify')

  expect(() => dispatch(notify, '1', '{')).not.toThrow()
  dispatch(notify, '1', '"signTransaction"')
  dispatch(notify, '1', '"getState"')

  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenCalledWith(notify, 1, 'getState')
  expect(notify.sender.send).toHaveBeenCalledTimes(2)
  expect(notify.sender.send).toHaveBeenCalledWith('main:rpc', 1, '"Invalid renderer RPC payload"')
})
