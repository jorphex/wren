export const EIP6963_ANNOUNCE_EVENT = 'eip6963:announceProvider'
export const EIP6963_REQUEST_EVENT = 'eip6963:requestProvider'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WREN_ICON = [
  'data:image/png;base64,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'
].join('')

export const WREN_PROVIDER_METADATA = Object.freeze({
  name: 'Wren',
  icon: WREN_ICON,
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
