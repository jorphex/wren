import fs from 'fs'
import os from 'os'
import path from 'path'
import Conf from 'conf'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => process.cwd()), on: jest.fn() } }))
jest.mock('electron-log', () => ({ error: jest.fn(), info: jest.fn() }))

import { completeGeneratedWalletAccount } from '../../../main/rpc/generatedWallet'
import migrations from '../../../main/store/migrate'
import { commitMainState, PersistStore } from '../../../main/store/persist'

const ADDRESS = '0x0000000000000000000000000000000000000001'
const SIGNER_ID = 'generated-signer'

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

test('durably commits a sanitized generated account before the periodic queue flush', async () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-generated-wallet-'))

  try {
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    const main = {
      _version: migrations.latest,
      accounts: {},
      signers: {},
      unrelatedQueuedState: 'preserved'
    } as {
      _version: number
      accounts: Record<string, Record<string, unknown>>
      signers: Record<string, Record<string, unknown>>
      unrelatedQueuedState: string
    }
    persisted.queue('main.unrelatedQueuedState', main.unrelatedQueuedState)

    const accounts = {
      add: jest.fn(
        (address: string, name: string, options: unknown, cb: (error: null, value: unknown) => void) => {
          const id = address.toLowerCase()
          const account = {
            active: false,
            id,
            name,
            options,
            requests: { transient: { payload: 'private' } }
          }
          main.accounts[id] = account
          cb(null, account)
        }
      ),
      current: jest.fn(() => undefined),
      get: jest.fn((id: string) => main.accounts[id]),
      getSelectedAddresses: jest.fn().mockReturnValueOnce([]).mockReturnValue([ADDRESS]),
      remove: jest.fn((id: string) => delete main.accounts[id]),
      setSigner: jest.fn((id: string, cb: (error: null, value: unknown) => void) => {
        main.accounts[id].active = true
        cb(null, main.accounts[id])
      })
    }
    const signers = {
      completeGeneratedWallet: jest.fn(
        (id: string, proof: unknown, cb: (error: null, value: unknown) => void) => {
          main.signers[SIGNER_ID] = { addresses: [ADDRESS], id: SIGNER_ID, type: 'seed' }
          cb(null, { address: ADDRESS, id: SIGNER_ID, type: 'seed' })
        }
      ),
      remove: jest.fn((id: string) => delete main.signers[id])
    }
    const cb = jest.fn()

    completeGeneratedWalletAccount(
      {
        accounts,
        commitState: () => commitMainState(main, persisted),
        log: { warn: jest.fn() },
        provider: { accountsChanged: jest.fn() },
        signers
      },
      'session',
      { words: ['one', 'two', 'three'] },
      cb
    )
    await flush()

    expect(cb).toHaveBeenCalledWith(null, expect.objectContaining({ accountId: ADDRESS, id: SIGNER_ID }))
    expect(jest.getTimerCount()).toBeGreaterThan(0)

    const restarted = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restarted.get('main') as {
      __: Record<string, { main: typeof main }>
    }
    const restored = envelope.__[String(migrations.latest)].main
    expect(restored.unrelatedQueuedState).toBe('preserved')
    expect(restored.signers[SIGNER_ID]).toMatchObject({ addresses: [ADDRESS], type: 'seed' })
    expect(restored.accounts[ADDRESS]).toMatchObject({ active: true, id: ADDRESS })
    expect(restored.accounts[ADDRESS]).not.toHaveProperty('requests')

    persisted.writeUpdates()
    const restartedAfterQueueFlush = new PersistStore({ configName: 'config', cwd: directory })
    const flushedEnvelope = restartedAfterQueueFlush.get('main') as {
      __: Record<string, { main: typeof main }>
    }
    expect(flushedEnvelope.__[String(migrations.latest)].main).toEqual(restored)
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

test('preserves unrelated queued updates when an immediate profile commit throws', () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-generated-wallet-'))
  const baseSet = jest.spyOn(Conf.prototype, 'set')

  try {
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    persisted.queue('main.unrelatedQueuedState', 'preserved')
    baseSet.mockImplementationOnce(() => {
      throw new Error('profile commit failed')
    })

    expect(() => commitMainState({ _version: migrations.latest, accounts: {} }, persisted)).toThrow(
      'profile commit failed'
    )

    baseSet.mockRestore()
    persisted.writeUpdates()
    const restarted = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restarted.get('main') as {
      __: Record<string, { main: { unrelatedQueuedState: string } }>
    }
    expect(envelope.__[String(migrations.latest)].main.unrelatedQueuedState).toBe('preserved')
  } finally {
    baseSet.mockRestore()
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})
