import { z } from 'zod'

const PUBLICNODE_CHAIN_IDS = new Set(['1', '10', '137', '8453', '42161', '84532', '11155111', '11155420'])

const LEGACY_PYLON_RPC_HOST = 'evm.pylon.link'

const ConnectionSchema = z
  .object({
    current: z.string(),
    custom: z.unknown().optional()
  })
  .passthrough()

const ChainSchema = z
  .object({
    connection: z
      .object({
        primary: ConnectionSchema,
        secondary: ConnectionSchema
      })
      .passthrough()
  })
  .passthrough()

const StateSchema = z
  .object({
    main: z
      .object({
        _version: z.number(),
        networks: z
          .object({
            ethereum: z.record(z.string(), ChainSchema)
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isInheritedFrameIcon = (value: unknown) => {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname === 'frame.nyc3.cdn.digitaloceanspaces.com'
    )
  } catch {
    return false
  }
}

const sanitizeIconField = <T extends Record<string, unknown>>(value: T): T => {
  if (!Object.prototype.hasOwnProperty.call(value, 'icon') || !isInheritedFrameIcon(value['icon'])) {
    return value
  }
  return { ...value, icon: '' }
}

const sanitizeNetworkMetadata = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value['ethereum'])) return value

  const ethereum = Object.fromEntries(
    Object.entries(value['ethereum']).map(([chainId, metadata]) => {
      if (!isRecord(metadata)) return [chainId, metadata]

      const sanitized = sanitizeIconField(metadata)
      const nativeCurrency = sanitized['nativeCurrency']
      return [
        chainId,
        isRecord(nativeCurrency)
          ? { ...sanitized, nativeCurrency: sanitizeIconField(nativeCurrency) }
          : sanitized
      ]
    })
  )

  return { ...value, ethereum }
}

const removeInventoryModule = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value['account'])) return value
  const account = value['account']
  if (!Array.isArray(account['moduleOrder'])) return value

  return {
    ...value,
    account: {
      ...account,
      moduleOrder: account['moduleOrder'].filter((moduleName) => moduleName !== 'inventory')
    }
  }
}

const isInheritedPylonEndpoint = (value: unknown) => {
  if (typeof value !== 'string' || !value) return false
  try {
    return new URL(value).hostname === LEGACY_PYLON_RPC_HOST
  } catch {
    return false
  }
}

const migrateConnection = (chainId: string, connection: z.infer<typeof ConnectionSchema>) => {
  if (connection.current !== 'pylon') {
    if (connection.current !== 'custom' || !isInheritedPylonEndpoint(connection.custom)) return connection
    return {
      ...connection,
      on: false,
      connected: false,
      status: 'off',
      custom: ''
    }
  }

  if (PUBLICNODE_CHAIN_IDS.has(chainId)) {
    return {
      ...connection,
      current: 'publicnode',
      custom: isInheritedPylonEndpoint(connection.custom) ? '' : connection.custom
    }
  }

  return {
    ...connection,
    on: false,
    connected: false,
    status: 'off',
    current: 'custom',
    custom:
      typeof connection.custom === 'string' && !isInheritedPylonEndpoint(connection.custom)
        ? connection.custom
        : ''
  }
}

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const ethereum = Object.fromEntries(
    Object.entries(parsed.data.main.networks.ethereum).map(([chainId, chain]) => [
      chainId,
      {
        ...sanitizeIconField(chain),
        connection: {
          ...chain.connection,
          primary: migrateConnection(chainId, chain.connection.primary),
          secondary: migrateConnection(chainId, chain.connection.secondary)
        }
      }
    ])
  )

  return {
    ...parsed.data,
    ...('panel' in parsed.data ? { panel: removeInventoryModule(parsed.data['panel']) } : {}),
    main: {
      ...parsed.data.main,
      ...('networksMeta' in parsed.data.main
        ? { networksMeta: sanitizeNetworkMetadata(parsed.data.main['networksMeta']) }
        : {}),
      networks: {
        ...parsed.data.main.networks,
        ethereum
      }
    }
  }
}

export default { version: 53, migrate }
