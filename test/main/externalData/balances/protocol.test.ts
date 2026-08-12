import {
  BALANCE_RPC_MAX_RESPONSE_BYTES,
  parseBalanceRpcResponse,
  parseBalancesWorkerCommand,
  parseBalancesWorkerEvent
} from '../../../../main/externalData/balances/protocol'

const token = {
  address: '0x0000000000000000000000000000000000000001',
  chainId: 1,
  name: 'Token',
  symbol: 'TKN',
  decimals: 18
}

describe('balances worker protocol', () => {
  it('accepts known commands with typed arguments', () => {
    expect(
      parseBalancesWorkerCommand({
        command: 'tokenBalanceScan',
        args: [token.address, [token], [1]]
      })
    ).toEqual({ command: 'tokenBalanceScan', args: [token.address, [token], [1]] })
  })

  it('rejects unknown and malformed commands', () => {
    expect(parseBalancesWorkerCommand({ command: 'eraseWallet', args: [] })).toBeUndefined()
    expect(
      parseBalancesWorkerCommand({ command: 'updateChainBalance', args: [token.address, ['1']] })
    ).toBeUndefined()
    expect(
      parseBalancesWorkerCommand({
        command: 'updateChainBalance',
        args: [token.address, [{ chainId: 10, decimals: 18 }]]
      })
    ).toBeDefined()
    expect(
      parseBalancesWorkerCommand({
        command: 'updateChainBalance',
        args: [token.address, [{ chainId: 10, decimals: -1 }]]
      })
    ).toBeUndefined()
  })

  it('accepts known events and rejects malformed payloads', () => {
    expect(parseBalancesWorkerEvent({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(
      parseBalancesWorkerEvent({
        type: 'tokenBalances',
        address: token.address,
        balances: [{ ...token, balance: '0x1', displayBalance: '1' }]
      })
    ).toBeDefined()
    expect(
      parseBalancesWorkerEvent({ type: 'chainBalances', address: token.address, balances: [{}] })
    ).toBeUndefined()
  })

  it('accepts only bounded read-only RPC requests with an explicit canonical chain', () => {
    expect(
      parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 1,
        chainId: 1,
        method: 'eth_getBalance',
        params: [token.address, 'latest']
      })
    ).toBeDefined()
    expect(
      parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 2,
        chainId: 10,
        method: 'eth_call',
        params: [{ to: token.address, data: '0x70a08231', value: '0x0' }, 'latest']
      })
    ).toBeDefined()

    expect(
      parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 3,
        chainId: 1,
        method: 'eth_sendTransaction',
        params: []
      })
    ).toBeUndefined()
    expect(
      parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 4,
        chainId: 0,
        method: 'eth_getBalance',
        params: [token.address, 'latest']
      })
    ).toBeUndefined()
    expect(
      parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 5,
        chainId: 1,
        method: 'eth_call',
        params: [{ to: token.address, data: '0x', from: token.address }, 'latest']
      })
    ).toBeUndefined()
    expect(
      parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 6,
        chainId: 1,
        method: 'eth_getBalance',
        params: [token.address, 'pending']
      })
    ).toBeUndefined()
  })

  it('accepts bounded RPC responses and rejects malformed or oversized results', () => {
    const result = { id: 1, result: '0x0' }
    const error = { id: 2, error: { code: 4901, message: 'Requested chain is unavailable' } }

    expect(parseBalanceRpcResponse(result)).toEqual(result)
    expect(parseBalanceRpcResponse(error)).toEqual(error)
    expect(parseBalancesWorkerCommand({ command: 'rpcResponse', args: [result] })).toBeDefined()
    expect(parseBalanceRpcResponse({ id: 3, result: 'not hex' })).toBeUndefined()
    expect(parseBalanceRpcResponse({ ...error, extra: true })).toBeUndefined()
    expect(
      parseBalanceRpcResponse({ id: 4, result: `0x${'00'.repeat(BALANCE_RPC_MAX_RESPONSE_BYTES)}` })
    ).toBeUndefined()
  })
})
