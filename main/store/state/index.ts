import { v4 as generateUuid } from 'uuid'
import { z } from 'zod'
import log from 'electron-log'

import packageFile from '../../../package.json'

import persist from '../persist'
import migrations from '../migrate'

import { MainSchema } from './types/main'
import { clearSessionOnlyOrigins } from './session'
import { normalizeInterfaceScale } from '../../windows/uiScale'
import { createDesktopAuthIdentity, DesktopAuthIdentitySchema } from '../../api/desktopAuthIdentity'
import { pruneOutboundAddressMemory } from './types/outboundAddressMemory'
import { pruneRecentRecipientUses } from '../../../resources/domain/recentRecipients'

export type { ChainId, Chain, ChainMetadata } from './types/chain'
export type { Connection } from './types/connection'
export type { Origin } from './types/origin'
export type { Permission } from './types/permission'
export type { Account, AccountMetadata } from './types/account'
export type { ActivityEntry } from './types/activity'
export type { OperationLifecycle, OperationLifecycles } from './types/operationLifecycle'
export type { AddressBook, AddressBookEntry } from './types/addressBook'
export type { RecentRecipientUse, RecentRecipientUses } from './types/recentRecipients'
export type { Balance } from './types/balance'
export type { WithTokenId, Token } from './types/token'
export type { Dapp } from './types/dapp'
export type { DappGuardrail, DappGuardrails } from './types/dappGuardrail'
export type { ExtensionCredential } from './types/extensionCredential'
export type { NativeCurrency } from './types/nativeCurrency'
export type { Gas, GasFees } from './types/gas'
export type { Rate } from './types/rate'
export type { ColorwayPalette } from './types/colors'
export type { WalletCallBatch, WalletCallBatches, WalletCallReceipt } from './types/walletCallBatch'
export type { YearnState } from './types/yearn'

const StateSchema = z
  .object({
    main: MainSchema.passthrough()
  })
  .passthrough()

