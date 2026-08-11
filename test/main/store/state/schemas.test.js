import { DappSchema } from '../../../../main/store/state/types/dapp'
import { MainSchema } from '../../../../main/store/state/types/main'
import { AccountMetadataSchema, AccountSchema } from '../../../../main/store/state/types/account'
import { OriginSchema } from '../../../../main/store/state/types/origin'
import { ConnectionSchema } from '../../../../main/store/state/types/connection'
import { GasSchema } from '../../../../main/store/state/types/gas'
import { AddressBookSchema } from '../../../../main/store/state/types/addressBook'

describe('persisted state schema compatibility', () => {
  it('validates normalized address-book records', () => {
    const entry = {
      address: '0x0000000000000000000000000000000000000001',
      name: 'Treasury',
      note: '',
      createdAt: 1,
      updatedAt: 2
    }
    expect(AddressBookSchema.parse({ [entry.address]: entry })).toEqual({ [entry.address]: entry })
    expect(() => AddressBookSchema.parse({ [entry.address]: { ...entry, updatedAt: 0 } })).toThrow()
    expect(() =>
      AddressBookSchema.parse({ [entry.address]: { ...entry, name: 'Spoofed\u202e treasury' } })
    ).toThrow()
  })

  it('accepts notification records from before every notification key existed', () => {
    expect(MainSchema.shape.mute.parse({ gasFeeWarning: true })).toStrictEqual({ gasFeeWarning: true })
  })

  it('accepts only supported persisted interface scales', () => {
    expect(MainSchema.shape.interfaceScale.parse(undefined)).toBe(1)
    expect(MainSchema.shape.interfaceScale.parse(1.25)).toBe(1.25)
    expect(() => MainSchema.shape.interfaceScale.parse(2)).toThrow()
  })

  it('accepts cached dapps without a manifest or lifecycle fields', () => {
    expect(
      DappSchema.parse({
        ens: 'example.eth',
        status: 'initial',
        config: {}
      })
    ).toStrictEqual({
      ens: 'example.eth',
      status: 'initial',
      config: {},
      openWhenReady: false,
      checkStatusRetryCount: 0
    })
  })

  it('validates known account fields while preserving legacy fields', () => {
    expect(
      AccountSchema.parse({
        name: 'Hardware account',
        active: false,
        requests: {},
        activeRequestId: null,
        balances: { lastUpdated: 123 },
        legacyMarker: 'preserved'
      })
    ).toStrictEqual({
      name: 'Hardware account',
      active: false,
      requests: {},
      activeRequestId: null,
      balances: { lastUpdated: 123 },
      legacyMarker: 'preserved'
    })

    expect(() => AccountSchema.parse({ active: 'yes' })).toThrow()
    expect(() => AccountSchema.parse({ requests: [] })).toThrow()
    expect(() => AccountSchema.parse({ activeRequestId: 1 })).toThrow()
    expect(() => AccountSchema.parse({ balances: { lastUpdated: -1 } })).toThrow()
  })

  it('validates account metadata and preserves future fields', () => {
    expect(
      AccountMetadataSchema.parse({ name: 'Named account', lastUpdated: 123, source: 'local' })
    ).toStrictEqual({ name: 'Named account', lastUpdated: 123, source: 'local' })

    expect(() => AccountMetadataSchema.parse({ name: 'Named account' })).toThrow()
  })

  it('accepts object dapp manifests without treating their values as trusted', () => {
    const dapp = {
      ens: 'example.eth',
      status: 'ready',
      config: {},
      openWhenReady: false,
      manifest: { version: 1, nested: { content: 'bafy-content' } }
    }

    expect(DappSchema.parse(dapp).manifest).toEqual(dapp.manifest)
    expect(() => DappSchema.parse({ ...dapp, manifest: 'bafy-manifest' })).toThrow()
  })

  it('defaults legacy origins to persistent and validates session-only markers', () => {
    const origin = {
      name: 'example.com',
      chain: { id: 1, type: 'ethereum' },
      session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
    }

    expect(OriginSchema.parse(origin)).toMatchObject({ sessionOnly: false })
    expect(OriginSchema.parse({ ...origin, sessionOnly: true })).toMatchObject({ sessionOnly: true })
    expect(() => OriginSchema.parse({ ...origin, sessionOnly: 'yes' })).toThrow()
  })

  it.each(['degraded', 'pending', 'syncing'])('persists the %s runtime connection status', (status) => {
    expect(
      ConnectionSchema.parse({
        id: 'rpc-1',
        on: true,
        connected: false,
        current: 'custom',
        status,
        custom: 'https://rpc.example.test'
      }).status
    ).toBe(status)
  })

  it('accepts PublicNode and rejects the retired Pylon preset', () => {
    const connection = {
      id: 'rpc-1',
      on: true,
      connected: false,
      status: 'loading',
      custom: ''
    }

    expect(ConnectionSchema.parse({ ...connection, current: 'publicnode' }).current).toBe('publicnode')
    expect(() => ConnectionSchema.parse({ ...connection, current: 'pylon' })).toThrow()
  })

  it('persists unavailable EIP-1559 fee data as null', () => {
    expect(
      GasSchema.parse({
        samples: [],
        price: { selected: 'fast', levels: { fast: '0x1' }, fees: null }
      }).price.fees
    ).toBeNull()
  })
})
