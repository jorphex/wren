import {
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
})
