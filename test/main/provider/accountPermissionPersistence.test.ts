import fs from 'fs'
import os from 'os'
import path from 'path'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => process.cwd()), on: jest.fn() } }))

import { FRAME_SEND_ORIGIN, originIdForInvoker } from '../../../resources/domain/origin'
import { applyAccountPermissionRendererAction } from '../../../main/provider/accountPermissionActions'
import { commitMainState, PersistStore } from '../../../main/store/persist'

const account = '0x0000000000000000000000000000000000000001'
const origin = 'https://durable.example'
const originId = originIdForInvoker(origin, { provenance: 'direct' })
const secondOrigin = 'https://second.example'
const secondOriginId = originIdForInvoker(secondOrigin, { provenance: 'direct' })

test('clearing external access survives restart while preserving managed access', () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-permission-revoke-'))

  try {
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    const main = {
      _version: 73,
      permissions: {
        [account]: {
          managed: {
            version: 1,
            handlerId: 'managed',
            origin: FRAME_SEND_ORIGIN,
            provider: true,
            parentCapability: 'eth_accounts',
            caveats: []
          },
          [originId]: {
            version: 1,
            handlerId: originId,
            origin,
            provider: true,
            parentCapability: 'eth_accounts',
            caveats: []
          },
          [secondOriginId]: {
            version: 1,
            handlerId: secondOriginId,
            origin: secondOrigin,
            provider: true,
            parentCapability: 'eth_accounts',
            caveats: []
          }
        }
      },
      dappGuardrails: {
        [account]: {
          [originId]: {
            '0x1': { version: 1, mode: 'block' }
          },
          [secondOriginId]: {
            '0x1': { version: 1, mode: 'warn' }
          }
        }
      },
      unrelatedQueuedState: 'preserved'
    }
    commitMainState(main, persisted)
    persisted.queue('main.unrelatedQueuedState', main.unrelatedQueuedState)

    expect(
      applyAccountPermissionRendererAction('clearPermissions', [account], {
        accounts: {
          getSelectedAddresses: () => [account],
          rejectUnapprovedRequestsForOrigins: () => true
        },
        provider: { accountsChanged: jest.fn() },
        getPermissions: (address) => main.permissions[address] || {},
        mutate: (address) => {
          const next = { managed: main.permissions[address].managed }
          main.permissions[address] = next
          persisted.queue(`main.permissions.${address}`, next)
        },
        removeGuardrails: (address, originIds) => {
          const next = { ...main.dappGuardrails[address] }
          originIds.forEach((id) => delete next[id])
          main.dappGuardrails[address] = next
          persisted.queue(`main.dappGuardrails.${address}`, next)
        },
        commit: () => commitMainState(main, persisted)
      })
    ).toBe(true)

    const restartedBeforeQueueFlush = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restartedBeforeQueueFlush.get('main') as {
      __: Record<string, { main: typeof main }>
    }
    const restored = envelope.__['73'].main
    expect(restored.permissions[account]).toEqual({ managed: main.permissions[account].managed })
    expect(restored.dappGuardrails[account]).toEqual({})
    expect(restored.unrelatedQueuedState).toBe('preserved')

    persisted.writeUpdates()
    const restartedAfterQueueFlush = new PersistStore({ configName: 'config', cwd: directory })
    const flushedEnvelope = restartedAfterQueueFlush.get('main') as {
      __: Record<string, { main: typeof main }>
    }
    expect(flushedEnvelope.__['73'].main).toEqual(restored)
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})
