import { z } from 'zod'

const StateSchema = z
  .object({
    main: z
      .object({
        networks: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const legacyEthereumNames = new Set(['Mainnet', 'Ethereum Mainnet'])

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const networks = parsed.data.main.networks
  if (!networks || typeof networks !== 'object' || Array.isArray(networks)) return parsed.data
  const ethereum = (networks as Record<string, unknown>)['ethereum']
  if (!ethereum || typeof ethereum !== 'object' || Array.isArray(ethereum)) return parsed.data
  const chain = (ethereum as Record<string, unknown>)['1']
  if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return parsed.data
  const current = chain as Record<string, unknown>
  if (typeof current['name'] !== 'string' || !legacyEthereumNames.has(current['name'])) return parsed.data

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      networks: {
        ...(networks as Record<string, unknown>),
        ethereum: {
          ...(ethereum as Record<string, unknown>),
          1: { ...current, name: 'Ethereum' }
        }
      }
    }
  }
}

export default { version: 69, migrate }
