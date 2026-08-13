// Legacy migrations preserve historical persisted shapes. Values stay unknown until
// the migration that owns a field has narrowed them.

import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import log from 'electron-log'

import { accountNS, getDefaultAccountName } from '../../../../../resources/domain/account'
import { isWindows } from '../../../../../resources/platform'

const LegacyEndpointSchema = z
  .object({
    on: z.boolean().optional(),
    current: z.string().optional(),
    status: z.string().optional(),
    connected: z.boolean().optional(),
    type: z.string().optional(),
    network: z.string().optional(),
    custom: z.string().optional()
  })
  .passthrough()

const LegacyConnectionSchema = z
  .object({
    primary: LegacyEndpointSchema.optional(),
    secondary: LegacyEndpointSchema.optional(),
    on: z.boolean().optional()
  })
  .passthrough()

const LegacyGasSchema = z
  .object({
    price: z
      .object({
        selected: z.string().optional(),
        lastLevel: z.string().optional(),
        levels: z.record(z.string(), z.unknown()).optional()
      })
      .passthrough()
      .optional(),
    fees: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough()

const LegacyNetworkSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
    layer: z.string().optional(),
    symbol: z.string().optional(),
    name: z.string().optional(),
    explorer: z.string().optional(),
    gas: LegacyGasSchema.optional(),
    connection: LegacyConnectionSchema.optional(),
    on: z.boolean().optional(),
    isTestnet: z.boolean().optional()
  })
  .passthrough()

const LegacyNativeCurrencySchema = z
  .object({
    usd: z.record(z.string(), z.unknown()).optional(),
    icon: z.string().optional(),
    name: z.string().optional(),
    symbol: z.string().optional(),
    decimals: z.number().optional()
  })
  .passthrough()

const LegacyNetworkMetaSchema = z
  .object({
    gas: LegacyGasSchema.optional(),
    nativeCurrency: LegacyNativeCurrencySchema.optional(),
    icon: z.string().optional(),
    primaryColor: z.string().optional()
  })
  .passthrough()

const LegacySmartSchema = z
  .object({
    type: z.string().optional(),
    actor: z.union([z.string(), z.object({ address: z.string() }).passthrough()]).optional(),
    chain: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough()

const LegacyAccountSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    lastSignerType: z.string().optional(),
    type: z.string().optional(),
    address: z.string().optional(),
    addresses: z.array(z.string()).optional(),
    created: z.union([z.string(), z.number()]).nullish(),
    smart: LegacySmartSchema.optional(),
    permissions: z.record(z.string(), z.unknown()).optional(),
    tokens: z.unknown().optional()
  })
  .passthrough()

const LegacyTokenSchema = z.object({ address: z.string().optional() }).passthrough()
const LegacyTokensSchema = z.union([
  z.array(z.unknown()),
  z
    .object({
      custom: z.array(z.unknown()).optional(),
      known: z.record(z.string(), z.array(LegacyTokenSchema)).optional()
    })
    .passthrough()
])

const LegacyShortcutSchema = z
  .object({
    modifierKeys: z.array(z.string()).optional(),
    shortcutKey: z.string().optional(),
    enabled: z.boolean().optional(),
    configuring: z.boolean().optional()
  })
  .passthrough()

