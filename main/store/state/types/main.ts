import { z } from 'zod'

import { AccountMetadataSchema, AccountSchema } from './account'
import { ActivitySchema } from './activity'
import { AddressBookSchema } from './addressBook'
import { BalanceSchema } from './balance'
import { ChainMetadataSchema, ChainSchema } from './chain'
import { ColorwayPrimarySchema } from './colors'
import { DappSchema } from './dapp'
import { ExtensionCredentialsSchema } from './extensionCredential'
import { OriginSchema } from './origin'
import { OperationLifecyclesSchema } from './operationLifecycle'
import { PermissionSchema } from './permission'
import { ShortcutSchema } from './shortcuts'
import { WalletCallBatchesSchema } from './walletCallBatch'
import { YearnStateSchema } from './yearn'

const ShortcutsSchema = z.object({
  summon: ShortcutSchema
})

const UpdaterPreferencesSchema = z.object({
  dontRemind: z.array(z.string())
})

// these are individual keys on the main state object
const PreferencesSchema = {
  launch: z.boolean().default(false).describe('Launch Wren on system start'),
  reveal: z.boolean().default(false).describe('Show Wren when user glides mouse to edge of screen'),
  glideSide: z.enum(['left', 'right']).default('right').describe('Display edge used by Glide'),
  interfaceScale: z
    .union([z.literal(1), z.literal(1.25), z.literal(1.5)])
    .default(1)
    .describe('Requested interface scale'),
  autohide: z.boolean().default(false).describe('Automatically hide Wren when it loses focus'),
  transactionNotifications: z
    .boolean()
    .default(true)
    .describe('Show privacy-safe terminal transaction notifications while Wren is hidden'),
  accountCloseLock: z
    .boolean()
    .default(false)
    .describe("Lock an account when it's closed instead of when Wren restarts"),
  showLocalNameWithENS: z.boolean(),
  menubarGasPrice: z.boolean().default(false).describe('Show gas price in menu bar'),
  hardwareDerivation: z.string()
}

const notificationTypes = z.enum([
  'alphaWarning',
  'welcomeWarning',
  'externalLinkWarning',
  'explorerWarning',
  'signerRelockChange',
  'gasFeeWarning',
  'betaDisclosure',
  'onboardingWindow',
  'signerCompatibilityWarning',
  // Read-only compatibility for profiles created before migration 53.
  'migrateToPylon'
])

export const MainSchema = z.object({
  _version: z.coerce.number(),
  instanceId: z.uuid(),
  networks: z.object({
    ethereum: z.record(z.coerce.number(), ChainSchema)
  }),
  networksMeta: z.object({
    ethereum: z.record(z.coerce.number(), ChainMetadataSchema)
  }),
  origins: z.record(z.string().describe('Origin Id'), OriginSchema),
  extensionCredentials: ExtensionCredentialsSchema,
  permissions: z.record(
    z.string().describe('Address'),
    z.record(z.string().describe('Origin Id'), PermissionSchema)
  ),
  accounts: z.record(z.string(), AccountSchema),
  accountsMeta: z.record(z.string(), AccountMetadataSchema),
  activity: ActivitySchema,
  operationLifecycles: OperationLifecyclesSchema,
  addressBook: AddressBookSchema,
  balances: z.record(z.string().describe('Address'), z.array(BalanceSchema)),
  dapps: z.record(z.string(), DappSchema),
  mute: z.partialRecord(notificationTypes, z.boolean()),
  colorway: z.literal('dark').default('dark'),
  colorwayPrimary: ColorwayPrimarySchema,
  shortcuts: ShortcutsSchema,
  updater: UpdaterPreferencesSchema,
  walletCallBatches: WalletCallBatchesSchema,
  yearn: YearnStateSchema,
  ...PreferencesSchema
})

export type Main = z.infer<typeof MainSchema>
