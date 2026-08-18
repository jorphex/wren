import {
  BRIDGE_SOURCE,
  LINK_SOURCE,
  MAX_MESSAGE_LENGTH,
  decodeBridgeMessage,
  encodeBridgeMessage,
  getRendererTargetOrigin,
  getRendererRole,
  isTrustedBridgeEvent,
  responseEventChannels
} from '../../../resources/bridge/protocol'

const id = '74b6f0b5-0396-4d91-b505-0fb66f00786a'
const encode = (message) => encodeBridgeMessage(message)

describe('renderer bridge protocol', () => {
  test('accepts bounded requests for registered IPC channels and main RPC methods', () => {
    expect(
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method: 'event', args: ['tray:ready'] }),
        LINK_SOURCE,
        'tray'
      )
    ).toEqual({ source: LINK_SOURCE, method: 'event', args: ['tray:ready'] })

    expect(
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method: 'invoke', id, args: ['tray:addChain', { chainId: '0x1' }] }),
        LINK_SOURCE,
        'dash'
      )
    ).toEqual({ source: LINK_SOURCE, method: 'invoke', id, args: ['tray:addChain', { chainId: '0x1' }] })

    expect(
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method: 'rpc', id, args: ['getState'] }),
        LINK_SOURCE,
        'tray'
      )
    ).toEqual({ source: LINK_SOURCE, method: 'rpc', id, args: ['getState'] })
  })

  test('accepts bridge replies and only known renderer event channels', () => {
    const actions = JSON.stringify([
      {
        name: 'setColorway',
        count: 1,
        deferred: false,
        updates: [{ path: 'main.colorway', value: 'dark' }]
      }
    ])
    expect(
      decodeBridgeMessage(
        encode({ source: BRIDGE_SOURCE, method: 'rpc', id, args: [null, 'ok'] }),
        BRIDGE_SOURCE
      )
    ).toEqual({ source: BRIDGE_SOURCE, method: 'rpc', id, args: [null, 'ok'] })

    expect(
      decodeBridgeMessage(
        encode({ source: BRIDGE_SOURCE, method: 'invoke', id, args: { success: true } }),
        BRIDGE_SOURCE
      )
    ).toEqual({ source: BRIDGE_SOURCE, method: 'invoke', id, args: { success: true } })

    expect(
      decodeBridgeMessage(
        encode({
          source: BRIDGE_SOURCE,
          method: 'event',
          channel: 'action',
          args: ['stateSync', actions]
        }),
        BRIDGE_SOURCE
      )
    ).toEqual({
      source: BRIDGE_SOURCE,
      method: 'event',
      channel: 'action',
      args: ['stateSync', actions]
    })

    expect(
      decodeBridgeMessage(
        encode({
          source: BRIDGE_SOURCE,
          method: 'event',
          channel: 'flex',
          args: ['shortcutActivated']
        }),
        BRIDGE_SOURCE
      )
    ).not.toBeNull()

    for (const args of [
      ['shellLayout', 'adjacent'],
      ['shellLayout', 'overlay'],
      ['shellContent', 'prepare'],
      ['shellContent', 'conceal'],
      ['shellContent', 'reveal'],
      ['shellJoined', 'true'],
      ['shellJoined', 'false']
    ]) {
      expect(
        decodeBridgeMessage(
          encode({ source: BRIDGE_SOURCE, method: 'event', channel: 'flex', args }),
          BRIDGE_SOURCE
        )
      ).not.toBeNull()
    }

    expect(
      decodeBridgeMessage(
        encode({ source: BRIDGE_SOURCE, method: 'event', channel: 'unknown', args: [] }),
        BRIDGE_SOURCE
      )
    ).toBeNull()
    expect([...responseEventChannels].sort()).toEqual(['action', 'flex'])
  })

  test('rejects malformed state updates, unsafe paths, and dead response channels', () => {
    const response = (channel, args) =>
      decodeBridgeMessage(encode({ source: BRIDGE_SOURCE, method: 'event', channel, args }), BRIDGE_SOURCE)
    const action = (path) =>
      JSON.stringify([{ name: 'update', count: 1, deferred: false, updates: [{ path, value: true }] }])

    expect(response('action', ['stateSync', action('main.ready')])).not.toBeNull()
    expect(response('action', ['stateSync', action('__proto__.polluted')])).toBeNull()
    expect(response('action', ['stateSync', '{'])).toBeNull()
    expect(response('action', ['unknown', action('main.ready')])).toBeNull()
    expect(response('flex', ['unknown'])).toBeNull()
    expect(response('flex', ['shellLayout', 'wide'])).toBeNull()
    expect(response('flex', ['shellContent', 'visible'])).toBeNull()
    expect(response('flex', ['shellJoined', true])).toBeNull()
    expect(response('flex', ['shellJoined', 'true', 'animate'])).toBeNull()
    expect(response('dapp', [])).toBeNull()
  })

  test.each([undefined, null, {}, '', '{', JSON.stringify(null), 'x'.repeat(MAX_MESSAGE_LENGTH + 1)])(
    'rejects malformed or oversized serialized input %#',
    (value) => {
      expect(decodeBridgeMessage(value, LINK_SOURCE, 'tray')).toBeNull()
    }
  )

  test('rejects forged endpoints, unknown methods, extra fields, invalid ids, and excessive arguments', () => {
    const messages = [
      { source: BRIDGE_SOURCE, method: 'rpc', id, args: ['getState'] },
      { source: LINK_SOURCE, method: 'unknown', id, args: ['getState'] },
      { source: LINK_SOURCE, method: 'rpc', id, args: ['getState'], extra: true },
      { source: LINK_SOURCE, method: 'rpc', id: 'not-a-uuid', args: ['getState'] },
      { source: LINK_SOURCE, method: 'rpc', id, args: new Array(65).fill(null) }
    ]

    messages.forEach((message) =>
      expect(decodeBridgeMessage(encode(message), LINK_SOURCE, 'tray')).toBeNull()
    )
  })

  test('rejects unregistered one-way and invoke channels', () => {
    expect(
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method: 'event', args: ['shell:execute'] }),
        LINK_SOURCE,
        'tray'
      )
    ).toBeNull()
    expect(
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method: 'invoke', id, args: ['shell:execute'] }),
        LINK_SOURCE,
        'tray'
      )
    ).toBeNull()
  })

  test('parses exactly one known main-process renderer role', () => {
    for (const role of ['dash', 'dapp', 'onboard', 'tray']) {
      expect(getRendererRole(['electron', `--frame-renderer-role=${role}`])).toBe(role)
    }
    expect(getRendererRole(['electron'])).toBeNull()
    expect(getRendererRole(['electron', '--frame-renderer-role=unknown'])).toBeNull()
    expect(getRendererRole(['--frame-renderer-role=tray', '--frame-renderer-role=dash'])).toBeNull()
  })

  test('limits onboard and dapp request capabilities', () => {
    const request = (role, method, args, requestId = id) =>
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method, ...(method === 'event' ? {} : { id: requestId }), args }),
        LINK_SOURCE,
        role
      )

    expect(request('dapp', 'rpc', ['getFrameId'])).not.toBeNull()
    expect(request('dapp', 'rpc', ['signTransaction'])).toBeNull()
    expect(request('dapp', 'event', ['tray:action', 'navDash', {}])).not.toBeNull()
    expect(request('dapp', 'event', ['tray:action', 'retryDapp', 'installed-dapp'])).not.toBeNull()
    expect(request('dapp', 'event', ['tray:action', 'removeAccount'])).toBeNull()
    expect(request('dapp', 'invoke', ['tray:addChain', {}])).toBeNull()

    expect(request('onboard', 'event', ['tray:openExternal', 'https://frame.sh'])).not.toBeNull()
    expect(request('onboard', 'event', ['tray:action', 'navReplace', 'dash'])).not.toBeNull()
    expect(request('onboard', 'event', ['tray:action', 'setKeyboardLayout', { isUS: true }])).not.toBeNull()
    expect(request('onboard', 'event', ['tray:resetAllSettings'])).toBeNull()
  })

  test('allows profile recovery and signer protection only from the dashboard renderer', () => {
    const request = (role, channel) =>
      decodeBridgeMessage(
        encode({ source: LINK_SOURCE, method: 'invoke', id, args: [channel, 'bounded argument'] }),
        LINK_SOURCE,
        role
      )

    for (const channel of [
      'profile:export',
      'profile:inspectBackup',
      'profile:stageRestore',
      'signers:protectionStatus',
      'signers:enableProtection',
      'signers:disableProtection'
    ]) {
      expect(request('dash', channel)).not.toBeNull()
      expect(request('tray', channel)).toBeNull()
      expect(request('dapp', channel)).toBeNull()
      expect(request('onboard', channel)).toBeNull()
    }
  })

  test('rejects requests without a valid role while preserving responses', () => {
    const request = encode({ source: LINK_SOURCE, method: 'rpc', id, args: ['getState'] })
    const response = encode({ source: BRIDGE_SOURCE, method: 'rpc', id, args: [null, {}] })

    expect(decodeBridgeMessage(request, LINK_SOURCE, null)).toBeNull()
    expect(decodeBridgeMessage(response, BRIDGE_SOURCE, null)).not.toBeNull()
  })

  test('requires the current window and an allowed origin', () => {
    const currentWindow = {}
    const origins = ['null', 'http://localhost:1234']

    expect(isTrustedBridgeEvent({ source: currentWindow, origin: 'null' }, currentWindow, origins)).toBe(true)
    expect(isTrustedBridgeEvent({ source: {}, origin: 'null' }, currentWindow, origins)).toBe(false)
    expect(
      isTrustedBridgeEvent({ source: currentWindow, origin: 'https://example.com' }, currentWindow, origins)
    ).toBe(false)
  })

  test('uses exact web origins and a wildcard only for the packaged file origin', () => {
    expect(getRendererTargetOrigin({ protocol: 'http:', origin: 'http://localhost:1234' })).toBe(
      'http://localhost:1234'
    )
    expect(getRendererTargetOrigin({ protocol: 'file:', origin: 'null' })).toBe('*')
  })
})