const LegacyTopLevelConnectionSchema = z
  .object({
    network: z.union([z.string(), z.number()]).optional(),
    local: z
      .object({
        on: z.boolean().optional(),
        settings: z
          .record(
            z.string(),
            z
              .object({
                options: z.record(z.string(), z.unknown()).optional(),
                current: z.string().optional()
              })
              .passthrough()
          )
          .optional()
      })
      .passthrough()
      .optional(),
    secondary: z
      .object({
        on: z.boolean().optional(),
        settings: z
          .record(
            z.string(),
            z
              .object({
                options: z.record(z.string(), z.unknown()).optional(),
                current: z.string().optional()
              })
              .passthrough()
          )
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

const LegacyStateSchema = z
  .object({
    main: z
      .object({
        _version: z.coerce.number(),
        networks: z
          .object({ ethereum: z.record(z.string(), LegacyNetworkSchema) })
          .passthrough()
          .optional(),
        networksMeta: z
          .object({ ethereum: z.record(z.string(), LegacyNetworkMetaSchema) })
          .passthrough()
          .optional(),
        accounts: z.record(z.string(), LegacyAccountSchema).optional(),
        addresses: z.record(z.string(), LegacyAccountSchema).optional(),
        permissions: z.record(z.string(), z.unknown()).optional(),
        balances: z.record(z.string(), z.array(LegacyTokenSchema)).optional(),
        gasPrice: z
          .record(
            z.string(),
            z.object({ default: z.string(), levels: z.record(z.string(), z.unknown()) }).passthrough()
          )
          .optional(),
        connection: LegacyTopLevelConnectionSchema.optional(),
        currentNetwork: z
          .object({ id: z.union([z.string(), z.number()]).optional() })
          .passthrough()
          .optional(),
        clients: z.unknown().optional(),
        backup: z.record(z.string(), z.unknown()).optional(),
        hardwareDerivation: z.string().optional(),
        ledger: z.record(z.string(), z.unknown()).optional(),
        trezor: z.record(z.string(), z.unknown()).optional(),
        lattice: z.record(z.string(), z.unknown()).optional(),
        latticeSettings: z.record(z.string(), z.unknown()).optional(),
        mute: z.record(z.string(), z.unknown()).optional(),
        tokens: z.unknown().optional(),
        shortcuts: z.unknown().optional(),
        accountsMeta: z.record(z.string(), z.unknown()).optional()
      })
      .passthrough()
  })
  .passthrough()

type LegacyState = z.infer<typeof LegacyStateSchema>
type LegacyMigration = (initial: LegacyState) => LegacyState

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidField = (migration: number, field: string): never => {
  throw new Error(`Migration ${migration}: invalid ${field}`)
}

const required = <Value>(value: Value | undefined, migration: number, field: string): Value =>
  value === undefined ? invalidField(migration, field) : value

const ethereumNetworks = (initial: LegacyState, migration: number) =>
  initial.main.networks?.ethereum || invalidField(migration, 'networks')

const ethereumNetworkMeta = (initial: LegacyState, migration: number) =>
  initial.main.networksMeta?.ethereum || invalidField(migration, 'network metadata')

const legacyAccounts = (initial: LegacyState, migration: number) =>
  initial.main.accounts || invalidField(migration, 'accounts')

const legacyValueIsGreater = (
  left: string | number | null | undefined,
  right: string | number | null | undefined
) => {
  const leftValue = left ?? ''
  const rightValue = right ?? ''
  if (typeof leftValue === typeof rightValue) {
    return typeof leftValue === 'number' ? leftValue > Number(rightValue) : leftValue > String(rightValue)
  }
  return Number(leftValue) > Number(rightValue)
}

const migrations = {
  4: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 4)
    const gasPrice = initial.main.gasPrice

    if (gasPrice) {
      Object.entries(gasPrice).forEach(([networkId, settings]) => {
        if (settings.default === 'normal') settings.default = 'standard'
        const price = networks[networkId]?.gas?.price
        if (price) {
          price.selected = settings.default
          price.levels = { ...(price.levels || {}), custom: settings.levels['custom'] }
        }
      })
    }

    const connection = initial.main.connection
    if (connection) {
      Object.entries(connection.local?.settings || {}).forEach(([networkId, settings]) => {
        const endpoint = networks[networkId]?.connection?.primary
        if (!endpoint) return
        const custom = settings.options?.['custom']
        if (typeof custom === 'string') endpoint.custom = custom
        const current = settings.current === 'direct' ? 'local' : settings.current
        if (current) endpoint.current = current
      })

      Object.entries(connection.secondary?.settings || {}).forEach(([networkId, settings]) => {
        const endpoint = networks[networkId]?.connection?.secondary
        if (!endpoint) return
        const custom = settings.options?.['custom']
        if (typeof custom === 'string') endpoint.custom = custom
        const current = settings.current === 'direct' ? 'local' : settings.current
        if (current) endpoint.current = current
      })

      Object.values(networks).forEach((network) => {
        if (network.connection?.primary && connection.local?.on !== undefined) {
          network.connection.primary.on = connection.local.on
        }
        if (network.connection?.secondary && connection.secondary?.on !== undefined) {
          network.connection.secondary.on = connection.secondary.on
        }
      })

      const currentNetwork = initial.main.currentNetwork || {}
      currentNetwork.id = connection.network || currentNetwork.id || 1
      initial.main.currentNetwork = currentNetwork
    }

    Object.values(networks).forEach((network) => {
      // The original JavaScript compared Object.keys strings with numeric 74/100,
      // so every missing symbol took this ETH fallback.
      if (!network.symbol) network.symbol = 'ETH'
      if (network.symbol === 'Ξ') network.symbol = 'ETH'
      const price = network.gas?.price
      if (price?.selected === 'safelow') price.selected = 'slow'
      if (price?.selected === 'trader') price.selected = 'asap'
      if (price?.selected === 'custom') price.selected = price.lastLevel || 'standard'
    })

    if (initial.main.mute && initial.main['accountCloseLock'] === undefined) {
      initial.main['accountCloseLock'] = true
    }
    delete initial.main.gasPrice
    delete initial.main.connection

    return initial
  },
  5: (initial: LegacyState) => {
    // Add Polygon to persisted networks
    ethereumNetworks(initial, 5)[137] = {
      id: 137,
      type: 'ethereum',
      symbol: 'MATIC',
      name: 'Polygon',
      explorer: 'https://polygonscan.com',
      gas: {
        price: {
          selected: 'standard',
          levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
        }
      },
      connection: {
        primary: {
          on: true,
          current: 'matic',
          status: 'loading',
          connected: false,
          type: '',
          network: '',
          custom: ''
        },
        secondary: {
          on: false,
          current: 'custom',
          status: 'loading',
          connected: false,
          type: '',
          network: '',
          custom: ''
        }
      }
    }
    return initial
  },
  6: (initial: LegacyState) => {
    // If previous hardwareDerivation is testnet, set that for split ledger/trezor derevation
    if (initial.main.hardwareDerivation === 'testnet') {
      initial.main.ledger = initial.main.ledger || {}
      initial.main.trezor = initial.main.trezor || {}
      initial.main.ledger['derivation'] = 'testnet'
      initial.main.trezor['derivation'] = 'testnet'
    }
    return initial
  },
  7: (initial: LegacyState) => {
    const originalAccounts = structuredClone(legacyAccounts(initial, 7))
    const addresses = structuredClone(initial.main.addresses || {})

    // Pre-v7 builds could store address records in the account map.
    Object.keys(originalAccounts).forEach((id) => {
      const account = originalAccounts[id]
      if (id.startsWith('0x') && account) {
        addresses[id] = account
        delete originalAccounts[id]
      }
    })

    const newAccounts: Record<string, z.infer<typeof LegacyAccountSchema>> = {}
    const permissions = initial.main.permissions || {}
    let skippedAddresses = 0
    Object.keys(addresses).forEach((originalAddress) => {
      const addressRecord = addresses[originalAddress]
      if (!addressRecord) return
      const address = originalAddress.toLowerCase()
      addresses[address] = addressRecord

      if (!addressRecord.permissions || Object.keys(addressRecord.permissions).length === 0) {
        skippedAddresses += 1
        return
      }
      permissions[address] = { ...addressRecord.permissions }

      const matchingAccounts = Object.keys(originalAccounts)
        .sort((left, right) =>
          legacyValueIsGreater(originalAccounts[left]?.created, originalAccounts[right]?.created) ? 1 : -1
        )
        .filter((id) =>
          originalAccounts[id]?.addresses?.map((value) => value.toLowerCase()).includes(address)
        )
        .sort((left, right) => {
          const leftLength = originalAccounts[left]?.addresses?.length || 0
          const rightLength = originalAccounts[right]?.addresses?.length || 0
          return leftLength === rightLength ? 0 : leftLength > rightLength ? -1 : 1
        })

      const sourceId = matchingAccounts[0]
      const source = sourceId ? originalAccounts[sourceId] : undefined
      if (!source) return
      const migrated: z.infer<typeof LegacyAccountSchema> = {
        ...source,
        address,
        id: address,
        lastSignerType: source.type
      }
      delete migrated.type
      delete migrated['network']
      delete migrated['signer']
      delete migrated['index']
      delete migrated.addresses
      migrated.tokens = addressRecord.tokens || {}
      newAccounts[address] = migrated
    })

    if (skippedAddresses > 0) log.info(`Migration 7: skipped ${skippedAddresses} inactive addresses`)
    initial.main.backup = initial.main.backup || {}
    initial.main.backup['accounts'] = { ...originalAccounts }
    initial.main.backup['addresses'] = { ...addresses }
    initial.main.permissions = permissions
    initial.main.accounts = newAccounts
    delete initial.main.addresses

    return initial
  },
  8: (initial: LegacyState) => {
    // Add on/off value to chains
    const networks = ethereumNetworks(initial, 8)
    Object.keys(networks).forEach((chainId) => {
      const network = networks[chainId]
      if (network) network.on = chainId === '1' || chainId === String(initial.main.currentNetwork?.id)
    })

    return initial
  },
  9: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 9)
    Object.keys(networks).forEach((chainId) => {
      const network = networks[chainId]
      if (!network) return
      if (chainId === '1') {
        network.layer = 'mainnet'
      } else if (chainId === '10') {
        network.layer = 'rollup'
      } else if (chainId === '100' || chainId === '137') {
        network.layer = 'sidechain'
      } else if (chainId === '3' || chainId === '4' || chainId === '5' || chainId === '42') {
        network.layer = 'testnet'
      } else {
        network.layer = 'other'
      }
    })

    return initial
  },
  10: (initial: LegacyState) => {
    // Add Optimism to persisted networks
    ethereumNetworks(initial, 10)[10] = {
      id: 10,
      type: 'ethereum',
      layer: 'rollup',
      symbol: 'ETH',
      name: 'Optimism',
      explorer: 'https://optimistic.etherscan.io',
      gas: {
        price: {
          selected: 'standard',
          levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
        }
      },
      connection: {
        primary: {
          on: true,
          current: 'optimism',
          status: 'loading',
          connected: false,
          type: '',
          network: '',
          custom: ''
        },
        secondary: {
          on: false,
          current: 'custom',
          status: 'loading',
          connected: false,
          type: '',
          network: '',
          custom: ''
        }
      },
      on: false
    }
    return initial
  },
  11: (initial: LegacyState) => {
    // Convert all Ξ symbols to ETH
    Object.values(ethereumNetworks(initial, 11)).forEach((chain) => {
      if (chain.symbol === 'Ξ') chain.symbol = 'ETH'
    })
    // Convert all accounts to new creation type system
    const accounts = legacyAccounts(initial, 11)
    Object.keys(accounts).forEach((accountId) => {
      const account = accounts[accountId]
      if (!account) return
      try {
        if (!account.created || account.created === -1) {
          account.created = 'new:' + Date.now()
        } else {
          account.created = String(account.created)
          const [block, localTime] = account.created.split(':')
          if (!block) {
            account.created = 'new:' + Date.now()
          } else if (!localTime) {
            account.created = block + ':' + Date.now()
          }
        }

        const [block = '', localTime] = String(account.created).split(':')
        let blockValue: string | number = block
        // The original "hex" radix coerced to zero, equivalent to parseInt here.
        if (block.startsWith('0x')) blockValue = parseInt(block)
        if (Number(blockValue) > 12726312) blockValue = 12726312
        account.created = blockValue + ':' + localTime
      } catch (e) {
        log.error('Migration error', e)
        delete accounts[accountId]
      }
    })

    return initial
  },
  12: (initial: LegacyState) => {
    // Update old smart accounts
    Object.values(legacyAccounts(initial, 12)).forEach((account) => {
      const smart = account.smart
      const actor = smart?.actor
      if (smart && actor && typeof actor !== 'string') smart.actor = actor.address
    })

    return initial
  },
  13: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 13)
    const networkMetadata = ethereumNetworkMeta(initial, 13)
    const defaultMeta = {
      gas: {
        price: {
          selected: 'standard',
          levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
        }
      }
    }

    // ensure all network configurations have corresponding network meta
    Object.keys(networks).forEach((networkId) => {
      const metadata = networkMetadata[networkId]
      if (metadata) {
        const gasSettings = metadata.gas
        const price = gasSettings?.price

        metadata.gas = {
          price: {
            selected: price?.selected || defaultMeta.gas.price.selected,
            levels: price?.levels || defaultMeta.gas.price.levels
          }
        }
      } else {
        networkMetadata[networkId] = { ...defaultMeta }
      }
    })

    return initial
  },
  14: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 14)
    const networkMetadata = ethereumNetworkMeta(initial, 14)
    const polygonConnection = networks[137]?.connection
    if (polygonConnection?.primary?.current === 'matic') polygonConnection.primary.current = 'infura'
    if (polygonConnection?.secondary?.current === 'matic') polygonConnection.secondary.current = 'infura'

    // add arbitrum network information
    if (!networks[42161]) {
      networks[42161] = {
        id: 42161,
        type: 'ethereum',
        layer: 'rollup',
        symbol: 'ETH',
        name: 'Arbitrum',
        explorer: 'https://explorer.arbitrum.io',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          primary: {
            on: true,
            current: 'infura',
            status: 'loading',
            connected: false,
            type: '',
            network: '',
            custom: ''
          },
          secondary: {
            on: false,
            current: 'custom',
            status: 'loading',
            connected: false,
            type: '',
            network: '',
            custom: ''
          }
        },
        on: false
      }
    }

    if (!networkMetadata[42161]) {
      networkMetadata[42161] = {
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        }
      }
    }

    return initial
  },
  15: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 15)
    // Polygon
    if (networks['137']) {
      const oldExplorer = networks['137'].explorer

      if (!oldExplorer || oldExplorer.endsWith('explorer.matic.network')) {
        // only replace if it hasn't been changed from the initial setting
        networks['137'].explorer = 'https://polygonscan.com'
      }
    }

    return initial
  },
  16: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 16)
    if (initial.main.currentNetwork?.id) {
      const id = parseInt(String(initial.main.currentNetwork.id))
      if (Number.isNaN(id)) invalidField(16, 'current network id')
      initial.main.currentNetwork.id = id
    }
    Object.keys(networks).forEach((chain) => {
      const network = networks[chain]
      if (!network?.id) return
      const id = parseInt(String(network.id))
      if (Number.isNaN(id)) invalidField(16, 'network id')
      network.id = id
    })
    return initial
  },
  17: (initial: LegacyState) => {
    // update Lattice settings
    const lattices = initial.main.lattice || {}
    const suffix = initial.main.latticeSettings?.['suffix']
    const oldSuffix = typeof suffix === 'string' ? suffix : ''

    Object.values(lattices).forEach((lattice) => {
      if (!isUnknownRecord(lattice)) return
      lattice['paired'] = true
      lattice['tag'] = oldSuffix
      lattice['deviceName'] = 'GridPlus'
    })

    return initial
  },
  18: (initial: LegacyState) => {
    // move custom tokens to new location
    let existingCustomTokens: unknown[] = []

    if (Array.isArray(initial.main.tokens)) {
      existingCustomTokens = [...initial.main.tokens]
    }

    initial.main.tokens = { custom: existingCustomTokens }

    return initial
  },
  19: (initial: LegacyState) => {
    // delete main.currentNetwork and main.clients
    delete initial.main.currentNetwork
    delete initial.main.clients

    return initial
  },
  20: (initial: LegacyState) => {
    // move all Aragon accounts to mainnet and add a warning if we did
    Object.values(legacyAccounts(initial, 20)).forEach((account) => {
      if (account.smart?.type === 'aragon' && !account.smart.chain) {
        account.smart.chain = { type: 'ethereum', id: 1 }
        const mute = initial.main.mute || {}
        mute['aragonAccountMigrationWarning'] = false
        initial.main.mute = mute
      }
    })

    return initial
  },
  21: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 21)
    const networkMetadata = ethereumNetworkMeta(initial, 21)
    // add sepolia network information
    if (!networks[11155111]) {
      networks[11155111] = {
        id: 11155111,
        type: 'ethereum',
        layer: 'testnet',
        symbol: 'ETH',
        name: 'Sepolia',
        explorer: 'https://sepolia.etherscan.io',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          primary: {
            on: true,
            current: 'infura',
            status: 'loading',
            connected: false,
            type: '',
            network: '',
            custom: ''
          },
          secondary: {
            on: false,
            current: 'custom',
            status: 'loading',
            connected: false,
            type: '',
            network: '',
            custom: ''
          }
        },
        on: false
      }
    }

    if (!networkMetadata[11155111]) {
      networkMetadata[11155111] = {
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        }
      }
    }

    if ('5' in networks) {
      // we removed support for the following goerli RPCs so reset the connections
      // to defaults when the user was previously connecting to them
      const removedGoerliRPCs = ['mudit', 'slockit', 'prylabs']
      const goerli = required(networks[5], 21, 'Goerli network')
      const connection = required(goerli.connection, 21, 'Goerli connection')
      const resetEndpoint = (endpoint: z.infer<typeof LegacyEndpointSchema> | undefined) =>
        endpoint?.current && removedGoerliRPCs.includes(endpoint.current)
          ? {
              on: false,
              current: 'custom',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          : endpoint
      const primary = resetEndpoint(connection.primary)
      const secondary = resetEndpoint(connection.secondary)
      goerli.connection = {
        ...connection,
        ...(primary ? { primary } : {}),
        ...(secondary ? { secondary } : {}),
        on: Boolean(primary?.on || secondary?.on)
      }
    }

    return initial
  },
  22: (initial: LegacyState) => {
    // set "isTestnet" flag on all chains based on layer value
    Object.values(ethereumNetworks(initial, 22)).forEach((chain) => {
      chain.isTestnet = chain.layer === 'testnet'
    })

    return initial
  },
  23: (initial: LegacyState) => {
    // set icon and primaryColor values on all chains
    Object.entries(ethereumNetworkMeta(initial, 23)).forEach(([id, chain]) => {
      if (id === '1') {
        chain.icon = ''
        chain.primaryColor = 'accent1' // Main
      } else if (id === '10') {
        chain.icon = 'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/optimism.svg'
        chain.primaryColor = 'accent4' // Optimism
      } else if (id === '100') {
        chain.icon = 'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/gnosis.svg'
        chain.primaryColor = 'accent5' // Gnosis
      } else if (id === '137') {
        chain.icon = 'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/polygon.svg'
        chain.primaryColor = 'accent6' // Polygon
      } else if (id === '42161') {
        chain.icon = 'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/arbitrum.svg'
        chain.primaryColor = 'accent7' // Arbitrum
      } else if (['3', '4', '5', '42', '11155111'].includes(id)) {
        chain.icon = ''
        chain.primaryColor = 'accent2' // Testnets
      } else {
        chain.icon = ''
        chain.primaryColor = 'accent3' // Default
      }
    })

    return initial
  },
  24: (initial: LegacyState) => {
    // set default nativeCurrency where it doesn't exist
    Object.values(ethereumNetworkMeta(initial, 24)).forEach((chain) => {
      if (!chain.nativeCurrency) {
        chain.nativeCurrency = {
          usd: { price: 0, change24hr: 0 },
          icon: '',
          name: '',
          symbol: '',
          decimals: 0
        }
      }
    })

    return initial
  },
  25: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 25)
    // remove Optimism RPC connection presets and use Infura instead
    if ('10' in networks) {
      const removeOptimismConnection = (connection: z.infer<typeof LegacyEndpointSchema>) => ({
        ...connection,
        current: connection.current === 'optimism' ? 'infura' : connection.current
      })

      const optimism = required(networks[10], 25, 'Optimism network')
      const primary = required(optimism.connection?.primary, 25, 'Optimism primary connection')
      const secondary = required(optimism.connection?.secondary, 25, 'Optimism secondary connection')

      networks[10] = {
        ...optimism,
        connection: {
          primary: removeOptimismConnection(primary),
          secondary: removeOptimismConnection(secondary)
        }
      }
    }

    return initial
  },
  26: (initial: LegacyState) => {
    const networkMetadata = ethereumNetworkMeta(initial, 26)
    Object.values(ethereumNetworks(initial, 26)).forEach((network) => {
      const { symbol, id } = network
      if (id === undefined) invalidField(26, 'network id')
      const metadata = required(networkMetadata[String(id)], 26, 'network metadata')
      const nativeCurrency = required(metadata.nativeCurrency, 26, 'native currency metadata')
      nativeCurrency.symbol = nativeCurrency.symbol || symbol
      delete network.symbol
    })

    return initial
  },
  27: (initial: LegacyState) => {
    // change any accounts with the old names of "seed signer" or "ring signer" to "hot signer"

    const accounts = Object.entries(legacyAccounts(initial, 27)).map(([id, account]) => {
      const name = ['ring account', 'seed account'].includes((account.name || '').toLowerCase())
        ? 'Hot Account'
        : account.name

      return [id, { ...account, name }]
    })

    initial.main.accounts = Object.fromEntries(accounts)

    return initial
  },
  28: (initial: LegacyState) => {
    const getUpdatedSymbol = (symbol: string | undefined, chainId: string) => {
      return parseInt(chainId) === 5 ? 'görETH' : parseInt(chainId) === 11155111 ? 'sepETH' : symbol
    }

    const updatedMeta = Object.entries(ethereumNetworkMeta(initial, 28)).map(([id, chainMeta]) => {
      const nativeCurrency = required(chainMeta.nativeCurrency, 28, 'native currency metadata')
      const { symbol, decimals } = nativeCurrency
      const updatedSymbol = (symbol || '').toLowerCase() !== 'eth' ? symbol : getUpdatedSymbol(symbol, id)

      const updatedChainMeta = {
        ...chainMeta,
        nativeCurrency: {
          ...nativeCurrency,
          symbol: updatedSymbol,
          decimals: decimals || 18
        }
      }

      return [id, updatedChainMeta]
    })

    initial.main.networksMeta = {
      ...(initial.main.networksMeta || {}),
      ethereum: Object.fromEntries(updatedMeta)
    }

    return initial
  },
  29: (initial: LegacyState) => {
    // add accountsMeta
    const accountsMeta: Record<string, unknown> = {}
    initial.main.accountsMeta = accountsMeta
    Object.entries(legacyAccounts(initial, 29)).forEach(([id, account]) => {
      const { lastSignerType, name } = account
      if (!lastSignerType || !name) return
      // Watch accounts, having a signer type of "address", used to have a default label of "Address Account"
      const isPreviousDefaultWatchAccountName =
        lastSignerType.toLowerCase() === 'address' && name.toLowerCase() === 'address account'
      const isCurrentDefaultName = name.toLowerCase() === getDefaultAccountName(lastSignerType)
      if (!isPreviousDefaultWatchAccountName && !isCurrentDefaultName) {
        const accountMetaId = uuidv5(id, accountNS)
        accountsMeta[accountMetaId] = {
          name,
          lastUpdated: Date.now()
        }
      }
    })

    return initial
  },
  30: (initial: LegacyState) => {
    // convert Aragon accounts to watch only
    const accounts = legacyAccounts(initial, 30)
    Object.entries(accounts).forEach(([id, { smart, name, created }]) => {
      if (smart) {
        accounts[id] = {
          id,
          name,
          lastSignerType: 'address',
          address: id,
          status: 'ok',
          active: false,
          signer: '',
          requests: {},
          ensName: '',
          created,
          balances: {}
        }
      }
    })

    return initial
  },
  31: (initial: LegacyState) => {
    const dodgyAddress = '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000'
    const balances = initial.main.balances || invalidField(31, 'balances')

    Object.entries(balances).forEach(([account, entries]) => {
      balances[account] = entries.filter(({ address }) => address !== dodgyAddress)
    })

    return initial
  },
  32: (initial: LegacyState) => {
    const dodgyAddress = '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000'
    const parsedTokens = LegacyTokensSchema.safeParse(initial.main.tokens)
    const tokens = parsedTokens.success ? parsedTokens.data : invalidField(32, 'tokens')
    const tokenState = Array.isArray(tokens) ? invalidField(32, 'known tokens') : tokens
    const knownTokens = tokenState.known || {}
    Object.entries(knownTokens).forEach(([address, tokens]) => {
      knownTokens[address] = tokens.filter(({ address }) => address !== dodgyAddress)
    })

    tokenState.known = knownTokens
    initial.main.tokens = tokenState

    return initial
  },
  33: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 33)
    const networkMetadata = ethereumNetworkMeta(initial, 33)
    // add Base testnet network information
    if (!networks[84531]) {
      networks[84531] = {
        id: 84531,
        type: 'ethereum',
        layer: 'testnet',
        isTestnet: true,
        name: 'Base Görli',
        explorer: 'https://goerli-explorer.base.org',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          primary: {
            on: true,
            current: 'custom',
            status: 'loading',
            connected: false,
            type: '',
            network: '',
            custom: 'https://goerli.base.org'
          },
          secondary: {
            on: false,
            current: 'custom',
            status: 'loading',
            connected: false,
            type: '',
            network: '',
            custom: ''
          }
        },
        on: false
      }
    }

    if (!networkMetadata[84531]) {
      networkMetadata[84531] = {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'görETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Görli Ether',
          decimals: 18
        },
        icon: 'https://frame.nyc3.cdn.digitaloceanspaces.com/baseiconcolor.png',
        primaryColor: 'accent2' // Testnet
      }
    }

    return initial
  },
  34: (initial: LegacyState) => {
    const networks = ethereumNetworks(initial, 34)
    const networkMetadata = ethereumNetworkMeta(initial, 34)
    // Add any missing nativeCurrency name values
    // Base Görli (84531) value added in #33
    const nativeCurrencyMap: Partial<Record<number, { name: string; symbol: string }>> = {
      1: {
        name: 'Ether',
        symbol: 'ETH'
      },
      5: {
        name: 'Görli Ether',
        symbol: 'görETH'
      },
      10: {
        name: 'Ether',
        symbol: 'ETH'
      },
      100: {
        name: 'xDAI',
        symbol: 'xDAI'
      },
      137: {
        name: 'Matic',
        symbol: 'MATIC'
      },
      42161: {
        name: 'Ether',
        symbol: 'ETH'
      },
      11155111: {
        name: 'Sepolia Ether',
        symbol: 'sepETH'
      }
    }

    Object.values(networks).forEach((network) => {
      const { id } = network
      if (id === undefined) invalidField(34, 'network id')
      const defaults = nativeCurrencyMap[Number(id)]
      const { name = '', symbol = '' } = defaults || {}
      const existingMeta = networkMetadata[String(id)] || {}
      const { nativeCurrency = {} } = existingMeta

      networkMetadata[String(id)] = {
        ...existingMeta,
        nativeCurrency: {
          ...nativeCurrency,
          name: nativeCurrency.name || name,
          symbol: nativeCurrency.symbol || symbol
        }
      }
    })

    return initial
  },
  35: (initial: LegacyState) => {
    const shortcutsResult = z
      .object({ altSlash: z.boolean().optional(), summon: LegacyShortcutSchema.optional() })
      .passthrough()
      .safeParse(initial.main.shortcuts)
    const shortcuts = shortcutsResult.success ? shortcutsResult.data : {}
    const { altSlash: summonShortcutEnabled, ...otherShortcuts } = shortcuts

    initial.main.shortcuts = {
      ...otherShortcuts,
      summon: {
        modifierKeys: ['Alt'],
        shortcutKey: 'Slash',
        enabled: summonShortcutEnabled,
        configuring: false
      }
    }

    return initial
  },
  36: (initial: LegacyState) => {
    const shortcuts = initial.main.shortcuts
    if (isUnknownRecord(shortcuts)) {
      const summon = shortcuts['summon']
      if (isUnknownRecord(summon) && summon['enabled'] === undefined) summon['enabled'] = true
    }

    return initial
  },
  37: (initial: LegacyState) => {
    const replaceAltGr = () => (isWindows() ? ['Alt', 'Control'] : ['Alt'])
    const updateModifierKey = (key: string) => (key === 'AltGr' ? replaceAltGr() : key)

    const defaultShortcuts = {
      summon: {
        modifierKeys: ['Alt'],
        shortcutKey: 'Slash',
        enabled: true,
        configuring: false
      }
    }

    const shortcutsSchema = z
      .object({
        summon: z.object({
          modifierKeys: z.array(z.string()),
          shortcutKey: z.string(),
          enabled: z.boolean(),
          configuring: z.boolean()
        })
      })
      .catch(defaultShortcuts)

    const result = shortcutsSchema.safeParse(initial.main.shortcuts)

    if (result.success) {
      const shortcuts = result.data

      const updatedSummonShortcut = {
        ...shortcuts.summon,
        modifierKeys: shortcuts.summon.modifierKeys.map(updateModifierKey).flat()
      }

      initial.main.shortcuts = {
        ...shortcuts,
        summon: updatedSummonShortcut
      }
    } else {
      log.error('Migration 37: Could not migrate shortcuts', result.error)
    }

    return initial
  }
} satisfies Record<number, LegacyMigration>

// retrofit legacy migrations
const legacyMigrations = Object.entries(migrations).map(([version, legacyMigration]) => ({
  version: parseInt(version),
  migrate: (initial: unknown) => {
    const parsed = LegacyStateSchema.safeParse(initial)
    if (!parsed.success) {
      // Record keys can contain addresses, origins, or endpoint labels. Limit
      // diagnostics to the owned top-level state field.
      const fields = [...new Set(parsed.error.issues.map(({ path }) => path.slice(0, 2).join('.')))].slice(
        0,
        5
      )
      throw new Error(`Migration ${version}: invalid state${fields.length ? ` (${fields.join(', ')})` : ''}`)
    }
    return legacyMigration(parsed.data)
  }
}))

export default legacyMigrations
