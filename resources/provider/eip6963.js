export const EIP6963_ANNOUNCE_EVENT = 'eip6963:announceProvider'
export const EIP6963_REQUEST_EVENT = 'eip6963:requestProvider'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const WREN_PROVIDER_METADATA = Object.freeze({
  name: 'Wren',
  icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgdmlld0JveD0iMCAwIDk2IDk2Ij48cmVjdIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgcng9IjIwIiBmaWxsPSIjMTExNTEzIi8+PHBhdGggZmlsbD0iI0E2OEE2MSIgZD0iTTE2IDU1YzEyLTIxIDMxLTI3IDQ3LTEyTDgxIDI0bC03IDIxIDE0LTEwLTE2IDIzQzYwIDc2IDM1IDc3IDE2IDU1WiIvPjxwYXRoIGZpbGw9IiNCNzlBNzAiIGQ9Im02MyA0MyAxOC0xOS03IDIxIDE0LTEwLTE2IDIzWiIvPjwvc3ZnPg==',
  rdns: 'io.github.jorphex.wren'
})

export function installEip6963Provider(target, provider) {
  const uuid = target.crypto?.randomUUID?.()
  if (typeof uuid !== 'string' || !UUID_V4.test(uuid)) {
    throw new Error('EIP-6963 requires a UUIDv4 identity')
  }
  if (typeof target.CustomEvent !== 'function') throw new Error('EIP-6963 requires CustomEvent')

  const info = Object.freeze({ uuid, ...WREN_PROVIDER_METADATA })
  const detail = Object.freeze({ info, provider })
  const announce = () => {
    target.dispatchEvent(new target.CustomEvent(EIP6963_ANNOUNCE_EVENT, { detail }))
  }

  target.addEventListener(EIP6963_REQUEST_EVENT, announce)
  announce()

  let installed = true
  return {
    detail,
    dispose() {
      if (!installed) return
      installed = false
      target.removeEventListener(EIP6963_REQUEST_EVENT, announce)
    }
  }
}
