const mockIpcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  send: jest.fn()
}
const mockRpc = jest.fn()

jest.mock('electron', () => ({ ipcRenderer: mockIpcRenderer }))
jest.mock('../../../resources/bridge/rpc', () => mockRpc)

const id = '74b6f0b5-0396-4d91-b505-0fb66f00786a'
const LINK_SOURCE = 'tray:link'

describe('preload renderer bridge', () => {
  let listeners
  let rendererWindow

  const loadBridge = (role = 'tray') => {
    globalThis.process.argv = globalThis.process.argv.filter(
      (arg) => !arg.startsWith('--frame-renderer-role=')
    )
    if (role) globalThis.process.argv.push(`--frame-renderer-role=${role}`)
    jest.resetModules()
    jest.isolateModules(() => jest.requireActual('../../../resources/bridge'))
  }

  beforeEach(() => {
    mockIpcRenderer.invoke.mockReset()
    mockIpcRenderer.on.mockReset()
    mockIpcRenderer.send.mockReset()
    mockRpc.mockReset()

    listeners = {}
    rendererWindow = {
      addEventListener: jest.fn((name, listener) => {
        listeners[name] = listener
      }),
      location: { protocol: 'file:', origin: 'null' },
      postMessage: jest.fn()
    }
    globalThis.window = rendererWindow

    loadBridge()
  })

  afterEach(() => {
    delete globalThis.window
    globalThis.process.argv = globalThis.process.argv.filter(
      (arg) => !arg.startsWith('--frame-renderer-role=')
    )
  })

  const dispatch = (data, overrides = {}) =>
    listeners.message({ data, source: rendererWindow, origin: 'null', ...overrides })

  test('ignores malformed, cross-window, and wrong-origin messages without throwing', () => {
    expect(() => dispatch('{')).not.toThrow()
    expect(() =>
      dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'event', args: ['tray:ready'] }), { source: {} })
    ).not.toThrow()
    expect(() =>
      dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'event', args: ['tray:ready'] }), {
        origin: 'https://example.com'
      })
    ).not.toThrow()

    expect(mockIpcRenderer.send).not.toHaveBeenCalled()
  })

  test('fails closed if a production renderer loads from a non-file origin', () => {
    rendererWindow.location = { protocol: 'https:', origin: 'https://example.com' }
    loadBridge()

    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'event', args: ['tray:ready'] }), {
      origin: 'https://example.com'
    })

    expect(mockIpcRenderer.send).not.toHaveBeenCalled()
  })

  test('forwards only a valid registered one-way channel', () => {
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'event', args: ['shell:execute', 'calc'] }))
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'event', args: ['tray:ready'] }))

    expect(mockIpcRenderer.send).toHaveBeenCalledTimes(1)
    expect(mockIpcRenderer.send).toHaveBeenCalledWith('tray:ready')
  })

  test('fails closed without a role and applies limited renderer capabilities', () => {
    loadBridge(null)
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'rpc', id, args: ['getState'] }))
    expect(mockRpc).not.toHaveBeenCalled()

    loadBridge('onboard')
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'rpc', id, args: ['signTransaction'] }))
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'rpc', id, args: ['getState'] }))

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('getState', expect.any(Function))
  })

  test('returns main RPC callbacks through a bounded bridge response', () => {
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'rpc', id, args: ['getState'] }))

    expect(mockRpc).toHaveBeenCalledWith('getState', expect.any(Function))
    mockRpc.mock.calls[0][1](null, { ready: true })

    expect(rendererWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ method: 'rpc', id, args: [null, { ready: true }], source: 'bridge:link' }),
      '*'
    )
  })

  test('returns invoke results through the same request id', async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true })
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'invoke', id, args: ['tray:addChain', {}] }))
    await Promise.resolve()

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('tray:addChain', {})
    expect(rendererWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ method: 'invoke', id, args: { success: true }, source: 'bridge:link' }),
      '*'
    )
  })

  test.each([
    ['tray:addChain', { success: false, error: 'Main IPC invocation failed' }],
    ['tray:getTokenDetails', {}]
  ])('settles rejected %s invokes with its exact failure result', async (channel, result) => {
    mockIpcRenderer.invoke.mockRejectedValue(new Error('sensitive internal failure'))
    dispatch(JSON.stringify({ source: LINK_SOURCE, method: 'invoke', id, args: [channel, {}] }))
    await Promise.resolve()

    expect(rendererWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ method: 'invoke', id, args: result, source: 'bridge:link' }),
      '*'
    )
  })

  test('registers only live outbound event channels', () => {
    expect(mockIpcRenderer.on.mock.calls.map(([channel]) => channel).sort()).toEqual([
      'main:action',
      'main:flex'
    ])
  })
})
