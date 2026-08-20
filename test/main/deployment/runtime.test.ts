import accounts from '../../../main/accounts'
import chains from '../../../main/chains'
import deployment from '../../../main/deployment/runtime'
import provider from '../../../main/provider'
import store from '../../../main/store'
import { requireStoreAction } from '../../../main/store/action'
import { simulateTransaction } from '../../../main/transaction/simulation'
import { WREN_DEPLOY_ORIGIN, originIdForName } from '../../../resources/domain/origin'

jest.mock('../../../main/accounts', () => ({ current: jest.fn() }))
jest.mock('../../../main/chains', () => ({ send: jest.fn() }))
jest.mock('../../../main/provider', () => ({
  connection: { connections: { ethereum: {} } },
  estimateGas: jest.fn(),
  getNonce: jest.fn(),
  sendTransaction: jest.fn()
}))
jest.mock('../../../main/store', () => jest.fn())
jest.mock('../../../main/store/action', () => ({ requireStoreAction: jest.fn() }))
jest.mock('../../../main/transaction/simulation', () => ({ simulateTransaction: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const originId = originIdForName(WREN_DEPLOY_ORIGIN)
const initcode = '0x60006000'
const draft = { account, chainId: 1, initcode, value: '' }
const actions: Record<string, jest.Mock> = {
  addOriginRequest: jest.fn(),
  initOrigin: jest.fn(),
  switchOriginChain: jest.fn()
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(accounts.current as jest.Mock).mockReturnValue({
    id: account,
    status: 'ok',
    lastSignerType: 'ring',
    getSigner: () => ({ type: 'ring' })
  })
  ;(requireStoreAction as jest.Mock).mockImplementation((name: string) => actions[name])
  ;(provider.connection.connections.ethereum as Record<number, unknown>)[1] = {
    chainConfig: { id: 1 },
    primary: { connected: true }
  }
  ;(store as unknown as jest.Mock).mockImplementation((...path: Array<string | number>) => {
    if (path.join('.') === 'main.networks.ethereum.1') return { id: 1, on: true }
    if (path.join('.') === 'main.networksMeta.ethereum.1.nativeCurrency.decimals') return 18
    if (path.join('.') === `main.origins.${originId}`) return undefined
  })
  ;(provider.estimateGas as jest.Mock).mockResolvedValue('0x186a0')
  ;(simulateTransaction as jest.Mock).mockResolvedValue({
    status: 'succeeded',
    source: 'eth_call',
    advancedChecks: { status: 'partly-unavailable' }
  })
  ;(provider.getNonce as jest.Mock).mockImplementation((_transaction, callback) =>
    callback({ result: '0x5' })
  )
})

it('checks the exact creation transaction only through the configured account network', async () => {
  const result = await deployment.prepare(draft)

  expect(result).toMatchObject({
    success: true,
    inspection: {
      account,
      chainId: '0x1',
      initcode: { bytes: 4 },
      value: '0x0',
      gasEstimate: { status: 'succeeded', source: 'configured-rpc' },
      simulation: { status: 'succeeded', source: 'configured-rpc', method: 'eth_call' },
      pendingNonce: { status: 'succeeded', source: 'configured-rpc', nonce: '0x5' }
    }
  })
  const transaction = { from: account, chainId: '0x1', data: initcode, value: '0x0' }
  expect(provider.estimateGas).toHaveBeenCalledWith(transaction)
  expect(simulateTransaction).toHaveBeenCalledWith(transaction, { send: expect.any(Function) })
  expect(provider.getNonce).toHaveBeenCalledWith(transaction, expect.any(Function))
  expect(provider.sendTransaction).not.toHaveBeenCalled()
})

it('queues the prepared no-destination transaction under the distinct managed Deploy principal', async () => {
  const prepared = await deployment.prepare(draft)
  if (!prepared.success) throw new Error(prepared.error)
  ;(provider.sendTransaction as jest.Mock).mockImplementation(
    (payload, _response, chain, onQueued, trustedMetadata) => {
      expect(payload).toMatchObject({
        method: 'eth_sendTransaction',
        chainId: '0x1',
        _origin: originId,
        params: [{ from: account, chainId: '0x1', data: initcode, value: '0x0' }]
      })
      expect(payload.params[0]).not.toHaveProperty('to')
      expect(chain).toEqual({ type: 'ethereum', id: 1 })
      expect(trustedMetadata).toEqual({
        deployment: expect.objectContaining({
          inspectionId: prepared.inspection.id,
          account,
          chainId: '0x1',
          initcodeBytes: 4,
          value: '0x0'
        })
      })
      expect(trustedMetadata).not.toHaveProperty('recentRecipient')
      onQueued('deployment-handler')
    }
  )

  await expect(deployment.queue({ inspectionId: prepared.inspection.id, draft })).resolves.toMatchObject({
    success: true,
    handlerId: 'deployment-handler'
  })
  expect(actions.initOrigin).toHaveBeenCalledWith(originId, {
    chain: { type: 'ethereum', id: 1 },
    name: WREN_DEPLOY_ORIGIN,
    provenance: 'managed',
    sessionOnly: false
  })
})

it('rejects a colliding managed Deploy principal before provider admission', async () => {
  const prepared = await deployment.prepare(draft)
  if (!prepared.success) throw new Error(prepared.error)
  const originalStore = (store as unknown as jest.Mock).getMockImplementation()
  ;(store as unknown as jest.Mock).mockImplementation((...path: Array<string | number>) => {
    if (path.join('.') === `main.origins.${originId}`) {
      return {
        name: 'https://collision.example',
        provenance: 'managed',
        chain: { type: 'ethereum', id: 1 }
      }
    }
    return originalStore?.(...path)
  })

  await expect(deployment.queue({ inspectionId: prepared.inspection.id, draft })).resolves.toEqual({
    success: false,
    error: 'origin-unavailable'
  })
  expect(provider.sendTransaction).not.toHaveBeenCalled()
})

it('does not move the managed Deploy origin while another-chain deployment awaits review', async () => {
  const otherDraft = { ...draft, chainId: 10 }
  ;(provider.connection.connections.ethereum as Record<number, unknown>)[10] = {
    chainConfig: { id: 10 },
    primary: { connected: true }
  }
  const originalStore = (store as unknown as jest.Mock).getMockImplementation()
  ;(store as unknown as jest.Mock).mockImplementation((...path: Array<string | number>) => {
    if (path.join('.') === `main.origins.${originId}`) {
      return {
        name: WREN_DEPLOY_ORIGIN,
        provenance: 'managed',
        chain: { type: 'ethereum', id: 1 }
      }
    }
    if (path.join('.') === 'main.accounts') {
      return {
        [account]: {
          requests: {
            pendingDeployment: {
              type: 'transaction',
              origin: originId,
              status: 'pending',
              data: { chainId: '0x1' }
            }
          }
        }
      }
    }
    if (path.join('.') === 'main.networks.ethereum.10') return { id: 10, on: true }
    if (path.join('.') === 'main.networksMeta.ethereum.10.nativeCurrency.decimals') return 18
    return originalStore?.(...path)
  })

  const prepared = await deployment.prepare(otherDraft)
  if (!prepared.success) throw new Error(prepared.error)
  await expect(
    deployment.queue({ inspectionId: prepared.inspection.id, draft: otherDraft })
  ).resolves.toEqual({
    success: false,
    error: 'deployment-pending'
  })
  expect(actions.addOriginRequest).not.toHaveBeenCalled()
  expect(actions.switchOriginChain).not.toHaveBeenCalled()
  expect(provider.sendTransaction).not.toHaveBeenCalled()
})

it('rejects another-chain deployment when a stale origin route already matches its target', async () => {
  const otherDraft = { ...draft, chainId: 137 }
  ;(provider.connection.connections.ethereum as Record<number, unknown>)[137] = {
    chainConfig: { id: 137 },
    primary: { connected: true }
  }
  const originalStore = (store as unknown as jest.Mock).getMockImplementation()
  ;(store as unknown as jest.Mock).mockImplementation((...path: Array<string | number>) => {
    if (path.join('.') === `main.origins.${originId}`) {
      return {
        name: WREN_DEPLOY_ORIGIN,
        provenance: 'managed',
        chain: { type: 'ethereum', id: 137 }
      }
    }
    if (path.join('.') === 'main.accounts') {
      return {
        [account]: {
          requests: {
            pendingDeployment: {
              type: 'transaction',
              origin: originId,
              status: 'pending',
              data: { chainId: '0x1' }
            }
          }
        }
      }
    }
    if (path.join('.') === 'main.networks.ethereum.137') return { id: 137, on: true }
    if (path.join('.') === 'main.networksMeta.ethereum.137.nativeCurrency.decimals') return 18
    return originalStore?.(...path)
  })

  const prepared = await deployment.prepare(otherDraft)
  if (!prepared.success) throw new Error(prepared.error)
  await expect(
    deployment.queue({ inspectionId: prepared.inspection.id, draft: otherDraft })
  ).resolves.toEqual({
    success: false,
    error: 'deployment-pending'
  })
  expect(actions.addOriginRequest).not.toHaveBeenCalled()
  expect(actions.switchOriginChain).not.toHaveBeenCalled()
  expect(provider.sendTransaction).not.toHaveBeenCalled()
})

it('maps private provider admission failures to a bounded queue error', async () => {
  const prepared = await deployment.prepare(draft)
  if (!prepared.success) throw new Error(prepared.error)
  ;(provider.sendTransaction as jest.Mock).mockImplementation((_payload, response) => {
    response({ error: { code: -32603, message: 'private upstream RPC detail' } })
  })

  await expect(deployment.queue({ inspectionId: prepared.inspection.id, draft })).resolves.toEqual({
    success: false,
    error: 'queue-unavailable'
  })
})

it('does not prepare for a watch-only or signerless current account', async () => {
  ;(accounts.current as jest.Mock).mockReturnValue({
    id: account,
    status: 'ok',
    lastSignerType: 'address',
    getSigner: () => undefined
  })

  await expect(deployment.prepare(draft)).resolves.toEqual({ success: false, error: 'watch-only' })
  expect(provider.estimateGas).not.toHaveBeenCalled()
  expect(chains.send).not.toHaveBeenCalled()
})
