import { z } from 'zod'

const EndpointSchema = z
  .object({
    on: z.boolean(),
    current: z.string(),
    custom: z.unknown().optional()
  })
  .passthrough()

const ChainSchema = z
  .object({
    connection: z
      .object({
        primary: EndpointSchema,
        secondary: EndpointSchema
      })
      .passthrough()
  })
  .passthrough()

const StateSchema = z
  .object({
    main: z
      .object({
        networks: z
          .object({
            ethereum: z.record(z.string(), ChainSchema)
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough()

const configured = (endpoint: z.infer<typeof EndpointSchema>) =>
  endpoint.on ||
  endpoint.current !== 'custom' ||
  (typeof endpoint.custom === 'string' && endpoint.custom.trim().length > 0)

const withId = (endpoint: z.infer<typeof EndpointSchema>, id: string) => ({ ...endpoint, id })

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const ethereum = Object.fromEntries(
    Object.entries(parsed.data.main.networks.ethereum).map(([chainId, chain]) => {
      const { primary, secondary, ...connection } = chain.connection
      const endpoints = [withId(primary, 'rpc-1')]
      if (configured(secondary)) endpoints.push(withId(secondary, 'rpc-2'))

      return [chainId, { ...chain, connection: { ...connection, endpoints } }]
    })
  )

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      networks: { ...parsed.data.main.networks, ethereum }
    }
  }
}

export default { version: 54, migrate }
