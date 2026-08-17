describe('renderer link bridge', () => {
  let link
  let messageListener
  let rendererWindow

  beforeEach(() => {
    rendererWindow = {
      addEventListener: jest.fn((name, listener) => {
        if (name === 'message') messageListener = listener
      }),
      location: { protocol: 'file:', origin: 'null' },
      postMessage: jest.fn()
    }
    globalThis.window = rendererWindow

    jest.resetModules()
    jest.isolateModules(() => {
      link = jest.requireActual('../../../resources/link').default
    })
  })

  afterEach(() => {
    delete globalThis.window
  })

  test('completes a packaged file-origin RPC round trip', () => {
    const callback = jest.fn()
    link.rpc('getState', callback)

    const [requestValue, targetOrigin] = rendererWindow.postMessage.mock.calls[0]
    const request = JSON.parse(requestValue)
    expect(request).toMatchObject({ source: 'tray:link', method: 'rpc', args: ['getState'] })
    expect(targetOrigin).toBe('*')

    const response = JSON.stringify({
      source: 'bridge:link',
      method: 'rpc',
      id: request.id,
      args: [null, { ready: true }]
    })
    messageListener({ data: response, source: rendererWindow, origin: 'https://example.com' })
    expect(callback).not.toHaveBeenCalled()

    messageListener({ data: response, source: rendererWindow, origin: 'null' })
    expect(callback).toHaveBeenCalledWith(null, { ready: true })
  })

  test('omits trailing undefined invoke arguments before JSON encoding', () => {
    const token = { address: '0x0000000000000000000000000000000000000001', chainId: 1 }

    link.invoke('tokens:save', token, undefined)

    const [requestValue] = rendererWindow.postMessage.mock.calls[0]
    expect(JSON.parse(requestValue)).toMatchObject({
      source: 'tray:link',
      method: 'invoke',
      args: ['tokens:save', token]
    })
  })

  test('ignores duplicate responses after removing the completed handler', () => {
    const callback = jest.fn()
    const log = jest.spyOn(globalThis.console, 'log').mockImplementation(() => {})
    link.rpc('getState', callback)

    const request = JSON.parse(rendererWindow.postMessage.mock.calls[0][0])
    const response = JSON.stringify({
      source: 'bridge:link',
      method: 'rpc',
      id: request.id,
      args: [null, { ready: true }]
    })

    messageListener({ data: response, source: rendererWindow, origin: 'null' })
    messageListener({ data: response, source: rendererWindow, origin: 'null' })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('link.rpc response had no handler')
    log.mockRestore()
  })
})
