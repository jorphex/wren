import { z } from 'zod'

const LEGACY_SEND_ORIGINS = new Set(['send.frame.eth', 'http://send.frame.eth.localhost:8421'])

const StateSchema = z
  .object({
    main: z
      .object({
        dapps: z.record(z.string(), z.unknown()).default({}),
        origins: z.record(z.string(), z.unknown()).default({}),
        permissions: z.record(z.string(), z.record(z.string(), z.unknown())).default({})
      })
      .passthrough()
  })
  .passthrough()

const originName = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const name = (value as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

const permissionOrigin = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const origin = (value as { origin?: unknown }).origin
  return typeof origin === 'string' ? origin : ''
}

const dappEns = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const ens = (value as { ens?: unknown }).ens
  return typeof ens === 'string' ? ens : ''
}

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const dapps = Object.fromEntries(
    Object.entries(parsed.data.main.dapps).filter(([, dapp]) => dappEns(dapp) !== 'send.frame.eth')
  )
  const origins = Object.fromEntries(
    Object.entries(parsed.data.main.origins).filter(
      ([, origin]) => !LEGACY_SEND_ORIGINS.has(originName(origin))
    )
  )
  const permissions = Object.fromEntries(
    Object.entries(parsed.data.main.permissions).map(([account, grants]) => [
      account,
      Object.fromEntries(
        Object.entries(grants).filter(
          ([, permission]) => !LEGACY_SEND_ORIGINS.has(permissionOrigin(permission))
        )
      )
    ])
  )

  return { ...parsed.data, main: { ...parsed.data.main, dapps, origins, permissions } }
}

export default { version: 55, migrate }