export type Migration = {
  version: number
  migrate: (initial: unknown) => unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mergeValidatedState = (source: unknown, validated: unknown): unknown => {
  if (Array.isArray(source) && Array.isArray(validated)) {
    return validated.map((value, index) => mergeValidatedState(source[index], value))
  }

  if (isRecord(source) && isRecord(validated)) {
    return Object.entries(validated).reduce<Record<string, unknown>>(
      (merged, [key, value]) => {
        merged[key] = mergeValidatedState(source[key], value)
        return merged
      },
      { ...source }
    )
  }

  return validated
}

const isValidState = (value: unknown): value is z.infer<typeof StateSchema> =>
  StateSchema.safeParse(value).success

const latestStateVersion = () => {
  const state = persist.get('main')
  if (!isRecord(state) || !isRecord(state['__'])) {
    // log.info('Persisted state: returning base state')
    return state
  }

  // valid states are less than or equal to the latest migration we know about
  const versions = Object.keys(state['__'])
  const numericVersions = versions.map((version) => {
    if (!/^\d+$/u.test(version)) throw new Error('Saved state contains an invalid version')
    return Number(version)
  })
  const futureVersion = numericVersions.find((version) => version > migrations.latest)
  if (futureVersion !== undefined) {
    throw new Error(`Saved state version ${futureVersion} is newer than Wren supports`)
  }
  versions.sort((a, b) => Number(a) - Number(b))

  if (versions.length === 0) {
    // log.info('Persisted state: returning base state')
    return state
  }

  const latest = versions[versions.length - 1]
  if (!latest) return state
  // log.info('Persisted state: returning latest state version: ', latest)
  const entry = state['__'][latest]
  return isRecord(entry) && isRecord(entry['main']) ? entry['main'] : undefined
}

const get = (path: string, initial: unknown = latestStateVersion()) => {
  let value = initial
  path.split('.').some((key) => {
    if (!isRecord(value)) {
      value = undefined
    } else {
      value = value[key]
    }
    return value === undefined // Stop navigating the path if we get to undefined value
  })
  return value
}

const main = (path: string, def: unknown) => {
  const found = get(path)
  if (found === undefined) return def
  return found
}

const persistedDesktopAuthIdentity = DesktopAuthIdentitySchema.safeParse(get('desktopAuthIdentity'))
const desktopAuthIdentity = persistedDesktopAuthIdentity.success
  ? persistedDesktopAuthIdentity.data
  : createDesktopAuthIdentity(generateUuid())
const persistedMigrationVersion = Number(main('_version', 49))

const mainState = {
  _version: persistedMigrationVersion,
  instanceId: main('instanceId', generateUuid()),
  colorway: main('colorway', 'dark'),
  colorwayPrimary: {
    dark: {
      background: 'rgb(17, 21, 19)',
      text: 'rgb(231, 238, 232)'
    },
    light: {
      background: 'rgb(17, 21, 19)',
      text: 'rgb(231, 238, 232)'
    }
  },
  mute: {
    alphaWarning: main('mute.alphaWarning', false),
    welcomeWarning: main('mute.welcomeWarning', false),
    externalLinkWarning: main('mute.externalLinkWarning', false),
    explorerWarning: main('mute.explorerWarning', false),
    signerRelockChange: main('mute.signerRelockChange', false),
    gasFeeWarning: main('mute.gasFeeWarning', false),
    betaDisclosure: main('mute.betaDisclosure', false),
    onboardingWindow: main('mute.onboardingWindow', false),
    ...(get('mute.migrateToPylon') === undefined
      ? {}
      : { migrateToPylon: main('mute.migrateToPylon', true) }),
    signerCompatibilityWarning: main('mute.signerCompatibilityWarning', false)
  },
  shortcuts: {
    summon: main('shortcuts.summon', {
      modifierKeys: ['Alt'],
      shortcutKey: 'Slash',
      enabled: true,
      configuring: false
    })
  },
  // showUSDValue: main('showUSDValue', true),
  launch: main('launch', false),
  reveal: main('reveal', false),
  glideSide: main('glideSide', 'right'),
  interfaceScale: normalizeInterfaceScale(main('interfaceScale', 1)),
  showLocalNameWithENS: main('showLocalNameWithENS', false),
  autohide: main('autohide', false),
  transactionNotifications: main('transactionNotifications', true),
  rememberRecentRecipients: main('rememberRecentRecipients', false),
  accountCloseLock: main('accountCloseLock', false),
  hardwareDerivation: main('hardwareDerivation', 'mainnet'),
  menubarGasPrice: main('menubarGasPrice', false),
  lattice: main('lattice', {}),
  latticeSettings: {
    accountLimit: main('latticeSettings.accountLimit', 5),
    derivation: main('latticeSettings.derivation', 'standard'),
    endpointMode: main('latticeSettings.endpointMode', 'default'),
    endpointCustom: main('latticeSettings.endpointCustom', '')
  },
  ledger: {
    derivation: main('ledger.derivation', 'live'),
    liveAccountLimit: main('ledger.liveAccountLimit', 5)
  },
  trezor: {
    derivation: main('trezor.derivation', 'standard')
  },
  origins: main('origins', {}),
  extensionCredentials: main('extensionCredentials', {}),
  desktopAuthIdentity,
  nativePeerCredentials: main('nativePeerCredentials', {}),
  // Retain raw fields only long enough for pre-v19 migrations to consume them.
  // Each owning migration removes the retired representation before validation.
  ...(persistedMigrationVersion < 4 && get('gasPrice') !== undefined ? { gasPrice: get('gasPrice') } : {}),
  ...(persistedMigrationVersion < 4 && get('connection') !== undefined
    ? { connection: get('connection') }
    : {}),
  ...(persistedMigrationVersion < 19 && get('currentNetwork') !== undefined
    ? { currentNetwork: get('currentNetwork') }
    : {}),
  ...(persistedMigrationVersion < 19 && get('clients') !== undefined ? { clients: get('clients') } : {}),
  accounts: main('accounts', {}),
  accountsMeta: main('accountsMeta', {}),
  activity: main('activity', []),
  operationLifecycles: main('operationLifecycles', {}),
  outboundAddressMemory: pruneOutboundAddressMemory(main('outboundAddressMemory', {})),
  recentRecipientUses: pruneRecentRecipientUses(main('recentRecipientUses', [])),
  addressBook: main('addressBook', {}),
  ...(persistedMigrationVersion < 7 && get('addresses') !== undefined ? { addresses: get('addresses') } : {}),
  permissions: main('permissions', {}),
  dappGuardrails: main('dappGuardrails', {}),
  balances: {},
  tokens: main('tokens', { custom: [], known: {} }),
  rates: {}, // main('rates', {}),
  inventory: {}, // main('rates', {}),
  signers: {},
  savedSigners: {},
  updater: {
    dontRemind: main('updater.dontRemind', [])
  },
  walletCallBatches: main('walletCallBatches', {}),
  yearn: main('yearn', { catalogCache: null, workflows: {} }),
  networks: main('networks', {
    ethereum: {
      1: {
        id: 1,
        type: 'ethereum',
        layer: 'mainnet',
        name: 'Mainnet',
        isTestnet: false,
        explorer: 'https://etherscan.io',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: true
      },
      10: {
        id: 10,
        type: 'ethereum',
        layer: 'rollup',
        isTestnet: false,
        name: 'Optimism',
        explorer: 'https://optimistic.etherscan.io',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      },
      100: {
        id: 100,
        type: 'ethereum',
        layer: 'sidechain',
        isTestnet: false,
        name: 'Gnosis',
        explorer: 'https://blockscout.com/xdai/mainnet',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: false,
              current: 'custom',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: 'https://rpc.gnosischain.com'
            }
          ]
        },
        on: false
      },
      137: {
        id: 137,
        type: 'ethereum',
        layer: 'sidechain',
        isTestnet: false,
        name: 'Polygon',
        explorer: 'https://polygonscan.com',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      },
      8453: {
        id: 8453,
        type: 'ethereum',
        layer: 'rollup',
        isTestnet: false,
        name: 'Base',
        explorer: 'https://basescan.org',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      },
      747474: {
        id: 747474,
        type: 'ethereum',
        layer: 'rollup',
        isTestnet: false,
        name: 'Katana',
        explorer: 'https://katanascan.com',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'custom',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: 'https://rpc.katana.network/'
            }
          ]
        },
        on: false
      },
      42161: {
        id: 42161,
        type: 'ethereum',
        layer: 'rollup',
        isTestnet: false,
        name: 'Arbitrum',
        explorer: 'https://arbiscan.io',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      },
      84532: {
        id: 84532,
        type: 'ethereum',
        layer: 'testnet',
        isTestnet: true,
        name: 'Base Sepolia',
        explorer: 'https://sepolia.basescan.org/',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      },
      11155111: {
        id: 11155111,
        type: 'ethereum',
        layer: 'testnet',
        isTestnet: true,
        name: 'Sepolia',
        explorer: 'https://sepolia.etherscan.io',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      },
      11155420: {
        id: 11155420,
        type: 'ethereum',
        layer: 'testnet',
        isTestnet: true,
        name: 'Optimism Sepolia',
        explorer: 'https://sepolia-optimism.etherscan.io/',
        gas: {
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        connection: {
          endpoints: [
            {
              id: 'rpc-1',
              on: true,
              current: 'publicnode',
              status: 'loading',
              connected: false,
              type: '',
              network: '',
              custom: ''
            }
          ]
        },
        on: false
      }
    }
  }),
  networksMeta: main('networksMeta', {
    ethereum: {
      1: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'ETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png?1595348880',
          name: 'Ether',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent1' // Mainnet
      },
      10: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent4' // Optimism
      },
      100: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'xDAI',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'xDAI',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent5' // Gnosis
      },
      137: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'MATIC',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Matic',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent6' // Polygon
      },
      8453: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'ETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Ether',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent8' // Base
      },
      747474: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'ETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Ether',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent3' // Katana
      },
      42161: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent7' // Arbitrum
      },
      84532: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'sepETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Base Sepolia Ether',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent2' // Testnet
      },
      11155111: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'sepETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Sepolia Ether',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent2' // Testnet
      },
      11155420: {
        blockHeight: 0,
        gas: {
          fees: {},
          price: {
            selected: 'standard',
            levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
          }
        },
        nativeCurrency: {
          symbol: 'sepETH',
          usd: {
            price: 0,
            change24hr: 0
          },
          icon: '',
          name: 'Optimism Sepolia Ether',
          decimals: 18
        },
        icon: '',
        primaryColor: 'accent2' // Testnet
      }
    }
  }),
  dapps: main('dapps', {}),
  ipfs: {},
  frames: {},
  openDapps: [],
  dapp: {
    details: {},
    map: {
      added: [],
      docked: []
    },
    storage: {},
    removed: []
  }
}

