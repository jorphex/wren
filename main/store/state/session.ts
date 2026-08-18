import { v5 as uuidv5 } from 'uuid'

const legacyUnknownOriginId = uuidv5('Unknown', uuidv5.DNS)
const isSessionOnlyPermission = (origin: string) => origin === 'Unknown' || origin.startsWith('Unknown/')

type SessionPrincipalState = {
  origins: Record<string, { sessionOnly: boolean }>
  permissions: Record<string, Record<string, { origin: string }>>
  dappGuardrails: Record<string, Record<string, unknown>>
}

export function clearSessionOnlyOrigins(main: SessionPrincipalState) {
  const prunedOriginIds = new Set(
    Object.entries(main.origins)
      .filter(([id, origin]) => id === legacyUnknownOriginId || origin.sessionOnly)
      .map(([id]) => id)
  )

  Object.values(main.permissions).forEach((permissions) => {
    Object.entries(permissions).forEach(([originId, permission]) => {
      if (prunedOriginIds.has(originId) || isSessionOnlyPermission(permission.origin)) {
        prunedOriginIds.add(originId)
        delete permissions[originId]
      }
    })
  })

  Object.values(main.dappGuardrails).forEach((guardrails) => {
    prunedOriginIds.forEach((originId) => delete guardrails[originId])
  })

  main.origins = Object.fromEntries(Object.entries(main.origins).filter(([id]) => !prunedOriginIds.has(id)))
}
