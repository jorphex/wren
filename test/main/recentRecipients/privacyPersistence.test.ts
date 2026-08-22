import fs from 'fs'
import os from 'os'
import path from 'path'

import { applyRecentRecipientPrivacyAction } from '../../../main/recentRecipients/runtime'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => process.cwd()), on: jest.fn() } }))
jest.mock('../../../main/store', () => jest.fn())
jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))
jest.mock('../../../main/operationLifecycle/runtime', () => ({
  __esModule: true,
  default: { observe: jest.fn() }
}))
jest.mock('../../../main/operationLifecycle', () => ({
  __esModule: true,
  default: { get: jest.fn(), listStored: jest.fn(() => []), put: jest.fn() }
}))

const recentUse = {
  operationId: '00000000-0000-4000-8000-000000000001',
  address: `0x${'a'.repeat(40)}`,
  confirmedAt: 10
}

test('a failed synchronous commit reports session-only clearing and restart restores disk state', () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-recent-recipient-clearing-'))

  try {
    const { PersistStore, commitMainState } = jest.requireActual('../../../main/store/persist')
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    const baseline = {
      _version: 73,
      rememberRecentRecipients: true,
      recentRecipientUses: [recentUse]
    }
    commitMainState(baseline, persisted)
    const session = structuredClone(baseline)

    const result = applyRecentRecipientPrivacyAction('disable', {
      updateSession: () => {
        session.rememberRecentRecipients = false
        session.recentRecipientUses = []
      },
      clearPendingMetadata: () => true,
      commit: () =>
        commitMainState(session, {
          set: () => {
            throw new Error('profile commit failed')
          }
        })
    })

    expect(result).toEqual({
      success: false,
      durable: false,
      sessionOnly: true,
      error: 'persistence-failed'
    })
    expect(session).toMatchObject({ rememberRecentRecipients: false, recentRecipientUses: [] })

    const restarted = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restarted.get('main') as {
      __: Record<string, { main: typeof baseline }>
    }
    expect(Object.values(envelope.__).at(-1)?.main).toMatchObject({
      rememberRecentRecipients: true,
      recentRecipientUses: [recentUse]
    })
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

test('a failed Activity commit restores history and address memories after restart', () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-activity-clearing-'))
  const digest = 'b'.repeat(64)
  const activity = {
    id: '00000000-0000-4000-8000-000000000002',
    account: `0x${'c'.repeat(40)}`,
    origin: 'example.test',
    type: 'transaction',
    outcome: 'confirmed',
    createdAt: 10,
    completedAt: 10,
    chainId: 1
  }

  try {
    const { PersistStore, commitMainState } = jest.requireActual('../../../main/store/persist')
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    const baseline = {
      _version: 73,
      activity: [activity],
      outboundAddressMemory: {
        [digest]: { digest, prefix: '1234', suffix: 'abcd', lastSubmittedAt: 10 }
      },
      recentRecipientUses: [recentUse]
    }
    commitMainState(baseline, persisted)
    const session = structuredClone(baseline)

    const result = applyRecentRecipientPrivacyAction('activity', {
      updateSession: () => {
        session.activity = []
        session.outboundAddressMemory = {}
        session.recentRecipientUses = []
      },
      clearPendingMetadata: () => true,
      commit: () =>
        commitMainState(session, {
          set: () => {
            throw new Error('profile commit failed')
          }
        })
    })

    expect(result).toEqual({
      success: false,
      durable: false,
      sessionOnly: true,
      error: 'persistence-failed'
    })
    expect(session).toMatchObject({ activity: [], outboundAddressMemory: {}, recentRecipientUses: [] })

    const restarted = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restarted.get('main') as {
      __: Record<string, { main: typeof baseline }>
    }
    expect(Object.values(envelope.__).at(-1)?.main).toMatchObject({
      activity: [activity],
      outboundAddressMemory: baseline.outboundAddressMemory,
      recentRecipientUses: [recentUse]
    })
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})
