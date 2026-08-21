import deepEqual from 'deep-equal'
import log from 'electron-log'

import { Colorway, getColor } from '../../../resources/colors'
import { safeNetworkMetadata } from '../../../resources/domain/networkMetadata'
import store from '../../store'

import type { Chain, ChainMetadata, Origin } from '../../store/state'

// typed access to state
const storeApi = {
  getCurrentOrigins: (): Record<string, Origin> => {
    return store('main.origins')
  },
  getChains: (): Record<string, Chain> => {
    return store('main.networks.ethereum') || {}
  },
  getChainsMeta: (): Record<string, ChainMetadata> => {
    return store('main.networksMeta.ethereum') || {}
  },
  getColorway: (): Colorway => {
    return store('main.colorway') as Colorway
  }
}

interface ChainsChangedHandler {
  chainsChanged: (address: Address, chains: RPC.GetEthereumChains.Chain[]) => void
}

interface ChainChangedHandler {
  chainChanged: (chainId: number, originId: string) => void
}

interface NetworkChangedHandler {
  networkChanged: (networkId: number, originId: string) => void
}

let reportedInvalidChainErrors = new Map<number, string>()

function createChainsObserver(handler: ChainsChangedHandler) {
  let availableChains: RPC.GetEthereumChains.Chain[] = []
  try {
    availableChains = getActiveChains()
  } catch {
    // getActiveChains records the affected chain ids. Keep the provider alive so
    // the catalog can recover when network metadata is repaired.
  }

  return function () {
    let currentChains: RPC.GetEthereumChains.Chain[]
    try {
      currentChains = getActiveChains()
    } catch {
      return
    }

    if (!deepEqual(currentChains, availableChains)) {
      availableChains = currentChains

      setTimeout(() => {
        const currentAccount = store('selected.current') as string
        handler.chainsChanged(currentAccount, availableChains)
      }, 0)
    }
  }
}

function createOriginChainObserver(handler: ChainChangedHandler & NetworkChangedHandler) {
  let knownOrigins: Record<string, Origin> = {}

  return function () {
    const currentOrigins = storeApi.getCurrentOrigins()

    for (const originId in currentOrigins) {
      const currentOrigin = currentOrigins[originId]
      if (!currentOrigin) continue
      const knownOrigin = knownOrigins[originId]

      if (knownOrigin && knownOrigin.chain.id !== currentOrigin.chain.id) {
        handler.chainChanged(currentOrigin.chain.id, originId)
        handler.networkChanged(currentOrigin.chain.id, originId)
      }

      knownOrigins[originId] = currentOrigin
    }
  }
}

function getActiveChains(): RPC.GetEthereumChains.Chain[] {
  const chains = storeApi.getChains()
  const meta = storeApi.getChainsMeta()
  const colorway = storeApi.getColorway()
  const invalidChainErrors = new Map<number, string>()

  const activeChains = Object.values(chains)
    .filter((chain) => chain.on)
    .sort((a, b) => a.id - b.id)
  const availableChains = activeChains.flatMap((chain) => {
    try {
      const { id, explorer, name } = chain
      const storedMetadata = meta[id]
      if (!storedMetadata) {
        invalidChainErrors.set(id, 'metadata is missing; using safe fallback')
      }
      const chainMetadata = safeNetworkMetadata(storedMetadata, chain)
      const { nativeCurrency, primaryColor } = chainMetadata
      const { icon: currencyIcon, name: currencyName, symbol, decimals } = nativeCurrency

      const icons = currencyIcon ? [{ url: currencyIcon }] : []
      let colors: ReturnType<typeof getColor>[] = []
      if (primaryColor) {
        try {
          colors = [getColor(primaryColor, colorway)]
        } catch {
          invalidChainErrors.set(id, 'primary color is invalid; omitting wallet color')
        }
      }

      return [
        {
          chainId: id,
          networkId: id,
          name,
          connected: chain.connection.endpoints.some((endpoint) => endpoint.connected),
          nativeCurrency: {
            name: currencyName,
            symbol,
            decimals
          },
          icon: icons,
          explorers: [{ url: explorer }],
          external: {
            wallet: { colors }
          }
        }
      ]
    } catch (error) {
      invalidChainErrors.set(chain.id, error instanceof Error ? error.message : String(error))
      return []
    }
  })

  for (const [chainId, error] of invalidChainErrors) {
    if (reportedInvalidChainErrors.get(chainId) === error) continue
    log.warn('Active network needed Companion catalog recovery', { chainId, error })
  }
  reportedInvalidChainErrors = invalidChainErrors

  return availableChains
}

export { getActiveChains, createChainsObserver, createOriginChainObserver }