const initial = {
  windows: {
    panel: {
      show: false,
      nav: [],
      footer: {
        height: 40
      }
    },
    dash: {
      show: false,
      nav: [],
      footer: {
        height: 40
      }
    },
    frames: []
  },
  panel: {
    // Panel view
    showing: false,
    nav: [],
    show: false,
    view: 'default',
    viewData: '',
    account: {
      moduleOrder: [
        'requests',
        // 'gas',
        'chains',
        'balances',
        'activity',
        'permissions',
        // 'verify',
        'signer',
        'settings'
      ],
      modules: {
        requests: {
          height: 0
        },
        balances: {
          height: 0
        },
        activity: {
          height: 0
        },
        inventory: {
          height: 0
        },
        permissions: {
          height: 0
        },
        verify: {
          height: 0
        },
        gas: {
          height: 100
        }
      }
    }
  },
  flow: {},
  dapps: {},
  view: {
    current: '',
    list: [],
    data: {},
    notify: '',
    notifyData: {},
    notifyId: '',
    notifyOwner: '',
    notifyQueue: [],
    interfaceScaleEffective: 1,
    badge: '',
    addAccount: '', // Add view (needs to be merged into Phase)
    addNetwork: false, // Phase view (needs to be merged with Add)
    clickGuard: false
  },
  signers: {},
  tray: {
    open: false,
    initial: true
  },
  balances: {},
  selected: {
    minimized: true,
    open: false,
    current: '',
    view: 'default',
    settings: {
      viewIndex: 0,
      views: ['permissions', 'verify', 'control'],
      subIndex: 0
    },
    addresses: [],
    showAccounts: false,
    hideBalances: false,
    accountPage: 0,
    position: {
      scrollTop: 0,
      initial: {
        top: 5,
        left: 5,
        right: 5,
        bottom: 5,
        height: 5,
        index: 0
      }
    }
  },
  frame: {
    type: 'tray'
  },
  node: {
    provider: false
  },
  provider: {
    events: []
  },
  version: packageFile.version,
  external: {
    rates: {}
  },
  platform: process.platform,
  main: mainState
}

