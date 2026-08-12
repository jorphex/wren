import BigNumber from 'bignumber.js'
import { Interface, toBeHex } from 'ethers'
import { addHexPrefix } from '@ethereumjs/util'
import log from 'electron-log'

import multicall, { Call, supportsChain as multicallSupportsChain } from '../../multicall'
import erc20TokenAbi from './erc-20-abi'
import { groupByChain, TokensByChain } from './reducers'

import type { BytesLike } from 'ethers'
import type EthereumProvider from 'ethereum-provider'
import type { Balance, Token } from '../../store/state'

const erc20Interface = new Interface(erc20TokenAbi)

interface ExternalBalance {
  balance: string
  displayBalance: string
}

export interface TokenDefinition extends Omit<Token, 'logoURI'> {
  logoUri?: string
}

export interface TokenBalance extends TokenDefinition, ExternalBalance {}

export interface CurrencyBalance extends ExternalBalance {
  chainId: number
}

export interface NativeCurrencyTarget {
  chainId: number
  decimals: number
}

export interface BalanceLoader {
  getCurrencyBalances: (address: Address, chains: NativeCurrencyTarget[]) => Promise<CurrencyBalance[]>
  getTokenBalances: (address: Address, tokens: TokenDefinition[]) => Promise<TokenBalance[]>
}

function createBalance(rawBalance: string, decimals: number): ExternalBalance {
  return {
    balance: rawBalance,
    displayBalance: new BigNumber(rawBalance).shiftedBy(-decimals).toString()
  }
}

export default function (eth: EthereumProvider) {
  function balanceCalls(owner: string, tokens: TokenDefinition[]): Call<bigint, ExternalBalance>[] {
    return tokens.map((token) => ({
      target: token.address,
      call: ['function balanceOf(address owner) returns (uint256 value)', owner],
      returns: [
        (bn?: bigint) => {
          const hexString = bn !== undefined ? toBeHex(bn) : '0x00'
          return createBalance(hexString, token.decimals)
        }
      ]
    }))
  }

  async function getNativeCurrencyBalance(address: string, { chainId, decimals }: NativeCurrencyTarget) {
    try {
      const rawBalance: string = await eth.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
        chainId: addHexPrefix(chainId.toString(16))
      })

      return { ...createBalance(rawBalance, decimals), chainId }
    } catch (e) {
      log.error(`error loading native currency balance for chain id: ${chainId}`, e)
      return { balance: '0x0', displayBalance: '0.0', chainId }
    }
  }

  async function getTokenBalance(token: TokenDefinition, owner: string) {
    const functionData = erc20Interface.encodeFunctionData('balanceOf', [owner])

    const response: BytesLike = await eth.request({
      method: 'eth_call',
      chainId: addHexPrefix(token.chainId.toString(16)),
      params: [{ to: token.address, value: '0x0', data: functionData }, 'latest']
    })

    const result = erc20Interface.decodeFunctionResult('balanceOf', response)
    const balance = result[0]
    if (balance === undefined) throw new Error('balanceOf returned no balance')

    return toBeHex(balance)
  }

  async function getTokenBalancesFromContracts(owner: string, tokens: TokenDefinition[]) {
    const balances = tokens.map(async (token) => {
      try {
        const rawBalance = await getTokenBalance(token, owner)

        return {
          ...token,
          ...createBalance(rawBalance, token.decimals)
        }
      } catch (e) {
        log.warn(`could not load balance for token with address ${token.address}`, e)
        return undefined
      }
    })

    const loadedBalances = await Promise.all(balances)

    return loadedBalances.filter((bal) => bal !== undefined) as Balance[]
  }

  async function getTokenBalancesFromMulticall(owner: string, tokens: TokenDefinition[], chainId: number) {
    const calls = balanceCalls(owner, tokens)

    const results = await multicall(chainId, eth).batchCall(calls)

    return results.reduce((acc, result, i) => {
      const token = tokens[i]
      const balance = result.returnValues[0]
      if (result.success && token && balance) {
        acc.push({
          ...token,
          ...balance
        })
      }

      return acc
    }, [] as Balance[])
  }

  return {
    getCurrencyBalances: async function (address: string, chains: NativeCurrencyTarget[]) {
      const fetchChainBalance = getNativeCurrencyBalance.bind(null, address)

      return Promise.all(chains.map(fetchChainBalance))
    },
    getTokenBalances: async function (owner: string, tokens: TokenDefinition[]) {
      const tokensByChain = tokens.reduce(groupByChain, {} as TokensByChain)

      const tokenBalances = await Promise.all(
        Object.entries(tokensByChain).map(([chain, tokens]) => {
          const chainId = parseInt(chain)

          return multicallSupportsChain(chainId)
            ? getTokenBalancesFromMulticall(owner, tokens, chainId)
            : getTokenBalancesFromContracts(owner, tokens)
        })
      )

      return ([] as TokenBalance[]).concat(...tokenBalances)
    }
  } as BalanceLoader
}
