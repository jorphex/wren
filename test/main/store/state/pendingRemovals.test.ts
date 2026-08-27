import fs from 'fs'
import os from 'os'
import path from 'path'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => process.cwd()), on: jest.fn() } }))

import { commitMainState, PersistStore } from '../../../../main/store/persist'
import migrations from '../../../../main/store/migrate'
import { applyPendingRemovalJournals } from '../../../../main/store/state/pendingRemovals'

const removedAccount = '0x0000000000000000000000000000000000000001'
const removedSignerAccount = '0x0000000000000000000000000000000000000002'
const retainedAccount = '0x0000000000000000000000000000000000000003'

test('a persisted removal journal suppresses removed accounts and access on restart', () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-removal-journal-'))

  try {
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    commitMainState(
      {
        _version: migrations.latest,
        accounts: {
          [removedAccount]: { name: 'Removed account' },
          [removedSignerAccount]: { name: 'Removed signer account' },
          [retainedAccount]: { name: 'Retained account' }
        },
        dappGuardrails: {
          [removedSignerAccount]: { guardrail: true },
          [retainedAccount]: { guardrail: true }
        },
        pendingAccountRemovals: [removedAccount],
        pendingSignerRemovals: {
          signer: { addresses: [removedSignerAccount], kind: 'hot' }
        },
        permissions: {
          [removedAccount]: { permission: true },
          [retainedAccount]: { permission: true }
        }
      },
      persisted
    )

    const restarted = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restarted.get('main') as {
      __: Record<string, { main: Record<string, unknown> }>
    }
    const projected = applyPendingRemovalJournals(envelope.__[String(migrations.latest)].main)

    expect(Object.keys(projected.accounts)).toEqual([retainedAccount])
    expect(projected.permissions).toEqual({ [retainedAccount]: { permission: true } })
    expect(projected.dappGuardrails).toEqual({ [retainedAccount]: { guardrail: true } })
    expect(projected.pendingAccountRemovals).toEqual([])
    expect(projected.pendingSignerRemovals).toEqual({
      signer: { addresses: [removedSignerAccount], kind: 'hot' }
    })
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

test('malformed journal data cannot prevent profile restoration', () => {
  expect(
    applyPendingRemovalJournals({
      accounts: { [retainedAccount]: { name: 'Retained account' } },
      dappGuardrails: { [retainedAccount]: { guardrail: true } },
      pendingAccountRemovals: 'not-an-array',
      pendingSignerRemovals: {
        invalid: { addresses: 'not-an-array' },
        '../../target': { addresses: [removedAccount], kind: 'hot' },
        valid: {
          addresses: [removedSignerAccount, 'not-an-address', removedSignerAccount.toUpperCase()],
          kind: 'hot'
        }
      },
      permissions: { [retainedAccount]: { permission: true } }
    })
  ).toEqual({
    accounts: { [retainedAccount]: { name: 'Retained account' } },
    dappGuardrails: { [retainedAccount]: { guardrail: true } },
    lattice: {},
    pendingAccountRemovals: [],
    pendingSignerRemovals: { valid: { addresses: [removedSignerAccount], kind: 'hot' } },
    permissions: { [retainedAccount]: { permission: true } }
  })
})

test('selects a retained account and retires one-shot account journals after restart', () => {
  expect(
    applyPendingRemovalJournals({
      accounts: {
        [removedAccount]: { active: true, name: 'Removed account' },
        [retainedAccount]: { active: false, name: 'Retained account' }
      },
      pendingAccountRemovals: [removedAccount]
    })
  ).toMatchObject({
    accounts: { [retainedAccount]: { active: true, name: 'Retained account' } },
    pendingAccountRemovals: []
  })
})

test('honors an explicit account removal even when its signer summary remains', () => {
  expect(
    applyPendingRemovalJournals({
      accounts: {
        [removedAccount]: { active: true, name: 'Explicitly removed account' },
        [retainedAccount]: { active: false, name: 'Retained account' }
      },
      pendingAccountRemovals: [removedAccount],
      signers: {
        owner: { addresses: [removedAccount] }
      }
    })
  ).toMatchObject({
    accounts: { [retainedAccount]: { active: true, name: 'Retained account' } },
    pendingAccountRemovals: []
  })
})

test('finishes a typed legacy Lattice journal without using its id as a file path', () => {
  const legacyId = 'legacy device.id'
  expect(
    applyPendingRemovalJournals({
      accounts: { [removedSignerAccount]: { name: 'Removed account' } },
      lattice: { [legacyId]: { paired: true }, retained: { paired: true } },
      pendingSignerRemovals: {
        [`lattice-${legacyId}`]: {
          addresses: [removedSignerAccount],
          deviceId: legacyId,
          kind: 'lattice'
        }
      }
    })
  ).toMatchObject({
    accounts: {},
    lattice: { retained: { paired: true } },
    pendingSignerRemovals: {}
  })
})

test('preserves a journaled account that a different signer owns before restart', () => {
  expect(
    applyPendingRemovalJournals({
      accounts: {
        [removedSignerAccount]: { active: true, name: 'Shared account' },
        [retainedAccount]: { active: false, name: 'Retained account' }
      },
      pendingSignerRemovals: {
        removed: { addresses: [removedSignerAccount], kind: 'hardware' }
      },
      signers: {
        removed: { addresses: [removedSignerAccount] },
        replacement: { addresses: [removedSignerAccount] }
      }
    })
  ).toMatchObject({
    accounts: {
      [removedSignerAccount]: { active: true, name: 'Shared account' },
      [retainedAccount]: { active: false, name: 'Retained account' }
    },
    pendingSignerRemovals: {}
  })
})

test('preserves proven replacement ownership across repeated restarts before hot cleanup', () => {
  const firstRestart = applyPendingRemovalJournals({
    accounts: {
      [removedSignerAccount]: { active: true, name: 'Shared account' },
      [retainedAccount]: { active: false, name: 'Retained account' }
    },
    pendingSignerRemovals: {
      removed: { addresses: [removedSignerAccount], kind: 'hot' }
    },
    signers: {
      replacement: { addresses: [removedSignerAccount] }
    }
  })

  expect(firstRestart.accounts).toHaveProperty(removedSignerAccount)
  expect(firstRestart.pendingSignerRemovals).toEqual({
    removed: { addresses: [], kind: 'hot' }
  })

  const secondRestart = applyPendingRemovalJournals({
    accounts: firstRestart.accounts,
    pendingSignerRemovals: firstRestart.pendingSignerRemovals,
    signers: {}
  })

  expect(secondRestart.accounts).toHaveProperty(removedSignerAccount)
  expect(secondRestart.pendingSignerRemovals).toEqual({
    removed: { addresses: [], kind: 'hot' }
  })
})