function clearSessionState(state: z.infer<typeof StateSchema>) {
  clearSessionOnlyOrigins(state.main)

  Object.keys(state.main.accounts).forEach((id) => {
    const account = state.main.accounts[id]
    if (isRecord(account)) Reflect.set(account, 'balances', { lastUpdated: undefined })
  })

  Object.values(state.main.networks.ethereum).forEach((chain) => {
    chain.connection.endpoints = chain.connection.endpoints.map((endpoint) => ({
      ...endpoint,
      connected: false,
      latencyMs: undefined
    }))
  })

  Object.values(state.main.networksMeta.ethereum).forEach((chainMeta) => {
    chainMeta.nativeCurrency = {
      ...chainMeta.nativeCurrency,
      usd: { price: 0, change24hr: 0 }
    }
  })

  state.main.origins = Object.fromEntries(
    Object.entries(state.main.origins).map(([id, origin]) => [
      id,
      {
        ...origin,
        session: {
          ...origin.session,
          endedAt: origin.session.lastUpdatedAt
        }
      }
    ])
  )

  state.main.dapps = Object.fromEntries(
    Object.entries(state.main.dapps).map(([id, dapp]) => [id, { ...dapp, openWhenReady: false }])
  )

  return state
}

export default function () {
  const migratedState = migrations.apply(initial)
  const result = StateSchema.safeParse(migratedState)

  if (!result.success) {
    const issues = result.error.issues
    log.warn(`Found ${issues.length} issues while parsing saved state`, issues)
    throw new Error('Saved state is invalid after migration')
  }

  const validatedState = mergeValidatedState(migratedState, result.data)
  if (!isValidState(validatedState)) throw new Error('Validated state has an invalid shape')

  return clearSessionState(validatedState)
}
