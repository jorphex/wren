import fs from 'fs'
import os from 'os'
import path from 'path'

import { OperationLifecycleSchema } from '../../../main/store/state/types/operationLifecycle'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => process.cwd()), on: jest.fn() } }))

const root = path.resolve(__dirname, '../../..')

test('the provider exclusively owns successful transaction lifecycle admission', () => {
  const providerSource = fs.readFileSync(path.join(root, 'main/provider/index.ts'), 'utf8')
  const rpcSource = fs.readFileSync(path.join(root, 'main/rpc/index.js'), 'utf8')

  expect(providerSource.match(/accounts\.setTxSent\s*\(/gu)).toHaveLength(1)
  expect(rpcSource).not.toMatch(/accounts\.setTxSent\s*\(/u)
})

test('submitted transaction recovery is on disk before response while queued writes are pending', () => {
  jest.useFakeTimers()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-submitted-transaction-'))

  try {
    const { PersistStore, commitMainState } = jest.requireActual('../../../main/store/persist')
    const persisted = new PersistStore({ configName: 'config', cwd: directory })
    const operation = OperationLifecycleSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'transaction',
      account: `0x${'a'.repeat(40)}`,
      origin: 'app.example',
      chainId: 1,
      state: 'submitted',
      createdAt: 10,
      updatedAt: 10,
      expiresAt: 20,
      visibleInActivity: true,
      notification: {},
      transaction: { hash: `0x${'b'.repeat(64)}`, nonce: '0x0' }
    })
    const main = {
      accounts: {
        [operation.account]: {
          activeRequestId: 'transient-request',
          id: operation.account,
          requests: { 'transient-request': { payload: 'private' } }
        }
      },
      operationLifecycles: { [operation.id]: operation },
      queuedEvidence: 'preserved'
    }
    persisted.queue('main.queuedEvidence', main.queuedEvidence)
    let responded = false

    commitMainState(main, persisted)

    const restartedBeforeResponse = new PersistStore({ configName: 'config', cwd: directory })
    const envelope = restartedBeforeResponse.get('main') as {
      __: Record<string, { main: typeof main }>
    }
    const restored = Object.values(envelope.__).at(-1)?.main
    expect(responded).toBe(false)
    expect(jest.getTimerCount()).toBeGreaterThan(0)
    expect(restored?.operationLifecycles[operation.id]).toEqual(operation)
    expect(restored?.accounts[operation.account]).not.toHaveProperty('requests')
    expect(restored?.accounts[operation.account]).not.toHaveProperty('activeRequestId')

    responded = true
    persisted.writeUpdates()
    const restartedAfterQueueFlush = new PersistStore({ configName: 'config', cwd: directory })
    const flushedEnvelope = restartedAfterQueueFlush.get('main') as {
      __: Record<string, { main: typeof main }>
    }
    expect(Object.values(flushedEnvelope.__).at(-1)?.main).toEqual(restored)
  } finally {
    jest.clearAllTimers()
    jest.useRealTimers()
    fs.rmSync(directory, { force: true, recursive: true })
  }
})
